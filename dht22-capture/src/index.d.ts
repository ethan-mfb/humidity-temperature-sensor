/**
 * Types for the DHT22 capture package.
 *
 * Hand-written rather than generated: the implementation is plain .mjs so that
 * scripts/ can run it with no build step, while web-api still gets strict
 * typing across the boundary.
 */

/** One GPIO transition, placed on the session's timeline. */
export type CapturedEdge = {
  /** The logic level the line moved to. */
  readonly level: number;
  /** Microseconds since the session's first edge. */
  readonly tickUs: number;
  /** Nanoseconds since the session's first edge. */
  readonly tickNs: number;
};

/** One edge as the helper reports it, before being placed on a timeline. */
export type HelperSample = {
  readonly level: number;
  readonly timestampNs: number;
};

/** The outcome of one triggered read. */
export type FrameCapture = {
  /** Every edge the sensor produced. Empty when the read failed. */
  readonly edges: readonly CapturedEdge[];
  /** The gpiochip the helper resolved, as reported on its stderr. */
  readonly resolvedChip: string | null;
  /** Non-fatal: a read that captured nothing is data, not a crash. */
  readonly error: { readonly message: string; readonly cause: unknown } | null;
};

export type LibgpiodSession = {
  readFrame(): Promise<FrameCapture>;
};

export type LibgpiodSessionOptions = {
  /** BCM GPIO number of the sensor data line. */
  readonly bcmPin: number;
  /** Overrides the compiled helper's location. */
  readonly helperPath?: string;
  /** Explicit gpiochip, e.g. /dev/gpiochip0. */
  readonly chipPath?: string;
  /** Chip label to resolve when no explicit path is given. */
  readonly chipLabel?: string;
};

export declare const DHT22: {
  readonly START_SIGNAL_LOW_US: number;
  readonly FRAME_WINDOW_MS: number;
  readonly MIN_READ_INTERVAL_MS: number;
};

export declare const TIMESTAMP_SOURCE: string;
export declare const CAPTURE_METHOD: string;
export declare const helperBuildCommand: string;

export declare function helperPath(): string;
export declare function requireHelper(path?: string): Promise<void>;
export declare function parseHelperOutput(stdout: string): HelperSample[];
export declare function createEdgeTimeline(): {
  place(samples: readonly HelperSample[]): CapturedEdge[];
};
export declare function createLibgpiodSession(
  options: LibgpiodSessionOptions,
): LibgpiodSession;
