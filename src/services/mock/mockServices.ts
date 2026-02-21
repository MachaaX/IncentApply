import type {
  ActivityItem,
  ApplicationLog,
  AuthSession,
  BankAccount,
  CounterApplicationLog,
  Group,
  GroupActivitySnapshot,
  GroupGoalStartDay,
  MyGroupSummary,
  PendingGroupInvite,
  LeaderboardEntry,
  MemberProgress,
  SettlementCycle,
  SettlementResult,
  User,
  Wallet
} from "../../domain/types";
import { emailsToLogs, generateInboundEmails } from "../../mocks/scenarios/gmail";
import { getState, updateState } from "../../mocks/stateStore";
import type {
  ApplicationService,
  AuthService,
  ConfigService,
  GroupService,
  ServiceContainer,
  SettlementService,
  WalletService
} from "../contracts";
import { calculateSettlement } from "../../utils/settlement";
import { getWeekWindow } from "../../utils/week";
import { maskRouting } from "../../utils/format";
import {
  addUtcCalendarDays,
  APP_TIME_ZONE,
  detectBrowserTimeZone,
  getActiveTimeZone,
  getZonedParts,
  normalizeTimeZone,
  toUtcCalendarDate,
  utcCalendarDateYmd,
  utcCalendarEpoch,
  zonedLocalToUtc
} from "../../utils/timezone";

const simulatedLatencyMs = 120;
const backendTokenStorageKey = "incentapply_backend_token";
const oauthPendingStorageKey = "incentapply_oauth_pending";

type AuthStrategy = "mock" | "hybrid" | "backend";

interface BackendUserProfile {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  timezone?: string | null;
  authProvider?: string | null;
}

interface BackendAuthResponse {
  token: string;
  user: BackendUserProfile;
}

interface BackendGroupSummary {
  id: string;
  name: string;
  applicationGoal: number;
  stakeUsd: number;
  goalCycle: "daily" | "weekly" | "biweekly";
  goalStartDay: GroupGoalStartDay;
  myRole: "admin" | "member";
  weeklyGoal: number;
  weeklyStakeUsd: number;
  ownerUserId: string;
  ownerName: string;
  inviteCode: string;
  inviteCodeExpiresAt: string;
  createdAt: string;
}

interface BackendGroupListResponse {
  groups: BackendGroupSummary[];
}

interface BackendGroupResponse {
  group: BackendGroupSummary;
}

interface BackendCreateGroupResponse {
  group: BackendGroupSummary;
  invitesCreated: number;
}

interface BackendPendingInvite {
  id: string;
  groupId: string;
  groupName: string;
  invitedBy: string;
  goalCycle: "daily" | "weekly" | "biweekly";
  goalStartDay: GroupGoalStartDay;
  applicationGoal: number;
  stakeUsd: number;
  goalApps: number;
  weeklyStakeUsd: number;
  inviteCode: string;
  expiresAt: string;
  createdAt: string;
}

interface BackendPendingInvitesResponse {
  invites: BackendPendingInvite[];
}

interface BackendInviteRejectResponse {
  ok: boolean;
}

interface BackendDeleteGroupResponse {
  ok: boolean;
}

interface BackendUserExistsResponse {
  exists: boolean;
}

interface BackendGroupActivitySnapshot {
  group: BackendGroupSummary;
  cycle: {
    key: string;
    label: "day" | "week" | "biweekly";
    startsAt: string;
    endsAt: string;
  };
  members: Array<{
    userId: string;
    name: string;
    email: string;
    role: "admin" | "member";
    avatarUrl?: string | null;
    isCurrentUser: boolean;
    applicationsCount: number;
    goal: number;
    status: "crushing" | "on_track" | "at_risk" | "slow_start";
  }>;
}

interface BackendMemberCountUpdateResponse {
  memberId: string;
  applicationsCount: number;
}

interface BackendCounterApplicationLog {
  id: string;
  userId: string;
  groupId: string;
  groupName: string;
  goalCycle: "daily" | "weekly" | "biweekly";
  goalStartDay: GroupGoalStartDay;
  applicationGoal: number;
  stakeUsd: number;
  cycleKey: string;
  cycleLabel: "day" | "week" | "biweekly";
  cycleStartsAt: string;
  cycleEndsAt: string;
  applicationIndex: number;
  loggedAt: string;
}

interface BackendCounterApplicationLogsResponse {
  logs: BackendCounterApplicationLog[];
}

class BackendUnavailableError extends Error {}

const configuredStrategy = (import.meta.env.VITE_AUTH_STRATEGY as string | undefined)?.toLowerCase();
const isVitestRuntime =
  (typeof process !== "undefined" && process.env?.VITEST === "true") ||
  import.meta.env.MODE === "test";
const authStrategy: AuthStrategy =
  isVitestRuntime
    ? "mock"
    : configuredStrategy === "mock" ||
        configuredStrategy === "hybrid" ||
        configuredStrategy === "backend"
      ? configuredStrategy
      : "backend";

const configuredBackendAuthBaseUrl = (
  import.meta.env.VITE_AUTH_BACKEND_URL as string | undefined
)?.trim();

const backendAuthBaseUrl = configuredBackendAuthBaseUrl
  ? configuredBackendAuthBaseUrl.replace(/\/$/, "")
  : "";

const localGoalStartDayToIndex: Record<GroupGoalStartDay, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

const localGroupSettingsOverride = new Map<
  string,
  {
    goalCycle: "daily" | "weekly" | "biweekly";
    goalStartDay: GroupGoalStartDay;
    applicationGoal: number;
    stakeUsd: number;
    createdAt: string;
  }
>();

const localManualCycleCounts = new Map<string, number>();

function buildBackendUrl(path: string): string {
  return backendAuthBaseUrl ? `${backendAuthBaseUrl}${path}` : path;
}

function mapBackendGroupSummary(entry: BackendGroupSummary): MyGroupSummary {
  const applicationGoal = Number(entry.applicationGoal ?? entry.weeklyGoal);
  const stakeUsd = Number(entry.stakeUsd ?? entry.weeklyStakeUsd);

  return {
    id: entry.id,
    name: entry.name,
    applicationGoal,
    stakeUsd,
    goalCycle: entry.goalCycle ?? "weekly",
    goalStartDay: entry.goalStartDay ?? "monday",
    myRole: entry.myRole ?? "member",
    weeklyGoal: applicationGoal,
    weeklyStakeUsd: stakeUsd,
    ownerUserId: entry.ownerUserId,
    ownerName: entry.ownerName,
    inviteCode: entry.inviteCode,
    inviteCodeExpiresAt: entry.inviteCodeExpiresAt,
    createdAt: entry.createdAt
  };
}

function mapBackendPendingInvite(entry: BackendPendingInvite): PendingGroupInvite {
  const applicationGoal = Number(entry.applicationGoal ?? entry.goalApps);
  const stakeUsd = Number(entry.stakeUsd ?? entry.weeklyStakeUsd);

  return {
    id: entry.id,
    groupId: entry.groupId,
    groupName: entry.groupName,
    invitedBy: entry.invitedBy,
    goalCycle: entry.goalCycle ?? "weekly",
    goalStartDay: entry.goalStartDay ?? "monday",
    applicationGoal,
    stakeUsd,
    goalApps: applicationGoal,
    weeklyStakeUsd: stakeUsd,
    inviteCode: entry.inviteCode,
    expiresAt: entry.expiresAt,
    createdAt: entry.createdAt
  };
}

function mapBackendGroupActivity(entry: BackendGroupActivitySnapshot): GroupActivitySnapshot {
  return {
    group: mapBackendGroupSummary(entry.group),
    cycle: {
      key: entry.cycle.key,
      label: entry.cycle.label,
      startsAt: entry.cycle.startsAt,
      endsAt: entry.cycle.endsAt
    },
    members: entry.members.map((member) => ({
      userId: member.userId,
      name: member.name,
      email: member.email,
      role: member.role,
      avatarUrl: member.avatarUrl,
      isCurrentUser: Boolean(member.isCurrentUser),
      applicationsCount: Math.max(0, Number(member.applicationsCount ?? 0)),
      goal: Math.max(0, Number(member.goal ?? 0)),
      status: member.status
    }))
  };
}

function shiftIsoTimestampByMs(value: string, deltaMs: number): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Date(parsed.getTime() + deltaMs).toISOString();
}

