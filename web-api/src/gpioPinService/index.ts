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
import { getDirname } from "../dirname.js";

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
      const __dirname = getDirname(import.meta.url);
      const gpioPinPollingServicePath = path.resolve(
        __dirname,
        "../gpioPinPollingService/index.js",
      );

      childProcess = startChildProcess({
        command: gpioPinPollingServicePath,
      });

      onChildProcessEvent(childProcess, "message", (event) => {
        if (event.type === "message" && isGpioPollingMessage(event.data)) {
          handleChildMessage(event.data);
        }
      });

      onChildProcessEvent(childProcess, "error", (event) => {
        if (event.type === "error") {
          emitter.emit("error", event.error.message);
          cleanup();
        }
      });

      onChildProcessEvent(childProcess, "stopped", (event) => {
        if (event.type === "stopped") {
          emitter.emit("status", {
            status: "exited",
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
      case "data":
        emitter.emit("data", message.payload);
        break;
      case "error":
        emitter.emit("error", message.reason);
        break;
      case "status":
        if (message.status === "started") {
          isPolling = true;
          currentPin = message.pin ?? null;
        } else if (message.status === "stopped") {
          isPolling = false;
          currentPin = null;
        }
        emitter.emit("status", {
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
        }, 5000);

        const statusHandler = (status: { status: string; pin?: number }) => {
          if (
            (command.type === "start" && status.status === "started") ||
            (command.type === "stop" && status.status === "stopped")
          ) {
            clearTimeout(timeoutId);
            emitter.off("status", statusHandler);
            emitter.off("error", errorHandler);
            resolve();
          }
        };

        const errorHandler = (reason: string) => {
          clearTimeout(timeoutId);
          emitter.off("status", statusHandler);
          emitter.off("error", errorHandler);
          reject(new Error(reason));
        };

        emitter.on("status", statusHandler);
        emitter.on("error", errorHandler);

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

    await sendCommand({ type: "start", pin });
  }

  async function stopPolling(): Promise<void> {
    if (!isPolling) {
      return;
    }

    await sendCommand({ type: "stop" });
  }

  function onData(
    callback: (data: { pin: number; value: number; timestamp: number }) => void,
  ): void {
    emitter.on("data", callback);
  }

  function onError(callback: (reason: string) => void): void {
    emitter.on("error", callback);
  }

  function onStatus(
    callback: (status: { status: string; pin?: number }) => void,
  ): void {
    emitter.on("status", callback);
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
