import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InstallButton } from "./InstallButton";

describe("InstallButton", () => {
  it("renders nothing when the app cannot be installed", () => {
    const { container } = render(
      <InstallButton installable={false} onInstall={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("installs the app when clicked", async () => {
    const onInstall = vi.fn();
    render(<InstallButton installable={true} onInstall={onInstall} />);
    await userEvent.click(screen.getByRole("button", { name: "Install app" }));
    expect(onInstall).toHaveBeenCalledOnce();
  });
});
