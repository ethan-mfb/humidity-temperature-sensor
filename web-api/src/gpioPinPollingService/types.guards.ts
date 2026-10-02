import type { GpioPollingCommand } from "./types.js";

export function isGpioPollingCommand(msg: unknown): msg is GpioPollingCommand {
  if (typeof msg !== "object" || msg === null) return false;
  if (!("type" in msg)) return false;
  const type = msg.type;
  if (type === "start" && "pin" in msg) {
    return typeof msg.pin === "number";
  }
  if (type === "stop") {
    return true;
  }
  return false;
}
