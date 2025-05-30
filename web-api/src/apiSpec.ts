import type { OpenAPIObject } from "openapi3-ts/oas31";
import { indexRequestPath } from "./indexController.js";
import { version } from "./version.js";

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
  },
};
