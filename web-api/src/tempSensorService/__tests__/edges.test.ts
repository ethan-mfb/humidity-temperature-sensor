import { describe, it, expect } from "vitest";
import { toPulses } from "../edges.js";
import { GPIO_LEVELS } from "../constants.js";
import { createFrameEdges, createFramePulses, withChecksum } from "./utils.js";

const bytes = withChecksum([0x02, 0x8c, 0x00, 0xea]);

describe("toPulses", () => {
  it("turns a frame's edges into the pulses that produced them", () => {
    expect(toPulses(createFrameEdges(bytes))).toEqual(createFramePulses(bytes));
  });

  it("returns nothing for a capture with no edges", () => {
    expect(toPulses([])).toEqual([]);
  });

  it("returns nothing for a single edge, which closes no pulse", () => {
    expect(toPulses(createFrameEdges(bytes).slice(0, 1))).toEqual([]);
  });

  it("measures each pulse from the edge that opened it", () => {
    const pulses = toPulses([
      { pin: 3, value: GPIO_LEVELS.LOW, timestamp: 0 },
      { pin: 3, value: GPIO_LEVELS.HIGH, timestamp: 50 },
      { pin: 3, value: GPIO_LEVELS.LOW, timestamp: 120 },
    ]);

    expect(pulses).toEqual([
      { value: GPIO_LEVELS.LOW, durationUs: 50 },
      { value: GPIO_LEVELS.HIGH, durationUs: 70 },
    ]);
  });

  it("drops a backwards interval rather than reporting a negative width", () => {
    const pulses = toPulses([
      { pin: 3, value: GPIO_LEVELS.LOW, timestamp: 100 },
      { pin: 3, value: GPIO_LEVELS.HIGH, timestamp: 40 },
    ]);

    expect(pulses).toEqual([]);
  });
});
