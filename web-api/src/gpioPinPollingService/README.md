# GPIO Pin Polling Service

## Overview

A service that lives in a child process of the web-api parent process. It is managed by the GPIO Pin Service and is responsible for low-level GPIO polling and event emission.

## Relationship to GPIO Pin Service

- Receives commands from the GPIO Pin Service (parent process) and sends back data, status, and error messages.
- Uses shared message types and command structures for strict typing and validation.

## Responsibilities

- Listen for `start` and `stop` commands from the parent process via IPC.
- Use an event-driven pattern to emit GPIO data as soon as it is available.
- Send structured JSON messages (`data`, `error`, `status`) to the parent process.
- Validate all incoming IPC messages using type guards (see `types.guards.ts`).
- Handle GPIO access errors and report them to the parent process.
- Ensure all GPIO resources are released on both normal and abnormal exits.
- Exit immediately if the parent process disconnects.
- Handle rapid start/stop command sequences safely.

## Architecture & Data Flow

- Follows functional programming principles and event-driven design.
- All communication is via IPC using shared, strongly-typed message contracts.
- No side effects on import: all state is encapsulated in a factory function (`createGpioPollingService`).
- Type guards for runtime validation are defined in `types.guards.ts`.
- Loosely coupled: interacts only with the GPIO Pin Service via public API.

## TypeScript API

```typescript
// Shared message types (see also ../gpioPinService/README.md)
export type GpioPollingCommand =
  | { type: "start"; pin: number }
  | { type: "stop" };

export type GpioPollingMessage =
  | { type: "data"; payload: { pin: number; value: number; timestamp: number } }
  | { type: "error"; reason: string }
  | { type: "status"; status: "started" | "stopped" | "exited"; pin?: number };

export type GpioPollingService = {
  handleParentMessage: (
    message: GpioPollingCommand,
    sendFn: (msg: GpioPollingMessage) => void,
  ) => void;
  cleanup: () => void;
};

export function createGpioPollingService(): GpioPollingService;

// Type guard for runtime validation
export function isGpioPollingCommand(msg: unknown): msg is GpioPollingCommand;
```

---

For further details, see the GPIO Pin Service specification and `types.guards.ts` for type guard implementations.
