// Temperature sensor controller types
import type {
  TemperatureC,
  TemperatureF,
  HumidityPercentage,
  Timestamp,
} from "../types/nominal-types.js";

export type TempSensorStatus = {
  status: "running" | "stopped";
  lastError?: { type: string; message: string };
};

export type TempSensorReading = {
  temperatureC: TemperatureC;
  temperatureF: TemperatureF;
  relativeHumidityPercentage: HumidityPercentage;
  timestamp: Timestamp;
};

export type TempSensorError =
  | { type: "checksum"; message: string }
  | { type: "signal"; message: string }
  | { type: "range"; message: string };

export type TempSensorStreamEvent =
  | TempSensorReading
  | { type: "error"; error: TempSensorError };
