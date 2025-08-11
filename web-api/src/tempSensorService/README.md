# Temp Sensor Service

## Overview

A high-level service that leverages the GPIO Pin Service to interact with the AM2302 (DHT22) temperature and humidity sensor on the Raspberry Pi Zero 2. It transforms raw GPIO events into meaningful temperature and humidity readings and exposes a typed, event-driven API.

## Relationship to GPIO Pin Service

- Uses the GPIO Pin Service public API for low-level pin access and event subscription (no direct hardware access here).
- Loosely coupled via dependency injection (builder pattern) and typed events.

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

## TypeScript API

Types should align with existing controller types and nominal types in `src/types/nominal-types.ts`.

```typescript
// Reading and error shapes
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
```

Notes:

- Use nominal types: `TemperatureC`, `TemperatureF`, `HumidityPercentage`, `Timestamp` from `src/types/nominal-types.ts`.
- Use `TEMP_SENSOR_STATUS` from `src/tempSensorController/constants.ts` for status string literal types.

## Factory & Dependencies

Provide a function builder that accepts dependencies and configuration:

- GPIO Pin Service instance (or factory) used to `startPolling(pin)`, `stopPolling()`, and to subscribe to `onData`, `onError`, and `onStatus`.
- Configuration including the target GPIO pin (defaults to `targetDataGpioPin`) and decoding thresholds.

Example configuration constants live in `src/tempSensorService/constants.ts`.

## Configuration & Constants

- `targetDataGpioPin` (in `src/tempSensorService/constants.ts`) selects the GPIO pin to poll.
- Define all timing thresholds and magic numbers (e.g., pulse width thresholds for bit 0/1, expected frame length, checksum byte positions) as named constants to avoid magic values in logic.
- Keep constants small, composable, and typed with number literal/specific units where practical.

## Error Handling Policy

- Do not throw for recoverable errors (checksum mismatch, transient signal noise, out-of-range values). Surface them as `TempSensorError` events and via `lastError`.
- Only throw when the process must halt (e.g., unrecoverable startup failure). In other cases, return error objects.
- In `try/catch` blocks, use `unknown` for the error type and convert with the shared utility `getErrorReason(e)` from `src/utils.ts`.

## Integration

- On `start()`, call GPIO Pin Service `startPolling(pin)` (pin from config/default constant). Subscribe to GPIO `DATA` events and accumulate/interpret pulses. Maintain `status` as `TEMP_SENSOR_STATUS.RUNNING`.
- On `stop()`, unsubscribe/cleanup and call GPIO Pin Service `stopPolling()`. Set `status` to `TEMP_SENSOR_STATUS.STOPPED`.
- `getLatestReading()` returns the latest valid reading or the last error value; it does not throw for checksum errors.
- `subscribe()` immediately begins invoking the callback for each new reading or error.
- The SSE and REST controllers depend on this contract (`src/tempSensorController/restService.ts`, `src/tempSensorController/sseService.ts`). The SSE layer periodically checks `status` and emits `reading` or `error` events accordingly.

## Testing

- Unit-test pure reducers for: pulse->bit, bit->frame, checksum verification, and range validation.
- Unit-test the service state machine: lifecycle transitions, error propagation, `getLatestReading()` behavior after errors, and subscription/unsubscription.
- Integration-test with a mocked GPIO Pin Service stream (simulate pulses, errors, and status changes).
- Use `npm run test:once` to avoid watch mode in CI; run `npm run typecheck` and `npm run lint` to enforce typing and style.

## Future Extensions

- Sensor calibration offsets and drift compensation.
- Support for additional DHT-family sensors with pluggable decoders.
- Optional smoothing/aggregation (e.g., moving average) as a post-processing projection.

## References

- GPIO Pin Service: `src/gpioPinService/`
- Temp Sensor Controller (REST/SSE and types): `src/tempSensorController/`
- Nominal types: `src/types/nominal-types.ts`
- Constants: `src/tempSensorService/constants.ts`
- Utils (error handling): `src/utils.ts`
