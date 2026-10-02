import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PwaService } from "../../../application/pwaService";
import { createStore } from "../../../application/store";
import type { PwaEvent, PwaState } from "../../../domain/pwaLifecycle";
import { initialPwaState, pwaReducer } from "../../../domain/pwaLifecycle";
import { App } from "./App";

const createFakeService = (): PwaService => ({
  start: vi.fn(() => () => undefined),
  applyUpdate: vi.fn(() => Promise.resolve(undefined)),
  dismissUpdate: vi.fn(),
  dismissOfflineReady: vi.fn(),
  install: vi.fn(() => Promise.resolve("accepted" as const)),
});

const renderApp = (
  events: ReadonlyArray<PwaEvent> = [],
): {
  service: PwaService;
  store: ReturnType<typeof createStore<PwaState, PwaEvent>>;
} => {
  const store = createStore(pwaReducer, initialPwaState);
  events.forEach(store.dispatch);
  const service = createFakeService();
  render(<App store={store} service={service} version="1.2.3" />);
  return { service, store };
};

describe("App", () => {
  it("says hello", () => {
    renderApp();
    expect(
      screen.getByRole("heading", { level: 1, name: "Hello, World!" }),
    ).toBeInTheDocument();
  });

  it("shows the running version", () => {
    renderApp();
    expect(screen.getByText("v1.2.3")).toBeInTheDocument();
  });

  it("applies an available update", async () => {
    const { service } = renderApp([{ type: "updateFound" }]);
    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(service.applyUpdate).toHaveBeenCalledOnce();
  });

  it("installs when the browser allows it", async () => {
    const { service } = renderApp([{ type: "installAvailable" }]);
    await userEvent.click(screen.getByRole("button", { name: "Install app" }));
    expect(service.install).toHaveBeenCalledOnce();
  });

  it("follows store changes", async () => {
    const { store } = renderApp();
    expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
    store.dispatch({ type: "installAvailable" });
    expect(
      await screen.findByRole("button", { name: "Install app" }),
    ).toBeInTheDocument();
  });
});
