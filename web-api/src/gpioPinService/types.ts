import { 
  COMMAND_TYPES, 
  MESSAGE_TYPES, 
  STATUS_TYPES,
  type CommandType,
  type MessageType,
  type StatusType,
} from "./constants.js";

// Shared message types for GPIO pin service
export type GpioPollingCommand =
  | { type: typeof COMMAND_TYPES.START; pin: number }
  | { type: typeof COMMAND_TYPES.STOP };

export type GpioPollingMessage =
  | { type: typeof MESSAGE_TYPES.DATA; payload: { pin: number; value: number; timestamp: number } }
  | { type: typeof MESSAGE_TYPES.ERROR; reason: string }
  | { type: typeof MESSAGE_TYPES.STATUS; status: StatusType; pin?: number };

export type GpioPinService = {
  startPolling(pin: number): Promise<void>;
  stopPolling(): Promise<void>;
  onData(
    callback: (data: { pin: number; value: number; timestamp: number }) => void,
  ): void;
  onError(callback: (reason: string) => void): void;
  onStatus(callback: (status: { status: string; pin?: number }) => void): void;
};
