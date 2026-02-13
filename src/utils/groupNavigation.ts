const LAST_OPENED_GROUP_STORAGE_KEY = "incentapply_last_opened_group_id";
const LEGACY_LAST_OPENED_GROUP_STORAGE_KEY = "incentapply_selected_mock_group_id";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function getLastOpenedGroupId(): string | undefined {
  if (!canUseStorage()) {
    return undefined;
  }

  return (
    window.localStorage.getItem(LAST_OPENED_GROUP_STORAGE_KEY) ??
    window.localStorage.getItem(LEGACY_LAST_OPENED_GROUP_STORAGE_KEY) ??
    undefined
  );
}

export function setLastOpenedGroupId(groupId: string): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(LAST_OPENED_GROUP_STORAGE_KEY, groupId);
  window.localStorage.setItem(LEGACY_LAST_OPENED_GROUP_STORAGE_KEY, groupId);
}
