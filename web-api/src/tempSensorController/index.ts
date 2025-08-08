// Export service factories
export {
  createTempSensorRestService,
  type TempSensorRestService,
} from "./restService.js";
export {
  createTempSensorSSEService,
  type TempSensorSSEService,
} from "./sseService.js";

// Export types for convenience
export type {
  TempSensorStatus,
  TempSensorReading,
  TempSensorError,
  TempSensorStreamEvent,
  TempSensorService,
} from "./types.js";
