import { describe, expect, it } from "vitest";
import { TEMP_SENSOR_STATUS } from "../../tempSensorController/constants.js";
import {
  TEMP_SENSOR_ERROR_TYPES,
  TEMP_SENSOR_EVENT_TYPES,
  TEMP_SENSOR_OUTCOMES,
} from "../constants.js";
import {
  createInitialTempSensorState,
  reduceTempSensorState,
} from "../reducer.js";
import type { TempSensorError, TempSensorReading } from "../types.js";
import {
  createHumidityPercentage,
  createTemperatureC,
  createTemperatureF,
  createTimestamp,
} from "../../types/nominal-utils.js";

const reading: TempSensorReading = {
  temperatureC: createTemperatureC(23.4),
  temperatureF: createTemperatureF(74.12),
  relativeHumidityPercentage: createHumidityPercentage(65.2),
  timestamp: createTimestamp(new Date("2025-08-11T13:00:00.000Z")),
};

const checksumError: TempSensorError = {
  type: TEMP_SENSOR_ERROR_TYPES.CHECKSUM,
  message: "Checksum mismatch",
};

describe("createInitialTempSensorState", () => {
  it("starts stopped with no history", () => {
    expect(createInitialTempSensorState()).toEqual({
      status: TEMP_SENSOR_STATUS.STOPPED,
      lastReading: undefined,
      lastError: undefined,
      lastOutcome: undefined,
    });
  });
});

describe("reduceTempSensorState", () => {
  it("marks the service running and clears history on start", () => {
    const state = reduceTempSensorState(
      {
        status: TEMP_SENSOR_STATUS.STOPPED,
        lastReading: reading,
        lastError: checksumError,
        lastOutcome: TEMP_SENSOR_OUTCOMES.ERROR,
      },
      { type: TEMP_SENSOR_EVENT_TYPES.STARTED },
    );

    expect(state).toEqual({
      status: TEMP_SENSOR_STATUS.RUNNING,
      lastReading: undefined,
      lastError: undefined,
      lastOutcome: undefined,
    });
  });

  it("keeps the last reading when the service stops", () => {
    const running = reduceTempSensorState(createInitialTempSensorState(), {
      type: TEMP_SENSOR_EVENT_TYPES.STARTED,
    });
    const withReading = reduceTempSensorState(running, {
      type: TEMP_SENSOR_EVENT_TYPES.READING_AVAILABLE,
      reading,
    });

    const stopped = reduceTempSensorState(withReading, {
      type: TEMP_SENSOR_EVENT_TYPES.STOPPED,
    });

    expect(stopped.status).toBe(TEMP_SENSOR_STATUS.STOPPED);
    expect(stopped.lastReading).toBe(reading);
  });

  it("records a reading as the current outcome", () => {
    const state = reduceTempSensorState(createInitialTempSensorState(), {
      type: TEMP_SENSOR_EVENT_TYPES.READING_AVAILABLE,
      reading,
    });

    expect(state.lastReading).toBe(reading);
    expect(state.lastOutcome).toBe(TEMP_SENSOR_OUTCOMES.READING);
  });

  it("records a decode failure as the current outcome", () => {
    const state = reduceTempSensorState(createInitialTempSensorState(), {
      type: TEMP_SENSOR_EVENT_TYPES.DECODE_FAILED,
      error: checksumError,
    });

    expect(state.lastError).toBe(checksumError);
    expect(state.lastOutcome).toBe(TEMP_SENSOR_OUTCOMES.ERROR);
  });

  it("keeps the failed frame's error visible after a later success", () => {
    const failed = reduceTempSensorState(createInitialTempSensorState(), {
      type: TEMP_SENSOR_EVENT_TYPES.DECODE_FAILED,
      error: checksumError,
    });

    const recovered = reduceTempSensorState(failed, {
      type: TEMP_SENSOR_EVENT_TYPES.READING_AVAILABLE,
      reading,
    });

    expect(recovered.lastError).toBe(checksumError);
    expect(recovered.lastOutcome).toBe(TEMP_SENSOR_OUTCOMES.READING);
  });

  it("does not mutate the state it is given", () => {
    const initial = createInitialTempSensorState();
    const snapshot = { ...initial };

    reduceTempSensorState(initial, {
      type: TEMP_SENSOR_EVENT_TYPES.READING_AVAILABLE,
      reading,
    });

    expect(initial).toEqual(snapshot);
  });
});
