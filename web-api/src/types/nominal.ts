// Nominal type definitions to prevent type confusion
// Using branded types to ensure type safety between similar primitives

export type GpioPin = number & { readonly __brand: 'GpioPin' };
export type GpioValue = number & { readonly __brand: 'GpioValue' };
export type TemperatureC = number & { readonly __brand: 'TemperatureC' };
export type TemperatureF = number & { readonly __brand: 'TemperatureF' };
export type HumidityPercentage = number & { readonly __brand: 'HumidityPercentage' };
export type Timestamp = number & { readonly __brand: 'Timestamp' };
export type IntervalMs = number & { readonly __brand: 'IntervalMs' };

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

export const createTimestamp = (value: number = Date.now()): Timestamp => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid timestamp: ${value}. Must be positive integer.`);
  }
  return value as Timestamp;
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
export const unwrapTimestamp = (timestamp: Timestamp): number => timestamp as number;
export const unwrapIntervalMs = (interval: IntervalMs): number => interval as number;