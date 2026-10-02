import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createGreeting } from "../../../domain/greeting";
import { HelloWorld } from "./HelloWorld";

describe("HelloWorld", () => {
  it("shows the greeting as the page heading", () => {
    render(<HelloWorld greeting={createGreeting("World")} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Hello, World!" }),
    ).toBeInTheDocument();
  });
});
