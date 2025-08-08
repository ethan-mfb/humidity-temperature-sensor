import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import type { Request, Response } from "express";
import type { TempSensorStatus, TempSensorService } from "../types.js";
import { createTempSensorRestService } from "../restService.js";

describe("createTempSensorRestService", () => {
  let mockTempSensorService: TempSensorService;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: Mock;
  let statusMock: Mock;
  let sendMock: Mock;

  beforeEach(() => {
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
    statusMock = vi.fn(() => ({ json: jsonMock, send: vi.fn() }));
    sendMock = vi.fn();

    mockRequest = {};
    mockResponse = {
      json: jsonMock,
      status: statusMock,
      send: sendMock,
    };
  });

  it("should create REST service with correct structure", () => {
    const service = createTempSensorRestService(mockTempSensorService);

    expect(service).toHaveProperty("handlers");
    expect(service).toHaveProperty("paths");
    expect(service.handlers).toHaveProperty("getStatus");
    expect(service.handlers).toHaveProperty("start");
    expect(service.handlers).toHaveProperty("stop");
    expect(service.paths).toEqual({
      status: "/api/temp-sensor/status",
      start: "/api/temp-sensor/start",
      stop: "/api/temp-sensor/stop",
    });
  });

  describe("getStatus handler", () => {
    it("should return stopped status initially", () => {
      const service = createTempSensorRestService(mockTempSensorService);

      service.handlers.getStatus(
        mockRequest as Request,
        mockResponse as Response<TempSensorStatus>,
      );

      expect(jsonMock).toHaveBeenCalledWith({
        status: "stopped",
        lastError: undefined,
      });
    });

    it("should return running status when service is running", () => {
      mockTempSensorService.status = "running";
      const service = createTempSensorRestService(mockTempSensorService);

      service.handlers.getStatus(
        mockRequest as Request,
        mockResponse as Response<TempSensorStatus>,
      );

      expect(jsonMock).toHaveBeenCalledWith({
        status: "running",
        lastError: undefined,
      });
    });

    it("should handle internal errors with 500 status", () => {
      jsonMock.mockImplementationOnce(() => {
        throw new Error("Internal error");
      });
      const service = createTempSensorRestService(mockTempSensorService);

      service.handlers.getStatus(
        mockRequest as Request,
        mockResponse as Response<TempSensorStatus>,
      );

      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  describe("start handler", () => {
    it("should start service and return 204", async () => {
      (mockTempSensorService.start as Mock).mockResolvedValueOnce(undefined);
      const service = createTempSensorRestService(mockTempSensorService);

      await service.handlers.start(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockTempSensorService.start).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(204);
    });

    it("should return 409 if already running", async () => {
      (mockTempSensorService.start as Mock).mockRejectedValueOnce(
        new Error("Already running"),
      );
      const service = createTempSensorRestService(mockTempSensorService);

      await service.handlers.start(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Service already running",
      });
    });

    it("should handle other errors with 500 status", async () => {
      (mockTempSensorService.start as Mock).mockRejectedValueOnce(
        new Error("Some other error"),
      );
      const service = createTempSensorRestService(mockTempSensorService);

      await service.handlers.start(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Internal server error" });
    });
  });

  describe("stop handler", () => {
    it("should stop service and return 204", async () => {
      (mockTempSensorService.stop as Mock).mockResolvedValueOnce(undefined);
      const service = createTempSensorRestService(mockTempSensorService);

      await service.handlers.stop(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockTempSensorService.stop).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(204);
    });

    it("should return 409 if already stopped", async () => {
      (mockTempSensorService.stop as Mock).mockRejectedValueOnce(
        new Error("Already stopped"),
      );
      const service = createTempSensorRestService(mockTempSensorService);

      await service.handlers.stop(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Service already stopped",
      });
    });

    it("should handle other errors with 500 status", async () => {
      (mockTempSensorService.stop as Mock).mockRejectedValueOnce(
        new Error("Some other error"),
      );
      const service = createTempSensorRestService(mockTempSensorService);

      await service.handlers.stop(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Internal server error" });
    });
  });
});
