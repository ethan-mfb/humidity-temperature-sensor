# Temp Sensor Service

## Overview

A high-level service that reads the AM2302 (DHT22) temperature and humidity sensor on the Raspberry Pi Zero 2. It turns raw GPIO edges into meaningful readings and exposes a typed, event-driven API.

## Relationship to the frame source

The service reaches the hardware through the `SensorFrameSource` port, declared
in `types.ts` by this service rather than by any implementation of it. The
AM2302 is request/response -- one start signal, one frame -- so the port is a
single triggered read:

```ts
readFrame(): Promise<FrameCapture>;
close(): Promise<void>;
```

The service owns _when_ to read and what the edges mean. The source owns how the
pin is reached. `src/sensorFrameSource/libgpiod.ts` implements it over the
[`dht22-capture`](../../../dht22-capture/) package; swapping to another
mechanism is a new module and a line in `src/index.ts`, the composition root.

Tests inject a fake source, so the whole service runs with no hardware.

## Responsibilities

- Signal Decoding: Parse and interpret the DHT22 pulse-width–encoded signal into bits, frames, and final readings.
- Data Transformation: Produce app-friendly values (Celsius, Fahrenheit, relative humidity) from decoded frames.
- Unit Conversion: Provide temperature readings in both Celsius and Fahrenheit; humidity as percentage.
- Validation & Error Handling: Verify frame integrity (checksum) and value ranges. On checksum mismatch or other recoverable issues, emit error events without stopping the service.
- API Exposure: Provide a clear, typed API to get the latest reading and to subscribe to updates.
- Extensibility: Keep thresholds/constants and decoding isolated so future sensors or calibrations can be added without breaking consumers.

## Architecture & Data Flow

- Functional and event-driven. Avoid classes; use function builders.
- Internal pipeline follows an event-sourcing style:
  - RawPulse -> BitDecoded -> FrameDecoded -> ChecksumVerified -> ReadingAvailable | ChecksumFailed | RangeError
  - A pure reducer maintains state: { status, lastReading, lastError }.
  - Side-effects (GPIO subscription, timers) are isolated; decoding and validation are pure functions.
- Errors are returned/emitted as values. Only throw to halt on unrecoverable initialization failures.

## Module Layout

| File              | Contents                                                               |
| ----------------- | ---------------------------------------------------------------------- |
| `index.ts`        | `createTempSensorService` factory, lifecycle and subscription handling |
| `decoder.ts`      | Pure pipeline: pulses -> bits -> bytes -> checksum -> reading          |
| `edges.ts`        | Turns one read's edges into the pulses that produced them              |
| `reducer.ts`      | Pure reducer over the pipeline events                                  |
| `constants.ts`    | Target pin, frame layout, pulse widths, sensor ranges, conversions     |
| `types.ts`        | Service, pipeline and state types                                      |
| `types.guards.ts` | `isTempSensorError` runtime guard                                      |

## TypeScript API

The reading, error and service shapes are owned by
`src/tempSensorController/types.ts` so that there is a single definition of the
contract both sides implement; this module re-exports them.

```typescript
export type TempSensorReading = {
  temperatureC: TemperatureC;
  temperatureF: TemperatureF;
  relativeHumidityPercentage: HumidityPercentage;
  timestamp: Timestamp;
};

export type TempSensorError =
  | { type: "checksum"; message: string }
  | { type: "signal"; message: string }
  | { type: "range"; message: string };

export type TempSensorService = {
  // Lifecycle and state
  status: (typeof TEMP_SENSOR_STATUS)[keyof typeof TEMP_SENSOR_STATUS];
  lastError: { type: string; message: string } | undefined;

  // Data access
  getLatestReading(): Promise<TempSensorReading | TempSensorError>;

  // Streaming
  subscribe(
    callback: (event: TempSensorReading | TempSensorError) => void,
  ): () => void; // unsubscribe

  // Control
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createTempSensorService(dependencies: {
  frameSource: SensorFrameSource;
  pin?: GpioPin; // defaults to targetDataGpioPin
  loggingService?: LoggingService;
}): TempSensorService;
```

