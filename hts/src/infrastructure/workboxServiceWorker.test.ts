import { describe, expect, it, vi } from "vitest";
import type { RegisterSWOptions } from "vite-plugin-pwa/types";
import type { RegisterSW } from "./workboxServiceWorker";
import {
  UPDATE_CHECK_INTERVAL_MS,
  createWorkboxServiceWorker,
} from "./workboxServiceWorker";

const handlers = { onUpdateFound: vi.fn(), onOfflineReady: vi.fn() };

function createFakeRegisterSW(): {
  registerSW: RegisterSW;
  options: () => RegisterSWOptions;
  updateSW: ReturnType<typeof vi.fn>;
} {
  const updateSW = vi.fn(() => Promise.resolve());
  const captured: { options?: RegisterSWOptions } = {};
  const registerSW: RegisterSW = (options) => {
    captured.options = options;
    return updateSW;
  };
  return {
    registerSW,
    updateSW,
    options: () => {
      if (captured.options === undefined) throw new Error("not registered");
      return captured.options;
    },
  };
}

describe("createWorkboxServiceWorker", () => {
  it("forwards a waiting worker and offline readiness to the handlers", () => {
    const fake = createFakeRegisterSW();
    createWorkboxServiceWorker({ registerSW: fake.registerSW }).register(
      handlers,
    );
    fake.options().onNeedRefresh?.();
    fake.options().onOfflineReady?.();
    expect(handlers.onUpdateFound).toHaveBeenCalledOnce();
    expect(handlers.onOfflineReady).toHaveBeenCalledOnce();
  });

  it("activates the waiting worker and reloads once it takes control", async () => {
    const fake = createFakeRegisterSW();
    const serviceWorkerContainer = new EventTarget();
    const reload = vi.fn();
    const serviceWorker = createWorkboxServiceWorker({
      registerSW: fake.registerSW,
      serviceWorkerContainer,
      reload,
    });
    serviceWorker.register(handlers);
    await serviceWorker.activateUpdate();
    expect(fake.updateSW).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    serviceWorkerContainer.dispatchEvent(new Event("controllerchange"));
    serviceWorkerContainer.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("leaves the reload to the adapter, not the plugin", () => {
    const fake = createFakeRegisterSW();
    createWorkboxServiceWorker({ registerSW: fake.registerSW }).register(
      handlers,
    );
    expect(fake.options().onNeedReload).toEqual(expect.any(Function));
  });

  it("rejects activating an update before registering", async () => {
    const fake = createFakeRegisterSW();
    await expect(
      createWorkboxServiceWorker({
        registerSW: fake.registerSW,
      }).activateUpdate(),
    ).rejects.toThrow();
  });

  it("checks the server for a new version on an interval", () => {
    const fake = createFakeRegisterSW();
    const setInterval = vi.fn();
    const registration = { update: vi.fn(() => Promise.resolve()) };
    createWorkboxServiceWorker({
      registerSW: fake.registerSW,
      setInterval,
    }).register(handlers);
    fake
      .options()
      .onRegisteredSW?.(
        "/sw.js",
        registration as unknown as ServiceWorkerRegistration,
      );
    expect(setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      UPDATE_CHECK_INTERVAL_MS,
    );
    const check = setInterval.mock.calls[0]?.[0] as () => void;
    check();
    expect(registration.update).toHaveBeenCalledOnce();
  });
});
