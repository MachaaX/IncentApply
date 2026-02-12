import type {
  ActivityItem,
  ApplicationLog,
  AuthSession,
  BankAccount,
  Group,
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
  authProvider?: string | null;
}

interface BackendAuthResponse {
  token: string;
  user: BackendUserProfile;
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

function buildBackendUrl(path: string): string {
  return backendAuthBaseUrl ? `${backendAuthBaseUrl}${path}` : path;
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

function defaultNamesFromEmail(email: string): { firstName: string; lastName: string } {
  const localPart = email.split("@")[0] ?? "member";
  const segments = localPart.split(/[._-]+/).filter(Boolean);

  const normalize = (value: string) =>
    value.length ? `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}` : "";

  const firstName = normalize(segments[0] ?? "Member");
  const lastName = normalize(segments[1] ?? "User");
  return { firstName, lastName };
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
        avatarUrl: profile.avatarUrl ?? existing.avatarUrl
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
    avatarUrl: auth.user.avatarUrl
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

  try {
    const response = await fetch(buildBackendUrl(path), {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      }
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

function getGroup(): Group {
  return getState().group;
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
    throw new Error("An account already exists with this email. Please log in instead.");
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
    setOauthPending();
    const query = new URLSearchParams({
      redirect: "/my-groups",
      mode: "redirect",
      intent
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
      const auth = await backendRequest<BackendAuthResponse>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(input)
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
    return withLatency(getGroup());
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

  async joinWithInviteCode(inviteCode) {
    const state = getState();
    if (state.group.inviteCode.toLowerCase() !== inviteCode.trim().toLowerCase()) {
      throw new Error("Invalid invite code.");
    }
    return withLatency(state.group);
  }
};

const applicationService: ApplicationService = {
  async getCurrentWeekWindow() {
    const group = getGroup();
    return withLatency(getWeekWindow(new Date(), group.timezone));
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
