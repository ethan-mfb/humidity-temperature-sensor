import { createAppError } from "../domain/appError";
import type { PwaEvent } from "../domain/pwaLifecycle";
import type {
  InstallOutcome,
  InstallPromptPort,
  ServiceWorkerPort,
  Unsubscribe,
} from "./ports";

export type PwaService = Readonly<{
  start: () => Unsubscribe;
  applyUpdate: () => Promise<Error | undefined>;
  dismissUpdate: () => void;
  dismissOfflineReady: () => void;
  install: () => Promise<InstallOutcome | Error>;
}>;

export type PwaServiceDependencies = Readonly<{
  serviceWorker: ServiceWorkerPort;
  installPrompt: InstallPromptPort;
  dispatch: (event: PwaEvent) => void;
}>;

const text = {
  updateFailed: "Could not apply the update",
  installFailed: "Could not show the install prompt",
};

export function createPwaService(deps: PwaServiceDependencies): PwaService {
  const start = (): Unsubscribe => {
    deps.serviceWorker.register({
      onUpdateFound: () => deps.dispatch({ type: "updateFound" }),
      onOfflineReady: () => deps.dispatch({ type: "offlineReady" }),
    });
    return deps.installPrompt.subscribe({
      onInstallAvailable: () => deps.dispatch({ type: "installAvailable" }),
      onInstalled: () => deps.dispatch({ type: "installed" }),
    });
  };

  const applyUpdate = async (): Promise<Error | undefined> => {
    deps.dispatch({ type: "updateRequested" });
    try {
      await deps.serviceWorker.activateUpdate();
      return undefined;
    } catch (error: unknown) {
      deps.dispatch({ type: "updateFailed" });
      return createAppError(text.updateFailed, error);
    }
  };

  const install = async (): Promise<InstallOutcome | Error> => {
    try {
      return await deps.installPrompt.promptInstall();
    } catch (error: unknown) {
      return createAppError(text.installFailed, error);
    } finally {
      deps.dispatch({ type: "installPromptUsed" });
    }
  };

  return Object.freeze({
    start,
    applyUpdate,
    dismissUpdate: () => deps.dispatch({ type: "updateDismissed" }),
    dismissOfflineReady: () => deps.dispatch({ type: "offlineReadyDismissed" }),
    install,
  });
}