function normalizeLegacyCounterLogTimezoneDrift(entry: CounterApplicationLog): CounterApplicationLog {
  const startsAt = new Date(entry.cycleStartsAt);
  if (Number.isNaN(startsAt.getTime())) {
    return entry;
  }

  // Counter cycle windows are expected to start at local midnight in app timezone.
  // If older rows are shifted (e.g., +5h), normalize all log timestamps by that drift.
  const zoned = getZonedParts(startsAt, APP_TIME_ZONE);
  let minutesFromMidnight = zoned.hour * 60 + zoned.minute;
  if (minutesFromMidnight > 12 * 60) {
    minutesFromMidnight -= 24 * 60;
  }
  const driftMs = (minutesFromMidnight * 60 + zoned.second) * 1000;

  if (driftMs === 0) {
    return entry;
  }

  return {
    ...entry,
    cycleStartsAt: shiftIsoTimestampByMs(entry.cycleStartsAt, -driftMs),
    cycleEndsAt: shiftIsoTimestampByMs(entry.cycleEndsAt, -driftMs),
    loggedAt: shiftIsoTimestampByMs(entry.loggedAt, -driftMs)
  };
}

function mapBackendCounterApplicationLog(entry: BackendCounterApplicationLog): CounterApplicationLog {
  return normalizeLegacyCounterLogTimezoneDrift({
    id: entry.id,
    userId: entry.userId,
    groupId: entry.groupId,
    groupName: entry.groupName,
    goalCycle: entry.goalCycle ?? "weekly",
    goalStartDay: entry.goalStartDay ?? "monday",
    applicationGoal: Math.max(0, Number(entry.applicationGoal ?? 0)),
    stakeUsd: Math.max(0, Number(entry.stakeUsd ?? 0)),
    cycleKey: entry.cycleKey,
    cycleLabel: entry.cycleLabel,
    cycleStartsAt: entry.cycleStartsAt,
    cycleEndsAt: entry.cycleEndsAt,
    applicationIndex: Math.max(0, Number(entry.applicationIndex ?? 0)),
    loggedAt: entry.loggedAt
  });
}

function getLocalCycleWindow(input: {
  goalCycle: "daily" | "weekly" | "biweekly";
  goalStartDay: GroupGoalStartDay;
  createdAt?: string;
  now?: Date;
}): {
  key: string;
  label: "day" | "week" | "biweekly";
  startsAt: string;
  endsAt: string;
} {
  const timezone = APP_TIME_ZONE;
  const now = input.now ?? new Date();
  const localCalendarDay = toUtcCalendarDate(now, timezone);

  if (input.goalCycle === "daily") {
    const startsAt = zonedLocalToUtc(
      localCalendarDay.getUTCFullYear(),
      localCalendarDay.getUTCMonth() + 1,
      localCalendarDay.getUTCDate(),
      0,
      0,
      0,
      timezone
    );
    const endLocalCalendar = addUtcCalendarDays(localCalendarDay, 1);
    const endsAt = zonedLocalToUtc(
      endLocalCalendar.getUTCFullYear(),
      endLocalCalendar.getUTCMonth() + 1,
      endLocalCalendar.getUTCDate(),
      0,
      0,
      0,
      timezone
    );
    return {
      key: `daily-${utcCalendarDateYmd(localCalendarDay)}`,
      label: "day",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString()
    };
  }

  const startDayIndex = localGoalStartDayToIndex[input.goalStartDay] ?? localGoalStartDayToIndex.monday;
  const offset = (localCalendarDay.getUTCDay() - startDayIndex + 7) % 7;
  let startsAtLocalCalendar = addUtcCalendarDays(localCalendarDay, -offset);
  let durationDays = 7;

  if (input.goalCycle === "biweekly") {
    const anchorDate = toUtcCalendarDate(new Date(input.createdAt ?? Date.now()), timezone);
    const anchorOffset = (anchorDate.getUTCDay() - startDayIndex + 7) % 7;
    const anchorStart = addUtcCalendarDays(anchorDate, -anchorOffset);
    const weekDiff = Math.floor(
      (utcCalendarEpoch(startsAtLocalCalendar) - utcCalendarEpoch(anchorStart)) /
        (7 * 24 * 60 * 60 * 1000)
    );
    if (Math.abs(weekDiff % 2) === 1) {
      startsAtLocalCalendar = addUtcCalendarDays(startsAtLocalCalendar, -7);
    }
    durationDays = 14;
  }

  const endsAtLocalCalendar = addUtcCalendarDays(startsAtLocalCalendar, durationDays);
  const startsAt = zonedLocalToUtc(
    startsAtLocalCalendar.getUTCFullYear(),
    startsAtLocalCalendar.getUTCMonth() + 1,
    startsAtLocalCalendar.getUTCDate(),
    0,
    0,
    0,
    timezone
  );
  const endsAt = zonedLocalToUtc(
    endsAtLocalCalendar.getUTCFullYear(),
    endsAtLocalCalendar.getUTCMonth() + 1,
    endsAtLocalCalendar.getUTCDate(),
    0,
    0,
    0,
    timezone
  );
  return {
    key: `${input.goalCycle}-${utcCalendarDateYmd(startsAtLocalCalendar)}`,
    label: input.goalCycle === "weekly" ? "week" : "biweekly",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString()
  };
}

function withLocalGroupOverrides(summary: MyGroupSummary): MyGroupSummary {
  const override = localGroupSettingsOverride.get(summary.id);
  if (!override) {
    return summary;
  }

  return {
    ...summary,
    applicationGoal: override.applicationGoal,
    weeklyGoal: override.applicationGoal,
    stakeUsd: override.stakeUsd,
    weeklyStakeUsd: override.stakeUsd,
    goalCycle: override.goalCycle,
    goalStartDay: override.goalStartDay,
    createdAt: override.createdAt
  };
}

function localCycleCountMapKey(groupId: string, cycleKey: string, userId: string): string {
  return `${groupId}:${cycleKey}:${userId}`;
}

function statusFromCount(applicationsCount: number, goal: number): "crushing" | "on_track" | "at_risk" | "slow_start" {
  if (goal <= 0) {
    return "slow_start";
  }
  if (applicationsCount >= goal) {
    return "crushing";
  }
  const ratio = applicationsCount / goal;
  if (ratio >= 0.65) {
    return "on_track";
  }
  if (applicationsCount <= 0) {
    return "slow_start";
  }
  return "at_risk";
}

function withLatency<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(value), simulatedLatencyMs);
  });
}

function backendAuthEnabled(): boolean {
  return authStrategy !== "mock";
}

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function getStoredBackendToken(): string | null {
  if (!canUseBrowserStorage()) {
    return null;
  }
  return window.localStorage.getItem(backendTokenStorageKey);
}

function setStoredBackendToken(token: string): void {
  if (!canUseBrowserStorage()) {
    return;
  }
  window.localStorage.setItem(backendTokenStorageKey, token);
}

function clearStoredBackendToken(): void {
  if (!canUseBrowserStorage()) {
    return;
  }
  window.localStorage.removeItem(backendTokenStorageKey);
}

function setOauthPending(): void {
  if (!canUseBrowserStorage()) {
    return;
  }
  window.localStorage.setItem(oauthPendingStorageKey, "1");
}

function clearOauthPending(): void {
  if (!canUseBrowserStorage()) {
    return;
  }
  window.localStorage.removeItem(oauthPendingStorageKey);
}

