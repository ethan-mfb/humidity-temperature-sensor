#!/usr/bin/env node
/**
 * DHT22/AM2302 raw signal capture tool.
 *
 * Runs standalone on the Raspberry Pi. Drives the sensor's start signal and
 * records every GPIO edge it produces. It does not interpret the signal: the
 * output is the raw edge stream, meant to be copied back to a dev machine and
 * replayed against the decoder in web-api/src/tempSensorService.
 *
 * The timing-critical part lives in the gpiod-capture helper; this script owns
 * sampling, output and analysis. See scripts/README.md for why that split
 * exists.
 *
 * Usage: node capture-sensor.mjs --help
 */

import { execFile } from "child_process";
import { access, appendFile, writeFile } from "fs/promises";
import { promisify } from "util";
import { dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const execFileAsync = promisify(execFile);

/** Host-side signalling constants from the AM2302 datasheet. */
const DHT22 = {
  /** Host holds the data line low to request a reading. Datasheet minimum is 1ms. */
  START_SIGNAL_LOW_US: 5000,
  /** Idle window after the start signal while the sensor clocks out its frame (~4.8ms). */
  FRAME_WINDOW_MS: 25,
  /** The sensor supports one reading every 2s; faster requests return a stale frame. */
  MIN_READ_INTERVAL_MS: 2000,
};

const DEFAULTS = {
  /** BCM GPIO 2 == physical header pin 3, the data pin in README "Connecting the sensor". */
  BCM_PIN: 2,
  SAMPLES: 20,
  INTERVAL_MS: 2500,
};

/**
 * The capture method is no longer selectable. pigpio was removed from Raspberry
 * Pi OS at trixie and onoff's sysfs interface is deprecated; libgpiod is the
 * supported character-device path and the only one that survives here.
 */
const CAPTURE_METHOD = "libgpiod";

/** Timestamps come from the kernel's edge IRQ handler, not the Node event loop. */
const TIMESTAMP_SOURCE = "kernel-monotonic";

/** BCM GPIO number -> physical header pin, for the pins this project uses. */
const BCM_TO_PHYSICAL_PIN = {
  2: 3,
  3: 5,
  4: 7,
  17: 11,
  27: 13,
  22: 15,
};

const HELPER_NAME = "gpiod-capture";
const HELPER_BUILD_COMMAND = `gcc -O2 -Wall -Wextra -std=gnu17 -o ${HELPER_NAME} ${HELPER_NAME}.c $(pkg-config --cflags --libs libgpiod)`;

const SCHEMA_VERSION = 3;

const NANOSECONDS_PER_MICROSECOND = 1000;

/** The helper reports the chip it resolved on stderr; this lifts it back out. */
const RESOLVED_CHIP_PATTERN = /on (\S+) line/;

const text = {
  help: `
Capture the raw DHT22/AM2302 GPIO edge stream on a Raspberry Pi.

  node capture-sensor.mjs [options]

Options
  --pin <bcm>        BCM GPIO number of the sensor data line (default: ${DEFAULTS.BCM_PIN}, physical pin 3)
  --samples <n>      Start signals to send (default: ${DEFAULTS.SAMPLES})
  --interval <ms>    Delay between start signals (default: ${DEFAULTS.INTERVAL_MS}, sensor minimum is ${DHT22.MIN_READ_INTERVAL_MS})
  --chip <path>      Explicit gpiochip, e.g. /dev/gpiochip0 (default: resolve by label)
  --chip-label <s>   Chip label to resolve (default: the helper's pinctrl-bcm2835)
  --out <file>       Output JSONL path (default: sensor-capture-<timestamp>.jsonl)
  --help             Show this message

Notes
  - This tool records edges only; it does not interpret the signal.
  - Line offsets on the character device are BCM numbers. The +512 sysfs base
    offset does not apply here.
  - No sudo required: /dev/gpiochip* is reachable through the gpio group.
`,

  helperMissing: (helperPath, helperDir) =>
    `Capture helper not found at ${helperPath}.\n` +
    `Build it on the pi first:\n\n` +
    `  sudo apt install -y build-essential libgpiod-dev pkg-config\n` +
    `  cd ${helperDir}\n` +
    `  ${HELPER_BUILD_COMMAND}\n`,
};

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Places edges on a timeline that starts at the session's first edge.
 *
 * The helper emits absolute CLOCK_MONOTONIC nanoseconds, which keeps running
 * across invocations, so a session spanning many helper runs stays one
 * continuous timeline with the idle gaps between frames intact.
 * @returns {{ place: (samples: ReadonlyArray<{ level: number, timestampNs: number }>) => Array<{ level: number, tickUs: number, tickNs: number }> }}
 */
function createEdgeTimeline() {
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
function parseHelperOutput(stdout) {
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
 * @param {{ bcmPin: number, helperPath: string, chipPath?: string, chipLabel?: string }} options
 * @returns {{ readFrame: () => Promise<{ edges: Array<{ level: number, tickUs: number, tickNs: number }>, resolvedChip: string | null, error: { message: string, cause: unknown } | null }> }}
 */
function createLibgpiodSession(options) {
  const timeline = createEdgeTimeline();

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
        const { stdout, stderr } = await execFileAsync(
          options.helperPath,
          helperArgs,
        );
        const resolvedChip = RESOLVED_CHIP_PATTERN.exec(stderr);
        return {
          edges: timeline.place(parseHelperOutput(stdout)),
          resolvedChip: resolvedChip === null ? null : resolvedChip[1],
          error: null,
        };
      } catch (error) {
        // A failed read is expected and recoverable; the run continues and the
        // empty record is kept, because a read that captured nothing is data.
        // The helper's own diagnostic leads, because it is the actionable part;
        // the exec failure that wraps it is only ever "Command failed: <argv>".
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

/**
 * @param {ReadonlyArray<number>} values
 * @returns {{ min: number, median: number, max: number } | null}
 */
function describe(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
  };
}

/**
 * Gaps between consecutive edges within a single triggered read.
 * @param {ReadonlyArray<{ level: number, tickUs: number }>} edges
 * @returns {number[]}
 */
function toEdgeIntervals(edges) {
  return edges.slice(1).map((edge, index) => edge.tickUs - edges[index].tickUs);
}

/**
 * Console-only description of what was captured. Nothing here is written to the
 * output file, and none of it interprets the signal.
 * @param {ReadonlyArray<Record<string, unknown>>} records
 * @returns {Record<string, unknown>}
 */
function summarize(records) {
  const intervals = records.flatMap((record) => toEdgeIntervals(record.edges));

  return {
    method: CAPTURE_METHOD,
    startSignalsSent: records.length,
    failedReads: records.filter((record) => record.error !== null).length,
    totalEdges: records.reduce((total, record) => total + record.edgeCount, 0),
    edgesPerRead: describe(records.map((record) => record.edgeCount)),
    edgeIntervalUs: describe(intervals),
  };
}

/**
 * @param {ReadonlyArray<string>} argv
 * @returns {Record<string, string>}
 */
function parseArgs(argv) {
  return argv.reduce((parsed, token, index) => {
    if (!token.startsWith("--")) {
      return parsed;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    const value = next === undefined || next.startsWith("--") ? "true" : next;
    return { ...parsed, [key]: value };
  }, {});
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help !== undefined) {
    console.log(text.help);
    return;
  }

  const bcmPin = Number(args.pin ?? DEFAULTS.BCM_PIN);
  const samples = Number(args.samples ?? DEFAULTS.SAMPLES);
  const intervalMs = Math.max(
    Number(args.interval ?? DEFAULTS.INTERVAL_MS),
    DHT22.MIN_READ_INTERVAL_MS,
  );
  const outPath =
    args.out ??
    `sensor-capture-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;

  const helperPath = fileURLToPath(new URL(HELPER_NAME, import.meta.url));

  try {
    await access(helperPath);
  } catch (error) {
    // Unrecoverable: there is nothing to capture with.
    throw new Error(text.helperMissing(helperPath, dirname(helperPath)), {
      cause: error,
    });
  }

  await writeFile(outPath, "");

  const session = createLibgpiodSession({
    bcmPin,
    helperPath,
    chipPath: args.chip,
    chipLabel: args["chip-label"],
  });

  console.log(
    `Capturing ${samples} read(s) on BCM GPIO ${bcmPin} ` +
      `(physical pin ${BCM_TO_PHYSICAL_PIN[bcmPin] ?? "unknown"}) every ${intervalMs}ms -> ${outPath}`,
  );

  const records = [];

  for (let attempt = 1; attempt <= samples; attempt += 1) {
    const { edges, resolvedChip, error } = await session.readFrame();

    const record = {
      schemaVersion: SCHEMA_VERSION,
      capturedAt: new Date().toISOString(),
      method: CAPTURE_METHOD,
      timestampSource: TIMESTAMP_SOURCE,
      bcmPin,
      physicalPin: BCM_TO_PHYSICAL_PIN[bcmPin] ?? null,
      chip: resolvedChip,
      attempt,
      startSignalLowUs: DHT22.START_SIGNAL_LOW_US,
      frameWindowMs: DHT22.FRAME_WINDOW_MS,
      edgeCount: edges.length,
      error: error === null ? null : error.message,
      edges,
    };
    records.push(record);
    await appendFile(outPath, `${JSON.stringify(record)}\n`);

    const [firstEdge] = edges;
    const lastEdge = edges[edges.length - 1];
    const spanUs =
      firstEdge === undefined ? 0 : lastEdge.tickUs - firstEdge.tickUs;
    console.log(
      `[${attempt}/${samples}] edges=${edges.length} span=${spanUs}us` +
        (error === null ? "" : ` error=${error.message.split("\n")[0]}`),
    );

    if (attempt < samples) {
      await delay(intervalMs);
    }
  }

  console.log("\nSummary");
  console.log(JSON.stringify(summarize(records), null, 2));
  console.log(`\nWrote ${records.length} record(s) to ${outPath}`);
}

/** Exported for unit testing; the capture itself only runs when invoked directly. */
export {
  createEdgeTimeline,
  parseHelperOutput,
  toEdgeIntervals,
  summarize,
  parseArgs,
  describe,
};

const isRunDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isRunDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  });
}
