import { describe, expect, it } from "vitest";
import type { PwaEvent, PwaState } from "./pwaLifecycle";
import { initialPwaState, pwaReducer } from "./pwaLifecycle";

const replay = (events: ReadonlyArray<PwaEvent>): PwaState =>
  events.reduce(pwaReducer, initialPwaState);

describe("pwaReducer", () => {
  it("starts current, not installable, not offline ready", () => {
    expect(initialPwaState).toEqual({
      update: "current",
      offlineReady: false,
      installable: false,
    });
  });

  it("marks the app offline ready", () => {
    expect(replay([{ type: "offlineReady" }]).offlineReady).toBe(true);
  });

  it("clears offline ready once acknowledged", () => {
    expect(
      replay([{ type: "offlineReady" }, { type: "offlineReadyDismissed" }])
        .offlineReady,
    ).toBe(false);
  });

  it("flags an update when a new service worker is waiting", () => {
    expect(replay([{ type: "updateFound" }]).update).toBe("updateAvailable");
  });

  it("moves to updating when the user accepts the update", () => {
    expect(
      replay([{ type: "updateFound" }, { type: "updateRequested" }]).update,
    ).toBe("updating");
  });

  it("ignores an update request when no update is available", () => {
    expect(replay([{ type: "updateRequested" }]).update).toBe("current");
  });

  it("returns to available when applying the update fails", () => {
    expect(
      replay([
        { type: "updateFound" },
        { type: "updateRequested" },
        { type: "updateFailed" },
      ]).update,
    ).toBe("updateAvailable");
  });

  it("returns to current when the user dismisses the update", () => {
    expect(
      replay([{ type: "updateFound" }, { type: "updateDismissed" }]).update,
    ).toBe("current");
  });

  it("becomes installable when the browser offers an install", () => {
    expect(replay([{ type: "installAvailable" }]).installable).toBe(true);
  });

  it("stops being installable once installed", () => {
    expect(
      replay([{ type: "installAvailable" }, { type: "installed" }]).installable,
    ).toBe(false);
  });

  it("stops being installable once the install prompt has been used", () => {
    expect(
      replay([{ type: "installAvailable" }, { type: "installPromptUsed" }])
        .installable,
    ).toBe(false);
  });

  it("does not mutate the previous state", () => {
    const before = replay([]);
    pwaReducer(before, { type: "updateFound" });
    expect(before).toEqual(initialPwaState);
  });
});
