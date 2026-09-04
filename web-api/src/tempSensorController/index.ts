// Export service factories
export {
  createTempSensorRestService,
  tempSensorRestPaths,
  type TempSensorRestService,
} from "./restService.js";
export {
  createTempSensorSSEService,
  tempSensorSSEPaths,
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
