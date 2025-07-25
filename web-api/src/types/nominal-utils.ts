// Utility functions for working with nominal types
import type { 
  GpioPin, 
  GpioValue, 
  TemperatureC, 
  TemperatureF, 
  HumidityPercentage, 
  Timestamp, 
  IntervalMs 
} from "./nominal-types.js";

// Type guard functions for creating nominal types
export const createGpioPin = (value: number): GpioPin => {
  if (!Number.isInteger(value) || value < 0 || value > 40) {
    throw new Error(`Invalid GPIO pin: ${value}. Must be integer 0-40.`);
  }
  return value as GpioPin;
};

export const createGpioValue = (value: number): GpioValue => {
  if (value !== 0 && value !== 1) {
    throw new Error(`Invalid GPIO value: ${value}. Must be 0 or 1.`);
  }
  return value as GpioValue;
};

export const createTemperatureC = (value: number): TemperatureC => {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid temperature (C): ${value}. Must be finite number.`);
  }
  return value as TemperatureC;
};

export const createTemperatureF = (value: number): TemperatureF => {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid temperature (F): ${value}. Must be finite number.`);
  }
  return value as TemperatureF;
};

export const createHumidityPercentage = (value: number): HumidityPercentage => {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`Invalid humidity: ${value}. Must be 0-100.`);
  }
  return value as HumidityPercentage;
};

export const createTimestamp = (date: Date = new Date()): Timestamp => {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${date}. Must be a valid Date instance.`);
  }
  return date.toJSON() as Timestamp;
};

export const createIntervalMs = (value: number): IntervalMs => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid interval: ${value}. Must be positive integer.`);
  }
  return value as IntervalMs;
};

// Utility functions for working with nominal types
export const unwrapGpioPin = (pin: GpioPin): number => pin as number;
export const unwrapGpioValue = (value: GpioValue): number => value as number;
export const unwrapTemperatureC = (temp: TemperatureC): number => temp as number;
export const unwrapTemperatureF = (temp: TemperatureF): number => temp as number;
export const unwrapHumidityPercentage = (humidity: HumidityPercentage): number => humidity as number;
export const unwrapTimestamp = (timestamp: Timestamp): string => timestamp as string;
export const unwrapIntervalMs = (interval: IntervalMs): number => interval as number;