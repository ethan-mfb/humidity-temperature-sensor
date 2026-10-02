# GPIO Pin Service

## Overview

A service that lives in the web-api parent process and manages the GPIO Pin Polling Service. It provides a high-level API for controlling GPIO polling and handling events.

## Relationship to GPIO Pin Polling Service

- Manages the lifecycle of the GPIO Pin Polling Service (child process).
- Communicates using shared command and message types for strict typing and validation.

## Responsibilities

- Manage the lifecycle of the GPIO polling child process using the child process service.
- Send structured JSON commands (`start`, `stop`) to the child process.
- Listen for and handle structured JSON messages (`data`, `error`, `status`) from the child.
- Validate all incoming/outgoing IPC messages.
- Handle rapid start/stop command sequences safely.
- Prevent or handle accidental spawning of multiple polling children for the same pin.
- Handle and report unexpected child process exits, including parent crash scenarios.
- Expose API/logging for reporting child process status and errors.

## Architecture & Data Flow

- Follows functional programming and event-driven design.
- All communication with the polling service is via shared, strongly-typed message contracts.
- Loosely coupled: interacts only with the polling service via public API.

## TypeScript API

```typescript
export type GpioPollingCommand =
  | { type: "start"; pin: number }
  | { type: "stop" };

export type GpioPollingMessage =
  | { type: "data"; payload: { pin: number; value: number; timestamp: number } }
  | { type: "error"; reason: string }
  | { type: "status"; status: "started" | "stopped" | "exited"; pin?: number };

export type GpioPinService = {
  startPolling(pin: number): Promise<void>;
  stopPolling(): Promise<void>;
  onData(
    callback: (data: { pin: number; value: number; timestamp: number }) => void,
  ): void;
  onError(callback: (reason: string) => void): void;
  onStatus(callback: (status: { status: string; pin?: number }) => void): void;
};
```

---

For further details, see the GPIO Pin Polling Service specification.
