#!/usr/bin/env node
/**
 * DHT22/AM2302 raw signal capture tool.
 *
 * Runs standalone on the Raspberry Pi. Drives the sensor's start signal and
 * records every GPIO edge it produces. It does not interpret the signal: the
 * output is the raw edge stream, meant to be copied back to a dev machine and
 * replayed.
 *
 * Usage: node capture-sensor.mjs --help
 */

import { pathToFileURL } from "url";

/** Host-side signalling constants from the AM2302 datasheet. */
const DHT22 = {
  /** Host holds the data line low to request a reading. Datasheet minimum is 1ms. */
  START_SIGNAL_LOW_US: 5000,
  /** Idle window after the start signal while the sensor clocks out its frame (~4.8ms). */
  FRAME_WINDOW_MS: 25,
  /** The sensor supports one reading every 2s; faster requests return a stale frame. */
  MIN_READ_INTERVAL_MS: 2000,
};

const CAPTURE_METHODS = {
  PIGPIO: "pigpio",
  ONOFF: "onoff",
  BOTH: "both",
};

const GPIO_LEVELS = {
  LOW: 0,
  HIGH: 1,
};

const DEFAULTS = {
  /** BCM GPIO 2 == physical header pin 3, the data pin in README "Connecting the sensor". */
  BCM_PIN: 2,
  METHOD: CAPTURE_METHODS.PIGPIO,
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

const SCHEMA_VERSION = 2;

const NANOSECONDS_PER_MICROSECOND = 1000n;

const text = {
  help: `
Capture the raw DHT22/AM2302 GPIO edge stream on a Raspberry Pi.

  node capture-sensor.mjs [options]

Options
  --pin <bcm>        BCM GPIO number of the sensor data line (default: ${DEFAULTS.BCM_PIN}, physical pin 3)
  --method <name>    pigpio | onoff | both (default: ${DEFAULTS.METHOD})
  --samples <n>      Start signals to send per method (default: ${DEFAULTS.SAMPLES})
  --interval <ms>    Delay between start signals (default: ${DEFAULTS.INTERVAL_MS}, sensor minimum is ${DHT22.MIN_READ_INTERVAL_MS})
  --out <file>       Output JSONL path (default: sensor-capture-<timestamp>.jsonl)
  --help             Show this message

Notes
  - This tool records edges only; it does not interpret the signal.
  - pigpio timestamps edges in its DMA sampler and is the only method with
    enough timing resolution to represent DHT22 pulse widths. It requires root.
  - onoff timestamps edges in the Node event loop. It is included so you can
    measure how much timing detail the current gpioPinPollingService loses.
`,
};

/**
 * Blocks the thread for the given number of microseconds.
 * Needed for the start signal: setTimeout cannot resolve at this granularity.
 * @param {number} microseconds
 * @returns {void}
 */
function busyWaitMicroseconds(microseconds) {
  const deadline =
    process.hrtime.bigint() +
    BigInt(microseconds) * NANOSECONDS_PER_MICROSECOND;
  while (process.hrtime.bigint() < deadline) {
    // intentionally spinning; the start pulse must be timed in microseconds
  }
}

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Accumulates edges on a timeline that starts at the session's first edge.
 * Deltas are folded into a running total so pigpio's uint32 microsecond tick
 * can wrap (every ~71 minutes) without corrupting or overflowing the timeline.
 * @returns {{ record: (level: number, tick: number) => void, drain: () => Array<{ level: number, tickUs: number }> }}
 */
function createEdgeTimeline() {
  let previousTick = null;
  let elapsedUs = 0;
  let edges = [];

  return {
    record(level, tick) {
      if (previousTick !== null) {
        // `>>> 0` keeps the delta unsigned, so a gap wider than 2^31us stays positive.
        elapsedUs += (tick - previousTick) >>> 0;
      }
      previousTick = tick;
      edges.push({ level, tickUs: elapsedUs });
    },
    drain() {
      const drained = edges;
      edges = [];
      return drained;
    },
  };
}

/**
 * Dynamically loads a CommonJS GPIO library, tolerating the default-export wrapper.
 * @param {string} moduleName
 * @returns {Promise<Record<string, unknown>>}
 */
async function loadGpioModule(moduleName) {
  const loaded = await import(moduleName);
  return loaded.default ?? loaded;
}

/**
 * Opens a capture session backed by pigpio's DMA-sampled, hardware-timestamped alerts.
 * The listener stays attached for the whole session, so the idle gaps between
 * frames are preserved in the timeline.
 * @param {{ bcmPin: number, pigpio: Record<string, unknown> }} options
 * @returns {{ triggerRead: () => Promise<void>, drain: () => Array<{ level: number, tickUs: number }>, close: () => void }}
 */
function createPigpioSession(options) {
  const { Gpio } = options.pigpio;
  const pin = new Gpio(options.bcmPin, {
    mode: Gpio.INPUT,
    pullUpDown: Gpio.PUD_UP,
    alert: true,
  });
  pin.glitchFilter(0);

  const timeline = createEdgeTimeline();
  pin.on("alert", (level, tick) => timeline.record(level, tick));

  return {
    async triggerRead() {
      pin.mode(Gpio.OUTPUT);
      pin.digitalWrite(GPIO_LEVELS.LOW);
      busyWaitMicroseconds(DHT22.START_SIGNAL_LOW_US);
      pin.mode(Gpio.INPUT);
      pin.pullUpDown(Gpio.PUD_UP);
      await delay(DHT22.FRAME_WINDOW_MS);
    },
    drain: timeline.drain,
    close() {
      pin.removeAllListeners("alert");
      if (typeof options.pigpio.terminate === "function") {
        options.pigpio.terminate();
      }
    },
  };
}

/**
 * Opens a capture session backed by onoff, timestamping edges in the Node event
 * loop. This mirrors what gpioPinPollingService can observe today.
 * @param {{ bcmPin: number, onoff: Record<string, unknown> }} options
 * @returns {{ triggerRead: () => Promise<void>, drain: () => Array<{ level: number, tickUs: number }>, close: () => void }}
 */
function createOnoffSession(options) {
  const { Gpio } = options.onoff;
  const pin = new Gpio(options.bcmPin, "in", "both", {
    reconfigureDirection: true,
  });

  const timeline = createEdgeTimeline();
  const startedAt = process.hrtime.bigint();
  pin.watch((error, value) => {
    if (error) {
      return;
    }
    timeline.record(
      value,
      Number(
        (process.hrtime.bigint() - startedAt) / NANOSECONDS_PER_MICROSECOND,
      ),
    );
  });

  return {
    async triggerRead() {
      pin.setDirection("out");
      pin.writeSync(GPIO_LEVELS.LOW);
      busyWaitMicroseconds(DHT22.START_SIGNAL_LOW_US);
      pin.setDirection("in");
      pin.setEdge("both");
      await delay(DHT22.FRAME_WINDOW_MS);
    },
    drain: timeline.drain,
    close() {
      pin.unwatchAll();
      pin.unexport();
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
 * @param {string} method
 * @returns {Record<string, unknown>}
 */
function summarize(records, method) {
  const forMethod = records.filter((record) => record.method === method);
  const intervals = forMethod.flatMap((record) =>
    toEdgeIntervals(record.edges),
  );

  return {
    method,
    startSignalsSent: forMethod.length,
    totalEdges: forMethod.reduce(
      (total, record) => total + record.edgeCount,
      0,
    ),
    edgesPerRead: describe(forMethod.map((record) => record.edgeCount)),
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
  const method = args.method ?? DEFAULTS.METHOD;
  const samples = Number(args.samples ?? DEFAULTS.SAMPLES);
  const intervalMs = Math.max(
    Number(args.interval ?? DEFAULTS.INTERVAL_MS),
    DHT22.MIN_READ_INTERVAL_MS,
  );
  const outPath =
    args.out ??
    `sensor-capture-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;

  if (!Object.values(CAPTURE_METHODS).includes(method)) {
    // Unrecoverable: there is nothing to capture with.
    throw new Error(
      `Unknown --method "${method}". Expected one of: ${Object.values(CAPTURE_METHODS).join(", ")}.`,
    );
  }

  const { appendFile, writeFile } = await import("fs/promises");
  await writeFile(outPath, "");

  const methods =
    method === CAPTURE_METHODS.BOTH
      ? [CAPTURE_METHODS.PIGPIO, CAPTURE_METHODS.ONOFF]
      : [method];

  console.log(
    `Capturing ${samples} read(s) per method [${methods.join(", ")}] on BCM GPIO ${bcmPin} ` +
      `(physical pin ${BCM_TO_PHYSICAL_PIN[bcmPin] ?? "unknown"}) every ${intervalMs}ms -> ${outPath}`,
  );

  const records = [];

  for (const activeMethod of methods) {
    const isPigpio = activeMethod === CAPTURE_METHODS.PIGPIO;

    if (isPigpio && process.getuid !== undefined && process.getuid() !== 0) {
      console.warn(
        "pigpio needs direct peripheral access; re-run with sudo if the next step fails.",
      );
    }

    const gpioModule = await loadGpioModule(activeMethod);
    const session = isPigpio
      ? createPigpioSession({ bcmPin, pigpio: gpioModule })
      : createOnoffSession({ bcmPin, onoff: gpioModule });

    try {
      for (let attempt = 1; attempt <= samples; attempt += 1) {
        await session.triggerRead();
        const edges = session.drain();
        const record = {
          schemaVersion: SCHEMA_VERSION,
          capturedAt: new Date().toISOString(),
          method: activeMethod,
          bcmPin,
          physicalPin: BCM_TO_PHYSICAL_PIN[bcmPin] ?? null,
          attempt,
          startSignalLowUs: DHT22.START_SIGNAL_LOW_US,
          frameWindowMs: DHT22.FRAME_WINDOW_MS,
          edgeCount: edges.length,
          edges,
        };
        records.push(record);
        await appendFile(outPath, `${JSON.stringify(record)}\n`);

        const [firstEdge] = edges;
        const lastEdge = edges[edges.length - 1];
        const spanUs =
          firstEdge === undefined ? 0 : lastEdge.tickUs - firstEdge.tickUs;
        console.log(
          `[${activeMethod} ${attempt}/${samples}] edges=${edges.length} span=${spanUs}us`,
        );

        if (attempt < samples) {
          await delay(intervalMs);
        }
      }
    } finally {
      session.close();
    }
  }

  const summaries = methods.map((activeMethod) =>
    summarize(records, activeMethod),
  );
  console.log("\nSummary");
  console.log(JSON.stringify(summaries, null, 2));
  console.log(`\nWrote ${records.length} record(s) to ${outPath}`);
}

/** Exported for unit testing; the capture itself only runs when invoked directly. */
export { createEdgeTimeline, toEdgeIntervals, summarize, parseArgs, describe };

const isRunDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isRunDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  });
}
