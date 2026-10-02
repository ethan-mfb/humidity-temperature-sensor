import { describe, expect, it } from "vitest";
import { DEFAULT_AUDIENCE, createGreeting } from "./greeting";

describe("createGreeting", () => {
  it("greets the given audience", () => {
    expect(createGreeting("Pi").message).toBe("Hello, Pi!");
  });

  it("trims whitespace around the audience", () => {
    expect(createGreeting("  Pi  ").message).toBe("Hello, Pi!");
  });

  it("falls back to the default audience when given a blank one", () => {
    expect(createGreeting("   ").message).toBe(`Hello, ${DEFAULT_AUDIENCE}!`);
  });

  it("returns a frozen value", () => {
    expect(Object.isFrozen(createGreeting("Pi"))).toBe(true);
  });
});