function throwIfMissing<T>(value: T | undefined | null, message: string): T {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function shouldFallbackToMock(error: unknown): boolean {
  return authStrategy === "hybrid" && error instanceof BackendUnavailableError;
}

function isNotFoundResponse(error: unknown): boolean {
  return error instanceof Error && /status\s*404|not found/i.test(error.message);
}

function defaultNamesFromEmail(email: string): { firstName: string; lastName: string } {
  const localPart = email.split("@")[0] ?? "member";
  const segments = localPart.split(/[._-]+/).filter(Boolean);

  const normalize = (value: string) =>
    value.length ? `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}` : "";

  const firstName = normalize(segments[0] ?? "Member");
  const lastName = normalize(segments[1] ?? "User");
  return { firstName, lastName };
}

function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getClientTimeZone(): string {
  return detectBrowserTimeZone(getActiveTimeZone());
}

function sessionProviderFromAuthProvider(
  provider: BackendUserProfile["authProvider"]
): AuthSession["provider"] {
  if (provider && provider.includes("google")) {
    return "google";
  }
  return "password";
}

function createLocalSession(userId: string, provider: AuthSession["provider"], token: string) {
  const session: AuthSession = {
    userId,
    token,
    provider,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  };

  updateState((current) => ({ ...current, session }));
  return session;
}

function ensureLocalUser(profile: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  timezone?: string | null;
}): User {
  let ensuredUser: User | undefined;

  updateState((current) => {
    const normalizedEmail = profile.email.trim().toLowerCase();
    const existing = current.users.find(
      (user) => user.email.trim().toLowerCase() === normalizedEmail
    );
    const defaults = defaultNamesFromEmail(profile.email);

    if (existing) {
      const updatedUser: User = {
        ...existing,
        firstName: profile.firstName ?? existing.firstName ?? defaults.firstName,
        lastName: profile.lastName ?? existing.lastName ?? defaults.lastName,
        avatarUrl: profile.avatarUrl ?? existing.avatarUrl,
        timezone: normalizeTimeZone(profile.timezone, existing.timezone || APP_TIME_ZONE)
      };
      ensuredUser = updatedUser;

      const alreadyMember = current.group.memberIds.includes(updatedUser.id);
      const needsCapacityIncrease =
        !alreadyMember && current.group.memberIds.length >= current.group.sizeLimits.maxMembers;

      return {
        ...current,
        users: current.users.map((user) => (user.id === updatedUser.id ? updatedUser : user)),
        group: alreadyMember
          ? current.group
          : {
              ...current.group,
              memberIds: [...current.group.memberIds, updatedUser.id],
              sizeLimits: needsCapacityIncrease
                ? {
                    ...current.group.sizeLimits,
                    maxMembers: current.group.memberIds.length + 1
                  }
                : current.group.sizeLimits
            }
      };
    }

    const nextUserId = `user-ext-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const walletId = `wallet-${nextUserId}`;

    const nextUser: User = {
      id: nextUserId,
      firstName: profile.firstName ?? defaults.firstName,
      lastName: profile.lastName ?? defaults.lastName,
      avatarUrl: profile.avatarUrl ?? undefined,
      email: profile.email.trim().toLowerCase(),
      timezone: normalizeTimeZone(profile.timezone, getClientTimeZone()),
      role: "member",
      walletId,
      groupId: current.group.id
    };

    const nextWallet: Wallet = {
      id: walletId,
      userId: nextUserId,
      availableBalanceCents: 0,
      pendingBalanceCents: 0,
      totalContributedCents: 0,
      totalPenaltiesCents: 0,
      totalWithdrawnCents: 0,
      transactions: [],
      bankAccounts: []
    };

    ensuredUser = nextUser;
    const needsCapacityIncrease = current.group.memberIds.length >= current.group.sizeLimits.maxMembers;

    return {
      ...current,
      users: [...current.users, nextUser],
      wallets: [...current.wallets, nextWallet],
      group: {
        ...current.group,
        memberIds: [...current.group.memberIds, nextUserId],
        sizeLimits: needsCapacityIncrease
          ? {
              ...current.group.sizeLimits,
              maxMembers: current.group.memberIds.length + 1
            }
          : current.group.sizeLimits
      },
      gmailSyncStates: [
        ...current.gmailSyncStates,
        {
          userId: nextUserId,
          connected: false,
          status: "idle",
          matchedCount: 0
        }
      ]
    };
  });

  return throwIfMissing(ensuredUser, "Unable to create local user state.");
}

function syncLocalStateFromBackendAuth(auth: BackendAuthResponse): AuthSession {
  setStoredBackendToken(auth.token);
  const user = ensureLocalUser({
    email: auth.user.email,
    firstName: auth.user.firstName,
    lastName: auth.user.lastName,
    avatarUrl: auth.user.avatarUrl,
    timezone: auth.user.timezone
  });

  clearOauthPending();
  return createLocalSession(
    user.id,
    sessionProviderFromAuthProvider(auth.user.authProvider),
    auth.token
  );
}

function consumeTokenFromUrlIfPresent(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  if (!token) {
    return null;
  }

  url.searchParams.delete("token");
  url.searchParams.delete("email");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  return token;
}

type OAuthProvider = "google";
type OAuthIntent = "login" | "signup";

function displayNameForProvider(provider: OAuthProvider): string {
  return provider === "google" ? "Google" : "OAuth";
}

async function backendRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!backendAuthEnabled()) {
    throw new BackendUnavailableError("Backend auth is disabled.");
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6000);
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getStoredBackendToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  try {
    const response = await fetch(buildBackendUrl(path), {
      ...init,
      signal: controller.signal,
      headers
    });

    const payload =
      (await response
        .json()
        .catch(() => null)) as { error?: string } | T | null;

    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload && payload.error
          ? payload.error
          : `Request failed with status ${response.status}.`;
      throw new Error(message);
    }

    return payload as T;
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new BackendUnavailableError("Cannot reach backend auth service.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function restoreSessionFromBackendToken(token: string): Promise<AuthSession> {
  const profile = await backendRequest<{ user: BackendUserProfile }>("/api/auth/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  return syncLocalStateFromBackendAuth({
    token,
    user: profile.user
  });
}

function getCurrentSession(): AuthSession {
  const session = getState().session;
  return throwIfMissing(session, "You must sign in to continue.");
}

function getCurrentUserRecord(): User {
  const state = getState();
  const session = getCurrentSession();
  const user = state.users.find((entry) => entry.id === session.userId);
  return throwIfMissing(user, "Unable to find active user record.");
}

function syncLocalUserProfileFromBackend(profile: BackendUserProfile): User {
  const session = getCurrentSession();
  const normalizedEmail = profile.email.trim().toLowerCase();
  let updatedUser: User | undefined;

  updateState((current) => {
    const currentUser = current.users.find((entry) => entry.id === session.userId);
    if (!currentUser) {
      return current;
    }

    const duplicate = current.users.find(
      (entry) => entry.id !== session.userId && entry.email.trim().toLowerCase() === normalizedEmail
    );
    if (duplicate) {
      throw new Error("An account already exists with this email.");
    }

    updatedUser = {
      ...currentUser,
      firstName: (profile.firstName ?? currentUser.firstName).trim(),
      lastName: (profile.lastName ?? currentUser.lastName).trim(),
      email: normalizedEmail,
      timezone: normalizeTimeZone(profile.timezone, currentUser.timezone),
      avatarUrl:
        profile.avatarUrl === null
          ? undefined
          : profile.avatarUrl === undefined
            ? currentUser.avatarUrl
            : profile.avatarUrl
    };

    return {
      ...current,
      users: current.users.map((entry) => (entry.id === session.userId ? updatedUser! : entry))
    };
  });

  return throwIfMissing(updatedUser, "Unable to find active user record.");
}

function updateLocalUserProfile(input: {
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl?: string | null;
  timezone?: string;
}): User {
  const session = getCurrentSession();
  const trimmedFirstName = input.firstName.trim();
  const trimmedLastName = input.lastName.trim();
  const normalizedEmail = input.email.trim().toLowerCase();

  if (!trimmedFirstName || !trimmedLastName || !normalizedEmail) {
    throw new Error("First name, last name, and email are required.");
  }
  if (!isValidEmailAddress(normalizedEmail)) {
    throw new Error("Please provide a valid email address.");
  }

  let updatedUser: User | undefined;
  updateState((current) => {
    const duplicate = current.users.find(
      (entry) => entry.id !== session.userId && entry.email.trim().toLowerCase() === normalizedEmail
    );
    if (duplicate) {
      throw new Error("An account already exists with this email.");
    }

    const currentUser = current.users.find((entry) => entry.id === session.userId);
    if (!currentUser) {
      return current;
    }

    updatedUser = {
      ...currentUser,
      firstName: trimmedFirstName,
      lastName: trimmedLastName,
      email: normalizedEmail,
      timezone:
        input.timezone === undefined
          ? currentUser.timezone
          : normalizeTimeZone(input.timezone, currentUser.timezone),
      avatarUrl:
        input.avatarUrl === undefined
          ? currentUser.avatarUrl
          : input.avatarUrl === null || input.avatarUrl.trim().length === 0
            ? undefined
            : input.avatarUrl
    };

    return {
      ...current,
      users: current.users.map((entry) => (entry.id === session.userId ? updatedUser! : entry))
    };
  });

  return throwIfMissing(updatedUser, "Unable to find active user record.");
}

function getGroup(): Group {
  return getState().group;
}

function localGroupToSummary(group: Group): MyGroupSummary {
  const owner = getState().users.find((entry) => entry.id === group.ownerUserId);
  const ownerName = owner ? `${owner.firstName} ${owner.lastName}`.trim() : "Group Owner";

  const baseSummary: MyGroupSummary = {
    id: group.id,
    name: group.name,
    applicationGoal: group.weeklyGoal,
    stakeUsd: (group.rules.baseStakeCents + group.rules.goalLockedStakeCents) / 100,
    goalCycle: "weekly",
    goalStartDay: group.weekConfig.weekStartsOn,
    myRole: "admin",
    weeklyGoal: group.weeklyGoal,
    weeklyStakeUsd: (group.rules.baseStakeCents + group.rules.goalLockedStakeCents) / 100,
    ownerUserId: group.ownerUserId,
    ownerName,
    inviteCode: group.inviteCode,
    inviteCodeExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  };

  return withLocalGroupOverrides(baseSummary);
}

function buildLocalGroupActivity(groupId: string): GroupActivitySnapshot {
  const state = getState();
  const summary = localGroupToSummary(state.group);
  if (summary.id !== groupId) {
    throw new Error("Group not found.");
  }

  const cycle = getLocalCycleWindow({
    goalCycle: summary.goalCycle,
    goalStartDay: summary.goalStartDay,
    createdAt: summary.createdAt
  });

  const members = state.users
    .filter((user) => state.group.memberIds.includes(user.id))
    .map((user) => {
      const count = localManualCycleCounts.get(localCycleCountMapKey(groupId, cycle.key, user.id)) ?? 0;
      const isAdmin = user.id === summary.ownerUserId || user.role === "owner" || user.role === "admin";
      const memberRole: "admin" | "member" = isAdmin ? "admin" : "member";
      const name = `${user.firstName} ${user.lastName}`.trim() || user.email;
      return {
        userId: user.id,
        name,
        email: user.email,
        role: memberRole,
        avatarUrl: user.avatarUrl,
        isCurrentUser: user.id === state.session?.userId,
        applicationsCount: count,
        goal: summary.applicationGoal,
        status: statusFromCount(count, summary.applicationGoal)
      };
    });

  return {
    group: summary,
    cycle,
    members
  };
}

function appendLocalCounterApplicationLogs(input: {
  userId: string;
  group: MyGroupSummary;
  cycle: GroupActivitySnapshot["cycle"];
  fromExclusive: number;
  toInclusive: number;
}): void {
  if (input.toInclusive <= input.fromExclusive) {
    return;
  }

  const loggedAt = new Date().toISOString();
  const entries: CounterApplicationLog[] = [];
  for (let index = input.fromExclusive + 1; index <= input.toInclusive; index += 1) {
    entries.push({
      id: `counter-log-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 6)}`,
      userId: input.userId,
      groupId: input.group.id,
      groupName: input.group.name,
      goalCycle: input.group.goalCycle,
      goalStartDay: input.group.goalStartDay,
      applicationGoal: Math.max(0, Number(input.group.applicationGoal ?? 0)),
      stakeUsd: Math.max(0, Number(input.group.stakeUsd ?? 0)),
      cycleKey: input.cycle.key,
      cycleLabel: input.cycle.label,
      cycleStartsAt: input.cycle.startsAt,
      cycleEndsAt: input.cycle.endsAt,
      applicationIndex: index,
      loggedAt
    });
  }

  updateState((current) => ({
    ...current,
    counterApplicationLogs: [...entries, ...current.counterApplicationLogs]
  }));
}

function removeLocalCounterApplicationLogs(input: {
  userId: string;
  groupId: string;
  cycleKey: string;
  count: number;
}): void {
  const removalCount = Math.max(0, Math.floor(Number(input.count) || 0));
  if (removalCount <= 0) {
    return;
  }

  let remaining = removalCount;
  updateState((current) => ({
    ...current,
    counterApplicationLogs: current.counterApplicationLogs.filter((entry) => {
      if (remaining <= 0) {
        return true;
      }
      if (
        entry.userId === input.userId &&
        entry.groupId === input.groupId &&
        entry.cycleKey === input.cycleKey
      ) {
        remaining -= 1;
        return false;
      }
      return true;
    })
  }));
}

function belongsToWeek(log: ApplicationLog, weekId: string, timezone: string): boolean {
  return getWeekWindow(new Date(log.timestamp), timezone).weekId === weekId;
}

function computeProgress(weekId: string): MemberProgress[] {
  const state = getState();
  const currentGroup = state.group;

  return currentGroup.memberIds.map((userId) => {
    const apps = state.applicationLogs.filter(
      (log) =>
        log.userId === userId &&
        log.isCounted &&
        belongsToWeek(log, weekId, currentGroup.timezone)
    ).length;

    const ratio = apps / currentGroup.weeklyGoal;
    const status: MemberProgress["status"] =
      apps >= currentGroup.weeklyGoal ? "met_goal" : ratio >= 0.7 ? "on_track" : "at_risk";

    return {
      userId,
      weekId,
      goal: currentGroup.weeklyGoal,
      applicationsSent: apps,
      status
    };
  });
}

function isAdminOrOwner(user: User): boolean {
  return user.role === "owner" || user.role === "admin";
}

function buildLeaderboard(weekId: string): LeaderboardEntry[] {
  const progress = computeProgress(weekId);
  const currentUserId = getState().session?.userId;

  return progress
    .sort((a, b) => b.applicationsSent - a.applicationsSent)
    .map((item, index) => {
      const percent = Math.round((item.applicationsSent / item.goal) * 100);
      const statusLabel =
        item.status === "met_goal"
          ? "Crushing It"
          : item.status === "on_track"
            ? "On Track"
            : "At Risk";

      return {
        rank: index + 1,
        userId: item.userId,
        applicationsSent: item.applicationsSent,
        goal: item.goal,
        progressPercent: percent,
        statusLabel,
        isCurrentUser: item.userId === currentUserId
      };
    });
}

function appendActivity(state: ReturnType<typeof getState>, item: Omit<ActivityItem, "id">) {
  state.activities.unshift({
    id: `activity-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    ...item
  });
}

