import type { Unsubscribe } from "./ports";

export type Reducer<State, Event> = (state: State, event: Event) => State;

export type Store<State, Event> = Readonly<{
  getState: () => State;
  dispatch: (event: Event) => void;
  subscribe: (listener: () => void) => Unsubscribe;
}>;

// A minimal Redux-style store: state only changes by reducing dispatched
// events, and listeners hear about it when it does.
export function createStore<State, Event>(
  reducer: Reducer<State, Event>,
  initialState: State,
): Store<State, Event> {
  const box = { state: initialState };
  const listeners = new Set<() => void>();

  return Object.freeze({
    getState: () => box.state,
    dispatch: (event: Event) => {
      const next = reducer(box.state, event);
      if (Object.is(next, box.state)) return;
      box.state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
}
