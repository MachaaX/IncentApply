const LAST_OPENED_GROUP_STORAGE_KEY = "incentapply_last_opened_group_id";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function getLastOpenedGroupId(): string | undefined {
  if (!canUseStorage()) {
    return undefined;
  }

  return window.localStorage.getItem(LAST_OPENED_GROUP_STORAGE_KEY) ?? undefined;
}

export function setLastOpenedGroupId(groupId: string): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(LAST_OPENED_GROUP_STORAGE_KEY, groupId);
}

export function clearLastOpenedGroupId(): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(LAST_OPENED_GROUP_STORAGE_KEY);
}
