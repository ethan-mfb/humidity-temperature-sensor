import {
  createHumidityPercentage,
  createTemperatureC,
  createTemperatureF,
  createTimestamp,
  unwrapGpioValue,
  unwrapMicroseconds,
} from "../types/nominal-utils.js";
import { getErrorReason } from "../utils.js";
import {
  BIT_MASKS,
  BYTE_INDEXES,
  CONVERSIONS,
  FRAME,
  GPIO_LEVELS,
  PULSE_WIDTHS_US,
  SENSOR_RANGES,
  TEMP_SENSOR_ERROR_TYPES,
} from "./constants.js";
import { isTempSensorError } from "./types.guards.js";
import type {
  Bit,
  Pulse,
  TempSensorError,
  TempSensorReading,
} from "./types.js";

/**
 * Pure decoding pipeline for a single AM2302 frame:
 * pulses -> bits -> bytes -> checksum -> reading.
 *
 * Every step returns an error value rather than throwing; a malformed frame is
 * an expected, recoverable condition.
 */

function signalError(message: string): TempSensorError {
  return { type: TEMP_SENSOR_ERROR_TYPES.SIGNAL, message };
}

/** Decodes one high pulse into the bit its width encodes. */
export function decodeBitFromPulse(pulse: Pulse): Bit | TempSensorError {
  const durationUs = unwrapMicroseconds(pulse.durationUs);

  if (
    durationUs < PULSE_WIDTHS_US.MIN_DATA_BIT_HIGH ||
    durationUs > PULSE_WIDTHS_US.MAX_DATA_BIT_HIGH
  ) {
    return signalError(
      `Pulse width ${durationUs}us is outside the valid data bit range ` +
        `(${PULSE_WIDTHS_US.MIN_DATA_BIT_HIGH}-${PULSE_WIDTHS_US.MAX_DATA_BIT_HIGH}us)`,
    );
  }

  return durationUs >= PULSE_WIDTHS_US.BIT_VALUE_THRESHOLD ? 1 : 0;
}

/**
 * Extracts the data bits from a frame's pulses. Only high pulses carry data,
 * and the first of them is the sensor's response to the start signal.
 */
export function decodeBitsFromFramePulses(
  pulses: readonly Pulse[],
): readonly Bit[] | TempSensorError {
  const dataPulses = pulses
    .filter((pulse) => unwrapGpioValue(pulse.value) === GPIO_LEVELS.HIGH)
    .slice(FRAME.SENSOR_RESPONSE_HIGH_PULSE_COUNT);

  if (dataPulses.length !== FRAME.DATA_BIT_COUNT) {
    return signalError(
      `Expected ${FRAME.DATA_BIT_COUNT} data bits but found ${dataPulses.length}`,
    );
  }

  const results = dataPulses.map(decodeBitFromPulse);
  const firstError = results.find(isTempSensorError);

  if (firstError !== undefined) {
    return firstError;
  }

  return results.filter((result): result is Bit => !isTempSensorError(result));
}

/** Packs bits into bytes, most significant bit first. */
export function packBitsIntoBytes(bits: readonly Bit[]): readonly number[] {
  const byteCount = Math.floor(bits.length / FRAME.BITS_PER_BYTE);

  return Array.from({ length: byteCount }, (_unused, byteIndex) =>
    bits
      .slice(
        byteIndex * FRAME.BITS_PER_BYTE,
        byteIndex * FRAME.BITS_PER_BYTE + FRAME.BITS_PER_BYTE,
      )
      .reduce<number>((byte, bit) => (byte << 1) | bit, 0),
  );
}

/** Sums the data bytes and compares against the transmitted checksum. */
export function validateChecksum(
  bytes: readonly number[],
): TempSensorError | undefined {
  if (bytes.length !== FRAME.DATA_BYTE_COUNT) {
    return signalError(
      `Expected ${FRAME.DATA_BYTE_COUNT} bytes but found ${bytes.length}`,
    );
  }

  const expected = bytes[BYTE_INDEXES.CHECKSUM];
  const actual =
    bytes
      .slice(BYTE_INDEXES.HUMIDITY_HIGH, BYTE_INDEXES.CHECKSUM)
      .reduce((sum, byte) => sum + byte, 0) & BIT_MASKS.BYTE;

  if (actual !== expected) {
    return {
      type: TEMP_SENSOR_ERROR_TYPES.CHECKSUM,
      message: `Checksum mismatch: expected ${expected} but calculated ${actual}`,
    };
  }

  return undefined;
}

