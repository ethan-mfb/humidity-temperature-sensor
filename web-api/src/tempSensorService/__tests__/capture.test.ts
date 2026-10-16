import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { TEMP_SENSOR_ERROR_TYPES } from "../constants.js";
import { decodeFrame } from "../decoder.js";
import { toPulses } from "../edges.js";
import type { GpioEdge } from "../types.js";
import { TEST_PIN } from "./utils.js";

/**
 * 30 reads from a Pi Zero 2 W, as `scripts/capture-sensor.mjs` recorded them.
 * Every one lost the response pair and 1-4 leading bits to late edge
 * detection, and 12 of them dropped an edge.
 */
const CAPTURE_PATH = new URL("./fixtures/capture-1.jsonl", import.meta.url);

type CaptureRecord = {
  attempt: number;
  edges: readonly { level: number; tickUs: number }[];
};

const records: readonly CaptureRecord[] = readFileSync(CAPTURE_PATH, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as CaptureRecord);

/** The same mapping the libgpiod frame source applies. */
function toGpioEdges(record: CaptureRecord): readonly GpioEdge[] {
  return record.edges.map((edge) => ({
    pin: TEST_PIN,
    value: edge.level,
    timestamp: edge.tickUs,
  }));
}

/** Relative humidity each clean read decodes to; all of them read 24.3C. */
const EXPECTED_HUMIDITY_BY_ATTEMPT: Readonly<Record<number, number>> = {
  1: 49.4,
  2: 49.7,
  6: 49.7,
  8: 49.7,
  9: 49.7,
  12: 49.7,
  13: 49.6,
  14: 49.7,
  15: 49.7,
  16: 49.7,
  17: 49.7,
  18: 49.7,
  21: 49.7,
  22: 49.6,
  24: 49.7,
  28: 49.7,
  29: 49.7,
  30: 49.7,
};

const DROPPED_EDGE_ATTEMPTS = [3, 4, 5, 7, 10, 11, 19, 20, 23, 25, 26, 27];

const recordFor = (attempt: number): CaptureRecord => {
  const record = records.find((candidate) => candidate.attempt === attempt);
  if (record === undefined) throw new Error(`No attempt ${attempt}`);
  return record;
};

describe("decoding capture-1", () => {
  it("covers every record in the capture", () => {
    expect(
      [
        ...Object.keys(EXPECTED_HUMIDITY_BY_ATTEMPT).map(Number),
        ...DROPPED_EDGE_ATTEMPTS,
      ].sort((left, right) => left - right),
    ).toEqual(records.map((record) => record.attempt));
  });

  it.each(
    Object.entries(EXPECTED_HUMIDITY_BY_ATTEMPT).map(([a, h]) => [+a, h]),
  )("decodes attempt %i to %f%% RH at 24.3C", (attempt, humidity) => {
    const result = decodeFrame(toPulses(toGpioEdges(recordFor(attempt))));

    expect(result).toMatchObject({
      temperatureC: 24.3,
      relativeHumidityPercentage: humidity,
    });
  });

  it.each(DROPPED_EDGE_ATTEMPTS)(
    "rejects attempt %i for its dropped edge",
    (attempt) => {
      const result = decodeFrame(toPulses(toGpioEdges(recordFor(attempt))));

      expect(result).toEqual({
        type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
        message: expect.stringContaining("dropped edge"),
      });
    },
  );
});
