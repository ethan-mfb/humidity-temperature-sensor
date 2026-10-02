import type { RegisterSWOptions } from "vite-plugin-pwa/types";
import type { ServiceWorkerPort } from "../application/ports";

// The shape of registerSW from "virtual:pwa-register". It is passed in rather
// than imported so this module can be tested without the vite plugin.
export type RegisterSW = (
  options: RegisterSWOptions,
) => (reloadPage?: boolean) => Promise<void>;

// An installed PWA can stay open for days. Without a periodic check it only
// finds a new version when it is next launched.
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const CONTROLLER_CHANGE = "controllerchange";

const text = {
  notRegistered: "The service worker has not been registered",
};

export type WorkboxServiceWorkerOptions = Readonly<{
  registerSW: RegisterSW;
  // navigator.serviceWorker, where the browser reports a new controller.
  // Undefined where service workers are unsupported, such as plain http.
  serviceWorkerContainer?: EventTarget;
  reload?: () => void;
  setInterval?: (callback: () => void, ms: number) => unknown;
}>;

export function createWorkboxServiceWorker(
  options: WorkboxServiceWorkerOptions,
): ServiceWorkerPort {
  const schedule = options.setInterval ?? globalThis.setInterval;
  const reload = options.reload ?? (() => window.location.reload());
  const state: { updateSW?: (reloadPage?: boolean) => Promise<void> } = {};

  return Object.freeze({
    register: (handlers) => {
      state.updateSW = options.registerSW({
        onNeedRefresh: handlers.onUpdateFound,
        onOfflineReady: handlers.onOfflineReady,
        // The plugin only reloads when the page was already controlled when
        // it loaded, so a first visit would never reload onto an update.
        // activateUpdate reloads instead.
        onNeedReload: () => undefined,
        onRegisteredSW: (_swUrl, registration) => {
          if (registration === undefined) return;
          schedule(() => {
            void registration.update();
          }, UPDATE_CHECK_INTERVAL_MS);
        },
        onRegisterError: (error: unknown) => {
          console.error(error);
        },
      });
    },
    activateUpdate: () => {
      if (state.updateSW === undefined) {
        return Promise.reject(new Error(text.notRegistered));
      }
      options.serviceWorkerContainer?.addEventListener(
        CONTROLLER_CHANGE,
        reload,
        { once: true },
      );
      return state.updateSW();
    },
  });
}
