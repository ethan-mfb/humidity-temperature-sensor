import { EventEmitter } from "events";
import path from "path";
import {
  startChildProcess,
  stopChildProcess,
  onChildProcessEvent,
  type ChildProcessHandle,
} from "../childProcessService/index.js";
import type {
  GpioPinService,
  GpioPollingCommand,
  GpioPollingMessage,
} from "./types.js";
import { isGpioPollingMessage } from "./types.guards.js";
import { getErrorReason } from "../utils.js";
import {
  TIMEOUTS,
  COMMAND_TYPES,
  STATUS_TYPES,
  EVENT_TYPES,
  MESSAGE_TYPES,
} from "./constants.js";

export function createGpioPinService(): GpioPinService {
  const emitter = new EventEmitter();
  let childProcess: ChildProcessHandle | null = null;
  let currentPin: number | null = null;
  let isPolling = false;

  function cleanup() {
    if (childProcess) {
      stopChildProcess(childProcess);
      childProcess = null;
    }
    currentPin = null;
    isPolling = false;
  }

  function ensureChildProcess(): ChildProcessHandle {
    if (!childProcess) {
      // Use a simple relative path resolution that works in both production and test environments
      const gpioPinPollingServicePath = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        "../gpioPinPollingService/index.js",
      );

      childProcess = startChildProcess({
        command: gpioPinPollingServicePath,
      });

      onChildProcessEvent(childProcess, EVENT_TYPES.MESSAGE, (event) => {
        if (event.type === EVENT_TYPES.MESSAGE && isGpioPollingMessage(event.data)) {
          handleChildMessage(event.data);
        }
      });

      onChildProcessEvent(childProcess, EVENT_TYPES.ERROR, (event) => {
        if (event.type === EVENT_TYPES.ERROR) {
          emitter.emit(EVENT_TYPES.ERROR, event.error.message);
          cleanup();
        }
      });

      onChildProcessEvent(childProcess, EVENT_TYPES.STOPPED, (event) => {
        if (event.type === EVENT_TYPES.STOPPED) {
          emitter.emit(EVENT_TYPES.STATUS, {
            status: STATUS_TYPES.EXITED,
            pin: currentPin ?? undefined,
          });
          cleanup();
        }
      });
    }
    return childProcess;
  }

  function handleChildMessage(message: GpioPollingMessage) {
    switch (message.type) {
      case MESSAGE_TYPES.DATA:
        emitter.emit(EVENT_TYPES.DATA, message.payload);
        break;
      case MESSAGE_TYPES.ERROR:
        emitter.emit(EVENT_TYPES.ERROR, message.reason);
        break;
      case MESSAGE_TYPES.STATUS:
        if (message.status === STATUS_TYPES.STARTED) {
          isPolling = true;
          currentPin = message.pin ?? null;
        } else if (message.status === STATUS_TYPES.STOPPED) {
          isPolling = false;
          currentPin = null;
        }
        emitter.emit(EVENT_TYPES.STATUS, {
          status: message.status,
          pin: message.pin,
        });
        break;
    }
  }

  function sendCommand(command: GpioPollingCommand): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const child = ensureChildProcess();

        const timeoutId = setTimeout(() => {
          reject(new Error(`Command timeout: ${command.type}`));
        }, TIMEOUTS.COMMAND_TIMEOUT_MS);

        const statusHandler = (status: { status: string; pin?: number }) => {
          if (
            (command.type === COMMAND_TYPES.START && status.status === STATUS_TYPES.STARTED) ||
            (command.type === COMMAND_TYPES.STOP && status.status === STATUS_TYPES.STOPPED)
          ) {
            clearTimeout(timeoutId);
            emitter.off(EVENT_TYPES.STATUS, statusHandler);
            emitter.off(EVENT_TYPES.ERROR, errorHandler);
            resolve();
          }
        };

        const errorHandler = (reason: string) => {
          clearTimeout(timeoutId);
          emitter.off(EVENT_TYPES.STATUS, statusHandler);
          emitter.off(EVENT_TYPES.ERROR, errorHandler);
          reject(new Error(reason));
        };

        emitter.on(EVENT_TYPES.STATUS, statusHandler);
        emitter.on(EVENT_TYPES.ERROR, errorHandler);

        child.send(command);
      } catch (error) {
        reject(new Error(getErrorReason(error)));
      }
    });
  }

  async function startPolling(pin: number): Promise<void> {
    if (isPolling && currentPin === pin) {
      return;
    }

    if (isPolling && currentPin !== pin) {
      await stopPolling();
    }

    await sendCommand({ type: COMMAND_TYPES.START, pin });
  }

  async function stopPolling(): Promise<void> {
    if (!isPolling) {
      return;
    }

    await sendCommand({ type: COMMAND_TYPES.STOP });
  }

  function onData(
    callback: (data: { pin: number; value: number; timestamp: number }) => void,
  ): void {
    emitter.on(EVENT_TYPES.DATA, callback);
  }

  function onError(callback: (reason: string) => void): void {
    emitter.on(EVENT_TYPES.ERROR, callback);
  }

  function onStatus(
    callback: (status: { status: string; pin?: number }) => void,
  ): void {
    emitter.on(EVENT_TYPES.STATUS, callback);
  }

  // Cleanup on process exit (only in production, not during testing)
  if (process.env.NODE_ENV !== "test") {
    process.on("exit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }

  return {
    startPolling,
    stopPolling,
    onData,
    onError,
    onStatus,
  };
}
