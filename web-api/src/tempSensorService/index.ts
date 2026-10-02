import { TEMP_SENSOR_STATUS } from "../tempSensorController/constants.js";
import { getErrorReason } from "../utils.js";
import {
  MIN_READ_INTERVAL_MS,
  TEMP_SENSOR_ERROR_TYPES,
  TEMP_SENSOR_EVENT_TYPES,
  TEMP_SENSOR_MESSAGES,
  TEMP_SENSOR_OUTCOMES,
} from "./constants.js";
import { decodeFrame } from "./decoder.js";
import { toPulses } from "./edges.js";
import {
  createInitialTempSensorState,
  reduceTempSensorState,
} from "./reducer.js";
import { isTempSensorError } from "./types.guards.js";
import type {
  FrameCapture,
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
 * The frame source is injected, so the whole service can be exercised against
 * captured or synthesised frames with no hardware. Recoverable problems are
 * emitted as error values; only a failed start or stop throws, since those
 * leave the service unable to continue.
 */
export function createTempSensorService(
  dependencies: TempSensorServiceDependencies,
): TempSensorService {
  const readIntervalMs = dependencies.readIntervalMs ?? MIN_READ_INTERVAL_MS;
  const subscribers = new Set<TempSensorSubscriber>();
  let state: TempSensorState = createInitialTempSensorState();
  let readTimer: ReturnType<typeof setTimeout> | undefined = undefined;

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

  function publishFrame(capture: FrameCapture): void {
    if (capture.error !== null) {
      publishError({
        type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
        message: capture.error,
      });
      return;
    }

    const result = decodeFrame(toPulses(capture.edges));

    if (isTempSensorError(result)) {
      publishError(result);
      return;
    }

    publishReading(result);
  }

  /**
   * Reads one frame, then schedules the next.
   *
   * Self-scheduling rather than an interval: a read that runs long must not
   * overlap the next one, because the sensor answers a single start signal.
   */
  async function readOnce(): Promise<void> {
    if (!isRunning()) return;

    try {
      const capture = await dependencies.frameSource.readFrame();
      // The service may have been stopped while the read was in flight.
      if (!isRunning()) return;
      publishFrame(capture);
    } catch (e: unknown) {
      if (!isRunning()) return;
      publishError({
        type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
        message: getErrorReason(e),
      });
    } finally {
      scheduleNextRead();
    }
  }

  function scheduleNextRead(): void {
    if (!isRunning()) return;

    readTimer = setTimeout(() => {
      void readOnce();
    }, readIntervalMs);
  }

  function cancelScheduledRead(): void {
    if (readTimer === undefined) return;

    clearTimeout(readTimer);
    readTimer = undefined;
  }

  async function start(): Promise<void> {
    if (isRunning()) {
      throw new Error(TEMP_SENSOR_MESSAGES.ALREADY_RUNNING);
    }

    dispatch({ type: TEMP_SENSOR_EVENT_TYPES.STARTED });
    dependencies.loggingService?.debug({ message: "Temp sensor started" });

    // Read straight away, so the first reading does not wait out an interval.
    await readOnce();
  }

  async function stop(): Promise<void> {
    if (state.status === TEMP_SENSOR_STATUS.STOPPED) {
      throw new Error(TEMP_SENSOR_MESSAGES.ALREADY_STOPPED);
    }

    cancelScheduledRead();
    dispatch({ type: TEMP_SENSOR_EVENT_TYPES.STOPPED });
    await dependencies.frameSource.close();
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
export { toPulses } from "./edges.js";
export { isTempSensorError } from "./types.guards.js";
export type {
  Bit,
  FrameCapture,
  Pulse,
  SensorFrameSource,
  TempSensorError,
  TempSensorReading,
  TempSensorService,
  TempSensorServiceDependencies,
  TempSensorState,
  TempSensorSubscriber,
} from "./types.js";