function localLoginWithGoogle(email?: string): AuthSession {
  const state = getState();
  const normalizedEmail = (email ?? "").trim().toLowerCase();
  const selectedUser = normalizedEmail
    ? state.users.find((user) => user.email.toLowerCase() === normalizedEmail)
    : state.users[0];

  if (!selectedUser) {
    if (!normalizedEmail) {
      throw new Error("Google account email is required.");
    }
    const created = ensureLocalUser({ email: normalizedEmail });
    return createLocalSession(created.id, "google", `google-${Date.now()}`);
  }

  return createLocalSession(selectedUser.id, "google", `google-${Date.now()}`);
}

function localRegisterWithGoogle(email?: string): AuthSession {
  const normalizedEmail = (email ?? "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("Google account email is required.");
  }

  const existing = getState().users.find((user) => user.email.toLowerCase() === normalizedEmail);
  if (existing) {
    return createLocalSession(existing.id, "google", `google-${Date.now()}`);
  }

  const created = ensureLocalUser({ email: normalizedEmail });
  return createLocalSession(created.id, "google", `google-${Date.now()}`);
}

function localLoginWithPassword(email: string, password: string): AuthSession {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const user = getState().users.find(
    (entry) => entry.email.toLowerCase() === email.toLowerCase()
  );
  if (!user) {
    throw new Error("No account found with that email.");
  }

  return createLocalSession(user.id, "password", `password-${Date.now()}`);
}

