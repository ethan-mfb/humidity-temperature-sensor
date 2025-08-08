import { Request, Response } from "express";
import type { TempSensorService } from "./types.js";
import { TEMP_SENSOR_STATUS } from "./constants.js";

export interface TempSensorSSEService {
  handlers: {
    stream: (req: Request, res: Response) => void;
  };
  paths: {
    stream: string;
  };
}

export function createTempSensorSSEService(
  tempSensorService: TempSensorService,
): TempSensorSSEService {
  const paths = {
    stream: "/api/temp-sensor/stream",
  };

  const handlers = {
    stream: (
      req: Request<{}, {}, {}, { interval?: string }>,
      res: Response,
    ) => {
      // Validate interval parameter
      const intervalMs = req.query.interval
        ? parseInt(req.query.interval, 10)
        : 1000;
      if (isNaN(intervalMs) || intervalMs < 100 || intervalMs > 60000) {
        return res
          .status(400)
          .json({ error: "Invalid interval parameter (100-60000ms)" });
      }

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Cache-Control");

      // Send initial connection event
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

      // Set up periodic data sending
      intervalId = setInterval(async () => {
        if (!isActive) return;

        try {
          if (tempSensorService.status === TEMP_SENSOR_STATUS.STOPPED) {
            sendEvent("error", {
              type: "signal",
              message: "Sensor service is stopped",
            });
            return;
          }

          const reading = await tempSensorService.getLatestReading();

          if ("type" in reading) {
            // It's an error
            sendEvent("error", reading);
          } else {
            // It's a reading
            sendEvent("reading", reading);
          }
        } catch (error) {
          sendEvent("error", {
            type: "internal",
            message: "Internal server error",
          });
        }
      }, intervalMs);

      // Handle client disconnect
      req.on("close", cleanup);
      req.on("end", cleanup);
      res.on("close", cleanup);
    },
  };

  return {
    handlers,
    paths,
  };
}
