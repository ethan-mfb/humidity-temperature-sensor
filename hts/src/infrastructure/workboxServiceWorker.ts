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

const text = {
  notRegistered: "The service worker has not been registered",
};

export type WorkboxServiceWorkerOptions = Readonly<{
  registerSW: RegisterSW;
  setInterval?: (callback: () => void, ms: number) => unknown;
}>;

export function createWorkboxServiceWorker(
  options: WorkboxServiceWorkerOptions,
): ServiceWorkerPort {
  const schedule = options.setInterval ?? globalThis.setInterval;
  const state: { updateSW?: (reloadPage?: boolean) => Promise<void> } = {};

  return Object.freeze({
    register: (handlers) => {
      state.updateSW = options.registerSW({
        onNeedRefresh: handlers.onUpdateFound,
        onOfflineReady: handlers.onOfflineReady,
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
    activateUpdate: () =>
      state.updateSW === undefined
        ? Promise.reject(new Error(text.notRegistered))
        : state.updateSW(true),
  });
}
