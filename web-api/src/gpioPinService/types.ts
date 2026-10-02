/**
 * The IPC contract is declared once, by the child that sends it. This file used
 * to restate it with plain `number`s, and the two copies drifted: the child sent
 * `timestamp` as an ISO string while this side expected a number, so the guard
 * rejected every reading. Re-exporting keeps a drift like that a build error.
 */
export type {
  GpioPollingCommand,
  GpioPollingMessage,
} from "../gpioPinPollingService/types.js";

export type GpioPinService = {
  startPolling(pin: number): Promise<void>;
  stopPolling(): Promise<void>;
  onData(
    callback: (data: { pin: number; value: number; timestamp: number }) => void,
  ): void;
  onError(callback: (reason: string) => void): void;
  onStatus(callback: (status: { status: string; pin?: number }) => void): void;
};
