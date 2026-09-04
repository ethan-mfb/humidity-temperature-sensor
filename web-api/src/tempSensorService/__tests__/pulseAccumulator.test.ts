import { describe, expect, it } from "vitest";
import { GPIO_LEVELS, PULSE_WIDTHS_US } from "../constants.js";
import { createPulseAccumulator } from "../pulseAccumulator.js";
import type { GpioEdge, Pulse } from "../types.js";
import {
  TEST_PIN,
  createFrameEdges,
  createFramePulses,
  withChecksum,
} from "./utils.js";

const bytes = withChecksum([0x02, 0x8c, 0x00, 0xea]);

function collectFrames(edges: readonly GpioEdge[]): readonly Pulse[][] {
  const accumulator = createPulseAccumulator();

  return edges
    .map((edge) => accumulator.addEdge(edge))
    .filter((frame): frame is readonly Pulse[] => frame !== undefined)
    .map((frame) => [...frame]);
}

describe("createPulseAccumulator", () => {
  it("emits nothing until a frame is complete", () => {
    const accumulator = createPulseAccumulator();
    const edges = createFrameEdges(bytes);

    const emittedEarly = edges
      .slice(0, edges.length - 1)
      .map((edge) => accumulator.addEdge(edge));

    expect(emittedEarly.every((frame) => frame === undefined)).toBe(true);
  });

  it("emits one frame carrying every pulse of the transmission", () => {
    const frames = collectFrames(createFrameEdges(bytes));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(createFramePulses(bytes));
  });

  it("derives each pulse's level from the edge that closed it", () => {
    const frames = collectFrames(createFrameEdges(bytes));

    expect(frames[0][0].value as number).toBe(GPIO_LEVELS.LOW);
    expect(frames[0][1].value as number).toBe(GPIO_LEVELS.HIGH);
  });

  it("separates consecutive frames", () => {
    const first = createFrameEdges(bytes);
    const secondStart =
      first[first.length - 1].timestamp +
      PULSE_WIDTHS_US.FRAME_GAP_THRESHOLD * 2;

    const frames = collectFrames([
      ...first,
      ...createFrameEdges(bytes, secondStart),
    ]);

    expect(frames).toHaveLength(2);
    expect(frames[1]).toEqual(createFramePulses(bytes));
  });

  it("discards a truncated frame when an idle gap arrives", () => {
    const partial = createFrameEdges(bytes).slice(0, 20);
    const resumeAt =
      partial[partial.length - 1].timestamp +
      PULSE_WIDTHS_US.FRAME_GAP_THRESHOLD;

    const frames = collectFrames([
      ...partial,
      ...createFrameEdges(bytes, resumeAt),
    ]);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(createFramePulses(bytes));
  });

  it("restarts collection when a timestamp goes backwards", () => {
    const accumulator = createPulseAccumulator();
    const edges = createFrameEdges(bytes);

    edges.slice(0, 10).forEach((edge) => accumulator.addEdge(edge));
    const rewound: GpioEdge = {
      pin: TEST_PIN,
      value: GPIO_LEVELS.LOW,
      timestamp: -PULSE_WIDTHS_US.FRAME_GAP_THRESHOLD * 2,
    };

    expect(accumulator.addEdge(rewound)).toBeUndefined();
    expect(
      createFrameEdges(bytes)
        .map((edge) => accumulator.addEdge(edge))
        .filter((frame) => frame !== undefined),
    ).toHaveLength(1);
  });

  it("drops collected pulses on reset", () => {
    const accumulator = createPulseAccumulator();
    const edges = createFrameEdges(bytes);

    edges
      .slice(0, edges.length - 1)
      .forEach((edge) => accumulator.addEdge(edge));
    accumulator.reset();

    expect(accumulator.addEdge(edges[edges.length - 1])).toBeUndefined();
  });
});
