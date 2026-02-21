import type { MockState } from "../domain/types";
import { createSeedState } from "./data/seed";
import { APP_TIME_ZONE, normalizeTimeZone } from "../utils/timezone";

const STORAGE_KEY = "incentapply-state-v1";

let memoryState: MockState | null = null;

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function normalizeTimezone(state: MockState): MockState {
  const withCounterLogs: MockState = {
    ...state,
    users: state.users.map((user) => ({
      ...user,
      timezone: normalizeTimeZone((user as { timezone?: string }).timezone, APP_TIME_ZONE)
    })),
    counterApplicationLogs: Array.isArray(state.counterApplicationLogs)
      ? state.counterApplicationLogs
      : []
  };

  if (
    withCounterLogs.group.timezone === APP_TIME_ZONE &&
    withCounterLogs.group.weekConfig.timezone === APP_TIME_ZONE &&
    withCounterLogs.platformConfig.timezoneDefault === APP_TIME_ZONE
  ) {
    return withCounterLogs;
  }

  return {
    ...withCounterLogs,
    group: {
      ...withCounterLogs.group,
      timezone: APP_TIME_ZONE,
      weekConfig: {
        ...withCounterLogs.group.weekConfig,
        timezone: APP_TIME_ZONE
      }
    },
    platformConfig: {
      ...withCounterLogs.platformConfig,
      timezoneDefault: APP_TIME_ZONE
    }
  };
}

export function getState(): MockState {
  if (memoryState) {
    return memoryState;
  }

  if (canUseLocalStorage()) {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      memoryState = normalizeTimezone(JSON.parse(raw) as MockState);
      return memoryState;
    }
  }

  memoryState = normalizeTimezone(createSeedState());
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
