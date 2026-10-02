import { describe, it, expect } from "vitest";
import { getErrorReason } from "./utils";

describe("getErrorReason", () => {
  it("returns the message from an Error object", () => {
    const error = new Error("Test error message");
    const result = getErrorReason(error);
    expect(result).toBe("Test error message");
  });

  it("returns the string if a string is passed", () => {
    const result = getErrorReason("A string error");
    expect(result).toBe("A string error");
  });

  it("returns 'Unknown error' for numbers", () => {
    const result = getErrorReason(42);
    expect(result).toBe("Unknown error");
  });

  it("returns 'Unknown error' for objects that are not Error", () => {
    const result = getErrorReason({ message: "not an Error instance" });
    expect(result).toBe("Unknown error");
  });

  it("returns 'Unknown error' for null", () => {
    const result = getErrorReason(null);
    expect(result).toBe("Unknown error");
  });

  it("returns 'Unknown error' for undefined", () => {
    const result = getErrorReason(undefined);
    expect(result).toBe("Unknown error");
  });

  it("returns the message from a subclass of Error", () => {
    class CustomError extends Error {}
    const error = new CustomError("Custom error message");
    const result = getErrorReason(error);
    expect(result).toBe("Custom error message");
  });
});
