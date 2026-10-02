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

/** The outcome of one triggered read of the sensor. */
export type FrameCapture = {
  /** Every edge the sensor produced. Empty when the read failed. */
  readonly edges: readonly GpioEdge[];
  /**
   * Why the read produced nothing, or null. A failed read is recoverable: the
   * service reports it and tries again on the next interval.
   */
  readonly error: string | null;
};

/**
 * The port this service reads the sensor through.
 *
 * Declared here, by the consumer, rather than by any implementation of it, so
 * that swapping how the hardware is reached is a new module and a line in the
 * composition root. The AM2302 is request/response -- one start signal, one
 * frame -- so the port is a single triggered read, not a stream.
 */
export type SensorFrameSource = {
  /** Drives one start signal and resolves with the edges the sensor answered with. */
  readFrame(): Promise<FrameCapture>;
  /** Releases whatever the source holds. Safe to call when already closed. */
  close(): Promise<void>;
};

/** Dependencies injected into the service factory. */
export type TempSensorServiceDependencies = {
  frameSource: SensorFrameSource;
  /** Defaults to the sensor's minimum, 2000ms. Faster requests return a stale frame. */
  readIntervalMs?: number;
  loggingService?: LoggingService;
};
