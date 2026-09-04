#!/usr/bin/env node
/**
 * DHT22/AM2302 raw signal capture tool.
 *
 * Runs standalone on the Raspberry Pi. Drives the sensor's start signal, records
 * every GPIO edge of the response frame, decodes it, and appends one JSON object
 * per capture attempt to a JSONL file. The JSONL is intended to be copied back to
 * a dev machine and used as fixture data for the tempSensorService decoder tests.
 *
 * Usage: node capture-sensor.mjs --help
 */

import { pathToFileURL } from "url";

/** Timing and framing constants from the AM2302 datasheet. */
const DHT22 = {
  /** Host holds the data line low to request a reading. Datasheet minimum is 1ms. */
  START_SIGNAL_LOW_US: 5000,
  /** Wall-clock window to stay idle while the sensor clocks out its frame (~4.8ms). */
  FRAME_WINDOW_MS: 25,
  /** Sensor supports one reading every 2s; anything faster returns a stale frame. */
  MIN_READ_INTERVAL_MS: 2000,
  /** Data bits per frame. */
  BIT_COUNT: 40,
  /** Bytes per frame: humidity high/low, temperature high/low, checksum. */
  BYTE_COUNT: 5,
  BITS_PER_BYTE: 8,
  /** High-pulse width that separates a 0 bit (~26-28us) from a 1 bit (~70us). */
  BIT_HIGH_THRESHOLD_US: 50,
  /** Expected edge count: host low, release, response pair, then 2 edges per data bit. */
  EXPECTED_EDGE_COUNT: 85,
  /** Sign bit lives in the MSB of the temperature high byte. */
  TEMPERATURE_SIGN_MASK: 0x80,
  TEMPERATURE_VALUE_MASK: 0x7fff,
  /** Raw humidity and temperature are transmitted as tenths. */
  VALUE_SCALE: 10,
  CHECKSUM_MASK: 0xff,
};

const CAPTURE_METHODS = {
  PIGPIO: "pigpio",
  ONOFF: "onoff",
  BOTH: "both",
};

