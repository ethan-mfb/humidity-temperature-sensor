// Shared message types for GPIO polling service
import type { GpioPin, GpioValue, Timestamp } from "../types/nominal-types.js";

export type GpioPollingCommand =
  | { type: "start"; pin: GpioPin }
  | { type: "stop" };

export type GpioPollingMessage =
  | { type: "data"; payload: { pin: GpioPin; value: GpioValue; timestamp: Timestamp } }
  | { type: "error"; reason: string }
  | { type: "status"; status: "started" | "stopped" | "exited"; pin?: GpioPin };