function localRegisterWithEmail(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): AuthSession {
  if (input.password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const exists = getState().users.some(
    (entry) => entry.email.toLowerCase() === input.email.toLowerCase()
  );
  if (exists) {
    throw new Error("An account with this email already exists.");
  }

  const nextUserId = `user-${Date.now()}`;
  const walletId = `wallet-${nextUserId}`;

  const nextUser: User = {
    id: nextUserId,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    timezone: getClientTimeZone(),
    role: "member",
    walletId,
    groupId: getState().group.id
  };

  const nextWallet: Wallet = {
    id: walletId,
    userId: nextUserId,
    availableBalanceCents: 0,
    pendingBalanceCents: 0,
    totalContributedCents: 0,
    totalPenaltiesCents: 0,
    totalWithdrawnCents: 0,
    transactions: [],
    bankAccounts: []
  };

  updateState((current) => {
    if (current.group.memberIds.length >= current.group.sizeLimits.maxMembers) {
      throw new Error("This group is full. Ask admin to increase max members.");
    }

    return {
      ...current,
      users: [...current.users, nextUser],
      wallets: [...current.wallets, nextWallet],
      group: {
        ...current.group,
        memberIds: [...current.group.memberIds, nextUserId]
      },
      gmailSyncStates: [
        ...current.gmailSyncStates,
        {
          userId: nextUserId,
          connected: false,
          status: "idle",
          matchedCount: 0
        }
      ]
    };
  });

  return createLocalSession(nextUserId, "password", `password-${Date.now()}`);
}

async function loginWithBackendOAuthProvider(
  provider: OAuthProvider,
  intent: OAuthIntent,
  fallback: () => AuthSession
): Promise<AuthSession> {
  if (!backendAuthEnabled()) {
    return withLatency(fallback());
  }

  try {
    const timezone = getClientTimeZone();
    setOauthPending();
    const query = new URLSearchParams({
      redirect: "/my-groups",
      mode: "redirect",
      intent,
      timezone
    });
    const payload = await backendRequest<{ url: string }>(
      `/api/auth/${provider}/url?${query.toString()}`,
      { method: "GET" }
    );

    if (!payload?.url) {
      throw new Error(`${displayNameForProvider(provider)} sign-in URL was not returned.`);
    }

    window.location.assign(payload.url);
    return new Promise<AuthSession>(() => {});
  } catch (error) {
    clearOauthPending();
    if (shouldFallbackToMock(error)) {
      return withLatency(fallback());
    }
    throw error;
  }
}

const authService: AuthService = {
  async getSession() {
    const existingSession = getState().session;
    if (existingSession) {
      return withLatency(existingSession);
    }

    if (!backendAuthEnabled()) {
      return withLatency(null);
    }

    const callbackToken = consumeTokenFromUrlIfPresent();
    if (callbackToken) {
      setStoredBackendToken(callbackToken);
    }
    const token = callbackToken ?? getStoredBackendToken();
    if (!token) {
      return withLatency(null);
    }

    try {
      const restored = await restoreSessionFromBackendToken(token);
      return withLatency(restored);
    } catch (error) {
      clearStoredBackendToken();
      clearOauthPending();
      if (shouldFallbackToMock(error)) {
        return withLatency(null);
      }
      throw error;
    }
  },

  async getCurrentUser() {
    const state = getState();
    const session = state.session;
    if (!session) {
      return withLatency(null);
    }
    const user = state.users.find((entry) => entry.id === session.userId) ?? null;
    return withLatency(user);
  },

  async updateProfile(input) {
    if (!backendAuthEnabled()) {
      return withLatency(updateLocalUserProfile(input));
    }

    try {
      const payload = await backendRequest<{ user: BackendUserProfile }>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify(input)
      });
      return withLatency(syncLocalUserProfileFromBackend(payload.user));
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        return withLatency(updateLocalUserProfile(input));
      }
      throw error;
    }
  },

  async loginWithGoogle(email) {
    return loginWithBackendOAuthProvider("google", "login", () => localLoginWithGoogle(email));
  },

  async registerWithGoogle(email) {
    return loginWithBackendOAuthProvider("google", "signup", () => localRegisterWithGoogle(email));
  },

  async loginWithPassword(email, password) {
    if (!backendAuthEnabled()) {
      return withLatency(localLoginWithPassword(email, password));
    }

    try {
      const auth = await backendRequest<BackendAuthResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      return withLatency(syncLocalStateFromBackendAuth(auth));
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        return withLatency(localLoginWithPassword(email, password));
      }
      throw error;
    }
  },

  async registerWithEmail(input) {
    if (!backendAuthEnabled()) {
      return withLatency(localRegisterWithEmail(input));
    }

    try {
      const timezone = getClientTimeZone();
      const auth = await backendRequest<BackendAuthResponse>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ ...input, timezone })
      });
      return withLatency(syncLocalStateFromBackendAuth(auth));
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        return withLatency(localRegisterWithEmail(input));
      }
      throw error;
    }
  },

  async logout() {
    clearStoredBackendToken();
    clearOauthPending();
    updateState((current) => ({ ...current, session: null }));
    return withLatency(undefined);
  }
};

