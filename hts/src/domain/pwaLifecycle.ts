// The PWA's install and update lifecycle as a pure reducer. Everything the
// service worker and the browser report arrives here as an event, so the
// current state is always the result of replaying those events.

export type UpdateStatus = "current" | "updateAvailable" | "updating";

export type PwaState = Readonly<{
  update: UpdateStatus;
  offlineReady: boolean;
  installable: boolean;
}>;

export type PwaEvent = Readonly<
  | { type: "offlineReady" }
  | { type: "offlineReadyDismissed" }
  | { type: "updateFound" }
  | { type: "updateRequested" }
  | { type: "updateFailed" }
  | { type: "updateDismissed" }
  | { type: "installAvailable" }
  | { type: "installPromptUsed" }
  | { type: "installed" }
>;

export const initialPwaState: PwaState = Object.freeze({
  update: "current",
  offlineReady: false,
  installable: false,
});

export function pwaReducer(state: PwaState, event: PwaEvent): PwaState {
  switch (event.type) {
    case "offlineReady":
      return { ...state, offlineReady: true };
    case "offlineReadyDismissed":
      return { ...state, offlineReady: false };
    case "updateFound":
      return { ...state, update: "updateAvailable" };
    case "updateRequested":
      return state.update === "updateAvailable"
        ? { ...state, update: "updating" }
        : state;
    case "updateFailed":
      return { ...state, update: "updateAvailable" };
    case "updateDismissed":
      return { ...state, update: "current" };
    case "installAvailable":
      return { ...state, installable: true };
    // The browser's install prompt can only be shown once, so whatever the
    // user chose, it is gone until the browser offers a new one.
    case "installPromptUsed":
    case "installed":
      return { ...state, installable: false };
  }
}
