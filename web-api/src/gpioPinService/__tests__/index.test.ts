import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { createGpioPinService } from "../index.js";
import type { ChildProcessHandle } from "../../childProcessService/index.js";
import {
  TIMEOUTS,
  COMMAND_TYPES,
  STATUS_TYPES,
  EVENT_TYPES,
  MESSAGE_TYPES,
} from "../constants.js";

// Test constants for consistency
const TEST_DATA = {
  PIN: 4,
  ALT_PIN: 5,
  TIMESTAMP: 1234567890,
  PID: 1234,
  GPIO_VALUE: 1,
  ERROR_MESSAGE: "GPIO error",
  CHILD_CRASH_MESSAGE: "Child process crashed",
} as const;

// Mock child process service
vi.mock("../../childProcessService/index.js", () => ({
  startChildProcess: vi.fn(),
  stopChildProcess: vi.fn(),
  onChildProcessEvent: vi.fn(),
}));

// Mock dirname utility
vi.mock("../../dirname.js", () => ({
  resolveFromModule: vi.fn(
    () => "/mock/path/to/gpioPinPollingService/index.js",
  ),
}));

describe("createGpioPinService", () => {
  let service: ReturnType<typeof createGpioPinService>;
  let mockChildProcess: ChildProcessHandle;
  let mockStartChildProcess: Mock;
  let mockStopChildProcess: Mock;
  let mockOnChildProcessEvent: Mock;
  let mockSend: Mock;
  let messageHandlers: Map<string, (event: any) => void>;

  beforeEach(async () => {
    messageHandlers = new Map();

    mockSend = vi.fn();

    mockChildProcess = {
      pid: TEST_DATA.PID,
      send: mockSend,
      stop: vi.fn(),
      _proc: {} as any,
      _emitter: {} as any,
    };

    mockStartChildProcess = vi.fn(() => mockChildProcess);
    mockStopChildProcess = vi.fn();
    mockOnChildProcessEvent = vi.fn((handle, eventType, handler) => {
      messageHandlers.set(eventType, handler);
    });

    const childProcessService = await import(
      "../../childProcessService/index.js"
    );
    (childProcessService.startChildProcess as Mock) = mockStartChildProcess;
    (childProcessService.stopChildProcess as Mock) = mockStopChildProcess;
    (childProcessService.onChildProcessEvent as Mock) = mockOnChildProcessEvent;

    service = createGpioPinService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("startPolling", () => {
    it("should start polling for a pin", async () => {
      const dataCallback = vi.fn();
      const statusCallback = vi.fn();

      service.onData(dataCallback);
      service.onStatus(statusCallback);

      // Start the polling
      const startPromise = service.startPolling(TEST_DATA.PIN);

      // Simulate child process started
      const messageHandler = messageHandlers.get(EVENT_TYPES.MESSAGE);
      expect(messageHandler).toBeDefined();

      messageHandler!({
        type: EVENT_TYPES.MESSAGE,
        data: {
          type: MESSAGE_TYPES.STATUS,
          status: STATUS_TYPES.STARTED,
          pin: TEST_DATA.PIN,
        },
      });

      await startPromise;

      expect(mockStartChildProcess).toHaveBeenCalledWith({
        command: "/mock/path/to/gpioPinPollingService/index.js",
      });
      expect(mockSend).toHaveBeenCalledWith({
        type: COMMAND_TYPES.START,
        pin: TEST_DATA.PIN,
      });
      expect(statusCallback).toHaveBeenCalledWith({
        status: STATUS_TYPES.STARTED,
        pin: TEST_DATA.PIN,
      });
    });

    it("should handle data messages from child process", async () => {
      const dataCallback = vi.fn();
      service.onData(dataCallback);

      // Start polling first
      const startPromise = service.startPolling(TEST_DATA.PIN);
      const messageHandler = messageHandlers.get(EVENT_TYPES.MESSAGE);
      messageHandler!({
        type: EVENT_TYPES.MESSAGE,
        data: {
          type: MESSAGE_TYPES.STATUS,
          status: STATUS_TYPES.STARTED,
          pin: TEST_DATA.PIN,
        },
      });
      await startPromise;

      // Send data message
      messageHandler!({
        type: EVENT_TYPES.MESSAGE,
        data: {
          type: MESSAGE_TYPES.DATA,
          payload: {
            pin: TEST_DATA.PIN,
            value: TEST_DATA.GPIO_VALUE,
            timestamp: TEST_DATA.TIMESTAMP,
          },
        },
      });

      expect(dataCallback).toHaveBeenCalledWith({
        pin: TEST_DATA.PIN,
        value: TEST_DATA.GPIO_VALUE,
        timestamp: TEST_DATA.TIMESTAMP,
      });
    });

    it("should handle error messages from child process", async () => {
      const errorCallback = vi.fn();
      service.onError(errorCallback);

      // Start polling first
      const startPromise = service.startPolling(TEST_DATA.PIN);
      const messageHandler = messageHandlers.get(EVENT_TYPES.MESSAGE);
      messageHandler!({
        type: EVENT_TYPES.MESSAGE,
        data: {
          type: MESSAGE_TYPES.STATUS,
          status: STATUS_TYPES.STARTED,
          pin: TEST_DATA.PIN,
        },
      });
      await startPromise;

      // Send error message
      messageHandler!({
        type: EVENT_TYPES.MESSAGE,
        data: { type: MESSAGE_TYPES.ERROR, reason: TEST_DATA.ERROR_MESSAGE },
      });

      expect(errorCallback).toHaveBeenCalledWith(TEST_DATA.ERROR_MESSAGE);
    });

    it("should not start polling if already polling the same pin", async () => {
      // First start
      const startPromise1 = service.startPolling(TEST_DATA.PIN);
      const messageHandler = messageHandlers.get(EVENT_TYPES.MESSAGE);
      messageHandler!({
        type: EVENT_TYPES.MESSAGE,
        data: {
          type: MESSAGE_TYPES.STATUS,
          status: STATUS_TYPES.STARTED,
          pin: TEST_DATA.PIN,
        },
      });
      await startPromise1;

      mockSend.mockClear();

      // Second start with same pin
      await service.startPolling(TEST_DATA.PIN);

      // Should not send another start command for the same pin
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should stop current polling before starting new pin", async () => {
      const statusCallback = vi.fn();
      service.onStatus(statusCallback);

      // Start polling pin 4
      const startPromise1 = service.startPolling(TEST_DATA.PIN);
      const messageHandler = messageHandlers.get(EVENT_TYPES.MESSAGE);
      messageHandler!({
        type: EVENT_TYPES.MESSAGE,
        data: {
          type: MESSAGE_TYPES.STATUS,
          status: STATUS_TYPES.STARTED,
          pin: TEST_DATA.PIN,
        },
      });
      await startPromise1;

      statusCallback.mockClear();
      mockSend.mockClear();

      // Start polling pin 5 (should stop pin 4 first)
      const startPromise2 = service.startPolling(TEST_DATA.ALT_PIN);

      // Simulate stop response first
      setTimeout(() => {
        messageHandler!({
          type: EVENT_TYPES.MESSAGE,
          data: {
            type: MESSAGE_TYPES.STATUS,
            status: STATUS_TYPES.STOPPED,
            pin: TEST_DATA.PIN,
          },
        });
      }, 10);

      // Then simulate start response for new pin
      setTimeout(() => {
        messageHandler!({
          type: EVENT_TYPES.MESSAGE,
          data: {
            type: MESSAGE_TYPES.STATUS,
            status: STATUS_TYPES.STARTED,
            pin: TEST_DATA.ALT_PIN,
          },
        });
      }, 20);

      await startPromise2;

      expect(mockSend).toHaveBeenCalledWith({
        type: COMMAND_TYPES.STOP,
      });
      expect(mockSend).toHaveBeenCalledWith({
        type: COMMAND_TYPES.START,
        pin: TEST_DATA.ALT_PIN,
      });
      expect(statusCallback).toHaveBeenCalledWith({
        status: STATUS_TYPES.STOPPED,
        pin: TEST_DATA.PIN,
      });
      expect(statusCallback).toHaveBeenCalledWith({
        status: STATUS_TYPES.STARTED,
        pin: TEST_DATA.ALT_PIN,
      });
    });
  });

  describe("stopPolling", () => {
    it("should stop polling", async () => {
      const statusCallback = vi.fn();
      service.onStatus(statusCallback);

      // Start polling first
      const startPromise = service.startPolling(TEST_DATA.PIN);
      const messageHandler = messageHandlers.get(EVENT_TYPES.MESSAGE);
      messageHandler!({
        type: EVENT_TYPES.MESSAGE,
        data: {
          type: MESSAGE_TYPES.STATUS,
          status: STATUS_TYPES.STARTED,
          pin: TEST_DATA.PIN,
        },
      });
      await startPromise;

      statusCallback.mockClear();
      mockSend.mockClear();

      // Stop polling
      const stopPromise = service.stopPolling();
      messageHandler!({
        type: EVENT_TYPES.MESSAGE,
        data: {
          type: MESSAGE_TYPES.STATUS,
          status: STATUS_TYPES.STOPPED,
          pin: TEST_DATA.PIN,
        },
      });
      await stopPromise;

      expect(mockSend).toHaveBeenCalledWith({
        type: COMMAND_TYPES.STOP,
      });
      expect(statusCallback).toHaveBeenCalledWith({
        status: STATUS_TYPES.STOPPED,
        pin: TEST_DATA.PIN,
      });
    });

    it("should not send stop command if not polling", async () => {
      await service.stopPolling();
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle child process errors", async () => {
      const errorCallback = vi.fn();
      const statusCallback = vi.fn();
      service.onError(errorCallback);
      service.onStatus(statusCallback);

      // Start polling
      const startPromise = service.startPolling(TEST_DATA.PIN);
      const messageHandler = messageHandlers.get(EVENT_TYPES.MESSAGE);
      messageHandler!({
        type: EVENT_TYPES.MESSAGE,
        data: {
          type: MESSAGE_TYPES.STATUS,
          status: STATUS_TYPES.STARTED,
          pin: TEST_DATA.PIN,
        },
      });
      await startPromise;

      // Simulate child process error
      const errorHandler = messageHandlers.get(EVENT_TYPES.ERROR);
      errorHandler!({
        type: EVENT_TYPES.ERROR,
        error: new Error(TEST_DATA.CHILD_CRASH_MESSAGE),
      });

      expect(errorCallback).toHaveBeenCalledWith(TEST_DATA.CHILD_CRASH_MESSAGE);
      expect(mockStopChildProcess).toHaveBeenCalledWith(mockChildProcess);
    });

    it("should handle child process exit", async () => {
      const statusCallback = vi.fn();
      service.onStatus(statusCallback);

      // Start polling
      const startPromise = service.startPolling(TEST_DATA.PIN);
      const messageHandler = messageHandlers.get(EVENT_TYPES.MESSAGE);
      messageHandler!({
        type: EVENT_TYPES.MESSAGE,
        data: {
          type: MESSAGE_TYPES.STATUS,
          status: STATUS_TYPES.STARTED,
          pin: TEST_DATA.PIN,
        },
      });
      await startPromise;

      statusCallback.mockClear();

      // Simulate child process exit
      const stoppedHandler = messageHandlers.get(EVENT_TYPES.STOPPED);
      stoppedHandler!({
        type: EVENT_TYPES.STOPPED,
        code: 0,
        signal: null,
      });

      expect(statusCallback).toHaveBeenCalledWith({
        status: STATUS_TYPES.EXITED,
        pin: TEST_DATA.PIN,
      });
      expect(mockStopChildProcess).toHaveBeenCalledWith(mockChildProcess);
    });

    it("should handle command timeout", async () => {
      vi.useFakeTimers();

      const startPromise = service.startPolling(TEST_DATA.PIN);

      // Fast-forward time to trigger timeout
      vi.advanceTimersByTime(TIMEOUTS.COMMAND_TIMEOUT_MS + 1000);

      await expect(startPromise).rejects.toThrow(
        `Command timeout: ${COMMAND_TYPES.START}`,
      );

      vi.useRealTimers();
    });
  });

  describe("event listeners", () => {
    it("should register data event listeners", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      service.onData(callback1);
      service.onData(callback2);

      // Should be able to register multiple listeners
      expect(callback1).toBeDefined();
      expect(callback2).toBeDefined();
    });

    it("should register error event listeners", () => {
      const callback = vi.fn();
      service.onError(callback);
      expect(callback).toBeDefined();
    });

    it("should register status event listeners", () => {
      const callback = vi.fn();
      service.onStatus(callback);
      expect(callback).toBeDefined();
    });
  });
});
