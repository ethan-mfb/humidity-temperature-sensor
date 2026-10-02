import { LogLevel, LogMessage, LoggingService } from "./types.js";

export function createLoggingService(): LoggingService {
  const log = (level: LogLevel, data: Record<string, unknown>) => {
    const timestamp = new Date().toISOString();
    const logEntry: LogMessage = {
      level,
      timestamp,
      ...data,
    };

    const logString = JSON.stringify(logEntry);

    switch (level) {
      case "debug":
        console.debug(logString);
        break;
      case "warning":
        console.warn(logString);
        break;
      case "error":
        console.error(logString);
        break;
      default:
        console.log(logString);
    }
  };

  return {
    debug: (data: Record<string, unknown>) => log("debug", data),
    warning: (data: Record<string, unknown>) => log("warning", data),
    error: (data: Record<string, unknown>) => log("error", data),
  };
}
