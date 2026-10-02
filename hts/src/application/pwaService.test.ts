import { describe, expect, it, vi } from "vitest";
import type { PwaEvent } from "../domain/pwaLifecycle";
import type {
  InstallPromptHandlers,
  InstallPromptPort,
  ServiceWorkerHandlers,
  ServiceWorkerPort,
  Unsubscribe,
} from "./ports";
import type { PwaService } from "./pwaService";
import { createPwaService } from "./pwaService";

type Harness = {
  events: Array<PwaEvent>;
  swHandlers: () => ServiceWorkerHandlers;
  installHandlers: () => InstallPromptHandlers;
  unsubscribe: ReturnType<typeof vi.fn>;
  serviceWorker: ServiceWorkerPort;
  installPrompt: InstallPromptPort;
};

function createHarness(
  overrides: Partial<{
    activateUpdate: ServiceWorkerPort["activateUpdate"];
    promptInstall: InstallPromptPort["promptInstall"];
  }> = {},
): Harness {
  const events: Array<PwaEvent> = [];
  const unsubscribe = vi.fn();
  const captured: {
    sw?: ServiceWorkerHandlers;
    install?: InstallPromptHandlers;
  } = {};
  const serviceWorker: ServiceWorkerPort = {
    register: (handlers) => {
      captured.sw = handlers;
    },
    activateUpdate: overrides.activateUpdate ?? (() => Promise.resolve()),
  };
  const installPrompt: InstallPromptPort = {
    subscribe: (handlers) => {
      captured.install = handlers;
      return unsubscribe;
    },
    promptInstall:
      overrides.promptInstall ?? (() => Promise.resolve("accepted" as const)),
  };
  const required = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error("handlers were not registered");
    return value;
  };
  return {
    events,
    swHandlers: () => required(captured.sw),
    installHandlers: () => required(captured.install),
    unsubscribe,
    serviceWorker,
    installPrompt,
  };
}

const start = (
  harness: Harness,
): { service: PwaService; stop: Unsubscribe } => {
  const service = createPwaService({
    serviceWorker: harness.serviceWorker,
    installPrompt: harness.installPrompt,
    dispatch: (event) => harness.events.push(event),
  });
  const stop = service.start();
  return { service, stop };
};

describe("createPwaService", () => {
  it("reports a waiting service worker as an available update", () => {
    const harness = createHarness();
    start(harness);
    harness.swHandlers().onUpdateFound();
    expect(harness.events).toEqual([{ type: "updateFound" }]);
  });

  it("reports when the app has been cached for offline use", () => {
    const harness = createHarness();
    start(harness);
    harness.swHandlers().onOfflineReady();
    expect(harness.events).toEqual([{ type: "offlineReady" }]);
  });

  it("reports install availability and completion", () => {
    const harness = createHarness();
    start(harness);
    harness.installHandlers().onInstallAvailable();
    harness.installHandlers().onInstalled();
    expect(harness.events).toEqual([
      { type: "installAvailable" },
      { type: "installed" },
    ]);
  });

  it("stops listening for install events when stopped", () => {
    const harness = createHarness();
    start(harness).stop();
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  it("requests the update and activates the waiting worker", async () => {
    const activateUpdate = vi.fn(() => Promise.resolve());
    const harness = createHarness({ activateUpdate });
    const result = await start(harness).service.applyUpdate();
    expect(result).toBeUndefined();
    expect(activateUpdate).toHaveBeenCalledOnce();
    expect(harness.events).toEqual([{ type: "updateRequested" }]);
  });

  it("returns an error and reports failure when activation fails", async () => {
    const cause = new Error("activation failed");
    const harness = createHarness({
      activateUpdate: () => Promise.reject(cause),
    });
    const result = await start(harness).service.applyUpdate();
    expect(result).toBeInstanceOf(Error);
    expect(result?.cause).toBe(cause);
    expect(harness.events).toEqual([
      { type: "updateRequested" },
      { type: "updateFailed" },
    ]);
  });

  it("dismisses the update and the offline notice", () => {
    const harness = createHarness();
    const { service } = start(harness);
    service.dismissUpdate();
    service.dismissOfflineReady();
    expect(harness.events).toEqual([
      { type: "updateDismissed" },
      { type: "offlineReadyDismissed" },
    ]);
  });

  it("returns the install outcome and marks the prompt used", async () => {
    const harness = createHarness({
      promptInstall: () => Promise.resolve("dismissed"),
    });
    const result = await start(harness).service.install();
    expect(result).toBe("dismissed");
    expect(harness.events).toEqual([{ type: "installPromptUsed" }]);
  });

  it("returns an error when the install prompt fails", async () => {
    const cause = new Error("no prompt");
    const harness = createHarness({
      promptInstall: () => Promise.reject(cause),
    });
    const result = await start(harness).service.install();
    expect(result).toBeInstanceOf(Error);
    expect(result instanceof Error && result.cause).toBe(cause);
    expect(harness.events).toEqual([{ type: "installPromptUsed" }]);
  });
});
