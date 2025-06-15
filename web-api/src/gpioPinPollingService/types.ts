// Shared message types for GPIO polling service
export type GpioPollingCommand =
  | { type: "start"; pin: number }
  | { type: "stop" };

export type GpioPollingMessage =
  | { type: "data"; payload: { pin: number; value: number; timestamp: number } }
  | { type: "error"; reason: string }
  | { type: "status"; status: "started" | "stopped" | "exited"; pin?: number };
