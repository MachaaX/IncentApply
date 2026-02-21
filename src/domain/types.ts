export type Role = "owner" | "admin" | "member";

export type AuthProvider = "google" | "password";

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl?: string;
  timezone: string;
  role: Role;
  walletId: string;
  groupId: string;
}

export interface AuthSession {
  userId: string;
  token: string;
  provider: AuthProvider;
  expiresAt: string;
}

export interface GroupSizeLimits {
  minMembers: number;
  maxMembers: number;
}

export interface WeekConfig {
  timezone: string;
  weekStartsOn: "friday";
  weekEndsOn: "friday";
}

export interface GroupRules {
  weeklyWindow: "friday_to_friday";
  goalType: "shared_threshold";
  stakeEditableByGroupAdmin: false;
  baseStakeCents: number;
  goalLockedStakeCents: number;
  penaltyDistribution: "all_members_equal";
}

export interface Group {
  id: string;
  name: string;
  timezone: string;
  weeklyGoal: number;
  adminGoalNote?: string;
  inviteCode: string;
  ownerUserId: string;
  memberIds: string[];
  sizeLimits: GroupSizeLimits;
  weekConfig: WeekConfig;
  rules: GroupRules;
}

export type GroupGoalCycle = "daily" | "weekly" | "biweekly";
export type GroupGoalStartDay =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";
export type GroupMemberRole = "admin" | "member";
export type GroupMemberProgressStatus = "crushing" | "on_track" | "at_risk" | "slow_start";

export interface MyGroupSummary {
  id: string;
  name: string;
  applicationGoal: number;
  stakeUsd: number;
  goalCycle: GroupGoalCycle;
  goalStartDay: GroupGoalStartDay;
  myRole: GroupMemberRole;
  weeklyGoal: number;
  weeklyStakeUsd: number;
  ownerUserId: string;
  ownerName: string;
  inviteCode: string;
  inviteCodeExpiresAt: string;
  createdAt: string;
}

export interface GroupCycleWindow {
  key: string;
  label: "day" | "week" | "biweekly";
  startsAt: string;
  endsAt: string;
}

export interface GroupActivityMember {
  userId: string;
  name: string;
  email: string;
  role: GroupMemberRole;
  avatarUrl?: string | null;
  isCurrentUser: boolean;
  applicationsCount: number;
  goal: number;
  status: GroupMemberProgressStatus;
}

export interface GroupActivitySnapshot {
  group: MyGroupSummary;
  cycle: GroupCycleWindow;
  members: GroupActivityMember[];
}

export interface PendingGroupInvite {
  id: string;
  groupId: string;
  groupName: string;
  invitedBy: string;
  goalCycle: GroupGoalCycle;
  goalStartDay: GroupGoalStartDay;
  applicationGoal: number;
  stakeUsd: number;
  goalApps: number;
  weeklyStakeUsd: number;
  inviteCode: string;
  expiresAt: string;
  createdAt: string;
}

export interface MemberProgress {
  userId: string;
  weekId: string;
  goal: number;
  applicationsSent: number;
  status: "met_goal" | "on_track" | "at_risk";
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  applicationsSent: number;
  goal: number;
  progressPercent: number;
  statusLabel: string;
  isCurrentUser: boolean;
}

export type ApplicationSource = "gmail" | "manual";

export interface ApplicationLog {
  id: string;
  userId: string;
  groupId: string;
  source: ApplicationSource;
  company: string;
  roleTitle: string;
  emailSubject?: string;
  emailFrom?: string;
  timestamp: string;
  note?: string;
  matchedRuleId?: string;
  isCounted: boolean;
}

export interface CounterApplicationLog {
  id: string;
  userId: string;
  groupId: string;
  groupName: string;
  goalCycle: GroupGoalCycle;
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

export interface GmailSyncState {
  userId: string;
  connected: boolean;
  status: "idle" | "syncing" | "success" | "error";
  lastSyncedAt?: string;
  matchedCount: number;
  error?: string;
}

export type TransactionType =
  | "deposit"
  | "stake_contribution"
  | "base_return"
  | "goal_return"
  | "penalty_loss"
  | "penalty_share"
  | "withdrawal"
  | "adjustment";

export interface Transaction {
  id: string;
  userId: string;
  groupId: string;
  weekId: string;
  type: TransactionType;
  amountCents: number;
  description: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
}

export interface BankAccount {
  id: string;
  userId: string;
  bankName: string;
  accountType: "checking" | "savings";
  last4: string;
  routingMasked: string;
  nickname?: string;
  isPrimary: boolean;
}

export interface Wallet {
  id: string;
  userId: string;
  availableBalanceCents: number;
  pendingBalanceCents: number;
  totalContributedCents: number;
  totalPenaltiesCents: number;
  totalWithdrawnCents: number;
  transactions: Transaction[];
  bankAccounts: BankAccount[];
}

export interface SettlementCycle {
  id: string;
  groupId: string;
  weekId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: "scheduled" | "processing" | "completed";
  triggeredBy: "auto" | "manual";
}

export interface MemberSettlementBreakdown {
  userId: string;
  applicationsSent: number;
  goal: number;
  metGoal: boolean;
  baseContributionCents: number;
  goalLockedContributionCents: number;
  baseReturnCents: number;
  goalReturnCents: number;
  penaltyLostCents: number;
  penaltyShareCents: number;
  netCents: number;
}

export interface SettlementResult {
  cycleId: string;
  groupId: string;
  weekId: string;
  totalMembers: number;
  totalPenaltyPoolCents: number;
  penaltySharePerMemberCents: number;
  breakdowns: MemberSettlementBreakdown[];
  completedAt: string;
}

export interface KeywordRule {
  id: string;
  label: string;
  enabled: boolean;
  senderIncludes: string[];
  subjectIncludes: string[];
}

export interface PlatformConfig {
  currency: "USD";
  timezoneDefault: string;
  stakeSplit: {
    baseStakeCents: number;
    goalLockedStakeCents: number;
  };
  keywordRules: KeywordRule[];
}

export interface ActivityItem {
  id: string;
  groupId: string;
  userId: string;
  kind: "application" | "warning" | "settlement";
  message: string;
  createdAt: string;
}

export interface MockState {
  users: User[];
  session: AuthSession | null;
  group: Group;
  wallets: Wallet[];
  gmailSyncStates: GmailSyncState[];
  applicationLogs: ApplicationLog[];
  counterApplicationLogs: CounterApplicationLog[];
  settlementCycles: SettlementCycle[];
  settlementResults: SettlementResult[];
  activities: ActivityItem[];
  platformConfig: PlatformConfig;
}

export interface WeekWindow {
  weekId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
}

export interface SettlementInputMember {
  userId: string;
  applicationsSent: number;
  goal: number;
}
