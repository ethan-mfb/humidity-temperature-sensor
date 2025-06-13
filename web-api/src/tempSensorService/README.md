# Temp Sensor Service

## Overview

A high-level service that leverages the GPIO Pin Service to interact with the AM2302 (DHT22) temperature and humidity sensor on the Raspberry Pi Zero 2. It transforms raw GPIO data into meaningful temperature and humidity readings, and exposes a typed, event-driven API.

## Relationship to GPIO Pin Service

- Uses the GPIO Pin Service for low-level pin access and event subscription.
- Loosely coupled: interacts only via the GPIO Pin Service public API.

## Responsibilities

- Data Transformation: Transform raw data received from the GPIO Pin Service into application-friendly values.
- Signal Decoding: Parse and interpret the digital signal according to the AM2302/DHT22 datasheet, extracting temperature and humidity readings.
- Unit Conversion: Provide temperature readings in both Celsius and Fahrenheit, and relative humidity as a percentage.
- Validation & Error Handling: Validate sensor data for integrity (e.g., checksum verification) internally. If a checksum mismatch occurs, emit an error event to subscribers but do not stop the service. Consumers are not exposed to checksum logic directly.
- API Exposure: Expose a clear, typed API for other services/controllers to request the latest sensor readings or subscribe to updates.
- Extensibility: Design the service to allow for future support of additional sensor types or calibration logic.

## Architecture & Data Flow

- Follows functional programming and event-driven design.
- All errors, including checksum errors, are surfaced to consumers only as error events and do not stop the service.
- Loosely coupled: interacts only with the GPIO Pin Service via public API.

## TypeScript API

```typescript
export type TempSensorReading = {
  temperatureC: number;
  temperatureF: number;
  relativeHumidityPercentage: number;
  timestamp: number;
};

export type TempSensorError =
  | { type: "checksum"; message: string }
  | { type: "signal"; message: string }
  | { type: "range"; message: string };

export type Unsubscribe = () => void;

export type TempSensorService = {
  /**
   * Returns the latest valid reading or the last error (including checksum errors).
   * Does not throw on checksum errors; these are surfaced as error events only.
   */
  getLatestReading(): Promise<TempSensorReading | TempSensorError>;

  /**
   * Subscribe to new readings and error events (including checksum errors).
   * The service continues running after checksum errors.
   * Returns an unsubscribe function.
   */
  subscribe(
    callback: (event: TempSensorReading | TempSensorError) => void,
  ): Unsubscribe;
};
```
