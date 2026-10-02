import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "../../../domain/pwaLifecycle";
import { UpdateBanner } from "./UpdateBanner";

const renderBanner = (
  update: UpdateStatus,
  offlineReady = false,
): {
  onUpdate: ReturnType<typeof vi.fn>;
  onDismissUpdate: ReturnType<typeof vi.fn>;
  onDismissOfflineReady: ReturnType<typeof vi.fn>;
  container: HTMLElement;
} => {
  const handlers = {
    onUpdate: vi.fn(),
    onDismissUpdate: vi.fn(),
    onDismissOfflineReady: vi.fn(),
  };
  const { container } = render(
    <UpdateBanner update={update} offlineReady={offlineReady} {...handlers} />,
  );
  return { ...handlers, container };
};

describe("UpdateBanner", () => {
  it("renders nothing when the app is current and the notice is seen", () => {
    expect(renderBanner("current").container).toBeEmptyDOMElement();
  });

  it("offers a waiting update", async () => {
    const { onUpdate } = renderBanner("updateAvailable");
    expect(screen.getByRole("status")).toHaveTextContent(
      "A new version is available.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("lets the user put the update off", async () => {
    const { onDismissUpdate } = renderBanner("updateAvailable");
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onDismissUpdate).toHaveBeenCalledOnce();
  });

  it("disables the update button while updating", () => {
    renderBanner("updating");
    expect(screen.getByRole("button", { name: "Updating…" })).toBeDisabled();
  });

  it("tells the user the app works offline", async () => {
    const { onDismissOfflineReady } = renderBanner("current", true);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Ready to work offline.",
    );
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onDismissOfflineReady).toHaveBeenCalledOnce();
  });
});
