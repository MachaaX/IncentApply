import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../app/AuthContext";
import {
  useDismissNotification,
  useMyGroupsList,
  useNotifications,
  usePendingInvites
} from "../hooks/useAppQueries";
import { useServices } from "../hooks/useServices";
import { getLastOpenedGroupId, setLastOpenedGroupId } from "../utils/groupNavigation";

const routeTitle: Record<string, string> = {
  "/my-groups": "My Groups",
  "/group/setup": "Group Setup",
  "/wallet": "My Wallet",
  "/applications": "Applications",
  "/settlements": "Settlements"
};

function getUserInitials(firstName?: string, lastName?: string): string {
  const first = firstName?.trim().charAt(0) ?? "";
  const last = lastName?.trim().charAt(0) ?? "";
  const initials = `${first}${last}`.toUpperCase();
  return initials || "U";
}

function formatNotificationTimestamp(value: string, timeZone?: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone
    }).format(parsed);
  } catch {
    return parsed.toLocaleString();
  }
}

export function TopNav() {
  const queryClient = useQueryClient();
  const { notificationService } = useServices();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const myGroupsQuery = useMyGroupsList();
  const pendingInvitesQuery = usePendingInvites();
  const notificationsQuery = useNotifications();
  const dismissNotificationMutation = useDismissNotification();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const groupMenuRef = useRef<HTMLDivElement | null>(null);
  const isMyGroupsRoute = location.pathname.startsWith("/my-groups");
  const isSettingsRoute = location.pathname.startsWith("/settings");
  const isWalletRoute = location.pathname === "/wallet";
  const currentGroupId = useMemo(() => {
    const match = location.pathname.match(/^\/my-groups\/([^/]+)$/);
    return match ? match[1] : undefined;
  }, [location.pathname]);

  const title = useMemo(() => {
    if (isMyGroupsRoute) {
      return "My Groups";
    }
    return routeTitle[location.pathname] ?? "IncentApply";
  }, [isMyGroupsRoute, location.pathname]);

  const avatarUrl = user?.avatarUrl?.trim();
  const initials = getUserInitials(user?.firstName, user?.lastName);
  const groupLinks = myGroupsQuery.data ?? [];
  const pendingInviteCount = pendingInvitesQuery.data?.length ?? 0;
  const routeGroupId = groupLinks.some((group) => group.id === currentGroupId)
    ? currentGroupId
    : undefined;
  const storedGroupId = getLastOpenedGroupId();
  const activeGroupId =
    routeGroupId ??
    (groupLinks.some((group) => group.id === storedGroupId) ? storedGroupId : undefined) ??
    groupLinks[0]?.id;
  const highlightedGroupId = routeGroupId ?? activeGroupId;
  const notifications = notificationsQuery.data?.notifications ?? [];
  const unreadCount = notifications.reduce(
    (total, entry) => total + (entry.isRead ? 0 : 1),
    0
  );

  const startFreshCreateGroup = () => {
    window.dispatchEvent(new Event("incentapply:create-group-fresh-start"));
    navigate("/my-groups/create");
  };
  const dismissNotification = (notificationId: string) => {
    void dismissNotificationMutation.mutateAsync(notificationId);
  };

  useEffect(() => {
    setNotificationsOpen(false);
    setGroupMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!routeGroupId) {
      return;
    }
    setLastOpenedGroupId(routeGroupId);
  }, [routeGroupId]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!groupMenuRef.current) {
        return;
      }
      if (!groupMenuRef.current.contains(event.target as Node)) {
        setGroupMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    if (!groupMenuOpen) {
      return;
    }
    void myGroupsQuery.refetch();
  }, [groupMenuOpen, myGroupsQuery]);

  useEffect(() => {
    const unsubscribe = notificationService.subscribe(() => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });
    return unsubscribe;
  }, [notificationService, queryClient]);

  const groupsButtonClass = `inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-bold transition-all ${
    groupMenuOpen
      ? "border-primary bg-primary/20 text-white shadow-[0_0_0_1px_rgba(17,212,147,0.35),0_8px_18px_rgba(17,212,147,0.2)]"
      : "border-primary/45 bg-[#18372d] text-primary hover:border-primary hover:bg-primary/15 hover:text-white"
  }`;
  const subPageButtonClass = (active: boolean) =>
    `inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors ${
      active
        ? "border border-primary bg-primary/15 text-primary"
        : "border border-primary/20 bg-surface-dark text-slate-200 hover:border-primary/40 hover:text-white"
    }`;

  return (
    <>
      <header className="sticky top-0 z-10 flex h-20 items-center justify-between border-b border-primary/10 bg-background-dark/85 px-3 backdrop-blur-md sm:px-6">
        {isMyGroupsRoute ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-2 sm:gap-2">
            <div ref={groupMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setGroupMenuOpen((open) => !open)}
                className={groupsButtonClass}
                aria-label="Open my groups list"
                aria-expanded={groupMenuOpen}
              >
                <span>My Groups</span>
                <span
                  className={`material-icons ml-0.5 text-[22px] leading-none text-white transition-transform ${
                    groupMenuOpen ? "rotate-180" : ""
                  }`}
                >
                  arrow_drop_down
                </span>
              </button>

              {groupMenuOpen ? (
                <div className="absolute left-0 top-12 z-40 w-64 overflow-hidden rounded-xl border border-primary/20 bg-surface-dark shadow-2xl">
                  <p className="border-b border-primary/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Your Groups
                  </p>
                  {myGroupsQuery.isLoading ? (
                    <p className="px-3 py-3 text-sm text-slate-400">Loading groups...</p>
                  ) : myGroupsQuery.error ? (
                    <p className="px-3 py-3 text-sm text-secondary-gold">
                      {myGroupsQuery.error instanceof Error
                        ? myGroupsQuery.error.message
                        : "Unable to load groups."}
                    </p>
                  ) : groupLinks.length ? (
                    <ul className="py-1">
                      {groupLinks.map((group) => (
                        <li key={group.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setGroupMenuOpen(false);
                              setLastOpenedGroupId(group.id);
                              navigate(`/my-groups/${group.id}`);
                            }}
                            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                              group.id === highlightedGroupId
                                ? "bg-primary/15 text-primary"
                                : "text-slate-200 hover:bg-primary/10 hover:text-white"
                            }`}
                          >
                            <span>{group.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-3 py-3 text-sm text-slate-400">No groups available.</p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto sm:gap-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={startFreshCreateGroup}
                className={subPageButtonClass(location.pathname === "/my-groups/create")}
              >
                <span className="material-icons text-base">add</span>
                <span className="whitespace-nowrap">Create Group</span>
              </button>

              <Link
                to="/my-groups/join"
                className={subPageButtonClass(location.pathname === "/my-groups/join")}
              >
                <span className="whitespace-nowrap">
                  Join Group{pendingInviteCount > 0 ? ` ${pendingInviteCount}` : ""}
                </span>
              </Link>
            </div>
          </div>
        ) : isSettingsRoute || isWalletRoute ? (
          <div />
        ) : (
          <h1 className="text-xl font-bold text-white">{title}</h1>
        )}
        <div className="ml-2 flex shrink-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setNotificationsOpen((open) => !open)}
            className="relative inline-flex items-center justify-center text-slate-300 transition-colors hover:text-primary"
            aria-label="Open notifications"
            aria-expanded={notificationsOpen}
          >
            <span className="material-icons text-[26px]">notifications</span>
            {unreadCount > 0 ? (
              <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-secondary-gold" />
            ) : null}
          </button>

          <Link
            to="/settings/profile"
            className="inline-flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-primary/30 bg-primary/10 text-sm font-bold text-white transition-colors hover:border-primary"
            aria-label="Open profile settings"
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={`${user?.firstName ?? "User"} ${user?.lastName ?? ""}`.trim()}
                className="h-full w-full object-cover"
              />
            ) : (
              <span>{initials}</span>
            )}
          </Link>
        </div>
      </header>

      {notificationsOpen ? (
        <>
          <button
            type="button"
            aria-label="Close notifications panel"
            onClick={() => setNotificationsOpen(false)}
            className="fixed inset-0 z-20 bg-black/25"
          />
          <aside className="fixed right-4 top-24 z-30 flex max-h-[calc(100dvh-7rem)] w-[min(22rem,calc(100vw-2rem))] flex-col rounded-2xl border border-primary/20 bg-surface-dark p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-white">
                Notifications
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNotificationsOpen(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-primary/20 text-slate-300 hover:text-white"
                  aria-label="Close notifications"
                >
                  <span className="material-icons text-base">close</span>
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {notificationsQuery.isLoading ? (
                <p className="rounded-lg border border-primary/10 bg-background-dark px-3 py-3 text-sm text-slate-400">
                  Loading notifications...
                </p>
              ) : notificationsQuery.error ? (
                <p className="rounded-lg border border-primary/10 bg-background-dark px-3 py-3 text-sm text-secondary-gold">
                  {notificationsQuery.error instanceof Error
                    ? notificationsQuery.error.message
                    : "Unable to load notifications."}
                </p>
              ) : notifications.length ? (
                <ul className="space-y-2">
                  {notifications.map((item) => (
                    <li
                      key={item.id}
                      className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2 ${
                        item.isRead
                          ? "border-primary/10 bg-background-dark/60"
                          : "border-primary/20 bg-background-dark"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className={`text-xs font-semibold uppercase tracking-wide ${item.isRead ? "text-slate-400" : "text-primary"}`}>
                          {item.title}
                        </p>
                        <p className={`mt-1 text-sm ${item.isRead ? "text-slate-400" : "text-slate-100"}`}>
                          {item.message}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatNotificationTimestamp(item.createdAt, user?.timezone)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => dismissNotification(item.id)}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/20 text-slate-300 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Dismiss notification: ${item.title}`}
                        disabled={dismissNotificationMutation.isPending}
                      >
                        <span className="material-icons text-base">close</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-primary/10 bg-background-dark px-3 py-3 text-sm text-slate-400">
                  No notifications.
                </p>
              )}
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}
