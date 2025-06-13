# GPIO Pin Polling Service

A service that lives in a child process of the web-api parent process. It is managed by the GPIO Pin Service (see ../gpioPinService/README.md).

## Relationship to GPIO Pin Service

- Receives commands from the GPIO Pin Service (parent process) and sends back data, status, and error messages.
- Uses shared message types and command structures for strict typing and validation.

## Responsibilities

- Listen for `start` and `stop` commands from the parent process via IPC.
- Use an event-driven pattern to emit GPIO data as soon as it is available.
- Send structured JSON messages (`data`, `error`, `status`) to the parent process.
- Validate all incoming IPC messages.
- Handle GPIO access errors and report them to the parent process.
- Ensure all GPIO resources are released on both normal and abnormal exits.
- Exit immediately if the parent process disconnects.
- Handle rapid start/stop command sequences safely.

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

// Child process main handler
export function handleParentMessage(
  message: GpioPollingCommand,
  send: (msg: GpioPollingMessage) => void,
): void;
```