Notes:

- Nominal types `TemperatureC`, `TemperatureF`, `HumidityPercentage` and `Timestamp` come from `src/types/nominal-types.ts`; `Microseconds` was added there for pulse widths.
- `TEMP_SENSOR_STATUS` from `src/tempSensorController/constants.ts` supplies the status string literal types.
- `status` and `lastError` are exposed as getters so consumers always observe current state.

## Factory & Dependencies

Provide a function builder that accepts dependencies and configuration:

- A `SensorFrameSource` to read frames through. Which pin it reads is the source's business, not the service's.
- Configuration including the target GPIO pin (defaults to `targetDataGpioPin`) and decoding thresholds.

Example configuration constants live in `src/tempSensorService/constants.ts`.

## Configuration & Constants

- `targetDataGpioPin` (in `src/tempSensorService/constants.ts`) selects the GPIO pin to poll.
- Define all timing thresholds and magic numbers (e.g., pulse width thresholds for bit 0/1, expected frame length, checksum byte positions) as named constants to avoid magic values in logic.
- Keep constants small, composable, and typed with number literal/specific units where practical.

## Error Handling Policy

- Do not throw for recoverable errors (checksum mismatch, transient signal noise, out-of-range values). Surface them as `TempSensorError` events and via `lastError`.
- Only throw when the process must halt (e.g., unrecoverable startup failure). In other cases, return error objects.
- `start()` and `stop()` reject with `Already running` and `Already stopped`; the REST controller matches on those messages to answer with 409, so they are part of the contract.
- In `try/catch` blocks, use `unknown` for the error type and convert with the shared utility `getErrorReason(e)` from `src/utils.ts`.

## Integration

- On `start()`, read one frame straight away so the first reading does not wait out an interval, then schedule the next. Maintain `status` as `TEMP_SENSOR_STATUS.RUNNING`.
- Reads schedule themselves rather than running on an interval: a read that runs long must not overlap the next, because the sensor answers a single start signal.
- On `stop()`, cancel the pending read, set `status` to `TEMP_SENSOR_STATUS.STOPPED` and `close()` the source.
- `getLatestReading()` resolves with whichever of a reading or an error the most recent frame produced, and with a `signal` error carrying `No reading available yet` before the first frame. It never throws for checksum errors.
- `lastError` is retained after a later success so the status endpoint can still report it; the most recent outcome is tracked separately.
- Starting clears any history, since readings from a previous run say nothing about the current one.
- `subscribe()` immediately begins invoking the callback for each new reading or error.
- The SSE and REST controllers depend on this contract (`src/tempSensorController/restService.ts`, `src/tempSensorController/sseService.ts`). The SSE layer periodically checks `status` and emits `reading` or `error` events accordingly.

## Testing

- Unit-test pure reducers for: pulse->bit, bit->frame, checksum verification, and range validation.
- Unit-test the service state machine: lifecycle transitions, error propagation, `getLatestReading()` behavior after errors, and subscription/unsubscription.
- Integration-test against a fake `SensorFrameSource` (queue frames, failed captures and outright rejections).
- Use `npm run test:once` to avoid watch mode in CI; run `npm run typecheck` and `npm run lint` to enforce typing and style.

## Future Extensions

- Sensor calibration offsets and drift compensation.
- Support for additional DHT-family sensors with pluggable decoders.
- Optional smoothing/aggregation (e.g., moving average) as a post-processing projection.

## References

- Frame source implementations: `src/sensorFrameSource/`
- Capture package: `dht22-capture/`
- Temp Sensor Controller (REST/SSE and types): `src/tempSensorController/`
- Nominal types: `src/types/nominal-types.ts`
- Constants: `src/tempSensorService/constants.ts`
- Utils (error handling): `src/utils.ts`
