import { indexRequestHandler } from "../indexController.js";
import type { Request, Response } from "express";
import { describe, it, expect, vi } from "vitest";

describe("indexRequestHandler", () => {
  it("responds with the correct message", () => {
    // Arrange: create mock req and res with correct generics
    const req = {} as Request<
      {},
      { message: string },
      undefined,
      undefined,
      Record<string, any>
    >;
    const jsonMock = vi.fn();
    const res = { json: jsonMock } as unknown as Response<
      { message: string },
      Record<string, any>
    >;

    // Act
    indexRequestHandler(req, res);

    // Assert
    expect(jsonMock).toHaveBeenCalledWith({
      message: "Humidity & Temperature Sensor API",
    });
  });
});
