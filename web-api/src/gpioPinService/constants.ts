/**
 * Constants for GPIO Pin Service
 * Centralizes all magic numbers and strings used throughout the service
 */

/**
 * Timeout configuration
 */
export const TIMEOUTS = {
  /** Default timeout for GPIO pin commands in milliseconds */
  COMMAND_TIMEOUT_MS: 5000,
} as const;

/**
 * Command types for GPIO pin operations
 */
export const COMMAND_TYPES = {
  /** Start polling command */
  START: "start",
  /** Stop polling command */
  STOP: "stop",
} as const;

/**
 * Status types for GPIO pin service events
 */
export const STATUS_TYPES = {
  /** Service started polling */
  STARTED: "started",
  /** Service stopped polling */
  STOPPED: "stopped",
  /** Service exited/terminated */
  EXITED: "exited",
} as const;

/**
 * Event types for inter-process communication
 */
export const EVENT_TYPES = {
  /** Message event from child process */
  MESSAGE: "message",
  /** Error event from child process */
  ERROR: "error",
  /** Status event from child process */
  STATUS: "status",
  /** Data event from child process */
  DATA: "data",
  /** Child process stopped event */
  STOPPED: "stopped",
} as const;

/**
 * Message types for GPIO polling communication
 */
export const MESSAGE_TYPES = {
  /** Data message with pin readings */
  DATA: "data",
  /** Error message */
  ERROR: "error",
  /** Status update message */
  STATUS: "status",
} as const;

// Type exports for better TypeScript integration
export type CommandType = (typeof COMMAND_TYPES)[keyof typeof COMMAND_TYPES];
export type StatusType = (typeof STATUS_TYPES)[keyof typeof STATUS_TYPES];
export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];