const groupService: GroupService = {
  async getCurrentGroup() {
    if (!backendAuthEnabled()) {
      return withLatency(getGroup());
    }

    try {
      const payload = await backendRequest<BackendGroupListResponse>("/api/groups", {
        method: "GET"
      });
      const first = payload.groups[0];
      if (!first) {
        return withLatency(getGroup());
      }
      const summary = mapBackendGroupSummary(first);
      const local = getGroup();
      return withLatency({
        ...local,
        id: summary.id,
        name: summary.name,
        weeklyGoal: summary.weeklyGoal,
        inviteCode: summary.inviteCode,
        ownerUserId: summary.ownerUserId
      });
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        return withLatency(getGroup());
      }
      throw error;
    }
  },

  async getMyGroups() {
    if (!backendAuthEnabled()) {
      return withLatency([localGroupToSummary(getGroup())]);
    }

    try {
      const payload = await backendRequest<BackendGroupListResponse>("/api/groups", {
        method: "GET"
      });
      return withLatency(payload.groups.map((entry) => mapBackendGroupSummary(entry)));
    } catch (error) {
      if (isNotFoundResponse(error)) {
        return withLatency([]);
      }
      if (shouldFallbackToMock(error)) {
        return withLatency([localGroupToSummary(getGroup())]);
      }
      throw error;
    }
  },

  async getGroupById(groupId) {
    if (!backendAuthEnabled()) {
      const groups = [localGroupToSummary(getGroup())];
      const found = groups.find((group) => group.id === groupId) ?? groups[0];
      return withLatency(throwIfMissing(found, "Group not found."));
    }

    try {
      const payload = await backendRequest<BackendGroupResponse>(`/api/groups/${groupId}`, {
        method: "GET"
      });
      return withLatency(mapBackendGroupSummary(payload.group));
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        const groups = [localGroupToSummary(getGroup())];
        const found = groups.find((group) => group.id === groupId) ?? groups[0];
        return withLatency(throwIfMissing(found, "Group not found."));
      }
      throw error;
    }
  },

  async getGroupActivity(groupId) {
    if (!backendAuthEnabled()) {
      return withLatency(buildLocalGroupActivity(groupId));
    }

    try {
      const payload = await backendRequest<BackendGroupActivitySnapshot>(
        `/api/groups/${groupId}/activity`,
        {
          method: "GET"
        }
      );
      return withLatency(mapBackendGroupActivity(payload));
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        return withLatency(buildLocalGroupActivity(groupId));
      }
      throw error;
    }
  },

  async createGroup(input) {
    if (!backendAuthEnabled()) {
      const code = (input.inviteCode?.trim() || "").toUpperCase() ||
        `SQ-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const createdAt = new Date().toISOString();
      const next = updateState((current) => ({
        ...current,
        group: {
          ...current.group,
          id: `group-${Date.now()}`,
          name: input.name,
          weeklyGoal: input.applicationGoal,
          inviteCode: code
        }
      }));
      localGroupSettingsOverride.set(next.group.id, {
        goalCycle: input.goalCycle,
        goalStartDay: input.goalStartDay,
        applicationGoal: input.applicationGoal,
        stakeUsd: input.stakeUsd,
        createdAt
      });

      return withLatency({
        group: localGroupToSummary(next.group),
        invitesCreated: input.inviteEmails.length
      });
    }

    try {
      const payload = await backendRequest<BackendCreateGroupResponse>("/api/groups", {
        method: "POST",
        body: JSON.stringify(input)
      });
      return withLatency({
        group: mapBackendGroupSummary(payload.group),
        invitesCreated: payload.invitesCreated
      });
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        const code = (input.inviteCode?.trim() || "").toUpperCase() ||
          `SQ-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const createdAt = new Date().toISOString();
        const next = updateState((current) => ({
          ...current,
          group: {
            ...current.group,
            id: `group-${Date.now()}`,
            name: input.name,
            weeklyGoal: input.applicationGoal,
            inviteCode: code
          }
        }));
        localGroupSettingsOverride.set(next.group.id, {
          goalCycle: input.goalCycle,
          goalStartDay: input.goalStartDay,
          applicationGoal: input.applicationGoal,
          stakeUsd: input.stakeUsd,
          createdAt
        });

        return withLatency({
          group: localGroupToSummary(next.group),
          invitesCreated: input.inviteEmails.length
        });
      }
      throw error;
    }
  },

  async getPendingInvites() {
    if (!backendAuthEnabled()) {
      return withLatency([]);
    }

    try {
      const payload = await backendRequest<BackendPendingInvitesResponse>(
        "/api/groups/invites/pending",
        {
          method: "GET"
        }
      );
      return withLatency(payload.invites.map((entry) => mapBackendPendingInvite(entry)));
    } catch (error) {
      if (isNotFoundResponse(error)) {
        return withLatency([]);
      }
      if (shouldFallbackToMock(error)) {
        return withLatency([]);
      }
      throw error;
    }
  },

  async checkUserExistsByEmail(email) {
    if (!backendAuthEnabled()) {
      const normalized = email.trim().toLowerCase();
      const exists = getState().users.some(
        (entry) => entry.email.trim().toLowerCase() === normalized
      );
      return withLatency(exists);
    }

    try {
      const encoded = encodeURIComponent(email.trim());
      const payload = await backendRequest<BackendUserExistsResponse>(
        `/api/users/exists?email=${encoded}`,
        {
          method: "GET"
        }
      );
      return withLatency(Boolean(payload.exists));
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        const normalized = email.trim().toLowerCase();
        const exists = getState().users.some(
          (entry) => entry.email.trim().toLowerCase() === normalized
        );
        return withLatency(exists);
      }
      throw error;
    }
  },

  async updateGroupSettings(input) {
    if (!backendAuthEnabled()) {
      const next = updateState((current) => ({
        ...current,
        group: {
          ...current.group,
          weeklyGoal: input.applicationGoal,
          rules: {
            ...current.group.rules,
            baseStakeCents: Math.round(input.stakeUsd * 100)
          }
        }
      }));
      const existing = localGroupSettingsOverride.get(input.groupId);
      localGroupSettingsOverride.set(input.groupId, {
        goalCycle: input.goalCycle,
        goalStartDay: input.goalStartDay,
        applicationGoal: input.applicationGoal,
        stakeUsd: input.stakeUsd,
        createdAt: existing?.createdAt ?? new Date().toISOString()
      });
      return withLatency(localGroupToSummary(next.group));
    }

    try {
      const payload = await backendRequest<BackendGroupResponse>(
        `/api/groups/${input.groupId}/settings`,
        {
          method: "PATCH",
          body: JSON.stringify({
            applicationGoal: input.applicationGoal,
            stakeUsd: input.stakeUsd,
            goalCycle: input.goalCycle,
            goalStartDay: input.goalStartDay
          })
        }
      );
      return withLatency(mapBackendGroupSummary(payload.group));
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        const next = updateState((current) => ({
          ...current,
          group: {
            ...current.group,
            weeklyGoal: input.applicationGoal,
            rules: {
              ...current.group.rules,
              baseStakeCents: Math.round(input.stakeUsd * 100)
            }
          }
        }));
        const existing = localGroupSettingsOverride.get(input.groupId);
        localGroupSettingsOverride.set(input.groupId, {
          goalCycle: input.goalCycle,
          goalStartDay: input.goalStartDay,
          applicationGoal: input.applicationGoal,
          stakeUsd: input.stakeUsd,
          createdAt: existing?.createdAt ?? new Date().toISOString()
        });
        return withLatency(localGroupToSummary(next.group));
      }
      throw error;
    }
  },

  async deleteGroup(groupId) {
    if (!backendAuthEnabled()) {
      return withLatency(undefined);
    }

    try {
      await backendRequest<BackendDeleteGroupResponse>(`/api/groups/${groupId}`, {
        method: "DELETE"
      });
      return withLatency(undefined);
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        return withLatency(undefined);
      }
      throw error;
    }
  },

  async regenerateInviteCode(groupId) {
    if (!backendAuthEnabled()) {
      const code = `SQ-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const next = updateState((current) => ({
        ...current,
        group: {
          ...current.group,
          id: groupId,
          inviteCode: code
        }
      }));
      return withLatency(localGroupToSummary(next.group));
    }

    try {
      const payload = await backendRequest<BackendGroupResponse>(
        `/api/groups/${groupId}/invite-code/regenerate`,
        {
          method: "POST"
        }
      );
      return withLatency(mapBackendGroupSummary(payload.group));
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        const code = `SQ-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const next = updateState((current) => ({
          ...current,
          group: {
            ...current.group,
            id: groupId,
            inviteCode: code
          }
        }));
        return withLatency(localGroupToSummary(next.group));
      }
      throw error;
    }
  },

  async respondToInvite(inviteId, action) {
    if (!backendAuthEnabled()) {
      return withLatency(null);
    }

    try {
      if (action === "accept") {
        const payload = await backendRequest<BackendGroupResponse>(
          `/api/groups/invites/${inviteId}/accept`,
          {
            method: "POST"
          }
        );
        return withLatency(mapBackendGroupSummary(payload.group));
      }

      await backendRequest<BackendInviteRejectResponse>(
        `/api/groups/invites/${inviteId}/reject`,
        {
          method: "POST"
        }
      );
      return withLatency(null);
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        return withLatency(null);
      }
      throw error;
    }
  },

  async getMembers() {
    const state = getState();
    const members = state.users.filter((user) => state.group.memberIds.includes(user.id));
    return withLatency(members);
  },

  async getMemberProgress(weekId) {
    return withLatency(computeProgress(weekId));
  },

  async getLeaderboard(weekId) {
    return withLatency(buildLeaderboard(weekId));
  },

  async getActivityFeed() {
    const activity = [...getState().activities].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return withLatency(activity);
  },

  async updateGoal(input) {
    const user = getCurrentUserRecord();
    if (!isAdminOrOwner(user)) {
      throw new Error("Only admins can update group goals.");
    }

    const next = updateState((current) => ({
      ...current,
      group: {
        ...current.group,
        weeklyGoal: input.weeklyGoal,
        adminGoalNote: input.adminGoalNote
      }
    }));

    return withLatency(next.group);
  },

  async updateGroupName(name) {
    const user = getCurrentUserRecord();
    if (!isAdminOrOwner(user)) {
      throw new Error("Only admins can update group name.");
    }

    const next = updateState((current) => ({
      ...current,
      group: {
        ...current.group,
        name
      }
    }));

    return withLatency(next.group);
  },

  async updateMemberApplicationCount(input) {
    if (!backendAuthEnabled()) {
      const session = getCurrentSession();
      if (session.userId !== input.memberId) {
        throw new Error("You can only update your own application count.");
      }
      const activity = buildLocalGroupActivity(input.groupId);
      const target = activity.members.find((member) => member.userId === input.memberId);
      if (!target) {
        throw new Error("Member not found in this group.");
      }

      const hasAbsolute = Number.isFinite(Number(input.applicationsCount));
      const hasDelta = Number.isFinite(Number(input.delta));
      if (!hasAbsolute && !hasDelta) {
        throw new Error("Provide either applicationsCount or delta.");
      }

      const nextValue = hasAbsolute
        ? Math.max(0, Math.floor(Number(input.applicationsCount)))
        : Math.max(0, target.applicationsCount + Math.floor(Number(input.delta)));

      if (nextValue > target.applicationsCount) {
        appendLocalCounterApplicationLogs({
          userId: input.memberId,
          group: activity.group,
          cycle: activity.cycle,
          fromExclusive: target.applicationsCount,
          toInclusive: nextValue
        });
      } else if (nextValue < target.applicationsCount) {
        removeLocalCounterApplicationLogs({
          userId: input.memberId,
          groupId: input.groupId,
          cycleKey: activity.cycle.key,
          count: target.applicationsCount - nextValue
        });
      }
      localManualCycleCounts.set(
        localCycleCountMapKey(input.groupId, activity.cycle.key, input.memberId),
        nextValue
      );

      return withLatency({
        memberId: input.memberId,
        applicationsCount: nextValue
      });
    }

    try {
      const payload = await backendRequest<BackendMemberCountUpdateResponse>(
        `/api/groups/${input.groupId}/members/${input.memberId}/count`,
        {
          method: "PATCH",
          body: JSON.stringify({
            delta: input.delta,
            applicationsCount: input.applicationsCount
          })
        }
      );
      return withLatency({
        memberId: payload.memberId,
        applicationsCount: Math.max(0, Number(payload.applicationsCount ?? 0))
      });
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        const session = getCurrentSession();
        if (session.userId !== input.memberId) {
          throw new Error("You can only update your own application count.");
        }
        const activity = buildLocalGroupActivity(input.groupId);
        const target = activity.members.find((member) => member.userId === input.memberId);
        if (!target) {
          throw new Error("Member not found in this group.");
        }

        const hasAbsolute = Number.isFinite(Number(input.applicationsCount));
        const hasDelta = Number.isFinite(Number(input.delta));
        if (!hasAbsolute && !hasDelta) {
          throw new Error("Provide either applicationsCount or delta.");
        }

        const nextValue = hasAbsolute
          ? Math.max(0, Math.floor(Number(input.applicationsCount)))
          : Math.max(0, target.applicationsCount + Math.floor(Number(input.delta)));
        if (nextValue > target.applicationsCount) {
          appendLocalCounterApplicationLogs({
            userId: input.memberId,
            group: activity.group,
            cycle: activity.cycle,
            fromExclusive: target.applicationsCount,
            toInclusive: nextValue
          });
        } else if (nextValue < target.applicationsCount) {
          removeLocalCounterApplicationLogs({
            userId: input.memberId,
            groupId: input.groupId,
            cycleKey: activity.cycle.key,
            count: target.applicationsCount - nextValue
          });
        }
        localManualCycleCounts.set(
          localCycleCountMapKey(input.groupId, activity.cycle.key, input.memberId),
          nextValue
        );

        return withLatency({
          memberId: input.memberId,
          applicationsCount: nextValue
        });
      }
      throw error;
    }
  },

  async joinWithInviteCode(inviteCode) {
    if (!backendAuthEnabled()) {
      const state = getState();
      if (state.group.inviteCode.toLowerCase() !== inviteCode.trim().toLowerCase()) {
        throw new Error("Invalid invite code.");
      }
      return withLatency(localGroupToSummary(state.group));
    }

    try {
      const payload = await backendRequest<BackendGroupResponse>("/api/groups/join-code", {
        method: "POST",
        body: JSON.stringify({ inviteCode })
      });
      return withLatency(mapBackendGroupSummary(payload.group));
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        const state = getState();
        if (state.group.inviteCode.toLowerCase() !== inviteCode.trim().toLowerCase()) {
          throw new Error("Invalid invite code.");
        }
        return withLatency(localGroupToSummary(state.group));
      }
      throw error;
    }
  }
};

