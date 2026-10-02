#!/usr/bin/env node
/**
 * DHT22/AM2302 capture validator.
 *
 * Replays a capture file from capture-sensor.mjs against the AM2302 frame
 * format and reports, per record, whether it yields a checksum-valid reading.
 * Runs anywhere: it reads a file, it does not touch the hardware.
 *
 * Two defects show up in real captures and this separates them:
 *
 *   - Leading bits lost. Edge detection is armed by the same libgpiod
 *     reconfigure that releases the line, so the sensor's 80us/80us response
 *     and the first few data bits land before the IRQ is live. Recoverable:
 *     relative humidity never exceeds 100%, so the frame's top 6 bits are
 *     always zero and can be filled back in.
 *   - A dropped edge mid-frame, visible as two consecutive edges reporting the
 *     same level. Not recoverable: every bit after it is shifted.
 *
 * Usage: node validate-capture.mjs --help
 */

import { readFile } from "fs/promises";
import { pathToFileURL } from "url";

/** Frame constants from the AM2302 datasheet. */
const DHT22 = {
  /** 16 bits humidity, 16 bits temperature, 8 bits checksum. */
  FRAME_BITS: 40,
  /**
   * A 0 bit is a 26-28us high pulse, a 1 bit is ~70us. The split sits clear of
   * both, so jitter has to be enormous before a bit is misread.
   */
  BIT_HIGH_THRESHOLD_US: 48,
  /** The sensor answers the host's release with an 80us low, then an 80us high. */
  RESPONSE_PULSE_US: 80,
  /**
   * An 80us response high and a ~70us 1 bit are only 10us apart, and observed
   * 1 bits reach 78us, so width alone cannot tell them apart. What can is the
   * low that precedes it: 80us for the response, 50us for every data bit. The
   * pair is what gets matched, and this tolerance only has to separate 80 from
   * 50.
   */
  RESPONSE_TOLERANCE_US: 20,
  /** The response pair leads the frame; past this it would be a data bit. */
  RESPONSE_SEARCH_EDGES: 4,
  /**
   * Relative humidity tops out at 100% (0x03E8), so the humidity high byte is
   * never above 0x03 and the frame's first 6 bits are always zero. That is the
   * entire licence for reconstructing a frame that lost its leading bits.
   */
  RECOVERABLE_LEADING_BITS: 6,
  /** Bit 15 of the temperature word is a sign bit, not part of the magnitude. */
  TEMPERATURE_SIGN_MASK: 0x80,
};

const text = {
  help: `
Validate a DHT22/AM2302 capture file produced by capture-sensor.mjs.

  node validate-capture.mjs --in <file> [options]

Options
  --in <file>    Capture to validate (JSONL, or pretty-printed JSON objects)
  --quiet        Print the summary only, not the per-record table
  --help         Show this message

Exit status is 1 if no record yields a checksum-valid reading.
`,
};

/**
 * Splits concatenated JSON objects.
 *
 * capture-sensor.mjs writes one object per line, but captures routinely get
 * pretty-printed on the way back from the pi, which breaks a line-by-line
 * parse. Tracking brace depth handles both without caring about newlines.
 * @param {string} source
 * @returns {string[]}
 */
