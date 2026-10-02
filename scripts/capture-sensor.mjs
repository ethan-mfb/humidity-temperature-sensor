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

import { appendFile, writeFile } from "fs/promises";
import { pathToFileURL } from "url";
import {
  CAPTURE_METHOD,
  DHT22,
  TIMESTAMP_SOURCE,
  createLibgpiodSession,
  requireHelper,
} from "dht22-capture";

const DEFAULTS = {
  /** BCM GPIO 2 == physical header pin 3, the data pin in README "Connecting the sensor". */
  BCM_PIN: 2,
  SAMPLES: 20,
  INTERVAL_MS: 2500,
};

/** BCM GPIO number -> physical header pin, for the pins this project uses. */
const BCM_TO_PHYSICAL_PIN = {
  2: 3,
  3: 5,
  4: 7,
  17: 11,
  27: 13,
  22: 15,
};

const SCHEMA_VERSION = 3;

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
};

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

  // Unrecoverable: there is nothing to capture with.
  await requireHelper();

  await writeFile(outPath, "");

  const session = createLibgpiodSession({
    bcmPin,
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
export { toEdgeIntervals, summarize, parseArgs, describe };

const isRunDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isRunDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  });
}
