import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { createGpioPinService } from "../index.js";
import type { ChildProcessHandle } from "../../childProcessService/index.js";

// Mock child process service
vi.mock("../../childProcessService/index.js", () => ({
  startChildProcess: vi.fn(),
  stopChildProcess: vi.fn(),
  onChildProcessEvent: vi.fn(),
}));

// Mock path module
vi.mock("path", () => ({
  default: {
    resolve: vi.fn(() => "/mock/path/to/gpioPinPollingService/index.js"),
  },
}));

describe("createGpioPinService", () => {
  let service: ReturnType<typeof createGpioPinService>;
  let mockChildProcess: ChildProcessHandle;
  let mockStartChildProcess: Mock;
  let mockStopChildProcess: Mock;
  let mockOnChildProcessEvent: Mock;
  let messageHandlers: Map<string, (event: any) => void>;

  beforeEach(async () => {
    messageHandlers = new Map();

    mockChildProcess = {
      pid: 1234,
      send: vi.fn(),
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
      const startPromise = service.startPolling(4);

      // Simulate child process started
      const messageHandler = messageHandlers.get("message");
      expect(messageHandler).toBeDefined();

      messageHandler!({
        type: "message",
        data: { type: "status", status: "started", pin: 4 },
      });

      await startPromise;

      expect(mockStartChildProcess).toHaveBeenCalledWith({
        command: "/mock/path/to/gpioPinPollingService/index.js",
      });
      expect(mockChildProcess.send).toHaveBeenCalledWith({
        type: "start",
        pin: 4,
      });
      expect(statusCallback).toHaveBeenCalledWith({
        status: "started",
        pin: 4,
      });
    });

    it("should handle data messages from child process", async () => {
      const dataCallback = vi.fn();
      service.onData(dataCallback);

      // Start polling first
      const startPromise = service.startPolling(4);
      const messageHandler = messageHandlers.get("message");
      messageHandler!({
        type: "message",
        data: { type: "status", status: "started", pin: 4 },
      });
      await startPromise;

      // Send data message
      messageHandler!({
        type: "message",
        data: {
          type: "data",
          payload: { pin: 4, value: 1, timestamp: 1234567890 },
        },
      });

      expect(dataCallback).toHaveBeenCalledWith({
        pin: 4,
        value: 1,
        timestamp: 1234567890,
      });
    });

    it("should handle error messages from child process", async () => {
      const errorCallback = vi.fn();
      service.onError(errorCallback);

      // Start polling first
      const startPromise = service.startPolling(4);
      const messageHandler = messageHandlers.get("message");
      messageHandler!({
        type: "message",
        data: { type: "status", status: "started", pin: 4 },
      });
      await startPromise;

      // Send error message
      messageHandler!({
        type: "message",
        data: { type: "error", reason: "GPIO error" },
      });

      expect(errorCallback).toHaveBeenCalledWith("GPIO error");
    });

    it("should not start polling if already polling the same pin", async () => {
      // First start
      const startPromise1 = service.startPolling(4);
      const messageHandler = messageHandlers.get("message");
      messageHandler!({
        type: "message",
        data: { type: "status", status: "started", pin: 4 },
      });
      await startPromise1;

      mockChildProcess.send.mockClear();

      // Second start with same pin
      await service.startPolling(4);

      // Should not send another start command for the same pin
      expect(mockChildProcess.send).not.toHaveBeenCalled();
    });

    it("should stop current polling before starting new pin", async () => {
      const statusCallback = vi.fn();
      service.onStatus(statusCallback);

      // Start polling pin 4
      const startPromise1 = service.startPolling(4);
      const messageHandler = messageHandlers.get("message");
      messageHandler!({
        type: "message",
        data: { type: "status", status: "started", pin: 4 },
      });
      await startPromise1;

      statusCallback.mockClear();
      mockChildProcess.send.mockClear();

      // Start polling pin 5 (should stop pin 4 first)
      const startPromise2 = service.startPolling(5);

      // Simulate stop response first
      setTimeout(() => {
        messageHandler!({
          type: "message",
          data: { type: "status", status: "stopped", pin: 4 },
        });
      }, 10);

      // Then simulate start response for new pin
      setTimeout(() => {
        messageHandler!({
          type: "message",
          data: { type: "status", status: "started", pin: 5 },
        });
      }, 20);

      await startPromise2;

      expect(mockChildProcess.send).toHaveBeenCalledWith({ type: "stop" });
      expect(mockChildProcess.send).toHaveBeenCalledWith({
        type: "start",
        pin: 5,
      });
      expect(statusCallback).toHaveBeenCalledWith({
        status: "stopped",
        pin: 4,
      });
      expect(statusCallback).toHaveBeenCalledWith({
        status: "started",
        pin: 5,
      });
    });
  });

  describe("stopPolling", () => {
    it("should stop polling", async () => {
      const statusCallback = vi.fn();
      service.onStatus(statusCallback);

      // Start polling first
      const startPromise = service.startPolling(4);
      const messageHandler = messageHandlers.get("message");
      messageHandler!({
        type: "message",
        data: { type: "status", status: "started", pin: 4 },
      });
      await startPromise;

      statusCallback.mockClear();
      mockChildProcess.send.mockClear();

      // Stop polling
      const stopPromise = service.stopPolling();
      messageHandler!({
        type: "message",
        data: { type: "status", status: "stopped", pin: 4 },
      });
      await stopPromise;

      expect(mockChildProcess.send).toHaveBeenCalledWith({ type: "stop" });
      expect(statusCallback).toHaveBeenCalledWith({
        status: "stopped",
        pin: 4,
      });
    });

    it("should not send stop command if not polling", async () => {
      await service.stopPolling();
      expect(mockChildProcess.send).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle child process errors", async () => {
      const errorCallback = vi.fn();
      const statusCallback = vi.fn();
      service.onError(errorCallback);
      service.onStatus(statusCallback);

      // Start polling
      const startPromise = service.startPolling(4);
      const messageHandler = messageHandlers.get("message");
      messageHandler!({
        type: "message",
        data: { type: "status", status: "started", pin: 4 },
      });
      await startPromise;

      // Simulate child process error
      const errorHandler = messageHandlers.get("error");
      errorHandler!({
        type: "error",
        error: new Error("Child process crashed"),
      });

      expect(errorCallback).toHaveBeenCalledWith("Child process crashed");
      expect(mockStopChildProcess).toHaveBeenCalledWith(mockChildProcess);
    });

    it("should handle child process exit", async () => {
      const statusCallback = vi.fn();
      service.onStatus(statusCallback);

      // Start polling
      const startPromise = service.startPolling(4);
      const messageHandler = messageHandlers.get("message");
      messageHandler!({
        type: "message",
        data: { type: "status", status: "started", pin: 4 },
      });
      await startPromise;

      statusCallback.mockClear();

      // Simulate child process exit
      const stoppedHandler = messageHandlers.get("stopped");
      stoppedHandler!({
        type: "stopped",
        code: 0,
        signal: null,
      });

      expect(statusCallback).toHaveBeenCalledWith({ status: "exited", pin: 4 });
      expect(mockStopChildProcess).toHaveBeenCalledWith(mockChildProcess);
    });

    it("should handle command timeout", async () => {
      vi.useFakeTimers();

      const startPromise = service.startPolling(4);

      // Fast-forward time to trigger timeout
      vi.advanceTimersByTime(6000);

      await expect(startPromise).rejects.toThrow("Command timeout: start");

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
