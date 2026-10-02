import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMP_SENSOR_STATUS } from "../../tempSensorController/constants.js";
import {
  MIN_READ_INTERVAL_MS,
  TEMP_SENSOR_ERROR_TYPES,
  TEMP_SENSOR_MESSAGES,
} from "../constants.js";
import { createTempSensorService } from "../index.js";
import type {
  FrameCapture,
  SensorFrameSource,
  TempSensorError,
  TempSensorReading,
  TempSensorService,
} from "../types.js";
import { createFrameEdges, withChecksum } from "./utils.js";

const roomConditionsBytes = withChecksum([0x02, 0x8c, 0x00, 0xea]);

const corruptChecksum = (bytes: readonly number[]): readonly number[] => [
  ...bytes.slice(0, 4),
  (bytes[4] + 1) & 0xff,
];

type SensorFrameSourceFake = SensorFrameSource & {
  /** The next read answers with a frame carrying these bytes. */
  queueFrame: (bytes: readonly number[]) => void;
  /** The next read answers with a failed capture. */
  queueError: (message: string) => void;
  /** The next read rejects outright, as a helper that cannot be run would. */
  queueThrow: (error: Error) => void;
};

/**
 * Stands in for the hardware. The service is the application layer, so it is
 * tested against a fake port rather than a pi.
 */
function createFrameSourceFake(): SensorFrameSourceFake {
  const queued: (FrameCapture | Error)[] = [];

  const readFrame = vi.fn(async (): Promise<FrameCapture> => {
    const next = queued.shift();

    if (next instanceof Error) throw next;

    // An unqueued read is a quiet sensor, not a test failure: the service
    // keeps polling and the next queued frame answers.
    return next ?? { edges: [], error: "no frame" };
  });

  return {
    readFrame,
    close: vi.fn(async () => undefined),
    queueFrame: (bytes) =>
      queued.push({ edges: createFrameEdges(bytes), error: null }),
    queueError: (message) => queued.push({ edges: [], error: message }),
    queueThrow: (error) => queued.push(error),
  };
}

