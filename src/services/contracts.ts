import type {
  ApplicationLog,
  AuthProvider,
  AuthSession,
  BankAccount,
  GroupActivitySnapshot,
  GmailSyncState,
  Group,
  GroupGoalStartDay,
  MyGroupSummary,
  PendingGroupInvite,
  LeaderboardEntry,
  MemberProgress,
  PlatformConfig,
  SettlementCycle,
  SettlementResult,
  User,
  Wallet,
  WeekWindow,
  ActivityItem
} from "../domain/types";

export interface AuthService {
  getSession(): Promise<AuthSession | null>;
  getCurrentUser(): Promise<User | null>;
  updateProfile(input: {
    firstName: string;
    lastName: string;
    email: string;
    avatarUrl?: string | null;
  }): Promise<User>;
  loginWithGoogle(email?: string): Promise<AuthSession>;
  registerWithGoogle(email?: string): Promise<AuthSession>;
  loginWithPassword(email: string, password: string): Promise<AuthSession>;
  registerWithEmail(input: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }): Promise<AuthSession>;
  logout(): Promise<void>;
}

export interface GroupService {
  getCurrentGroup(): Promise<Group>;
  getMyGroups(): Promise<MyGroupSummary[]>;
  getGroupById(groupId: string): Promise<MyGroupSummary>;
  getGroupActivity(groupId: string): Promise<GroupActivitySnapshot>;
  createGroup(input: {
    name: string;
    applicationGoal: number;
    stakeUsd: number;
    goalCycle: "daily" | "weekly" | "biweekly";
    goalStartDay: GroupGoalStartDay;
    inviteEmails: string[];
    inviteCode?: string;
  }): Promise<{ group: MyGroupSummary; invitesCreated: number }>;
  checkUserExistsByEmail(email: string): Promise<boolean>;
  updateGroupSettings(input: {
    groupId: string;
    applicationGoal: number;
    stakeUsd: number;
    goalCycle: "daily" | "weekly" | "biweekly";
    goalStartDay: GroupGoalStartDay;
  }): Promise<MyGroupSummary>;
  getPendingInvites(): Promise<PendingGroupInvite[]>;
  respondToInvite(inviteId: string, action: "accept" | "reject"): Promise<MyGroupSummary | null>;
  getMembers(): Promise<User[]>;
  getMemberProgress(weekId: string): Promise<MemberProgress[]>;
  getLeaderboard(weekId: string): Promise<LeaderboardEntry[]>;
  getActivityFeed(): Promise<ActivityItem[]>;
  updateGoal(input: { weeklyGoal: number; adminGoalNote?: string }): Promise<Group>;
  updateGroupName(name: string): Promise<Group>;
  joinWithInviteCode(inviteCode: string): Promise<MyGroupSummary>;
  regenerateInviteCode(groupId: string): Promise<MyGroupSummary>;
  deleteGroup(groupId: string): Promise<void>;
  updateMemberApplicationCount(input: {
    groupId: string;
    memberId: string;
    delta?: number;
    applicationsCount?: number;
  }): Promise<{ memberId: string; applicationsCount: number }>;
}

export interface ApplicationService {
  getCurrentWeekWindow(): Promise<WeekWindow>;
  getLogsForWeek(weekId: string): Promise<ApplicationLog[]>;
  createManualLog(input: {
    company: string;
    roleTitle: string;
    note?: string;
  }): Promise<ApplicationLog>;
  updateManualLog(
    id: string,
    input: { company: string; roleTitle: string; note?: string }
  ): Promise<ApplicationLog>;
  deleteLog(id: string): Promise<void>;
  getGmailSyncState(): Promise<GmailSyncState>;
  connectGmail(): Promise<GmailSyncState>;
  syncGmailNow(): Promise<{ state: GmailSyncState; created: ApplicationLog[] }>;
}

export interface WalletService {
  getWallet(): Promise<Wallet>;
  addBankAccount(input: {
    bankName: string;
    accountType: "checking" | "savings";
    accountNumber: string;
    routingNumber: string;
    nickname?: string;
  }): Promise<BankAccount>;
  withdraw(input: { amountCents: number; bankAccountId: string }): Promise<Wallet>;
}

export interface SettlementService {
  getCurrentCycle(): Promise<SettlementCycle>;
  getHistory(): Promise<SettlementResult[]>;
  simulateSettlementNow(): Promise<SettlementResult>;
}

export interface ConfigService {
  getPlatformConfig(): Promise<PlatformConfig>;
}

export interface ServiceContainer {
  authService: AuthService;
  groupService: GroupService;
  applicationService: ApplicationService;
  walletService: WalletService;
  settlementService: SettlementService;
  configService: ConfigService;
}

export function buildFakeToken(email: string, provider: AuthProvider): string {
  return `${provider}-${email.replace(/[^a-zA-Z0-9]/g, "")}-${Date.now()}`;
}
