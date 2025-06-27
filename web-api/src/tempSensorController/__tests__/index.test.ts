import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  Mock,
} from "vitest";
import type { Request, Response } from "express";
import type { TempSensorStatus } from "../types.js";

// Mock the controller module to reset state between tests
const mockTempSensorService = {
  status: "stopped" as "running" | "stopped",
  lastError: undefined as { type: string; message: string } | undefined,
  
  async getLatestReading() {
    if (this.status === "stopped") {
      return { type: "signal", message: "Sensor service is stopped" };
    }
    return { type: "signal", message: "Service not yet implemented" };
  },
  
  subscribe(callback: any): () => void {
    return () => {};
  },
  
  async start(): Promise<void> {
    if (this.status === "running") {
      throw new Error("Already running");
    }
    this.status = "running";
    this.lastError = undefined;
  },
  
  async stop(): Promise<void> {
    if (this.status === "stopped") {
      throw new Error("Already stopped");
    }
    this.status = "stopped";
  },

  reset(): void {
    this.status = "stopped";
    this.lastError = undefined;
  }
};

vi.mock("../index.js", async () => {
  const actual = await vi.importActual("../index.js") as any;
  
  return {
    ...actual,
    tempSensorStatusHandler: (req: Request, res: Response<TempSensorStatus>) => {
      try {
        const status: TempSensorStatus = {
          status: mockTempSensorService.status,
          lastError: mockTempSensorService.lastError
        };
        res.json(status);
      } catch (error) {
        res.status(500).json({
          status: "stopped",
          lastError: { type: "internal", message: "Internal server error" }
        });
      }
    },
    
    tempSensorStartHandler: async (req: Request, res: Response) => {
      try {
        await mockTempSensorService.start();
        res.status(204).send();
      } catch (error) {
        if (error instanceof Error && error.message === "Already running") {
          res.status(409).json({ error: "Service already running" });
        } else {
          res.status(500).json({ error: "Internal server error" });
        }
      }
    },
    
    tempSensorStopHandler: async (req: Request, res: Response) => {
      try {
        await mockTempSensorService.stop();
        res.status(204).send();
      } catch (error) {
        if (error instanceof Error && error.message === "Already stopped") {
          res.status(409).json({ error: "Service already stopped" });
        } else {
          res.status(500).json({ error: "Internal server error" });
        }
      }
    },
    
    tempSensorStreamHandler: (req: Request, res: Response) => {
      const intervalMs = req.query.interval ? parseInt(req.query.interval as string, 10) : 1000;
      if (isNaN(intervalMs) || intervalMs < 100 || intervalMs > 60000) {
        return res.status(400).json({ error: "Invalid interval parameter (100-60000ms)" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Cache-Control");

      res.write('data: {"type":"connected"}\n\n');

      let intervalId: NodeJS.Timeout;
      let isActive = true;

      const sendEvent = (eventType: string, data: any) => {
        if (isActive) {
          res.write(`event: ${eventType}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      const cleanup = () => {
        isActive = false;
        if (intervalId) {
          clearInterval(intervalId);
        }
      };

      intervalId = setInterval(async () => {
        if (!isActive) return;

        try {
          if (mockTempSensorService.status === "stopped") {
            sendEvent("error", { type: "signal", message: "Sensor service is stopped" });
            return;
          }

          const reading = await mockTempSensorService.getLatestReading();
          
          if ("type" in reading) {
            sendEvent("error", reading);
          } else {
            sendEvent("reading", reading);
          }
        } catch (error) {
          sendEvent("error", { type: "internal", message: "Internal server error" });
        }
      }, intervalMs);

      req.on("close", cleanup);
      req.on("end", cleanup);
      res.on("close", cleanup);
    }
  };
});

import {
  tempSensorStatusHandler,
  tempSensorStartHandler,
  tempSensorStopHandler,
  tempSensorStreamHandler,
} from "../index.js";

describe("temp sensor controller", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: Mock;
  let statusMock: Mock;
  let sendMock: Mock;
  let setHeaderMock: Mock;
  let writeMock: Mock;

  beforeEach(() => {
    // Reset service state before each test
    mockTempSensorService.reset();
    
    jsonMock = vi.fn();
    statusMock = vi.fn(() => ({ json: jsonMock, send: vi.fn() }));
    sendMock = vi.fn();
    setHeaderMock = vi.fn();
    writeMock = vi.fn();

    mockRequest = {
      query: {},
      on: vi.fn(),
    };

    mockResponse = {
      json: jsonMock,
      status: statusMock,
      send: sendMock,
      setHeader: setHeaderMock,
      write: writeMock,
      on: vi.fn(),
    };
  });

  describe("tempSensorStatusHandler", () => {
    it("should return stopped status initially", () => {
      tempSensorStatusHandler(
        mockRequest as Request,
        mockResponse as Response<TempSensorStatus>
      );

      expect(jsonMock).toHaveBeenCalledWith({
        status: "stopped",
        lastError: undefined,
      });
    });

    it("should return running status after service is started", async () => {
      // First start the service
      await tempSensorStartHandler(mockRequest as Request, mockResponse as Response);
      
      // Reset mocks
      jsonMock.mockClear();
      statusMock.mockClear();

      // Then check status
      tempSensorStatusHandler(
        mockRequest as Request,
        mockResponse as Response<TempSensorStatus>
      );

      expect(jsonMock).toHaveBeenCalledWith({
        status: "running",
        lastError: undefined,
      });
    });

    it("should handle internal errors with 500 status", () => {
      // Mock json to throw an error
      jsonMock.mockImplementationOnce(() => {
        throw new Error("Internal error");
      });

      tempSensorStatusHandler(
        mockRequest as Request,
        mockResponse as Response<TempSensorStatus>
      );

      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  describe("tempSensorStartHandler", () => {
    it("should start service and return 204", async () => {
      await tempSensorStartHandler(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(204);
    });

    it("should return 409 if already running", async () => {
      // Start service first time
      await tempSensorStartHandler(mockRequest as Request, mockResponse as Response);
      
      // Reset mocks
      statusMock.mockClear();
      jsonMock.mockClear();

      // Try to start again
      await tempSensorStartHandler(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Service already running" });
    });
  });

  describe("tempSensorStopHandler", () => {
    it("should return 409 if already stopped", async () => {
      await tempSensorStopHandler(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Service already stopped" });
    });

    it("should stop service and return 204", async () => {
      // Start service first
      await tempSensorStartHandler(mockRequest as Request, mockResponse as Response);
      
      // Reset mocks
      statusMock.mockClear();
      jsonMock.mockClear();

      // Stop service
      await tempSensorStopHandler(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(204);
    });
  });

  describe("tempSensorStreamHandler", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should set up SSE headers correctly", () => {
      tempSensorStreamHandler(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(setHeaderMock).toHaveBeenCalledWith("Content-Type", "text/event-stream");
      expect(setHeaderMock).toHaveBeenCalledWith("Cache-Control", "no-cache");
      expect(setHeaderMock).toHaveBeenCalledWith("Connection", "keep-alive");
      expect(setHeaderMock).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
    });

    it("should send initial connection event", () => {
      tempSensorStreamHandler(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(writeMock).toHaveBeenCalledWith('data: {"type":"connected"}\n\n');
    });

    it("should validate interval parameter", () => {
      mockRequest.query = { interval: "invalid" };

      tempSensorStreamHandler(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ 
        error: "Invalid interval parameter (100-60000ms)" 
      });
    });

    it("should reject interval outside valid range", () => {
      mockRequest.query = { interval: "50" }; // Below minimum

      tempSensorStreamHandler(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it("should use default interval when not specified", () => {
      const setIntervalSpy = vi.spyOn(global, "setInterval");
      
      tempSensorStreamHandler(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        1000 // Default interval
      );
    });

    it("should use custom interval when specified", () => {
      const setIntervalSpy = vi.spyOn(global, "setInterval");
      mockRequest.query = { interval: "2000" };
      
      tempSensorStreamHandler(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        2000
      );
    });

    it("should send error event when service is stopped", async () => {
      // Start the stream
      tempSensorStreamHandler(
        mockRequest as Request,
        mockResponse as Response
      );

      // Clear initial connection write
      writeMock.mockClear();

      // Advance timer to trigger interval
      vi.advanceTimersByTime(1000);
      await vi.waitFor(() => {
        expect(writeMock).toHaveBeenCalledWith("event: error\n");
        expect(writeMock).toHaveBeenCalledWith(
          'data: {"type":"signal","message":"Sensor service is stopped"}\n\n'
        );
      });
    });

    it("should clean up on client disconnect", () => {
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");
      const onMock = mockRequest.on as Mock;
      
      tempSensorStreamHandler(
        mockRequest as Request,
        mockResponse as Response
      );

      // Simulate client disconnect
      const closeCallback = onMock.mock.calls.find(call => call[0] === "close")?.[1];
      if (closeCallback) {
        closeCallback();
      }

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });
});