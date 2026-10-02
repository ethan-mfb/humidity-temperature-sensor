import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { STATUS_TYPES } from "../../gpioPinService/constants.js";
import { TEMP_SENSOR_STATUS } from "../../tempSensorController/constants.js";
import type { GpioPinService } from "../../gpioPinService/types.js";
import { createGpioPin } from "../../types/nominal-utils.js";
import {
  TEMP_SENSOR_ERROR_TYPES,
  TEMP_SENSOR_MESSAGES,
  targetDataGpioPin,
} from "../constants.js";
import { createTempSensorService } from "../index.js";
import type {
  GpioEdge,
  TempSensorError,
  TempSensorReading,
  TempSensorService,
} from "../types.js";
import { TEST_PIN, createFrameEdges, withChecksum } from "./utils.js";

const roomConditionsBytes = withChecksum([0x02, 0x8c, 0x00, 0xea]);

type GpioPinServiceStub = GpioPinService & {
  emitData: (edge: GpioEdge) => void;
  emitError: (reason: string) => void;
  emitStatus: (status: { status: string; pin?: number }) => void;
  startPolling: Mock;
  stopPolling: Mock;
};

function createGpioPinServiceStub(): GpioPinServiceStub {
  const dataCallbacks: ((edge: GpioEdge) => void)[] = [];
  const errorCallbacks: ((reason: string) => void)[] = [];
  const statusCallbacks: ((status: {
    status: string;
    pin?: number;
  }) => void)[] = [];

  return {
    startPolling: vi.fn(async () => undefined),
    stopPolling: vi.fn(async () => undefined),
    onData: (callback) => {
      dataCallbacks.push(callback);
    },
    onError: (callback) => {
      errorCallbacks.push(callback);
    },
    onStatus: (callback) => {
      statusCallbacks.push(callback);
    },
    emitData: (edge) => dataCallbacks.forEach((callback) => callback(edge)),
    emitError: (reason) =>
      errorCallbacks.forEach((callback) => callback(reason)),
    emitStatus: (status) =>
      statusCallbacks.forEach((callback) => callback(status)),
  };
}

function transmitFrame(
  gpioPinService: GpioPinServiceStub,
  bytes: readonly number[],
  startTimestamp = 0,
): void {
  createFrameEdges(bytes, startTimestamp).forEach((edge) =>
    gpioPinService.emitData(edge),
  );
}

