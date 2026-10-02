/** The GPIO pin that is being targeted as the sensor data input. */
export const targetDataGpioPin = 3;

/**
 * Structure of a single AM2302 (DHT22) transmission frame.
 *
 * The sensor acknowledges the host start signal with one response pulse pair
 * and then transmits 40 data bits, most significant bit first.
 */
export const FRAME = {
  /** Data bits transmitted in a single frame. */
  DATA_BIT_COUNT: 40,
  /** Bits packed into each decoded byte. */
  BITS_PER_BYTE: 8,
  /** Bytes decoded from a complete frame. */
  DATA_BYTE_COUNT: 5,
  /** High pulses the sensor sends to acknowledge the start signal. */
  SENSOR_RESPONSE_HIGH_PULSE_COUNT: 1,
} as const;

/** Position of each decoded byte within a complete frame. */
export const BYTE_INDEXES = {
  HUMIDITY_HIGH: 0,
  HUMIDITY_LOW: 1,
  TEMPERATURE_HIGH: 2,
  TEMPERATURE_LOW: 3,
  CHECKSUM: 4,
} as const;

/**
 * Pulse widths, in microseconds, taken from the AM2302 datasheet
 * (`assets/DHT22-AM2302-Datasheet.pdf`). A data bit is encoded by the width of
 * its high pulse: roughly 26-28us for a zero and 70us for a one.
 */
export const PULSE_WIDTHS_US = {
  /** Shortest high pulse accepted as a data bit. */
  MIN_DATA_BIT_HIGH: 10,
  /** Longest high pulse accepted as a data bit. */
  MAX_DATA_BIT_HIGH: 120,
  /** High pulses at or above this width encode a one, below it a zero. */
  BIT_VALUE_THRESHOLD: 50,
  /** An idle gap at least this long separates one frame from the next. */
  FRAME_GAP_THRESHOLD: 1000,
} as const;

/** Operating ranges of the AM2302 sensor. */
export const SENSOR_RANGES = {
  MIN_TEMPERATURE_C: -40,
  MAX_TEMPERATURE_C: 80,
  MIN_RELATIVE_HUMIDITY_PERCENTAGE: 0,
  MAX_RELATIVE_HUMIDITY_PERCENTAGE: 100,
} as const;

/** Factors used to turn raw sensor values into physical units. */
export const CONVERSIONS = {
  /** Raw values are transmitted as tenths of a unit. */
  RAW_VALUE_DIVISOR: 10,
  /** Celsius to Fahrenheit ratio. */
  FAHRENHEIT_RATIO: 9 / 5,
  /** Celsius to Fahrenheit offset. */
  FAHRENHEIT_OFFSET: 32,
  /** Retains two decimal places when rounding converted values. */
  ROUNDING_FACTOR: 100,
} as const;

/** Masks applied while decoding raw frame bytes. */
export const BIT_MASKS = {
  /** Masks a value down to a single byte. */
  BYTE: 0xff,
  /** Set in the temperature high byte when the reading is negative. */
  TEMPERATURE_SIGN: 0x80,
  /** Clears the sign bit from the temperature high byte. */
  TEMPERATURE_MAGNITUDE: 0x7f,
} as const;

/** Logic levels reported by the GPIO pin service. */
export const GPIO_LEVELS = {
  LOW: 0,
  HIGH: 1,
} as const;

/** Recoverable error categories surfaced to consumers. */
export const TEMP_SENSOR_ERROR_TYPES = {
  CHECKSUM: "checksum",
  SIGNAL: "signal",
  RANGE: "range",
} as const;

/**
 * Internal pipeline events. State is derived by reducing these in order, so
 * every state change has a corresponding event.
 */
export const TEMP_SENSOR_EVENT_TYPES = {
  STARTED: "started",
  STOPPED: "stopped",
  READING_AVAILABLE: "readingAvailable",
  DECODE_FAILED: "decodeFailed",
} as const;

/** Records whether the most recent frame produced a reading or an error. */
export const TEMP_SENSOR_OUTCOMES = {
  READING: "reading",
  ERROR: "error",
} as const;

/**
 * Lifecycle messages. The REST controller matches on ALREADY_RUNNING and
 * ALREADY_STOPPED to answer with 409, so these strings are part of the
 * service contract.
 */
export const TEMP_SENSOR_MESSAGES = {
  ALREADY_RUNNING: "Already running",
  ALREADY_STOPPED: "Already stopped",
  NO_READING_AVAILABLE: "No reading available yet",
  EDGE_TIMESTAMP_WENT_BACKWARDS: "GPIO edge timestamp went backwards",
} as const;
