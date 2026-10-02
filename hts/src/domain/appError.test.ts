import { describe, expect, it } from "vitest";
import { createAppError } from "./appError";

describe("createAppError", () => {
  it("keeps the message and the causing value", () => {
    const cause = new Error("boom");
    const error = createAppError("Could not update", cause);
    expect(error.message).toBe("Could not update");
    expect(error.cause).toBe(cause);
  });

  it("captures a call stack", () => {
    expect(createAppError("Could not update", "boom").stack).toContain(
      "Could not update",
    );
  });
});
