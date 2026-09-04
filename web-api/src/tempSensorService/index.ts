import { STATUS_TYPES } from "../gpioPinService/constants.js";
import { TEMP_SENSOR_STATUS } from "../tempSensorController/constants.js";
import { createGpioPin, unwrapGpioPin } from "../types/nominal-utils.js";
import { getErrorReason } from "../utils.js";
import {
  TEMP_SENSOR_ERROR_TYPES,
  TEMP_SENSOR_EVENT_TYPES,
  TEMP_SENSOR_MESSAGES,
  TEMP_SENSOR_OUTCOMES,
  targetDataGpioPin,
} from "./constants.js";
import { decodeFrame } from "./decoder.js";
import { createPulseAccumulator } from "./pulseAccumulator.js";
import {
  createInitialTempSensorState,
  reduceTempSensorState,
} from "./reducer.js";
import { isTempSensorError } from "./types.guards.js";
import type {
  GpioEdge,
  TempSensorError,
  TempSensorEvent,
  TempSensorReading,
  TempSensorService,
  TempSensorServiceDependencies,
  TempSensorState,
  TempSensorSubscriber,
} from "./types.js";

/**
 * Builds the temperature sensor service.
 *
 * The GPIO pin service is injected, so the whole service can be exercised
 * against a simulated edge stream. Recoverable problems are emitted as error
 * values; only a failed start or stop throws, since those leave the service
 * unable to continue.
 */
export function createTempSensorService(
  dependencies: TempSensorServiceDependencies,
): TempSensorService {
  const pin = dependencies.pin ?? createGpioPin(targetDataGpioPin);
  const accumulator = createPulseAccumulator();
  const subscribers = new Set<TempSensorSubscriber>();
  let state: TempSensorState = createInitialTempSensorState();

  function dispatch(event: TempSensorEvent): void {
    state = reduceTempSensorState(state, event);
  }

  /** A throwing subscriber must not stop the others or the GPIO handler. */
  function notify(event: TempSensorReading | TempSensorError): void {
    subscribers.forEach((subscriber) => {
      try {
        subscriber(event);
      } catch (e: unknown) {
        dependencies.loggingService?.error({
          message: "Temp sensor subscriber threw",
          reason: getErrorReason(e),
        });
      }
    });
  }

  function publishError(error: TempSensorError): void {
    dispatch({ type: TEMP_SENSOR_EVENT_TYPES.DECODE_FAILED, error });
    dependencies.loggingService?.warning({
      message: "Temp sensor frame rejected",
      errorType: error.type,
      reason: error.message,
    });
    notify(error);
  }

  function publishReading(reading: TempSensorReading): void {
    dispatch({
      type: TEMP_SENSOR_EVENT_TYPES.READING_AVAILABLE,
      reading,
    });
    notify(reading);
  }

  function isRunning(): boolean {
    return state.status === TEMP_SENSOR_STATUS.RUNNING;
  }

  function handleGpioEdge(edge: GpioEdge): void {
    if (!isRunning()) return;

    const framePulses = accumulator.addEdge(edge);

    if (framePulses === undefined) return;

    const result = decodeFrame(framePulses);

    if (isTempSensorError(result)) {
      publishError(result);
      return;
    }

    publishReading(result);
  }

  function handleGpioError(reason: string): void {
    if (!isRunning()) return;

    accumulator.reset();
    publishError({ type: TEMP_SENSOR_ERROR_TYPES.SIGNAL, message: reason });
  }

  /** The polling child exiting on its own leaves the service stopped. */
  function handleGpioStatus(status: { status: string; pin?: number }): void {
    if (status.status !== STATUS_TYPES.EXITED || !isRunning()) return;

    dispatch({ type: TEMP_SENSOR_EVENT_TYPES.STOPPED });
    accumulator.reset();
    dependencies.loggingService?.warning({
      message: "GPIO polling exited while the temp sensor was running",
      pin: status.pin,
    });
  }

  // The GPIO pin service has no unsubscribe, so subscribe once here and let
  // the handlers ignore events that arrive while stopped.
  dependencies.gpioPinService.onData(handleGpioEdge);
  dependencies.gpioPinService.onError(handleGpioError);
  dependencies.gpioPinService.onStatus(handleGpioStatus);

  async function start(): Promise<void> {
    if (isRunning()) {
      throw new Error(TEMP_SENSOR_MESSAGES.ALREADY_RUNNING);
    }

    accumulator.reset();
    await dependencies.gpioPinService.startPolling(unwrapGpioPin(pin));
    dispatch({ type: TEMP_SENSOR_EVENT_TYPES.STARTED });
    dependencies.loggingService?.debug({
      message: "Temp sensor started",
      pin: unwrapGpioPin(pin),
    });
  }

  async function stop(): Promise<void> {
    if (state.status === TEMP_SENSOR_STATUS.STOPPED) {
      throw new Error(TEMP_SENSOR_MESSAGES.ALREADY_STOPPED);
    }

    await dependencies.gpioPinService.stopPolling();
    dispatch({ type: TEMP_SENSOR_EVENT_TYPES.STOPPED });
    accumulator.reset();
    dependencies.loggingService?.debug({ message: "Temp sensor stopped" });
  }

  /** Resolves with whichever of a reading or an error the last frame produced. */
  async function getLatestReading(): Promise<
    TempSensorReading | TempSensorError
  > {
    if (
      state.lastOutcome === TEMP_SENSOR_OUTCOMES.READING &&
      state.lastReading !== undefined
    ) {
      return state.lastReading;
    }

    if (
      state.lastOutcome === TEMP_SENSOR_OUTCOMES.ERROR &&
      state.lastError !== undefined
    ) {
      return state.lastError;
    }

    return {
      type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
      message: TEMP_SENSOR_MESSAGES.NO_READING_AVAILABLE,
    };
  }

  function subscribe(callback: TempSensorSubscriber): () => void {
    subscribers.add(callback);

    return () => {
      subscribers.delete(callback);
    };
  }

  return {
    get status() {
      return state.status;
    },
    get lastError() {
      return state.lastError;
    },
    getLatestReading,
    subscribe,
    start,
    stop,
  };
}

export { decodeFrame } from "./decoder.js";
export { createPulseAccumulator } from "./pulseAccumulator.js";
export { isTempSensorError } from "./types.guards.js";
export type {
  Bit,
  Pulse,
  TempSensorError,
  TempSensorReading,
  TempSensorService,
  TempSensorServiceDependencies,
  TempSensorState,
  TempSensorSubscriber,
} from "./types.js";
