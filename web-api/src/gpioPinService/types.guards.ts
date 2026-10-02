import type { GpioPollingMessage } from "./types.js";

export function isGpioPollingMessage(msg: unknown): msg is GpioPollingMessage {
  if (typeof msg !== "object" || msg === null) return false;
  if (!("type" in msg)) return false;

  const type = msg.type;

  if (type === "data" && "payload" in msg) {
    const payload = msg.payload;
    return (
      typeof payload === "object" &&
      payload !== null &&
      "pin" in payload &&
      "value" in payload &&
      "timestamp" in payload &&
      typeof payload.pin === "number" &&
      typeof payload.value === "number" &&
      typeof payload.timestamp === "number"
    );
  }

  if (type === "error" && "reason" in msg) {
    return typeof msg.reason === "string";
  }

  if (type === "status" && "status" in msg) {
    const status = msg.status;
    const validStatuses = ["started", "stopped", "exited"];
    return (
      typeof status === "string" &&
      validStatuses.includes(status) &&
      (!("pin" in msg) || typeof msg.pin === "number")
    );
  }

  return false;
}
