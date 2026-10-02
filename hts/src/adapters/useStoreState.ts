import { useSyncExternalStore } from "react";
import type { Store } from "../application/store";

export function useStoreState<State, Event>(store: Store<State, Event>): State {
  return useSyncExternalStore(store.subscribe, store.getState);
}
