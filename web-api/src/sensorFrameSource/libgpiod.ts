import {
  createLibgpiodSession,
  requireHelper,
  type LibgpiodSession,
} from "dht22-capture";
import { createGpioValue, createMicroseconds } from "../types/nominal-utils.js";
import type { GpioPin } from "../types/nominal-types.js";
import { unwrapGpioPin } from "../types/nominal-utils.js";
import type {
  FrameCapture,
  GpioEdge,
  SensorFrameSource,
} from "../tempSensorService/types.js";

/**
 * Reads the sensor through the dht22-capture package.
 *
 * The package spawns a small C helper per read. That is the only way to get
 * this signal off a pi: the start pulse and the edge listen have to happen
 * across one libgpiod request that never releases the line, and the edges have
 * to carry the kernel's own timestamps. A 0 bit is a ~26us high pulse and a 1
 * bit ~70us, which the node event loop cannot resolve. See
 * `dht22-capture/README.md`.
 */
export type LibgpiodFrameSourceOptions = {
  readonly pin: GpioPin;
  /** Explicit gpiochip, e.g. /dev/gpiochip0. Resolved by label when absent. */
  readonly chipPath?: string;
  /** Chip label to resolve. The package defaults to the Pi Zero 2 W's. */
  readonly chipLabel?: string;
};

/**
 * Converts the package's edges into the service's.
 *
 * `tickUs` is measured from the session's first edge and the session spans
 * every read, so the timeline stays continuous and intervals within a frame
 * stay correct.
 */
function toGpioEdges(
  pin: GpioPin,
  edges: readonly { level: number; tickUs: number }[],
): readonly GpioEdge[] {
  return edges.map((edge) => ({
    pin: unwrapGpioPin(pin),
    value: createGpioValue(edge.level),
    timestamp: createMicroseconds(edge.tickUs),
  }));
}

export function createLibgpiodFrameSource(
  options: LibgpiodFrameSourceOptions,
): SensorFrameSource {
  // Opened lazily so constructing the service does not need the helper, which
  // only exists on a machine that has built it.
  let session: LibgpiodSession | undefined = undefined;

  async function openSession(): Promise<LibgpiodSession> {
    if (session === undefined) {
      // Unrecoverable: without the helper there is nothing to read with.
      await requireHelper();
      session = createLibgpiodSession({
        bcmPin: unwrapGpioPin(options.pin),
        chipPath: options.chipPath,
        chipLabel: options.chipLabel,
      });
    }
    return session;
  }

  return {
    async readFrame(): Promise<FrameCapture> {
      const capture = await (await openSession()).readFrame();

      return {
        edges: toGpioEdges(options.pin, capture.edges),
        error: capture.error === null ? null : capture.error.message,
      };
    },

    async close(): Promise<void> {
      // The helper owns the line only while it runs, and it has already exited
      // by the time readFrame resolves. Dropping the session is the whole job.
      session = undefined;
    },
  };
}
