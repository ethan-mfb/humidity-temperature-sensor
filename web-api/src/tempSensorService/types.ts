import type {
  GpioPin,
  GpioValue,
  Microseconds,
} from "../types/nominal-types.js";
import type {
  TempSensorError,
  TempSensorReading,
  TempSensorService,
  TempSensorStatusType,
} from "../tempSensorController/types.js";
import type { GpioPinService } from "../gpioPinService/types.js";
import type { LoggingService } from "../loggingService/types.js";
import type {
  TEMP_SENSOR_EVENT_TYPES,
  TEMP_SENSOR_OUTCOMES,
} from "./constants.js";

/**
 * The reading, error and service shapes are owned by the controller module so
 * that there is a single definition of the contract both sides implement.
 */
export type {
  TempSensorError,
  TempSensorReading,
  TempSensorService,
  TempSensorStatusType,
};

/** A single decoded data bit. */
export type Bit = 0 | 1;

/** One completed logic level, measured between two GPIO edges. */
export type Pulse = {
  value: GpioValue;
  durationUs: Microseconds;
};

/** A GPIO transition as delivered by the GPIO pin service. */
export type GpioEdge = {
  pin: number;
  value: number;
  timestamp: number;
};

/** Records whether the most recent frame produced a reading or an error. */
export type TempSensorOutcome =
  (typeof TEMP_SENSOR_OUTCOMES)[keyof typeof TEMP_SENSOR_OUTCOMES];

/** Events that drive the service state machine. */
export type TempSensorEvent =
  | { type: typeof TEMP_SENSOR_EVENT_TYPES.STARTED }
  | { type: typeof TEMP_SENSOR_EVENT_TYPES.STOPPED }
  | {
      type: typeof TEMP_SENSOR_EVENT_TYPES.READING_AVAILABLE;
      reading: TempSensorReading;
    }
  | {
      type: typeof TEMP_SENSOR_EVENT_TYPES.DECODE_FAILED;
      error: TempSensorError;
    };

/** State derived by reducing the event stream. */
export type TempSensorState = {
  status: TempSensorStatusType;
  lastReading: TempSensorReading | undefined;
  lastError: TempSensorError | undefined;
  lastOutcome: TempSensorOutcome | undefined;
};

/** Receives every reading and recoverable error the service produces. */
export type TempSensorSubscriber = (
  event: TempSensorReading | TempSensorError,
) => void;

/**
 * Groups GPIO edges into frames. Stateful, but the state is confined to the
 * closure so the decoding functions it feeds stay pure.
 */
export type PulseAccumulator = {
  /** Returns a frame's pulses once one is complete, otherwise undefined. */
  addEdge: (edge: GpioEdge) => readonly Pulse[] | undefined;
  reset: () => void;
};

/** Dependencies injected into the service factory. */
export type TempSensorServiceDependencies = {
  gpioPinService: GpioPinService;
  /** Defaults to `targetDataGpioPin`. */
  pin?: GpioPin;
  loggingService?: LoggingService;
};
