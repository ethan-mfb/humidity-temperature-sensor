import { describe, expect, it } from "vitest";
import { bem } from "./bem";

describe("bem", () => {
  it("names a block", () => {
    expect(bem("button")).toBe("button");
  });

  it("names an element of a block", () => {
    expect(bem("menu", "item")).toBe("menu__item");
  });

  it("keeps the base class and adds each active modifier", () => {
    expect(bem("button", undefined, { primary: true, disabled: false })).toBe(
      "button button--primary",
    );
  });

  it("modifies an element", () => {
    expect(bem("banner", "button", { busy: true })).toBe(
      "banner__button banner__button--busy",
    );
  });
});
