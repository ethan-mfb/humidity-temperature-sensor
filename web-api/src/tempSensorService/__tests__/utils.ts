import {
  createGpioValue,
  createMicroseconds,
} from "../../types/nominal-utils.js";
import { BIT_MASKS, FRAME, GPIO_LEVELS } from "../constants.js";
import type { Bit, GpioEdge, Pulse } from "../types.js";

/**
 * Nominal AM2302 timings, in microseconds, used to synthesise frames that a
 * healthy sensor would produce.
 */
export const TEST_PULSE_WIDTHS_US = {
  RESPONSE_LOW: 80,
  RESPONSE_HIGH: 80,
  BIT_LOW: 50,
  ZERO_HIGH: 27,
  ONE_HIGH: 70,
} as const;

/** Default pin used by the synthetic edge stream. */
export const TEST_PIN = 3;

export function createPulse(level: number, durationUs: number): Pulse {
  return {
    value: createGpioValue(level),
    durationUs: createMicroseconds(durationUs),
  };
}

/** Splits a byte into bits, most significant bit first. */
export function byteToBits(byte: number): readonly Bit[] {
  return Array.from(
    { length: FRAME.BITS_PER_BYTE },
    (_unused, index) =>
      ((byte >> (FRAME.BITS_PER_BYTE - 1 - index)) & 1) as Bit,
  );
}

/** The checksum the sensor would transmit for the given data bytes. */
export function computeChecksum(dataBytes: readonly number[]): number {
  return dataBytes.reduce((sum, byte) => sum + byte, 0) & BIT_MASKS.BYTE;
}

/** Appends the correct checksum to four data bytes. */
export function withChecksum(dataBytes: readonly number[]): readonly number[] {
  return [...dataBytes, computeChecksum(dataBytes)];
}

/**
 * Builds the pulse train for a frame carrying the given bytes: the sensor
 * response pair followed by one low/high pair per data bit.
 */
export function createFramePulses(bytes: readonly number[]): readonly Pulse[] {
  const bitPulses = bytes
    .flatMap(byteToBits)
    .flatMap((bit) => [
      createPulse(GPIO_LEVELS.LOW, TEST_PULSE_WIDTHS_US.BIT_LOW),
      createPulse(
        GPIO_LEVELS.HIGH,
        bit === 1
          ? TEST_PULSE_WIDTHS_US.ONE_HIGH
          : TEST_PULSE_WIDTHS_US.ZERO_HIGH,
      ),
    ]);

  return [
    createPulse(GPIO_LEVELS.LOW, TEST_PULSE_WIDTHS_US.RESPONSE_LOW),
    createPulse(GPIO_LEVELS.HIGH, TEST_PULSE_WIDTHS_US.RESPONSE_HIGH),
    ...bitPulses,
  ];
}

/**
 * Converts pulses into the edge stream the GPIO pin service would deliver. An
 * edge carries the level the pin moved to, so each pulse is closed by an edge
 * reporting the opposite level.
 */
export function createEdgesFromPulses(
  pulses: readonly Pulse[],
  startTimestamp = 0,
): readonly GpioEdge[] {
  let timestamp = startTimestamp;

  const closingEdges = pulses.map((pulse) => {
    timestamp += pulse.durationUs as number;
    return {
      pin: TEST_PIN,
      value:
        (pulse.value as number) === GPIO_LEVELS.HIGH
          ? GPIO_LEVELS.LOW
          : GPIO_LEVELS.HIGH,
      timestamp,
    };
  });

  return [
    {
      pin: TEST_PIN,
      value: pulses[0].value as number,
      timestamp: startTimestamp,
    },
    ...closingEdges,
  ];
}

/** Edge stream for a complete frame carrying the given bytes. */
export function createFrameEdges(
  bytes: readonly number[],
  startTimestamp = 0,
): readonly GpioEdge[] {
  return createEdgesFromPulses(createFramePulses(bytes), startTimestamp);
}
