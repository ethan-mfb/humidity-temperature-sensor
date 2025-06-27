// Shared message types for GPIO pin service
export type GpioPollingCommand =
  | { type: "start"; pin: number }
  | { type: "stop" };

export type GpioPollingMessage =
  | { type: "data"; payload: { pin: number; value: number; timestamp: number } }
  | { type: "error"; reason: string }
  | { type: "status"; status: "started" | "stopped" | "exited"; pin?: number };

export type GpioPinService = {
  startPolling(pin: number): Promise<void>;
  stopPolling(): Promise<void>;
  onData(
    callback: (data: { pin: number; value: number; timestamp: number }) => void,
  ): void;
  onError(callback: (reason: string) => void): void;
  onStatus(callback: (status: { status: string; pin?: number }) => void): void;
};
