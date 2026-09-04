import { describe, expect, it } from "vitest";
import {
  decodeBitFromPulse,
  decodeBitsFromFramePulses,
  decodeFrame,
  decodeReadingFromBytes,
  packBitsIntoBytes,
  validateChecksum,
  validateReadingRanges,
} from "../decoder.js";
import { GPIO_LEVELS, TEMP_SENSOR_ERROR_TYPES } from "../constants.js";
import { isTempSensorError } from "../types.guards.js";
import type { Bit } from "../types.js";
import {
  TEST_PULSE_WIDTHS_US,
  byteToBits,
  computeChecksum,
  createFramePulses,
  createPulse,
  withChecksum,
} from "./utils.js";

// 65.2% RH, 23.4C -> 0x028C, 0x00EA
const roomConditionsBytes = withChecksum([0x02, 0x8c, 0x00, 0xea]);

describe("decodeBitFromPulse", () => {
  it("decodes a short high pulse as zero", () => {
    const result = decodeBitFromPulse(
      createPulse(GPIO_LEVELS.HIGH, TEST_PULSE_WIDTHS_US.ZERO_HIGH),
    );

    expect(result).toBe(0);
  });

  it("decodes a long high pulse as one", () => {
    const result = decodeBitFromPulse(
      createPulse(GPIO_LEVELS.HIGH, TEST_PULSE_WIDTHS_US.ONE_HIGH),
    );

    expect(result).toBe(1);
  });

  it("returns a signal error for a pulse that is too short", () => {
    const result = decodeBitFromPulse(createPulse(GPIO_LEVELS.HIGH, 2));

    expect(result).toEqual({
      type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
      message: expect.stringContaining("2us"),
    });
  });

  it("returns a signal error for a pulse that is too long", () => {
    const result = decodeBitFromPulse(createPulse(GPIO_LEVELS.HIGH, 5000));

    expect(isTempSensorError(result)).toBe(true);
  });
});

describe("decodeBitsFromFramePulses", () => {
  it("skips the sensor response and decodes 40 data bits", () => {
    const result = decodeBitsFromFramePulses(
      createFramePulses(roomConditionsBytes),
    );

    expect(isTempSensorError(result)).toBe(false);
    expect(result).toHaveLength(40);
    expect(result).toEqual(roomConditionsBytes.flatMap(byteToBits));
  });

  it("returns a signal error when the frame is truncated", () => {
    const pulses = createFramePulses(roomConditionsBytes).slice(0, 40);

    const result = decodeBitsFromFramePulses(pulses);

    expect(result).toEqual({
      type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
      message: expect.stringContaining("Expected 40 data bits"),
    });
  });

  it("propagates the first malformed pulse", () => {
    const pulses = [...createFramePulses(roomConditionsBytes)];
    pulses[5] = createPulse(GPIO_LEVELS.HIGH, 500);

    const result = decodeBitsFromFramePulses(pulses);

    expect(isTempSensorError(result)).toBe(true);
  });
});

describe("packBitsIntoBytes", () => {
  it("packs bits most significant bit first", () => {
    const bits: readonly Bit[] = [1, 0, 1, 0, 0, 0, 0, 1];

    expect(packBitsIntoBytes(bits)).toEqual([0xa1]);
  });

  it("round trips every byte of a frame", () => {
    const bits = roomConditionsBytes.flatMap(byteToBits);

    expect(packBitsIntoBytes(bits)).toEqual([...roomConditionsBytes]);
  });
});

describe("validateChecksum", () => {
  it("accepts a frame whose checksum matches", () => {
    expect(validateChecksum(roomConditionsBytes)).toBeUndefined();
  });

  it("returns a checksum error when the transmitted sum differs", () => {
    const corrupted = [...roomConditionsBytes];
    corrupted[4] = (corrupted[4] + 1) & 0xff;

    expect(validateChecksum(corrupted)).toEqual({
      type: TEMP_SENSOR_ERROR_TYPES.CHECKSUM,
      message: expect.stringContaining("Checksum mismatch"),
    });
  });

  it("masks the sum to a single byte", () => {
    const overflowing = withChecksum([0xff, 0xff, 0x00, 0x50]);

    expect(computeChecksum([0xff, 0xff, 0x00, 0x50])).toBe(0x4e);
    expect(validateChecksum(overflowing)).toBeUndefined();
  });

  it("returns a signal error when the byte count is wrong", () => {
    expect(validateChecksum([0x01, 0x02])).toEqual({
      type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
      message: expect.stringContaining("Expected 5 bytes"),
    });
  });
});

describe("validateReadingRanges", () => {
  it("accepts values inside the sensor range", () => {
    expect(validateReadingRanges(23.4, 65.2)).toBeUndefined();
  });

  it("rejects a temperature above the sensor maximum", () => {
    expect(validateReadingRanges(120, 50)).toEqual({
      type: TEMP_SENSOR_ERROR_TYPES.RANGE,
      message: expect.stringContaining("120C"),
    });
  });

  it("rejects a humidity above 100 percent", () => {
    expect(validateReadingRanges(20, 140)).toEqual({
      type: TEMP_SENSOR_ERROR_TYPES.RANGE,
      message: expect.stringContaining("140%"),
    });
  });
});

describe("decodeReadingFromBytes", () => {
  it("converts raw tenths into physical units", () => {
    const result = decodeReadingFromBytes(roomConditionsBytes);

    expect(result).toMatchObject({
      temperatureC: 23.4,
      temperatureF: 74.12,
      relativeHumidityPercentage: 65.2,
    });
  });

  it("applies the sign bit to negative temperatures", () => {
    // -10.1C -> 0x8065
    const result = decodeReadingFromBytes(
      withChecksum([0x01, 0x2c, 0x80, 0x65]),
    );

    expect(result).toMatchObject({
      temperatureC: -10.1,
      temperatureF: 13.82,
      relativeHumidityPercentage: 30.0,
    });
  });

  it("stamps the reading with an ISO timestamp", () => {
    const result = decodeReadingFromBytes(roomConditionsBytes);

    expect(isTempSensorError(result)).toBe(false);
    if (isTempSensorError(result)) return;
    expect(Date.parse(result.timestamp as string)).not.toBeNaN();
  });

  it("returns a range error for an impossible humidity", () => {
    const result = decodeReadingFromBytes(
      withChecksum([0x07, 0xd0, 0x00, 0xea]),
    );

    expect(result).toMatchObject({ type: TEMP_SENSOR_ERROR_TYPES.RANGE });
  });
});

describe("decodeFrame", () => {
  it("decodes a well formed frame into a reading", () => {
    const result = decodeFrame(createFramePulses(roomConditionsBytes));

    expect(result).toMatchObject({
      temperatureC: 23.4,
      relativeHumidityPercentage: 65.2,
    });
  });

  it("reports a checksum failure without throwing", () => {
    const corrupted = [...roomConditionsBytes];
    corrupted[4] = (corrupted[4] + 1) & 0xff;

    const result = decodeFrame(createFramePulses(corrupted));

    expect(result).toMatchObject({ type: TEMP_SENSOR_ERROR_TYPES.CHECKSUM });
  });
});
