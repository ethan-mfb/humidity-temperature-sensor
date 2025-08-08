import { Request, Response } from "express";
import type { TempSensorStatus, TempSensorService } from "./types.js";

export interface TempSensorRestService {
  handlers: {
    getStatus: (req: Request, res: Response<TempSensorStatus>) => void;
    start: (req: Request, res: Response) => Promise<void>;
    stop: (req: Request, res: Response) => Promise<void>;
  };
  paths: {
    status: string;
    start: string;
    stop: string;
  };
}

export function createTempSensorRestService(
  tempSensorService: TempSensorService,
): TempSensorRestService {
  const paths = {
    status: "/api/temp-sensor/status",
    start: "/api/temp-sensor/start",
    stop: "/api/temp-sensor/stop",
  };

  const handlers = {
    getStatus: (_req: Request, res: Response<TempSensorStatus>) => {
      try {
        const status: TempSensorStatus = {
          status: tempSensorService.status,
          lastError: tempSensorService.lastError,
        };
        res.json(status);
      } catch (error) {
        res.status(500).json({
          status: "stopped",
          lastError: { type: "internal", message: "Internal server error" },
        });
      }
    },

    start: async (_req: Request, res: Response) => {
      try {
        await tempSensorService.start();
        res.status(204).send();
      } catch (error) {
        if (error instanceof Error && error.message === "Already running") {
          res.status(409).json({ error: "Service already running" });
        } else {
          res.status(500).json({ error: "Internal server error" });
        }
      }
    },

    stop: async (_req: Request, res: Response) => {
      try {
        await tempSensorService.stop();
        res.status(204).send();
      } catch (error) {
        if (error instanceof Error && error.message === "Already stopped") {
          res.status(409).json({ error: "Service already stopped" });
        } else {
          res.status(500).json({ error: "Internal server error" });
        }
      }
    },
  };

  return {
    handlers,
    paths,
  };
}
