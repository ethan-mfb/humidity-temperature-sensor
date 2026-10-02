import type { OpenAPIObject } from "openapi3-ts";
import { indexRequestPath } from "./indexController.js";
import {
  tempSensorRestPaths,
  tempSensorSSEPaths,
} from "./tempSensorController/index.js";
import { version } from "./version.js";

const tempSensorTag = "Temperature Sensor";

const errorSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["checksum", "signal", "range"] },
    message: { type: "string" },
  },
  required: ["type", "message"],
} as const;

const readingSchema = {
  type: "object",
  properties: {
    temperatureC: { type: "number" },
    temperatureF: { type: "number" },
    relativeHumidityPercentage: { type: "number" },
    timestamp: { type: "string", format: "date-time" },
  },
  required: [
    "temperatureC",
    "temperatureF",
    "relativeHumidityPercentage",
    "timestamp",
  ],
} as const;

const internalErrorResponse = {
  description: "Internal server error",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: { error: { type: "string" } },
      },
    },
  },
} as const;

export const openApiSpec: OpenAPIObject = {
  openapi: "3.1.0",
  info: {
    title: "Humidity & Temperature Sensor API",
    version,
    description: "API for accessing humidity and temperature sensor data.",
  },
  servers: [{ url: "http://localhost:3000", description: "Local server" }],
  paths: {
    [indexRequestPath]: {
      get: {
        summary: "Root endpoint",
        operationId: "indexRequestHandler",
        responses: {
          "200": {
            description: "API is running",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { message: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
    [tempSensorRestPaths.status]: {
      get: {
        summary: "Get the temperature sensor status",
        operationId: "getTempSensorStatus",
        tags: [tempSensorTag],
        responses: {
          "200": {
            description: "Current service status and last recorded error",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["running", "stopped"] },
                    lastError: errorSchema,
                  },
                  required: ["status"],
                },
              },
            },
          },
          "500": internalErrorResponse,
        },
      },
    },
    [tempSensorRestPaths.start]: {
      post: {
        summary: "Start the temperature sensor",
        operationId: "startTempSensor",
        tags: [tempSensorTag],
        responses: {
          "204": { description: "Service started" },
          "409": { description: "Service already running" },
          "500": internalErrorResponse,
        },
      },
    },
    [tempSensorRestPaths.stop]: {
      post: {
        summary: "Stop the temperature sensor",
        operationId: "stopTempSensor",
        tags: [tempSensorTag],
        responses: {
          "204": { description: "Service stopped" },
          "409": { description: "Service already stopped" },
          "500": internalErrorResponse,
        },
      },
    },
    [tempSensorSSEPaths.stream]: {
      get: {
        summary: "Stream temperature and humidity readings",
        description:
          "Server-sent event stream emitting `reading` and `error` events.",
        operationId: "streamTempSensorReadings",
        tags: [tempSensorTag],
        parameters: [
          {
            name: "interval",
            in: "query",
            required: false,
            description: "Push interval in milliseconds (100-60000).",
            schema: {
              type: "integer",
              minimum: 100,
              maximum: 60000,
              default: 1000,
            },
          },
        ],
        responses: {
          "200": {
            description: "Event stream of readings and recoverable errors",
            content: {
              "text/event-stream": {
                schema: {
                  oneOf: [readingSchema, errorSchema],
                },
              },
            },
          },
          "400": { description: "Invalid interval parameter" },
        },
      },
    },
  },
};
