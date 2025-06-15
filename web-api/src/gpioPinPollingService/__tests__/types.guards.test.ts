import { describe, it, expect } from "vitest";
import { isGpioPollingCommand } from "../types.guards.js";

describe("isGpioPollingCommand", () => {
  it("returns true for valid start command", () => {
    expect(isGpioPollingCommand({ type: "start", pin: 1 })).toBe(true);
  });
  it("returns true for valid stop command", () => {
    expect(isGpioPollingCommand({ type: "stop" })).toBe(true);
  });
  it("returns false for missing type", () => {
    expect(isGpioPollingCommand({ pin: 1 })).toBe(false);
  });
  it("returns false for invalid type", () => {
    expect(isGpioPollingCommand({ type: "foo" })).toBe(false);
  });
  it("returns false for start with missing pin", () => {
    expect(isGpioPollingCommand({ type: "start" })).toBe(false);
  });
  it("returns false for non-object", () => {
    expect(isGpioPollingCommand(null)).toBe(false);
    expect(isGpioPollingCommand(42)).toBe(false);
    expect(isGpioPollingCommand("start")).toBe(false);
  });
});
