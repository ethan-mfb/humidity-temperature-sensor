// What the application needs from the outside world. Infrastructure provides
// implementations; the application never imports them directly.

export type Unsubscribe = () => void;

export type ServiceWorkerHandlers = Readonly<{
  onUpdateFound: () => void;
  onOfflineReady: () => void;
}>;

export type ServiceWorkerPort = Readonly<{
  register: (handlers: ServiceWorkerHandlers) => void;
  // Activates the waiting service worker and reloads onto it. Rejects if it
  // cannot.
  activateUpdate: () => Promise<void>;
}>;

export type InstallOutcome = "accepted" | "dismissed";

export type InstallPromptHandlers = Readonly<{
  onInstallAvailable: () => void;
  onInstalled: () => void;
}>;

export type InstallPromptPort = Readonly<{
  subscribe: (handlers: InstallPromptHandlers) => Unsubscribe;
  // Shows the browser's install prompt. Rejects if none is available.
  promptInstall: () => Promise<InstallOutcome>;
}>;