describe("createTempSensorService", () => {
  let frameSource: SensorFrameSourceFake;
  let service: TempSensorService;

  beforeEach(() => {
    // Reads schedule themselves, so time is held still and advanced on demand.
    vi.useFakeTimers();
    frameSource = createFrameSourceFake();
    service = createTempSensorService({ frameSource });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("lifecycle", () => {
    it("starts stopped with no error", () => {
      expect(service.status).toBe(TEMP_SENSOR_STATUS.STOPPED);
      expect(service.lastError).toBeUndefined();
    });

    it("reads once immediately on start, rather than waiting an interval", async () => {
      frameSource.queueFrame(roomConditionsBytes);

      await service.start();

      expect(frameSource.readFrame).toHaveBeenCalledTimes(1);
      expect(service.status).toBe(TEMP_SENSOR_STATUS.RUNNING);
    });

    it("keeps reading on the sensor's interval", async () => {
      await service.start();

      await vi.advanceTimersByTimeAsync(MIN_READ_INTERVAL_MS * 3);

      expect(frameSource.readFrame).toHaveBeenCalledTimes(4);
    });

    it("honours an injected read interval", async () => {
      const configured = createTempSensorService({
        frameSource,
        readIntervalMs: 100,
      });
      await configured.start();

      await vi.advanceTimersByTimeAsync(250);

      expect(frameSource.readFrame).toHaveBeenCalledTimes(3);
      await configured.stop();
    });

    it("rejects with the message the controller maps to 409 when running", async () => {
      await service.start();

      await expect(service.start()).rejects.toThrow(
        TEMP_SENSOR_MESSAGES.ALREADY_RUNNING,
      );
    });

    it("rejects with the message the controller maps to 409 when stopped", async () => {
      await expect(service.stop()).rejects.toThrow(
        TEMP_SENSOR_MESSAGES.ALREADY_STOPPED,
      );
    });

    it("closes the frame source and reports stopped", async () => {
      await service.start();

      await service.stop();

      expect(frameSource.close).toHaveBeenCalled();
      expect(service.status).toBe(TEMP_SENSOR_STATUS.STOPPED);
    });

    it("stops reading once stopped", async () => {
      await service.start();
      await service.stop();
      const readsBefore = frameSource.readFrame.mock.calls.length;

      await vi.advanceTimersByTimeAsync(MIN_READ_INTERVAL_MS * 5);

      expect(frameSource.readFrame).toHaveBeenCalledTimes(readsBefore);
    });
  });

  describe("readings", () => {
    it("reports no reading before any frame arrives", async () => {
      await expect(service.getLatestReading()).resolves.toEqual({
        type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
        message: TEMP_SENSOR_MESSAGES.NO_READING_AVAILABLE,
      });
    });

    it("decodes a captured frame into a reading", async () => {
      frameSource.queueFrame(roomConditionsBytes);

      await service.start();

      await expect(service.getLatestReading()).resolves.toMatchObject({
        temperatureC: 23.4,
        temperatureF: 74.12,
        relativeHumidityPercentage: 65.2,
      });
    });

    it("does not serve a previous run's reading after a restart", async () => {
      frameSource.queueFrame(roomConditionsBytes);
      await service.start();
      await service.stop();

      // Nothing queued, so the restart's first read finds a quiet sensor.
      await service.start();

      await expect(service.getLatestReading()).resolves.toMatchObject({
        type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
      });
    });
  });

  describe("error handling", () => {
    it("surfaces a checksum failure without stopping", async () => {
      frameSource.queueFrame(corruptChecksum(roomConditionsBytes));

      await service.start();

      expect(service.status).toBe(TEMP_SENSOR_STATUS.RUNNING);
      expect(service.lastError).toMatchObject({
        type: TEMP_SENSOR_ERROR_TYPES.CHECKSUM,
      });
    });

    it("recovers on the next good frame", async () => {
      frameSource.queueFrame(corruptChecksum(roomConditionsBytes));
      frameSource.queueFrame(roomConditionsBytes);
      await service.start();

      await vi.advanceTimersByTimeAsync(MIN_READ_INTERVAL_MS);

      await expect(service.getLatestReading()).resolves.toMatchObject({
        temperatureC: 23.4,
      });
    });

    it("reports a failed capture as a signal error", async () => {
      frameSource.queueError("EACCES: permission denied");

      await service.start();

      expect(service.lastError).toEqual({
        type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
        message: "EACCES: permission denied",
      });
    });

    it("keeps polling when a read rejects outright", async () => {
      frameSource.queueThrow(new Error("helper exited with signal SIGKILL"));

      await service.start();

      expect(service.status).toBe(TEMP_SENSOR_STATUS.RUNNING);
      expect(service.lastError).toMatchObject({
        type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
        message: expect.stringContaining("SIGKILL"),
      });
    });
  });

  describe("subscriptions", () => {
    it("delivers readings to subscribers", async () => {
      const received: (TempSensorReading | TempSensorError)[] = [];
      service.subscribe((event) => received.push(event));
      frameSource.queueFrame(roomConditionsBytes);

      await service.start();

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ temperatureC: 23.4 });
    });

    it("delivers recoverable errors to subscribers", async () => {
      const received: (TempSensorReading | TempSensorError)[] = [];
      service.subscribe((event) => received.push(event));
      frameSource.queueError("signal noise");

      await service.start();

      expect(received).toEqual([
        {
          type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
          message: "signal noise",
        },
      ]);
    });

    it("stops delivering after unsubscribe", async () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);
      frameSource.queueFrame(roomConditionsBytes);
      await service.start();
      callback.mockClear();

      unsubscribe();
      frameSource.queueFrame(roomConditionsBytes);
      await vi.advanceTimersByTimeAsync(MIN_READ_INTERVAL_MS);

      expect(callback).not.toHaveBeenCalled();
    });

    it("keeps serving other subscribers when one throws", async () => {
      const healthy = vi.fn();
      service.subscribe(() => {
        throw new Error("subscriber blew up");
      });
      service.subscribe(healthy);
      frameSource.queueFrame(roomConditionsBytes);

      await service.start();

      expect(healthy).toHaveBeenCalledTimes(1);
    });
  });
});
