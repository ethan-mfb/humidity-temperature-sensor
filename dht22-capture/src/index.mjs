/**
 * DHT22/AM2302 frame capture over libgpiod.
 *
 * The timing-critical work happens in the gpiod-capture helper, built from
 * src/gpiod-capture.c. This module owns spawning it, parsing its output and
 * placing edges on a continuous timeline. It does not interpret the signal:
 * callers get the raw edge stream and decode it themselves.
 *
 * Consumed by scripts/capture-sensor.mjs to record captures, and by the
 * web-api to take live readings. Keep it free of anything specific to either.
 */

import { execFile } from "child_process";
import { access } from "fs/promises";
import { promisify } from "util";
import { dirname } from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

/** Host-side signalling constants from the AM2302 datasheet. */
export const DHT22 = {
  /** Host holds the data line low to request a reading. Datasheet minimum is 1ms. */
  START_SIGNAL_LOW_US: 5000,
  /** Idle window after the start signal while the sensor clocks out its frame (~4.8ms). */
  FRAME_WINDOW_MS: 25,
  /** The sensor supports one reading every 2s; faster requests return a stale frame. */
  MIN_READ_INTERVAL_MS: 2000,
};

/** Timestamps come from the kernel's edge IRQ handler, not the Node event loop. */
export const TIMESTAMP_SOURCE = "kernel-monotonic";

/** The capture method this package implements. */
export const CAPTURE_METHOD = "libgpiod";

const HELPER_NAME = "gpiod-capture";

const NANOSECONDS_PER_MICROSECOND = 1000;

/** The helper reports the chip it resolved on stderr; this lifts it back out. */
const RESOLVED_CHIP_PATTERN = /on (\S+) line/;

/** Built by `npm run build`, beside this file in bin/. */
const HELPER_PATH = fileURLToPath(
  new URL(`../bin/${HELPER_NAME}`, import.meta.url),
);

export const helperBuildCommand = `gcc -O2 -Wall -Wextra -std=gnu17 -o bin/${HELPER_NAME} src/${HELPER_NAME}.c $(pkg-config --cflags --libs libgpiod)`;

/**
 * Where the compiled helper lives.
 * @returns {string}
 */
export function helperPath() {
  return HELPER_PATH;
}

/**
 * Confirms the helper has been built. Rejects with an actionable message if
 * not: there is nothing to capture with, so callers cannot continue.
 * @param {string} [path]
 * @returns {Promise<void>}
 */
export async function requireHelper(path = HELPER_PATH) {
  try {
    await access(path);
  } catch (error) {
    throw new Error(
      `GPIO helper not found at ${path}.\n` +
        `Build it on the pi:\n` +
        `  sudo apt install -y build-essential libgpiod-dev pkg-config\n` +
        `  cd ${dirname(dirname(path))} && npm run build\n`,
      { cause: error },
    );
  }
}

/**
 * Places edges on a timeline that starts at the session's first edge.
 *
 * The helper emits absolute CLOCK_MONOTONIC nanoseconds, which keeps running
 * across invocations, so a session spanning many helper runs stays one
 * continuous timeline with the idle gaps between frames intact.
 * @returns {{ place: (samples: ReadonlyArray<{ level: number, timestampNs: number }>) => Array<{ level: number, tickUs: number, tickNs: number }> }}
 */
export function createEdgeTimeline() {
  let sessionStartNs = null;

  return {
    place(samples) {
      return samples.map((sample) => {
        if (sessionStartNs === null) {
          sessionStartNs = sample.timestampNs;
        }
        const tickNs = sample.timestampNs - sessionStartNs;
        return {
          level: sample.level,
          tickUs: Math.round(tickNs / NANOSECONDS_PER_MICROSECOND),
          tickNs,
        };
      });
    },
  };
}

/**
 * Parses the helper's stdout: one "<level> <timestamp_ns>" per edge.
 * @param {string} stdout
 * @returns {Array<{ level: number, timestampNs: number }>}
 */
export function parseHelperOutput(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [level, timestampNs] = line.split(/\s+/);
      return { level: Number(level), timestampNs: Number(timestampNs) };
    })
    .filter(
      (sample) =>
        Number.isFinite(sample.level) && Number.isFinite(sample.timestampNs),
    );
}

/**
 * Opens a capture session backed by the libgpiod helper.
 *
 * Each read spawns the helper once. Spawn cost is a few milliseconds against a
 * read interval measured in seconds, and it keeps the line unowned between
 * reads so nothing else on the pi is locked out.
 * @param {{ bcmPin: number, helperPath?: string, chipPath?: string, chipLabel?: string }} options
 * @returns {{ readFrame: () => Promise<{ edges: Array<{ level: number, tickUs: number, tickNs: number }>, resolvedChip: string | null, error: { message: string, cause: unknown } | null }> }}
 */
export function createLibgpiodSession(options) {
  const timeline = createEdgeTimeline();
  const binary = options.helperPath ?? HELPER_PATH;

  const helperArgs = [
    "--line",
    String(options.bcmPin),
    "--start-low-us",
    String(DHT22.START_SIGNAL_LOW_US),
    "--frame-window-ms",
    String(DHT22.FRAME_WINDOW_MS),
    ...(options.chipPath === undefined ? [] : ["--chip", options.chipPath]),
    ...(options.chipLabel === undefined
      ? []
      : ["--chip-label", options.chipLabel]),
  ];

  return {
    async readFrame() {
      try {
        const { stdout, stderr } = await execFileAsync(binary, helperArgs);
        const resolvedChip = RESOLVED_CHIP_PATTERN.exec(stderr);
        return {
          edges: timeline.place(parseHelperOutput(stdout)),
          resolvedChip: resolvedChip === null ? null : resolvedChip[1],
          error: null,
        };
      } catch (error) {
        // A failed read is expected and recoverable; the caller decides whether
        // to continue. The helper's own diagnostic leads, because it is the
        // actionable part; the exec failure that wraps it is only ever
        // "Command failed: <argv>".
        const reason =
          error instanceof Error ? error.message : "Unknown helper failure";
        const details =
          typeof error?.stderr === "string" ? error.stderr.trim() : "";
        return {
          edges: [],
          resolvedChip: null,
          error: {
            message: details.length === 0 ? reason : `${details}\n${reason}`,
            cause: error,
          },
        };
      }
    },
  };
}
