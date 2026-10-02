import { createGpioValue, createMicroseconds } from "../types/nominal-utils.js";
import type { GpioEdge, Pulse } from "./types.js";

/**
 * Turns one triggered read's edges into the pulses that produced them.
 *
 * An edge reports the level the line moved to, so the interval between two
 * edges held the level of the earlier one. Framing is not this function's job:
 * the sensor answers one start signal with one frame, and the frame source
 * returns exactly that, so there are no frame boundaries left to find.
 */
export function toPulses(edges: readonly GpioEdge[]): readonly Pulse[] {
  return edges.slice(1).reduce<Pulse[]>((pulses, edge, index) => {
    const openingEdge = edges[index];
    const durationUs = edge.timestamp - openingEdge.timestamp;

    // The kernel's monotonic clock does not go backwards, so this means the
    // capture is malformed. Drop the interval rather than invent a width.
    if (durationUs < 0) {
      return pulses;
    }

    return [
      ...pulses,
      {
        value: createGpioValue(openingEdge.value),
        durationUs: createMicroseconds(durationUs),
      },
    ];
  }, []);
}
