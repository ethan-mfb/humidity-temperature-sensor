// Temperature sensor controller types

export type TempSensorStatus = {
  status: "running" | "stopped";
  lastError?: { type: string; message: string };
};

export type TempSensorReading = {
  temperatureC: number;
  temperatureF: number;
  relativeHumidityPercentage: number;
  timestamp: number;
};

export type TempSensorError =
  | { type: "checksum"; message: string }
  | { type: "signal"; message: string }
  | { type: "range"; message: string };

export type TempSensorStreamEvent = TempSensorReading | { type: "error"; error: TempSensorError };