function roundToTwoDecimals(value: number): number {
  return (
    Math.round(value * CONVERSIONS.ROUNDING_FACTOR) /
    CONVERSIONS.ROUNDING_FACTOR
  );
}

function toRelativeHumidityPercentage(bytes: readonly number[]): number {
  const raw =
    (bytes[BYTE_INDEXES.HUMIDITY_HIGH] << FRAME.BITS_PER_BYTE) |
    bytes[BYTE_INDEXES.HUMIDITY_LOW];

  return raw / CONVERSIONS.RAW_VALUE_DIVISOR;
}

/** Bit 15 of the raw temperature marks a negative reading. */
function toTemperatureC(bytes: readonly number[]): number {
  const highByte = bytes[BYTE_INDEXES.TEMPERATURE_HIGH];
  const magnitude =
    ((highByte & BIT_MASKS.TEMPERATURE_MAGNITUDE) << FRAME.BITS_PER_BYTE) |
    bytes[BYTE_INDEXES.TEMPERATURE_LOW];
  const celsius = magnitude / CONVERSIONS.RAW_VALUE_DIVISOR;

  return (highByte & BIT_MASKS.TEMPERATURE_SIGN) === 0 ? celsius : -celsius;
}

function toTemperatureF(celsius: number): number {
  return roundToTwoDecimals(
    celsius * CONVERSIONS.FAHRENHEIT_RATIO + CONVERSIONS.FAHRENHEIT_OFFSET,
  );
}

/** Rejects values the AM2302 cannot physically report. */
export function validateReadingRanges(
  temperatureC: number,
  relativeHumidityPercentage: number,
): TempSensorError | undefined {
  if (
    temperatureC < SENSOR_RANGES.MIN_TEMPERATURE_C ||
    temperatureC > SENSOR_RANGES.MAX_TEMPERATURE_C
  ) {
    return {
      type: TEMP_SENSOR_ERROR_TYPES.RANGE,
      message:
        `Temperature ${temperatureC}C is outside the sensor range ` +
        `(${SENSOR_RANGES.MIN_TEMPERATURE_C} to ${SENSOR_RANGES.MAX_TEMPERATURE_C}C)`,
    };
  }

  if (
    relativeHumidityPercentage <
      SENSOR_RANGES.MIN_RELATIVE_HUMIDITY_PERCENTAGE ||
    relativeHumidityPercentage > SENSOR_RANGES.MAX_RELATIVE_HUMIDITY_PERCENTAGE
  ) {
    return {
      type: TEMP_SENSOR_ERROR_TYPES.RANGE,
      message:
        `Humidity ${relativeHumidityPercentage}% is outside the sensor range ` +
        `(${SENSOR_RANGES.MIN_RELATIVE_HUMIDITY_PERCENTAGE} to ` +
        `${SENSOR_RANGES.MAX_RELATIVE_HUMIDITY_PERCENTAGE}%)`,
    };
  }

  return undefined;
}

/** Turns verified frame bytes into an application-level reading. */
export function decodeReadingFromBytes(
  bytes: readonly number[],
): TempSensorReading | TempSensorError {
  const temperatureC = toTemperatureC(bytes);
  const relativeHumidityPercentage = toRelativeHumidityPercentage(bytes);

  const rangeError = validateReadingRanges(
    temperatureC,
    relativeHumidityPercentage,
  );

  if (rangeError !== undefined) {
    return rangeError;
  }

  try {
    return {
      temperatureC: createTemperatureC(temperatureC),
      temperatureF: createTemperatureF(toTemperatureF(temperatureC)),
      relativeHumidityPercentage: createHumidityPercentage(
        relativeHumidityPercentage,
      ),
      timestamp: createTimestamp(),
    };
  } catch (e: unknown) {
    return { type: TEMP_SENSOR_ERROR_TYPES.RANGE, message: getErrorReason(e) };
  }
}

/** Runs the full pipeline over one frame's pulses. */
export function decodeFrame(
  pulses: readonly Pulse[],
): TempSensorReading | TempSensorError {
  const bits = decodeBitsFromFramePulses(pulses);

  if (isTempSensorError(bits)) {
    return bits;
  }

  const bytes = packBitsIntoBytes(bits);
  const checksumError = validateChecksum(bytes);

  if (checksumError !== undefined) {
    return checksumError;
  }

  return decodeReadingFromBytes(bytes);
}
