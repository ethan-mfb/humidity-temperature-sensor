import type { InstallOutcome, InstallPromptPort } from "../application/ports";

// Chromium's install prompt event. It is not in the DOM typings because it
// is not a web standard.
type BeforeInstallPromptEvent = Event &
  Readonly<{
    prompt: () => Promise<void>;
    userChoice: Promise<Readonly<{ outcome: InstallOutcome }>>;
  }>;

const BEFORE_INSTALL_PROMPT = "beforeinstallprompt";
const APP_INSTALLED = "appinstalled";

const text = {
  noPrompt: "The browser has not offered to install the app",
};

export function createBrowserInstallPrompt(
  target: EventTarget,
): InstallPromptPort {
  const state: { deferred?: BeforeInstallPromptEvent } = {};

  return Object.freeze({
    subscribe: (handlers) => {
      const onBeforeInstallPrompt = (event: Event): void => {
        // Stops the browser's own mini-infobar so the app can offer the
        // install itself.
        event.preventDefault();
        state.deferred = event as BeforeInstallPromptEvent;
        handlers.onInstallAvailable();
      };
      const onAppInstalled = (): void => {
        delete state.deferred;
        handlers.onInstalled();
      };
      target.addEventListener(BEFORE_INSTALL_PROMPT, onBeforeInstallPrompt);
      target.addEventListener(APP_INSTALLED, onAppInstalled);
      return () => {
        target.removeEventListener(
          BEFORE_INSTALL_PROMPT,
          onBeforeInstallPrompt,
        );
        target.removeEventListener(APP_INSTALLED, onAppInstalled);
      };
    },
    promptInstall: async () => {
      const deferred = state.deferred;
      if (deferred === undefined) throw new Error(text.noPrompt);
      delete state.deferred;
      await deferred.prompt();
      const choice = await deferred.userChoice;
      return choice.outcome;
    },
  });
}
