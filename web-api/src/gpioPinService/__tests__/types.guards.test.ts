import { describe, it, expect } from "vitest";
import { isGpioPollingMessage } from "../types.guards.js";

describe("isGpioPollingMessage", () => {
  it("should validate data messages", () => {
    const validData = {
      type: "data",
      payload: {
        pin: 4,
        value: 1,
        timestamp: 1234567890,
      },
    };
    expect(isGpioPollingMessage(validData)).toBe(true);
  });

  it("should reject invalid data messages", () => {
    const invalidData = [
      { type: "data" }, // missing payload
      { type: "data", payload: {} }, // empty payload
      { type: "data", payload: { pin: "4", value: 1, timestamp: 1234567890 } }, // wrong pin type
      { type: "data", payload: { pin: 4, value: "1", timestamp: 1234567890 } }, // wrong value type
      { type: "data", payload: { pin: 4, value: 1, timestamp: "1234567890" } }, // wrong timestamp type
    ];

    invalidData.forEach((data) => {
      expect(isGpioPollingMessage(data)).toBe(false);
    });
  });

  it("should validate error messages", () => {
    const validError = { type: "error", reason: "Test error" };
    expect(isGpioPollingMessage(validError)).toBe(true);
  });

  it("should reject invalid error messages", () => {
    const invalidErrors = [
      { type: "error" }, // missing reason
      { type: "error", reason: 123 }, // wrong reason type
    ];

    invalidErrors.forEach((error) => {
      expect(isGpioPollingMessage(error)).toBe(false);
    });
  });

  it("should validate status messages", () => {
    const validStatuses = [
      { type: "status", status: "started", pin: 4 },
      { type: "status", status: "stopped", pin: 4 },
      { type: "status", status: "exited" },
      { type: "status", status: "started" }, // pin is optional
    ];

    validStatuses.forEach((status) => {
      expect(isGpioPollingMessage(status)).toBe(true);
    });
  });

  it("should reject invalid status messages", () => {
    const invalidStatuses = [
      { type: "status" }, // missing status
      { type: "status", status: "invalid" }, // invalid status
      { type: "status", status: "started", pin: "4" }, // wrong pin type
    ];

    invalidStatuses.forEach((status) => {
      expect(isGpioPollingMessage(status)).toBe(false);
    });
  });

  it("should reject non-objects", () => {
    const nonObjects = [null, undefined, "string", 123, [], true];
    nonObjects.forEach((obj) => {
      expect(isGpioPollingMessage(obj)).toBe(false);
    });
  });

  it("should reject objects without type", () => {
    const withoutType = [{ payload: {} }, { reason: "error" }, { status: "started" }];
    withoutType.forEach((obj) => {
      expect(isGpioPollingMessage(obj)).toBe(false);
    });
  });
});