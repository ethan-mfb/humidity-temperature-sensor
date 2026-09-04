import { TEMP_SENSOR_STATUS } from "../tempSensorController/constants.js";
import { TEMP_SENSOR_EVENT_TYPES, TEMP_SENSOR_OUTCOMES } from "./constants.js";
import type { TempSensorEvent, TempSensorState } from "./types.js";

/** A stopped service with no history. */
export function createInitialTempSensorState(): TempSensorState {
  return {
    status: TEMP_SENSOR_STATUS.STOPPED,
    lastReading: undefined,
    lastError: undefined,
    lastOutcome: undefined,
  };
}

/**
 * Pure reducer over the pipeline events.
 *
 * Starting clears any history, since readings from a previous run say nothing
 * about the current one. `lastError` is kept after a later success so the
 * status endpoint can still report it; `lastOutcome` records which of the two
 * is current.
 */
export function reduceTempSensorState(
  state: TempSensorState,
  event: TempSensorEvent,
): TempSensorState {
  switch (event.type) {
    case TEMP_SENSOR_EVENT_TYPES.STARTED:
      return {
        ...createInitialTempSensorState(),
        status: TEMP_SENSOR_STATUS.RUNNING,
      };

    case TEMP_SENSOR_EVENT_TYPES.STOPPED:
      return { ...state, status: TEMP_SENSOR_STATUS.STOPPED };

    case TEMP_SENSOR_EVENT_TYPES.READING_AVAILABLE:
      return {
        ...state,
        lastReading: event.reading,
        lastOutcome: TEMP_SENSOR_OUTCOMES.READING,
      };

    case TEMP_SENSOR_EVENT_TYPES.DECODE_FAILED:
      return {
        ...state,
        lastError: event.error,
        lastOutcome: TEMP_SENSOR_OUTCOMES.ERROR,
      };

    default:
      return state;
  }
}
