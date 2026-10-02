export type LogLevel = "debug" | "warning" | "error";

export type LogMessage = {
  level: LogLevel;
  timestamp: string;
  [key: string]: unknown;
};

export type LoggingService = {
  debug: (data: Record<string, unknown>) => void;
  warning: (data: Record<string, unknown>) => void;
  error: (data: Record<string, unknown>) => void;
};
