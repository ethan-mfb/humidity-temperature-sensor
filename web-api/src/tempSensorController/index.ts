import { Request, Response } from "express";
import type { TempSensorStatus, TempSensorReading, TempSensorError, TempSensorStreamEvent } from "./types.js";

// Mock implementation until temp sensor service is implemented
// TODO: Replace with actual temp sensor service import when available
const mockTempSensorService = {
  status: "stopped" as "running" | "stopped",
  lastError: undefined as { type: string; message: string } | undefined,
  
  async getLatestReading(): Promise<TempSensorReading | TempSensorError> {
    if (this.status === "stopped") {
      return { type: "signal", message: "Sensor service is stopped" };
    }
    return { type: "signal", message: "Service not yet implemented" };
  },
  
  subscribe(callback: (event: TempSensorReading | TempSensorError) => void): () => void {
    // Mock subscription - returns unsubscribe function
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
  }
};

// REST Endpoints

export const tempSensorStatusPath = "/api/temp-sensor/status";
export function tempSensorStatusHandler(
  req: Request,
  res: Response<TempSensorStatus>
) {
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
}

export const tempSensorStartPath = "/api/temp-sensor/start";
export function tempSensorStartHandler(
  req: Request,
  res: Response
) {
  try {
    mockTempSensorService.start();
    res.status(204).send();
  } catch (error) {
    if (error instanceof Error && error.message === "Already running") {
      res.status(409).json({ error: "Service already running" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

export const tempSensorStopPath = "/api/temp-sensor/stop";
export function tempSensorStopHandler(
  req: Request,
  res: Response
) {
  try {
    mockTempSensorService.stop();
    res.status(204).send();
  } catch (error) {
    if (error instanceof Error && error.message === "Already stopped") {
      res.status(409).json({ error: "Service already stopped" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

// SSE Endpoint

export const tempSensorStreamPath = "/api/temp-sensor/stream";
export function tempSensorStreamHandler(
  req: Request<{}, {}, {}, { interval?: string }>,
  res: Response
) {
  // Validate interval parameter
  const intervalMs = req.query.interval ? parseInt(req.query.interval, 10) : 1000;
  if (isNaN(intervalMs) || intervalMs < 100 || intervalMs > 60000) {
    return res.status(400).json({ error: "Invalid interval parameter (100-60000ms)" });
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Cache-Control");

  // Send initial connection event
  res.write("data: {\"type\":\"connected\"}\n\n");

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

  // Set up periodic data sending
  intervalId = setInterval(async () => {
    if (!isActive) return;

    try {
      if (mockTempSensorService.status === "stopped") {
        sendEvent("error", { type: "signal", message: "Sensor service is stopped" });
        return;
      }

      const reading = await mockTempSensorService.getLatestReading();
      
      if ("type" in reading) {
        // It's an error
        sendEvent("error", reading);
      } else {
        // It's a reading
        sendEvent("reading", reading);
      }
    } catch (error) {
      sendEvent("error", { type: "internal", message: "Internal server error" });
    }
  }, intervalMs);

  // Handle client disconnect
  req.on("close", cleanup);
  req.on("end", cleanup);
  res.on("close", cleanup);
}