import { Gpio } from "onoff";
import type { GpioPollingCommand, GpioPollingMessage } from "./types.js";
import { getErrorReason } from "../utils.js";
import { isGpioPollingCommand } from "./types.guards.js";
import { createGpioValue, createTimestamp, unwrapGpioPin, type GpioPin } from "../types/nominal.js";

export type GpioPollingService = {
  handleParentMessage: (
    message: GpioPollingCommand,
    sendFn: (msg: GpioPollingMessage) => void,
  ) => void;
  cleanup: () => void;
};

export function createGpioPollingService(): GpioPollingService {
  let gpio: Gpio | null = null;
  let pin: GpioPin | null = null;
  let isStarted = false;
  let isListening = false;

  function cleanup() {
    if (gpio) {
      try {
        gpio.unwatchAll();
        gpio.unexport();
      } catch (e) {
        // ignore
      }
      gpio = null;
    }
    pin = null;
    isStarted = false;
    isListening = false;
  }

  function send(msg: GpioPollingMessage) {
    if (process && typeof process.send === "function") {
      process.send(msg);
    }
  }

  function startPolling(
    message: Extract<GpioPollingCommand, { type: "start" }>,
    sendFn: (msg: GpioPollingMessage) => void,
  ) {
    if (isStarted && pin === message.pin) {
      sendFn({ type: "status", status: "started", pin });
      return;
    }
    cleanup();
    try {
      gpio = new Gpio(unwrapGpioPin(message.pin), "in", "both");
      pin = message.pin;
      isStarted = true;
      isListening = true;
      gpio.watch((err, value) => {
        if (!isListening) return;
        if (err) {
          sendFn({ type: "error", reason: err.message });
          return;
        }
        sendFn({
          type: "data",
          payload: {
            pin: message.pin,
            value: createGpioValue(value),
            timestamp: createTimestamp(),
          },
        });
      });
      sendFn({ type: "status", status: "started", pin });
    } catch (e: unknown) {
      const reason = getErrorReason(e);
      sendFn({ type: "error", reason });
      cleanup();
    }
  }

  function stopPolling(sendFn: (msg: GpioPollingMessage) => void) {
    if (!isStarted) {
      sendFn({ type: "status", status: "stopped" });
      return;
    }
    isListening = false;
    const currentPin = pin;
    cleanup();
    sendFn({ type: "status", status: "stopped", pin: currentPin ?? undefined });
  }

  function handleMalformedCommand(sendFn: (msg: GpioPollingMessage) => void) {
    sendFn({ type: "error", reason: "Malformed command" });
  }

  function handleParentMessage(
    message: GpioPollingCommand,
    sendFn: (msg: GpioPollingMessage) => void,
  ): void {
    switch (message.type) {
      case "start":
        startPolling(message, sendFn);
        break;
      case "stop":
        stopPolling(sendFn);
        break;
      default:
        handleMalformedCommand(sendFn);
    }
  }

  // Listen for parent messages
  if (process && process.on) {
    process.on("message", (msg: unknown) => {
      if (isGpioPollingCommand(msg)) {
        handleParentMessage(msg, send);
      } else {
        send({ type: "error", reason: "Malformed IPC message" });
      }
    });
    process.on("disconnect", () => {
      cleanup();
      process.exit(0);
    });
  }

  return {
    handleParentMessage,
    cleanup,
  };
}
