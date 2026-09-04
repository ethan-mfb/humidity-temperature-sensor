import { createGpioValue, createMicroseconds } from "../types/nominal-utils.js";
import { FRAME, GPIO_LEVELS, PULSE_WIDTHS_US } from "./constants.js";
import type { GpioEdge, Pulse, PulseAccumulator } from "./types.js";

/** Every high pulse of a frame: the sensor's response plus one per data bit. */
const highPulsesPerFrame =
  FRAME.SENSOR_RESPONSE_HIGH_PULSE_COUNT + FRAME.DATA_BIT_COUNT;

/**
 * Groups the GPIO edge stream into frames.
 *
 * An edge reports the level the pin has just moved to, so the pulse it
 * completes held the opposite level for the time since the previous edge. A
 * gap longer than a frame's own timings means the previous frame was truncated
 * and collection restarts.
 */
export function createPulseAccumulator(): PulseAccumulator {
  let pulses: Pulse[] = [];
  let highPulseCount = 0;
  let previousEdge: GpioEdge | undefined = undefined;

  function reset(): void {
    pulses = [];
    highPulseCount = 0;
    previousEdge = undefined;
  }

  function startNewFrame(edge: GpioEdge): undefined {
    pulses = [];
    highPulseCount = 0;
    previousEdge = edge;
    return undefined;
  }

  function addEdge(edge: GpioEdge): readonly Pulse[] | undefined {
    if (previousEdge === undefined) {
      return startNewFrame(edge);
    }

    const durationUs = edge.timestamp - previousEdge.timestamp;

    if (durationUs < 0 || durationUs >= PULSE_WIDTHS_US.FRAME_GAP_THRESHOLD) {
      return startNewFrame(edge);
    }

    const completedLevel =
      edge.value === GPIO_LEVELS.HIGH ? GPIO_LEVELS.LOW : GPIO_LEVELS.HIGH;

    pulses.push({
      value: createGpioValue(completedLevel),
      durationUs: createMicroseconds(durationUs),
    });

    previousEdge = edge;

    if (completedLevel === GPIO_LEVELS.HIGH) {
      highPulseCount += 1;
    }

    if (highPulseCount < highPulsesPerFrame) {
      return undefined;
    }

    const framePulses = pulses;
    pulses = [];
    highPulseCount = 0;

    return framePulses;
  }

  return { addEdge, reset };
}