describe("createTempSensorService", () => {
  let gpioPinService: GpioPinServiceStub;
  let service: TempSensorService;

  beforeEach(() => {
    gpioPinService = createGpioPinServiceStub();
    service = createTempSensorService({ gpioPinService });
  });

  describe("lifecycle", () => {
    it("starts stopped with no error", () => {
      expect(service.status).toBe(TEMP_SENSOR_STATUS.STOPPED);
      expect(service.lastError).toBeUndefined();
    });

    it("polls the default data pin on start", async () => {
      await service.start();

      expect(gpioPinService.startPolling).toHaveBeenCalledWith(
        targetDataGpioPin,
      );
      expect(service.status).toBe(TEMP_SENSOR_STATUS.RUNNING);
    });

    it("polls an injected pin when one is supplied", async () => {
      const configured = createTempSensorService({
        gpioPinService,
        pin: createGpioPin(17),
      });

      await configured.start();

      expect(gpioPinService.startPolling).toHaveBeenCalledWith(17);
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

    it("stops polling and reports stopped", async () => {
      await service.start();

      await service.stop();

      expect(gpioPinService.stopPolling).toHaveBeenCalled();
      expect(service.status).toBe(TEMP_SENSOR_STATUS.STOPPED);
    });

    it("propagates a failure to start", async () => {
      gpioPinService.startPolling.mockRejectedValueOnce(
        new Error("Command timeout: start"),
      );

      await expect(service.start()).rejects.toThrow("Command timeout: start");
      expect(service.status).toBe(TEMP_SENSOR_STATUS.STOPPED);
    });

    it("reports stopped when the polling child exits on its own", async () => {
      await service.start();

      gpioPinService.emitStatus({
        status: STATUS_TYPES.EXITED,
        pin: TEST_PIN,
      });

      expect(service.status).toBe(TEMP_SENSOR_STATUS.STOPPED);
    });
  });

  describe("readings", () => {
    it("reports no reading before any frame arrives", async () => {
      await expect(service.getLatestReading()).resolves.toEqual({
        type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
        message: TEMP_SENSOR_MESSAGES.NO_READING_AVAILABLE,
      });
    });

    it("decodes a transmitted frame into a reading", async () => {
      await service.start();

      transmitFrame(gpioPinService, roomConditionsBytes);

      await expect(service.getLatestReading()).resolves.toMatchObject({
        temperatureC: 23.4,
        temperatureF: 74.12,
        relativeHumidityPercentage: 65.2,
      });
    });

    it("ignores edges that arrive while stopped", async () => {
      transmitFrame(gpioPinService, roomConditionsBytes);

      await expect(service.getLatestReading()).resolves.toMatchObject({
        type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
      });
    });

    it("clears readings from a previous run on restart", async () => {
      await service.start();
      transmitFrame(gpioPinService, roomConditionsBytes);
      await service.stop();

      await service.start();

      await expect(service.getLatestReading()).resolves.toMatchObject({
        type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
        message: TEMP_SENSOR_MESSAGES.NO_READING_AVAILABLE,
      });
    });
  });

  describe("error handling", () => {
    it("surfaces a checksum failure without stopping", async () => {
      const corrupted = [...roomConditionsBytes];
      corrupted[4] = (corrupted[4] + 1) & 0xff;
      await service.start();

      transmitFrame(gpioPinService, corrupted);

      expect(service.status).toBe(TEMP_SENSOR_STATUS.RUNNING);
      expect(service.lastError).toMatchObject({
        type: TEMP_SENSOR_ERROR_TYPES.CHECKSUM,
      });
      await expect(service.getLatestReading()).resolves.toMatchObject({
        type: TEMP_SENSOR_ERROR_TYPES.CHECKSUM,
      });
    });

    it("recovers on the next good frame", async () => {
      const corrupted = [...roomConditionsBytes];
      corrupted[4] = (corrupted[4] + 1) & 0xff;
      await service.start();
      transmitFrame(gpioPinService, corrupted);

      transmitFrame(gpioPinService, roomConditionsBytes, 100_000);

      await expect(service.getLatestReading()).resolves.toMatchObject({
        temperatureC: 23.4,
      });
    });

    it("reports a GPIO error as a signal error", async () => {
      await service.start();

      gpioPinService.emitError("EACCES: permission denied");

      expect(service.lastError).toEqual({
        type: TEMP_SENSOR_ERROR_TYPES.SIGNAL,
        message: "EACCES: permission denied",
      });
    });
  });

  describe("subscriptions", () => {
    it("delivers readings to subscribers", async () => {
      const received: (TempSensorReading | TempSensorError)[] = [];
      service.subscribe((event) => received.push(event));
      await service.start();

      transmitFrame(gpioPinService, roomConditionsBytes);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ temperatureC: 23.4 });
    });

    it("delivers recoverable errors to subscribers", async () => {
      const received: (TempSensorReading | TempSensorError)[] = [];
      service.subscribe((event) => received.push(event));
      await service.start();

      gpioPinService.emitError("signal noise");

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
      await service.start();

      unsubscribe();
      transmitFrame(gpioPinService, roomConditionsBytes);

      expect(callback).not.toHaveBeenCalled();
    });

    it("keeps delivering to the other subscribers when one throws", async () => {
      const healthy = vi.fn();
      service.subscribe(() => {
        throw new Error("subscriber exploded");
      });
      service.subscribe(healthy);
      await service.start();

      transmitFrame(gpioPinService, roomConditionsBytes);

      expect(healthy).toHaveBeenCalledTimes(1);
    });
  });
});
