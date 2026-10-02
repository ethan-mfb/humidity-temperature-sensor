import { describe, it, expect } from "vitest";
import { getDirname, getFilename, resolveFromModule } from "./dirname.js";

describe("dirname utilities", () => {
  it("should provide getDirname function", () => {
    expect(typeof getDirname).toBe("function");
  });

  it("should provide getFilename function", () => {
    expect(typeof getFilename).toBe("function");
  });

  it("should provide resolveFromModule function", () => {
    expect(typeof resolveFromModule).toBe("function");
  });

  it("should get dirname from import.meta.url", () => {
    const dirname = getDirname(import.meta.url);
    expect(dirname).toBeTruthy();
    expect(typeof dirname).toBe("string");
    expect(dirname.endsWith("src")).toBe(true);
  });

  it("should get filename from import.meta.url", () => {
    const filename = getFilename(import.meta.url);
    expect(filename).toBeTruthy();
    expect(typeof filename).toBe("string");
    expect(filename.endsWith("dirname.test.ts")).toBe(true);
  });

  it("should resolve path from module", () => {
    const resolved = resolveFromModule(import.meta.url, "./gpioPinService");
    expect(resolved).toBeTruthy();
    expect(typeof resolved).toBe("string");
    expect(resolved).toContain("gpioPinService");
  });
});