function splitJsonObjects(source) {
  const chunks = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        chunks.push(source.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return chunks;
}

/**
 * @param {string} source
 * @returns {Array<Record<string, unknown>>}
 */
function parseRecords(source) {
  return splitJsonObjects(source).map((chunk) => JSON.parse(chunk));
}

/**
 * Durations of each high pulse, which is what carries the bit value. A pulse is
 * a rising edge followed by a falling one; anything else is a dropped edge.
 * @param {ReadonlyArray<{ level: number, tickUs: number }>} edges
 * @returns {number[]}
 */
function toHighPulses(edges) {
  const pulses = [];
  for (let index = 0; index + 1 < edges.length; index += 1) {
    if (edges[index].level === 1 && edges[index + 1].level === 0) {
      pulses.push(edges[index + 1].tickUs - edges[index].tickUs);
    }
  }
  return pulses;
}

/**
 * Indices where two consecutive edges report the same level, meaning the kernel
 * never delivered the transition between them. Position decides severity: one
 * in the first few edges costs a bit that gets filled back in, one mid-frame
 * shifts everything after it.
 * @param {ReadonlyArray<{ level: number }>} edges
 * @returns {number[]}
 */
function findDroppedEdges(edges) {
  const dropped = [];
  for (let index = 0; index + 1 < edges.length; index += 1) {
    if (edges[index].level === edges[index + 1].level) {
      dropped.push(index);
    }
  }
  return dropped;
}

/**
 * Locates the sensor's response handshake: an 80us low immediately followed by
 * an 80us high, at the head of the frame. A data bit pair is 50us low then
 * 26-70us high, so it cannot match both halves.
 *
 * Finding it matters beyond reporting. The response high is wide enough to read
 * as a 1 bit, so a frame that still has its handshake decodes one bit long
 * unless these two edges are taken off the front first.
 * @param {ReadonlyArray<{ level: number, tickUs: number }>} edges
 * @returns {number} index of the response low edge, or -1 if the frame lost it
 */
function findResponsePulse(edges) {
  const isResponseWidth = (duration) =>
    Math.abs(duration - DHT22.RESPONSE_PULSE_US) <= DHT22.RESPONSE_TOLERANCE_US;

  const limit = Math.min(DHT22.RESPONSE_SEARCH_EDGES, edges.length - 2);

  for (let index = 0; index < limit; index += 1) {
    const [low, high, next] = edges.slice(index, index + 3);
    if (low.level !== 0 || high.level !== 1 || next.level !== 0) {
      continue;
    }
    if (
      isResponseWidth(high.tickUs - low.tickUs) &&
      isResponseWidth(next.tickUs - high.tickUs)
    ) {
      return index;
    }
  }

  return -1;
}

/**
 * @param {ReadonlyArray<number>} bits exactly DHT22.FRAME_BITS of them
 * @returns {{ bytes: number[], humidity: number, temperature: number, checksumValid: boolean }}
 */
function decodeFrame(bits) {
  const bytes = [];
  for (let offset = 0; offset < DHT22.FRAME_BITS; offset += 8) {
    bytes.push(parseInt(bits.slice(offset, offset + 8).join(""), 2));
  }

  const [humidityHigh, humidityLow, temperatureHigh, temperatureLow, checksum] =
    bytes;

  const magnitude =
    (((temperatureHigh & ~DHT22.TEMPERATURE_SIGN_MASK) << 8) | temperatureLow) /
    10;

  return {
    bytes,
    humidity: ((humidityHigh << 8) | humidityLow) / 10,
    temperature:
      (temperatureHigh & DHT22.TEMPERATURE_SIGN_MASK) === 0
        ? magnitude
        : -magnitude,
    checksumValid:
      ((humidityHigh + humidityLow + temperatureHigh + temperatureLow) & 0xff) ===
      checksum,
  };
}

/**
 * @param {Record<string, any>} record
 * @returns {Record<string, any>}
 */
function validateRecord(record) {
  const edges = record.edges ?? [];
  const responseIndex = findResponsePulse(edges);

  // Drop the handshake's two edges so only data pulses are counted as bits.
  const dataEdges =
    responseIndex === -1 ? edges : edges.slice(responseIndex + 2);

  const pulses = toHighPulses(dataEdges);
  const bits = pulses.map((pulse) =>
    pulse > DHT22.BIT_HIGH_THRESHOLD_US ? 1 : 0,
  );
  const missingLeadingBits = DHT22.FRAME_BITS - bits.length;
  const droppedEdges = findDroppedEdges(edges);

  const base = {
    attempt: record.attempt,
    edgeCount: edges.length,
    bitCount: bits.length,
    missingLeadingBits,
    droppedEdges: droppedEdges.length,
    hasResponsePulse: responseIndex !== -1,
    frame: null,
    reason: null,
  };

  if (missingLeadingBits < 0) {
    return { ...base, reason: `${-missingLeadingBits} bit(s) too many` };
  }
  if (missingLeadingBits > DHT22.RECOVERABLE_LEADING_BITS) {
    return {
      ...base,
      reason: `${missingLeadingBits} leading bits lost, only ${DHT22.RECOVERABLE_LEADING_BITS} are recoverable`,
    };
  }

  // The lost bits are the top of the humidity high byte, which is zero for any
  // reading the sensor can produce.
  const frame = decodeFrame([
    ...new Array(missingLeadingBits).fill(0),
    ...bits,
  ]);

  return {
    ...base,
    frame,
    reason: frame.checksumValid ? null : "checksum mismatch",
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
 * @param {ReadonlyArray<Record<string, any>>} results
 * @returns {Record<string, unknown>}
 */
function summarize(results) {
  const decoded = results.filter((result) => result.frame?.checksumValid);
  const humidity = decoded.map((result) => result.frame.humidity);
  const temperature = decoded.map((result) => result.frame.temperature);

  return {
    records: results.length,
    decoded: decoded.length,
    leadingBitsLost: describe(results.map((r) => r.missingLeadingBits)),
    framesWithDroppedEdges: results.filter((r) => r.droppedEdges > 0).length,
    framesWithSensorResponse: results.filter((r) => r.hasResponsePulse).length,
    humidityPercent: describe(humidity),
    temperatureCelsius: describe(temperature),
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
 * @param {Record<string, any>} result
 * @returns {string}
 */
function formatRow(result) {
  const outcome =
    result.frame?.checksumValid === true
      ? `RH=${result.frame.humidity.toFixed(1)}%  T=${result.frame.temperature.toFixed(1)}C`
      : result.reason;

  return (
    `${String(result.attempt ?? "?").padStart(4)}` +
    `${String(result.edgeCount).padStart(7)}` +
    `${String(result.bitCount).padStart(6)}` +
    `${String(result.missingLeadingBits).padStart(6)}` +
    `${String(result.droppedEdges).padStart(9)}  ` +
    outcome
  );
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help !== undefined || args.in === undefined) {
    console.log(text.help);
    return;
  }

  const source = await readFile(args.in, "utf8");
  const records = parseRecords(source);

  if (records.length === 0) {
    throw new Error(`No capture records found in ${args.in}`);
  }

  const results = records.map(validateRecord);

  if (args.quiet === undefined) {
    console.log(`Validating ${args.in} — ${records.length} record(s)\n`);
    console.log("   #  edges  bits   pad  dropped  result");
    results.forEach((result) => console.log(formatRow(result)));
    console.log("");
  }

  const summary = summarize(results);
  console.log("Summary");
  console.log(JSON.stringify(summary, null, 2));

  if (summary.decoded === 0) {
    process.exitCode = 1;
  }
}

/** Exported for unit testing; validation only runs when invoked directly. */
export {
  splitJsonObjects,
  parseRecords,
  toHighPulses,
  findDroppedEdges,
  findResponsePulse,
  decodeFrame,
  validateRecord,
  summarize,
  describe,
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
