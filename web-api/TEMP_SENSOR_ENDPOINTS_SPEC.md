# Temp Sensor HTTP Rest Endpoint Specification

## Responsibilities

- Expose REST API endpoints to:
  - Check the status of the GPIO pin polling service
  - Start the polling service
  - Stop the polling service
- Expose an SSE endpoints to:
  - send the current temperature
  - send the current relative humidity
  - the interval at which this data is sent should be configurable
- Ensure all operations are safe (no race conditions, double-start/stop, etc.) and secure (input validation, error handling).
- Use strong TypeScript typing and functional patterns per project standards.
- Use the temp sensor service to implement the endpoints in this controller.
- These endpoints should be put in their own controller module.
