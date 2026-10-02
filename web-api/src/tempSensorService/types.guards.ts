import { TEMP_SENSOR_ERROR_TYPES } from "./constants.js";
import type { TempSensorError } from "./types.js";

const errorTypes: readonly string[] = Object.values(TEMP_SENSOR_ERROR_TYPES);

export function isTempSensorError(value: unknown): value is TempSensorError {
  if (typeof value !== "object" || value === null) return false;
  if (!("type" in value) || !("message" in value)) return false;
  return (
    typeof value.type === "string" &&
    errorTypes.includes(value.type) &&
    typeof value.message === "string"
  );
}
