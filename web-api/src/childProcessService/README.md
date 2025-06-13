# Child Process Service

The Child Process Service is responsible for managing the lifecycle and communication of child processes within the web API. It abstracts process management, providing a declarative, event-driven interface for starting, stopping, and interacting with child processes. This service is designed to fit into the overall event sourcing and Redux-style data flow of the application.

## Responsibilities

- Start, stop, and monitor child processes as requested by consumers.
- Attach and manage message event listeners for IPC (inter-process communication).
- Emit and handle events related to process lifecycle (started, stopped, error, message, etc.).
- Abstract away direct process management from consumers, exposing a functional API.
- Integrate with the application's event sourcing and Redux-style state management patterns.

## Architecture & Data Flow

- Follows functional programming principles; no classes are used.
- All process events (start, stop, message, error) are dispatched as actions to the Redux/event sourcing system.
- Consumers interact with the service via pure functions, passing explicit arguments and receiving typed results.
- Communication with child processes uses Node.js IPC (message events), with strong typing for all payloads.

## Error Handling & Lifecycle Management

- All errors are captured and dispatched as error events.
- The service ensures child processes are properly cleaned up on stop or error.
- Provides hooks for consumers to listen for process exit, error, and custom message events.

## TypeScript API

```typescript
// Types
export type ChildProcessOptions = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type ChildProcessEvent =
  | { type: "started"; pid: number }
  | { type: "stopped"; code: number | null; signal: string | null }
  | { type: "error"; error: Error }
  | { type: "message"; data: unknown };

export type ChildProcessHandle = {
  pid: number;
  send: (message: unknown) => void;
  stop: () => void;
};

// API
export function startChildProcess(
  options: ChildProcessOptions,
): ChildProcessHandle;
export function stopChildProcess(handle: ChildProcessHandle): void;
export function onChildProcessEvent(
  handle: ChildProcessHandle,
  event: ChildProcessEvent["type"],
  listener: (event: ChildProcessEvent) => void,
): void;
```
