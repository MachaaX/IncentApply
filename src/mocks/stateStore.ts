import type { MockState } from "../domain/types";
import { createSeedState } from "./data/seed";

const STORAGE_KEY = "incentapply-state-v1";

let memoryState: MockState | null = null;

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function getState(): MockState {
  if (memoryState) {
    return memoryState;
  }

  if (canUseLocalStorage()) {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      memoryState = JSON.parse(raw) as MockState;
      return memoryState;
    }
  }

  memoryState = createSeedState();
  persist(memoryState);
  return memoryState;
}

export function persist(state: MockState): void {
  memoryState = state;
  if (canUseLocalStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}

export function updateState(updater: (state: MockState) => MockState): MockState {
  const current = getState();
  const next = updater(structuredClone(current));
  persist(next);
  return next;
}

export function resetState(): MockState {
  const next = createSeedState();
  persist(next);
  return next;
}
