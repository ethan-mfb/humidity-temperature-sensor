# Temp Sensor HTTP REST Endpoint Specification

## Overview

These endpoints provide HTTP and Server-Sent Events (SSE) interfaces for accessing temperature and humidity data from the AM2302 (DHT22) sensor via the Temp Sensor Service. They enable clients to start/stop polling, check service status, and receive real-time sensor updates. All endpoints are implemented using strong TypeScript typing, functional patterns, and event-driven architecture, and are decoupled from hardware details.

## Relationship to Temp Sensor Service

- Uses the Temp Sensor Service API for all sensor data and lifecycle management.
- Surfaces errors and status changes to clients via HTTP responses and SSE events.

## Responsibilities

- Expose REST API endpoints to:
  - Check the status of the GPIO pin polling service
  - Start the polling service
  - Stop the polling service
- Expose SSE endpoints to:
  - Stream current temperature and humidity readings to clients
  - Allow configuration of the data push interval
- Ensure all operations are safe (no race conditions, double-start/stop, etc.) and secure (input validation, error handling)
- Place all endpoint logic in a dedicated controller module

## Architecture & Data Flow

- REST endpoints trigger actions in the Temp Sensor Service, which manages polling and data decoding.
- SSE endpoints subscribe to the Temp Sensor Service and push new readings or error events to connected clients.
- All errors (including checksum errors) are surfaced as error events or HTTP error responses, but do not halt the service.
- Input validation and idempotency are enforced for all start/stop/status operations.

## Endpoint Specification

### REST Endpoints

#### GET /api/temp-sensor/status

- **Description:** Returns the current status of the polling service (e.g., running, stopped, last error).
- **Response:**

  ```json
  {
    "status": "running" | "stopped",
    "lastError"?: { "type": string, "message": string }
  }
  ```

- **Errors:** 500 on internal error

#### POST /api/temp-sensor/start

- **Description:** Starts the polling service if not already running.
- **Response:** 204 No Content on success
- **Errors:** 409 if already running, 500 on internal error

#### POST /api/temp-sensor/stop

- **Description:** Stops the polling service if running.
- **Response:** 204 No Content on success
- **Errors:** 409 if already stopped, 500 on internal error

### SSE Endpoint

#### GET /api/temp-sensor/stream?interval=ms

- **Description:** Opens an SSE connection streaming temperature and humidity readings at the specified interval (default: 1000ms)
- **Events:**
  - `reading`: `{ temperatureC: number, temperatureF: number, relativeHumidityPercentage: number, timestamp: number }`
  - `error`: `{ type: string, message: string }` (e.g., checksum, signal, range)
- **Errors:** Connection closes on unrecoverable error

## TypeScript API

```typescript
export type TempSensorStatus = {
  status: "running" | "stopped";
  lastError?: { type: string; message: string };
};

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
```

## Error Handling & Validation

- All input is validated; invalid requests return 400.
- Service state errors (e.g., double start/stop) return 409.
- Internal errors return 500.
- SSE error events are sent for recoverable errors; connection closes on fatal errors.

## Security & Safety

- All endpoints validate input and enforce idempotency.
- No direct hardware access is exposed to clients.
- All operations are logged and auditable.
