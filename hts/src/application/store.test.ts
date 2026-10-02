import { describe, expect, it, vi } from "vitest";
import { createStore } from "./store";

type CounterEvent = { type: "increment" } | { type: "reset" };

const counter = (state: number, event: CounterEvent): number =>
  event.type === "increment" ? state + 1 : 0;

describe("createStore", () => {
  it("starts with the initial state", () => {
    expect(createStore(counter, 0).getState()).toBe(0);
  });

  it("reduces dispatched events into the state", () => {
    const store = createStore(counter, 0);
    store.dispatch({ type: "increment" });
    store.dispatch({ type: "increment" });
    expect(store.getState()).toBe(2);
  });

  it("notifies subscribers when the state changes", () => {
    const store = createStore(counter, 0);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: "increment" });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not notify subscribers when the state is unchanged", () => {
    const store = createStore(counter, 0);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: "reset" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying a subscriber once it unsubscribes", () => {
    const store = createStore(counter, 0);
    const listener = vi.fn();
    store.subscribe(listener)();
    store.dispatch({ type: "increment" });
    expect(listener).not.toHaveBeenCalled();
  });
});
