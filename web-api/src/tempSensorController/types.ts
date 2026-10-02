// Temperature sensor controller types
import type {
  TemperatureC,
  TemperatureF,
  HumidityPercentage,
  Timestamp,
} from "../types/nominal-types.js";
import { TEMP_SENSOR_STATUS } from "./constants.js";

export type TempSensorStatusType =
  (typeof TEMP_SENSOR_STATUS)[keyof typeof TEMP_SENSOR_STATUS];

export type TempSensorStatus = {
  status: TempSensorStatusType;
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

// Temperature sensor service interface
export type TempSensorService = {
  status: TempSensorStatusType;
  lastError: { type: string; message: string } | undefined;
  getLatestReading(): Promise<TempSensorReading | TempSensorError>;
  subscribe(
    callback: (event: TempSensorReading | TempSensorError) => void,
  ): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
};