const DECODE_FAILURE_REASONS = {
  TOO_FEW_EDGES: "too-few-edges",
  TOO_FEW_PULSES: "too-few-pulses",
  CHECKSUM_MISMATCH: "checksum-mismatch",
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

const SCHEMA_VERSION = 1;

const MICROSECONDS_PER_MILLISECOND = 1000;
const NANOSECONDS_PER_MICROSECOND = 1000n;
const UINT32_MASK = 0xffffffff;
const FAHRENHEIT_RATIO = 9 / 5;
const FAHRENHEIT_OFFSET = 32;
const PERCENT_MIN = 0;
const PERCENT_MAX = 100;

const text = {
  help: `
Capture raw DHT22/AM2302 signal data on a Raspberry Pi.

  node capture-sensor.mjs [options]

Options
  --pin <bcm>        BCM GPIO number of the sensor data line (default: ${DEFAULTS.BCM_PIN}, physical pin 3)
  --method <name>    pigpio | onoff | both (default: ${DEFAULTS.METHOD})
  --samples <n>      Capture attempts per method (default: ${DEFAULTS.SAMPLES})
  --interval <ms>    Delay between attempts (default: ${DEFAULTS.INTERVAL_MS}, sensor minimum is ${DHT22.MIN_READ_INTERVAL_MS})
  --out <file>       Output JSONL path (default: sensor-capture-<timestamp>.jsonl)
  --help             Show this message

Notes
  - pigpio timestamps edges in its DMA sampler and is the only method accurate
    enough to decode DHT22 reliably. It requires root: run with sudo.
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
 * Rebases absolute edge ticks onto the first edge, handling uint32 tick wraparound.
 * @param {ReadonlyArray<{ level: number, tick: number }>} edges
 * @returns {Array<{ level: number, tickUs: number }>}
 */
function toRelativeEdges(edges) {
  if (edges.length === 0) {
    return [];
  }
  const [{ tick: baseTick }] = edges;
  return edges.map((edge) => ({
    level: edge.level,
    tickUs: (edge.tick - baseTick) & UINT32_MASK,
  }));
}

/**
 * Extracts the width of every high pulse in the edge stream.
 * DHT22 encodes each bit in the width of the high half of the pulse pair.
 * @param {ReadonlyArray<{ level: number, tickUs: number }>} edges
 * @returns {number[]}
 */
function toHighPulseWidths(edges) {
  return edges
    .map((edge, index) => ({ edge, nextEdge: edges[index + 1] }))
    .filter(
      ({ edge, nextEdge }) =>
        edge.level === GPIO_LEVELS.HIGH && nextEdge !== undefined,
    )
    .map(({ edge, nextEdge }) => nextEdge.tickUs - edge.tickUs);
}

/**
 * @param {ReadonlyArray<number>} bits
 * @returns {number[]}
 */
function toBytes(bits) {
  return Array.from({ length: DHT22.BYTE_COUNT }, (_unused, byteIndex) =>
    bits
      .slice(
        byteIndex * DHT22.BITS_PER_BYTE,
        byteIndex * DHT22.BITS_PER_BYTE + DHT22.BITS_PER_BYTE,
      )
      .reduce((accumulator, bit) => (accumulator << 1) | bit, 0),
  );
}

/**
 * Decodes a captured edge stream into a sensor reading.
 * Pure: this is the reference implementation the tempSensorService decoder
 * should agree with, so failures are returned rather than thrown.
 * @param {ReadonlyArray<{ level: number, tickUs: number }>} edges
 * @returns {Record<string, unknown>}
 */
function decodeFrame(edges) {
  if (edges.length < DHT22.BIT_COUNT) {
    return {
      ok: false,
      reason: DECODE_FAILURE_REASONS.TOO_FEW_EDGES,
      edgeCount: edges.length,
      expectedEdgeCount: DHT22.EXPECTED_EDGE_COUNT,
    };
  }

  const highPulseWidthsUs = toHighPulseWidths(edges);
  if (highPulseWidthsUs.length < DHT22.BIT_COUNT) {
    return {
      ok: false,
      reason: DECODE_FAILURE_REASONS.TOO_FEW_PULSES,
      highPulseCount: highPulseWidthsUs.length,
      expectedHighPulseCount: DHT22.BIT_COUNT,
    };
  }

  // The data bits are the trailing 40 high pulses; anything before them is the
  // host release pulse and the sensor's 80us response pulse.
  const dataPulseWidthsUs = highPulseWidthsUs.slice(-DHT22.BIT_COUNT);
  const bits = dataPulseWidthsUs.map((widthUs) =>
    widthUs > DHT22.BIT_HIGH_THRESHOLD_US ? 1 : 0,
  );
  const bytes = toBytes(bits);
  const [humidityHigh, humidityLow, temperatureHigh, temperatureLow, checksum] =
    bytes;

  const computedChecksum =
    (humidityHigh + humidityLow + temperatureHigh + temperatureLow) &
    DHT22.CHECKSUM_MASK;

  const rawHumidity = (humidityHigh << DHT22.BITS_PER_BYTE) | humidityLow;
  const rawTemperature =
    (temperatureHigh << DHT22.BITS_PER_BYTE) | temperatureLow;
  const isNegative = (temperatureHigh & DHT22.TEMPERATURE_SIGN_MASK) !== 0;
  const temperatureC =
    ((rawTemperature & DHT22.TEMPERATURE_VALUE_MASK) / DHT22.VALUE_SCALE) *
    (isNegative ? -1 : 1);
  const relativeHumidityPercentage = rawHumidity / DHT22.VALUE_SCALE;

  const decoded = {
    bits: bits.join(""),
    bytes,
    dataPulseWidthsUs,
    checksumReceived: checksum,
    checksumComputed: computedChecksum,
    temperatureC,
    temperatureF: temperatureC * FAHRENHEIT_RATIO + FAHRENHEIT_OFFSET,
    relativeHumidityPercentage,
    humidityInRange:
      relativeHumidityPercentage >= PERCENT_MIN &&
      relativeHumidityPercentage <= PERCENT_MAX,
  };

  if (computedChecksum !== checksum) {
    return {
      ok: false,
      reason: DECODE_FAILURE_REASONS.CHECKSUM_MISMATCH,
      ...decoded,
    };
  }

  return { ok: true, ...decoded };
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
 * Captures one frame using pigpio's DMA-sampled, hardware-timestamped alerts.
 * @param {{ bcmPin: number, pigpio: Record<string, unknown> }} options
 * @returns {Promise<Array<{ level: number, tickUs: number }>>}
 */
async function captureWithPigpio(options) {
  const { Gpio } = options.pigpio;
  const pin = new Gpio(options.bcmPin, {
    mode: Gpio.INPUT,
    pullUpDown: Gpio.PUD_UP,
    alert: true,
  });
  pin.glitchFilter(0);

  const edges = [];
  const onAlert = (level, tick) => edges.push({ level, tick });
  pin.on("alert", onAlert);

  pin.mode(Gpio.OUTPUT);
  pin.digitalWrite(GPIO_LEVELS.LOW);
  busyWaitMicroseconds(DHT22.START_SIGNAL_LOW_US);
  pin.mode(Gpio.INPUT);
  pin.pullUpDown(Gpio.PUD_UP);

  await delay(DHT22.FRAME_WINDOW_MS);
  pin.removeListener("alert", onAlert);

  return toRelativeEdges(edges);
}

/**
 * Captures one frame using onoff, timestamping edges in the Node event loop.
 * This mirrors what gpioPinPollingService can observe today.
 * @param {{ bcmPin: number, onoff: Record<string, unknown> }} options
 * @returns {Promise<Array<{ level: number, tickUs: number }>>}
 */
async function captureWithOnoff(options) {
  const { Gpio } = options.onoff;
  const pin = new Gpio(options.bcmPin, "in", "both", {
    reconfigureDirection: true,
  });

  const edges = [];
  const startedAt = process.hrtime.bigint();
  pin.watch((error, value) => {
    if (error) {
      return;
    }
    edges.push({
      level: value,
      tick: Number(
        (process.hrtime.bigint() - startedAt) / NANOSECONDS_PER_MICROSECOND,
      ),
    });
  });

  pin.setDirection("out");
  pin.writeSync(GPIO_LEVELS.LOW);
  busyWaitMicroseconds(DHT22.START_SIGNAL_LOW_US);
  pin.setDirection("in");
  pin.setEdge("both");

  await delay(DHT22.FRAME_WINDOW_MS);

  pin.unwatchAll();
  pin.unexport();

  return toRelativeEdges(edges);
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
 * Builds the end-of-run summary, including the pulse-width separation that the
 * decoder's bit threshold constant should be derived from.
 * @param {ReadonlyArray<Record<string, unknown>>} records
 * @param {string} method
 * @returns {Record<string, unknown>}
 */
function summarize(records, method) {
  const forMethod = records.filter((record) => record.method === method);
  const decoded = forMethod.filter((record) => record.decode.ok);
  const withPulses = forMethod.filter(
    (record) => record.decode.dataPulseWidthsUs !== undefined,
  );

  const pulsesByBit = withPulses.flatMap((record) =>
    record.decode.dataPulseWidthsUs.map((widthUs, index) => ({
      widthUs,
      bit: Number(record.decode.bits[index]),
    })),
  );
  const zeroPulses = pulsesByBit
    .filter(({ bit }) => bit === 0)
    .map(({ widthUs }) => widthUs);
  const onePulses = pulsesByBit
    .filter(({ bit }) => bit === 1)
    .map(({ widthUs }) => widthUs);

  const failureReasons = forMethod
    .filter((record) => !record.decode.ok)
    .reduce(
      (tally, record) => ({
        ...tally,
        [record.decode.reason]: (tally[record.decode.reason] ?? 0) + 1,
      }),
      {},
    );

  return {
    method,
    attempts: forMethod.length,
    decodedOk: decoded.length,
    failureReasons,
    edgeCount: describe(forMethod.map((record) => record.edgeCount)),
    expectedEdgeCount: DHT22.EXPECTED_EDGE_COUNT,
    zeroBitPulseUs: describe(zeroPulses),
    oneBitPulseUs: describe(onePulses),
    temperatureC: describe(decoded.map((record) => record.decode.temperatureC)),
    relativeHumidityPercentage: describe(
      decoded.map((record) => record.decode.relativeHumidityPercentage),
    ),
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
    // Unrecoverable: nothing to capture with.
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
    `Capturing ${samples} sample(s) per method [${methods.join(", ")}] on BCM GPIO ${bcmPin} ` +
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
    const capture = isPigpio
      ? () => captureWithPigpio({ bcmPin, pigpio: gpioModule })
      : () => captureWithOnoff({ bcmPin, onoff: gpioModule });

    for (let attempt = 1; attempt <= samples; attempt += 1) {
      const edges = await capture();
      const decode = decodeFrame(edges);
      const record = {
        schemaVersion: SCHEMA_VERSION,
        capturedAt: new Date().toISOString(),
        method: activeMethod,
        bcmPin,
        physicalPin: BCM_TO_PHYSICAL_PIN[bcmPin] ?? null,
        attempt,
        edgeCount: edges.length,
        edges,
        decode,
      };
      records.push(record);
      await appendFile(outPath, `${JSON.stringify(record)}\n`);

      console.log(
        decode.ok
          ? `[${activeMethod} ${attempt}/${samples}] ok  edges=${edges.length} ` +
              `${decode.temperatureC.toFixed(1)}C / ${decode.temperatureF.toFixed(1)}F / ` +
              `${decode.relativeHumidityPercentage.toFixed(1)}%RH`
          : `[${activeMethod} ${attempt}/${samples}] FAIL edges=${edges.length} reason=${decode.reason}`,
      );

      if (attempt < samples) {
        await delay(intervalMs);
      }
    }

    if (isPigpio && typeof gpioModule.terminate === "function") {
      gpioModule.terminate();
    }
  }

  const summaries = methods.map((activeMethod) =>
    summarize(records, activeMethod),
  );
  console.log("\nSummary");
  console.log(JSON.stringify(summaries, null, 2));
  console.log(`\nWrote ${records.length} record(s) to ${outPath}`);
}

/** Reusable pieces, so decoder tests can assert against this reference implementation. */
export {
  DHT22,
  DECODE_FAILURE_REASONS,
  decodeFrame,
  toHighPulseWidths,
  toBytes,
  summarize,
  parseArgs,
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
