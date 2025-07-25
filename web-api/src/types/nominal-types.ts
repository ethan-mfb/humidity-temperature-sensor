// Nominal type definitions to prevent type confusion
// Using branded types to ensure type safety between similar primitives

export type GpioPin = number & { readonly __brand: 'GpioPin' };
export type GpioValue = number & { readonly __brand: 'GpioValue' };
export type TemperatureC = number & { readonly __brand: 'TemperatureC' };
export type TemperatureF = number & { readonly __brand: 'TemperatureF' };
export type HumidityPercentage = number & { readonly __brand: 'HumidityPercentage' };
export type Timestamp = string & { readonly __brand: 'Timestamp' };
export type IntervalMs = number & { readonly __brand: 'IntervalMs' };