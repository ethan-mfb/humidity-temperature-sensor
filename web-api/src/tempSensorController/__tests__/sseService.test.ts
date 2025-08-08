import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import type { Request, Response } from "express";
import type { TempSensorService } from "../types.js";
import { createTempSensorSSEService } from "../sseService.js";

describe("createTempSensorSSEService", () => {
  let mockTempSensorService: TempSensorService;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: Mock;
  let statusMock: Mock;
  let setHeaderMock: Mock;
  let writeMock: Mock;

  beforeEach(() => {
    vi.useFakeTimers();

    // Create mock temperature sensor service
    mockTempSensorService = {
      status: "stopped",
      lastError: undefined,
      getLatestReading: vi.fn(),
      subscribe: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    // Create mock Express objects
    jsonMock = vi.fn();
    statusMock = vi.fn(() => ({ json: jsonMock }));
    setHeaderMock = vi.fn();
    writeMock = vi.fn();

    mockRequest = {
      query: {},
      on: vi.fn(),
    };

    mockResponse = {
      json: jsonMock,
      status: statusMock,
      setHeader: setHeaderMock,
      write: writeMock,
      on: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should create SSE service with correct structure", () => {
    const service = createTempSensorSSEService(mockTempSensorService);

    expect(service).toHaveProperty("handlers");
    expect(service).toHaveProperty("paths");
    expect(service.handlers).toHaveProperty("stream");
    expect(service.paths).toEqual({
      stream: "/api/temp-sensor/stream",
    });
  });

  describe("stream handler", () => {
    it("should set up SSE headers correctly", () => {
      const service = createTempSensorSSEService(mockTempSensorService);

      service.handlers.stream(mockRequest as Request, mockResponse as Response);

      expect(setHeaderMock).toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
      expect(setHeaderMock).toHaveBeenCalledWith("Cache-Control", "no-cache");
      expect(setHeaderMock).toHaveBeenCalledWith("Connection", "keep-alive");
      expect(setHeaderMock).toHaveBeenCalledWith(
        "Access-Control-Allow-Origin",
        "*",
      );
    });

    it("should send initial connection event", () => {
      const service = createTempSensorSSEService(mockTempSensorService);

      service.handlers.stream(mockRequest as Request, mockResponse as Response);

      expect(writeMock).toHaveBeenCalledWith('data: {"type":"connected"}\n\n');
    });

    it("should validate interval parameter", () => {
      mockRequest.query = { interval: "invalid" };
      const service = createTempSensorSSEService(mockTempSensorService);

      service.handlers.stream(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Invalid interval parameter (100-60000ms)",
      });
    });

    it("should reject interval outside valid range", () => {
      mockRequest.query = { interval: "50" }; // Below minimum
      const service = createTempSensorSSEService(mockTempSensorService);

      service.handlers.stream(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it("should use default interval when not specified", () => {
      const setIntervalSpy = vi.spyOn(global, "setInterval");
      const service = createTempSensorSSEService(mockTempSensorService);

      service.handlers.stream(mockRequest as Request, mockResponse as Response);

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        1000, // Default interval
      );
    });

    it("should use custom interval when specified", () => {
      const setIntervalSpy = vi.spyOn(global, "setInterval");
      mockRequest.query = { interval: "2000" };
      const service = createTempSensorSSEService(mockTempSensorService);

      service.handlers.stream(mockRequest as Request, mockResponse as Response);

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
    });

    it("should send error event when service is stopped", async () => {
      mockTempSensorService.status = "stopped";
      (mockTempSensorService.getLatestReading as Mock).mockResolvedValue({
        type: "signal",
        message: "Sensor service is stopped",
      });
      const service = createTempSensorSSEService(mockTempSensorService);

      service.handlers.stream(mockRequest as Request, mockResponse as Response);

      // Clear initial connection write
      writeMock.mockClear();

      // Advance timer to trigger interval
      vi.advanceTimersByTime(1000);
      await vi.waitFor(() => {
        expect(writeMock).toHaveBeenCalledWith("event: error\n");
        expect(writeMock).toHaveBeenCalledWith(
          'data: {"type":"signal","message":"Sensor service is stopped"}\n\n',
        );
      });
    });

    it("should clean up on client disconnect", () => {
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");
      const onMock = mockRequest.on as Mock;
      const service = createTempSensorSSEService(mockTempSensorService);

      service.handlers.stream(mockRequest as Request, mockResponse as Response);

      // Simulate client disconnect
      const closeCallback = onMock.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      if (closeCallback) {
        closeCallback();
      }

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });
});