const applicationService: ApplicationService = {
  async getCurrentWeekWindow() {
    const group = getGroup();
    return withLatency(getWeekWindow(new Date(), group.timezone));
  },

  async getCounterApplicationLogs() {
    const user = getCurrentUserRecord();
    if (!backendAuthEnabled()) {
      const state = getState();
      const logs = state.counterApplicationLogs
        .filter((entry) => entry.userId === user.id)
        .sort((a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime());
      return withLatency(logs);
    }

    try {
      const payload = await backendRequest<BackendCounterApplicationLogsResponse>(
        "/api/applications/counter-logs",
        {
          method: "GET"
        }
      );
      return withLatency(payload.logs.map((entry) => mapBackendCounterApplicationLog(entry)));
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        const state = getState();
        const logs = state.counterApplicationLogs
          .filter((entry) => entry.userId === user.id)
          .sort((a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime());
        return withLatency(logs);
      }
      throw error;
    }
  },

  async getLogsForWeek(weekId) {
    const user = getCurrentUserRecord();
    const state = getState();
    const logs = state.applicationLogs.filter(
      (log) =>
        log.userId === user.id && belongsToWeek(log, weekId, state.group.timezone)
    );
    return withLatency(logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
  },

  async createManualLog(input) {
    const user = getCurrentUserRecord();
    const entry: ApplicationLog = {
      id: `manual-${Date.now()}`,
      userId: user.id,
      groupId: user.groupId,
      source: "manual",
      company: input.company,
      roleTitle: input.roleTitle,
      note: input.note,
      timestamp: new Date().toISOString(),
      isCounted: true
    };

    updateState((current) => {
      appendActivity(current, {
        groupId: current.group.id,
        userId: user.id,
        kind: "application",
        message: `${user.firstName} logged an application for ${input.company}`,
        createdAt: new Date().toISOString()
      });

      return {
        ...current,
        applicationLogs: [entry, ...current.applicationLogs]
      };
    });

    return withLatency(entry);
  },

  async updateManualLog(id, input) {
    const user = getCurrentUserRecord();
    let updated: ApplicationLog | undefined;

    updateState((current) => {
      const nextLogs = current.applicationLogs.map((log) => {
        if (log.id !== id) {
          return log;
        }
        if (log.userId !== user.id || log.source !== "manual") {
          throw new Error("You can edit only your own manual logs.");
        }
        updated = { ...log, ...input };
        return updated;
      });

      return {
        ...current,
        applicationLogs: nextLogs
      };
    });

    return withLatency(throwIfMissing(updated, "Log not found."));
  },

  async deleteLog(id) {
    const user = getCurrentUserRecord();
    updateState((current) => {
      const target = current.applicationLogs.find((log) => log.id === id);
      if (!target) {
        return current;
      }
      if (target.userId !== user.id || target.source !== "manual") {
        throw new Error("You can delete only your own manual logs.");
      }
      return {
        ...current,
        applicationLogs: current.applicationLogs.filter((log) => log.id !== id)
      };
    });
    return withLatency(undefined);
  },

  async getGmailSyncState() {
    const user = getCurrentUserRecord();
    const state = getState();
    const status = state.gmailSyncStates.find((entry) => entry.userId === user.id);
    return withLatency(
      throwIfMissing(status, "No Gmail state found for this user.")
    );
  },

  async connectGmail() {
    const user = getCurrentUserRecord();
    let nextState = throwIfMissing(
      getState().gmailSyncStates.find((entry) => entry.userId === user.id),
      "No Gmail state found for this user."
    );

    updateState((current) => {
      const next = current.gmailSyncStates.map((entry) => {
        if (entry.userId !== user.id) {
          return entry;
        }
        nextState = {
          ...entry,
          connected: true,
          status: "success",
          lastSyncedAt: new Date().toISOString()
        };
        return nextState;
      });
      return { ...current, gmailSyncStates: next };
    });

    return withLatency(nextState);
  },

  async syncGmailNow() {
    const user = getCurrentUserRecord();

    const state = updateState((current) => {
      const sync = current.gmailSyncStates.find((entry) => entry.userId === user.id);
      if (!sync?.connected) {
        throw new Error("Connect your Google account first.");
      }
      return {
        ...current,
        gmailSyncStates: current.gmailSyncStates.map((entry) =>
          entry.userId === user.id ? { ...entry, status: "syncing" } : entry
        )
      };
    });

    const existingLogIds = new Set(
      state.applicationLogs.filter((entry) => entry.userId === user.id).map((entry) => entry.id)
    );

    const inbound = generateInboundEmails(6);
    const created = emailsToLogs({
      emails: inbound,
      userId: user.id,
      groupId: state.group.id,
      existingLogIds,
      rules: state.platformConfig.keywordRules
    });

    const final = updateState((current) => {
      appendActivity(current, {
        groupId: current.group.id,
        userId: user.id,
        kind: "application",
        message: `${user.firstName} synced Gmail (${created.filter((item) => item.isCounted).length} matched)` ,
        createdAt: new Date().toISOString()
      });

      return {
        ...current,
        applicationLogs: [...created, ...current.applicationLogs],
        gmailSyncStates: current.gmailSyncStates.map((entry) =>
          entry.userId === user.id
            ? {
                ...entry,
                status: "success",
                lastSyncedAt: new Date().toISOString(),
                matchedCount: created.filter((item) => item.isCounted).length
              }
            : entry
        )
      };
    });

    const stateRecord = throwIfMissing(
      final.gmailSyncStates.find((entry) => entry.userId === user.id),
      "No Gmail state found for this user."
    );

    return withLatency({
      state: stateRecord,
      created
    });
  }
};

const walletService: WalletService = {
  async getWallet() {
    const user = getCurrentUserRecord();
    const wallet = getState().wallets.find((entry) => entry.userId === user.id);
    return withLatency(throwIfMissing(wallet, "Wallet was not found."));
  },

  async addBankAccount(input) {
    const user = getCurrentUserRecord();
    const digitsOnlyAccount = input.accountNumber.replace(/\D/g, "");
    const digitsOnlyRouting = input.routingNumber.replace(/\D/g, "");

    if (digitsOnlyAccount.length < 4 || digitsOnlyAccount.length > 17) {
      throw new Error("Account number must be between 4 and 17 digits.");
    }

    if (digitsOnlyRouting.length !== 9) {
      throw new Error("Routing number must be 9 digits.");
    }

    const account: BankAccount = {
      id: `bank-${Date.now()}`,
      userId: user.id,
      bankName: input.bankName,
      accountType: input.accountType,
      last4: digitsOnlyAccount.slice(-4),
      routingMasked: maskRouting(digitsOnlyRouting),
      nickname: input.nickname,
      isPrimary: true
    };

    updateState((current) => ({
      ...current,
      wallets: current.wallets.map((wallet) => {
        if (wallet.userId !== user.id) {
          return wallet;
        }

        return {
          ...wallet,
          bankAccounts: [
            account,
            ...wallet.bankAccounts.map((existing) => ({ ...existing, isPrimary: false }))
          ]
        };
      })
    }));

    return withLatency(account);
  },

  async withdraw(input) {
    const user = getCurrentUserRecord();
    let walletResult: Wallet | undefined;

    updateState((current) => {
      const wallets = current.wallets.map((wallet) => {
        if (wallet.userId !== user.id) {
          return wallet;
        }

        const bank = wallet.bankAccounts.find((entry) => entry.id === input.bankAccountId);
        if (!bank) {
          throw new Error("Choose a linked bank account first.");
        }
        if (input.amountCents <= 0) {
          throw new Error("Withdraw amount must be positive.");
        }
        if (wallet.availableBalanceCents < input.amountCents) {
          throw new Error("Insufficient wallet balance.");
        }

        const tx = {
          id: `tx-withdraw-${Date.now()}`,
          userId: user.id,
          groupId: current.group.id,
          weekId: getWeekWindow(new Date(), current.group.timezone).weekId,
          type: "withdrawal" as const,
          amountCents: -input.amountCents,
          description: `Withdrawal to ${bank.bankName} •••• ${bank.last4}`,
          status: "completed" as const,
          createdAt: new Date().toISOString()
        };

        walletResult = {
          ...wallet,
          availableBalanceCents: wallet.availableBalanceCents - input.amountCents,
          totalWithdrawnCents: wallet.totalWithdrawnCents + input.amountCents,
          transactions: [tx, ...wallet.transactions]
        };

        return walletResult;
      });

      return {
        ...current,
        wallets
      };
    });

    return withLatency(throwIfMissing(walletResult, "Wallet was not found."));
  }
};

const settlementService: SettlementService = {
  async getCurrentCycle() {
    const state = getState();
    const window = getWeekWindow(new Date(), state.group.timezone);
    const cycle =
      state.settlementCycles.find((entry) => entry.weekId === window.weekId) ??
      state.settlementCycles[0];

    return withLatency(throwIfMissing(cycle, "No settlement cycle is available."));
  },

  async getHistory() {
    const history = [...getState().settlementResults].sort(
      (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    );
    return withLatency(history);
  },

  async simulateSettlementNow() {
    const user = getCurrentUserRecord();
    if (!isAdminOrOwner(user)) {
      throw new Error("Only admins can simulate settlements.");
    }

    const state = getState();
    const window = getWeekWindow(new Date(), state.group.timezone);
    const progress = computeProgress(window.weekId);

    const cycleId = `cycle-${window.weekId}`;
    const calculation = calculateSettlement({
      groupId: state.group.id,
      cycleId,
      weekId: window.weekId,
      baseStakeCents: state.group.rules.baseStakeCents,
      goalLockedStakeCents: state.group.rules.goalLockedStakeCents,
      members: progress.map((entry) => ({
        userId: entry.userId,
        applicationsSent: entry.applicationsSent,
        goal: entry.goal
      }))
    });

    const result: SettlementResult = {
      ...calculation,
      completedAt: new Date().toISOString()
    };

    const nextCycle: SettlementCycle = {
      id: `cycle-next-${Date.now()}`,
      groupId: state.group.id,
      weekId: getWeekWindow(new Date(new Date(window.endsAt).getTime() + 60 * 60 * 1000), state.group.timezone)
        .weekId,
      startsAt: window.endsAt,
      endsAt: getWeekWindow(new Date(new Date(window.endsAt).getTime() + 60 * 60 * 1000), state.group.timezone).endsAt,
      timezone: state.group.timezone,
      status: "scheduled",
      triggeredBy: "auto"
    };

    updateState((current) => {
      const walletByUserId = new Map(current.wallets.map((wallet) => [wallet.userId, wallet]));

      for (const breakdown of result.breakdowns) {
        const wallet = walletByUserId.get(breakdown.userId);
        if (!wallet) {
          continue;
        }

        const timestamp = new Date().toISOString();
        const weekId = result.weekId;

        const newTransactions = [
          {
            id: `tx-stake-${breakdown.userId}-${Date.now()}`,
            userId: breakdown.userId,
            groupId: current.group.id,
            weekId,
            type: "stake_contribution" as const,
            amountCents: -(breakdown.baseContributionCents + breakdown.goalLockedContributionCents),
            description: "Weekly stake contribution",
            status: "completed" as const,
            createdAt: timestamp
          },
          {
            id: `tx-base-return-${breakdown.userId}-${Date.now()}`,
            userId: breakdown.userId,
            groupId: current.group.id,
            weekId,
            type: "base_return" as const,
            amountCents: breakdown.baseReturnCents,
            description: "Base stake return",
            status: "completed" as const,
            createdAt: timestamp
          },
          {
            id: `tx-goal-return-${breakdown.userId}-${Date.now()}`,
            userId: breakdown.userId,
            groupId: current.group.id,
            weekId,
            type: "goal_return" as const,
            amountCents: breakdown.goalReturnCents,
            description: "Goal-locked return",
            status: "completed" as const,
            createdAt: timestamp
          },
          {
            id: `tx-penalty-share-${breakdown.userId}-${Date.now()}`,
            userId: breakdown.userId,
            groupId: current.group.id,
            weekId,
            type: "penalty_share" as const,
            amountCents: breakdown.penaltyShareCents,
            description: "Penalty pool distribution",
            status: "completed" as const,
            createdAt: timestamp
          }
        ].filter((tx) => tx.amountCents !== 0);

        walletByUserId.set(breakdown.userId, {
          ...wallet,
          availableBalanceCents: wallet.availableBalanceCents + breakdown.netCents,
          totalContributedCents:
            wallet.totalContributedCents +
            breakdown.baseContributionCents +
            breakdown.goalLockedContributionCents,
          totalPenaltiesCents: wallet.totalPenaltiesCents + breakdown.penaltyLostCents,
          transactions: [...newTransactions, ...wallet.transactions]
        });
      }

      appendActivity(current, {
        groupId: current.group.id,
        userId: user.id,
        kind: "settlement",
        message: `Settlement simulated for week ${result.weekId}`,
        createdAt: new Date().toISOString()
      });

      return {
        ...current,
        wallets: [...walletByUserId.values()],
        settlementResults: [result, ...current.settlementResults],
        settlementCycles: [
          ...current.settlementCycles.filter((entry) => entry.weekId !== result.weekId),
          {
            id: cycleId,
            groupId: current.group.id,
            weekId: result.weekId,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            timezone: current.group.timezone,
            status: "completed",
            triggeredBy: "manual"
          },
          nextCycle
        ]
      };
    });

    return withLatency(result);
  }
};

const configService: ConfigService = {
  async getPlatformConfig() {
    return withLatency(getState().platformConfig);
  }
};

export const services: ServiceContainer = {
  authService,
  groupService,
  applicationService,
  walletService,
  settlementService,
  configService
};
