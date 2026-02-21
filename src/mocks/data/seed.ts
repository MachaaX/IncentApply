import type {
  ActivityItem,
  ApplicationLog,
  AuthSession,
  GmailSyncState,
  Group,
  MockState,
  PlatformConfig,
  SettlementCycle,
  SettlementResult,
  Transaction,
  User,
  Wallet
} from "../../domain/types";
import { calculateSettlement } from "../../utils/settlement";
import { getWeekWindow } from "../../utils/week";
import { APP_TIME_ZONE } from "../../utils/timezone";

const timezone = APP_TIME_ZONE;

const platformConfig: PlatformConfig = {
  currency: "USD",
  timezoneDefault: timezone,
  stakeSplit: {
    baseStakeCents: 700,
    goalLockedStakeCents: 700
  },
  keywordRules: [
    {
      id: "rule-workday",
      label: "Workday Confirmation",
      enabled: true,
      senderIncludes: ["workday.com", "myworkdayjobs.com"],
      subjectIncludes: ["application", "thank you for applying", "received"]
    },
    {
      id: "rule-greenhouse",
      label: "Greenhouse Confirmation",
      enabled: true,
      senderIncludes: ["greenhouse.io"],
      subjectIncludes: ["application submitted", "thanks for applying"]
    },
    {
      id: "rule-lever",
      label: "Lever Confirmation",
      enabled: true,
      senderIncludes: ["lever.co"],
      subjectIncludes: ["application received", "thank you for your interest"]
    }
  ]
};

const users: User[] = [
  {
    id: "user-alex",
    firstName: "Alex",
    lastName: "D",
    email: "alex@incentapply.dev",
    timezone,
    role: "owner",
    walletId: "wallet-alex",
    groupId: "group-1"
  },
  {
    id: "user-sarah",
    firstName: "Sarah",
    lastName: "M",
    email: "sarah@incentapply.dev",
    timezone,
    role: "member",
    walletId: "wallet-sarah",
    groupId: "group-1"
  },
  {
    id: "user-marcus",
    firstName: "Marcus",
    lastName: "J",
    email: "marcus@incentapply.dev",
    timezone,
    role: "member",
    walletId: "wallet-marcus",
    groupId: "group-1"
  },
  {
    id: "user-elena",
    firstName: "Elena",
    lastName: "R",
    email: "elena@incentapply.dev",
    timezone,
    role: "member",
    walletId: "wallet-elena",
    groupId: "group-1"
  },
  {
    id: "user-david",
    firstName: "David",
    lastName: "K",
    email: "david@incentapply.dev",
    timezone,
    role: "member",
    walletId: "wallet-david",
    groupId: "group-1"
  }
];

const group: Group = {
  id: "group-1",
  name: "Alpha Squad",
  timezone,
  weeklyGoal: 20,
  adminGoalNote: "Goal aligned in standup. Keep momentum into Friday cutoff.",
  inviteCode: "SQ-882",
  ownerUserId: "user-alex",
  memberIds: users.map((user) => user.id),
  sizeLimits: {
    minMembers: 2,
    maxMembers: 10
  },
  weekConfig: {
    timezone,
    weekStartsOn: "friday",
    weekEndsOn: "friday"
  },
  rules: {
    weeklyWindow: "friday_to_friday",
    goalType: "shared_threshold",
    stakeEditableByGroupAdmin: false,
    baseStakeCents: platformConfig.stakeSplit.baseStakeCents,
    goalLockedStakeCents: platformConfig.stakeSplit.goalLockedStakeCents,
    penaltyDistribution: "all_members_equal"
  }
};

function isoOffset(base: Date, days: number, minutes: number): string {
  const value = new Date(base.getTime() + days * 24 * 60 * 60 * 1000 + minutes * 60 * 1000);
  return value.toISOString();
}

function generateLogs(
  weekStart: Date,
  weekId: string,
  counts: Record<string, number>
): ApplicationLog[] {
  const logs: ApplicationLog[] = [];
  let index = 1;

  for (const [userId, total] of Object.entries(counts)) {
    for (let i = 0; i < total; i += 1) {
      const source = i % 3 === 0 ? "gmail" : "manual";
      const minute = (i * 83) % (7 * 24 * 60 - 120);
      logs.push({
        id: `log-${weekId}-${index}`,
        userId,
        groupId: group.id,
        source,
        company: ["Google", "Netflix", "Stripe", "Notion", "Figma"][i % 5],
        roleTitle: [
          "Frontend Engineer",
          "Full Stack Engineer",
          "Product Engineer",
          "Software Engineer",
          "Platform Engineer"
        ][i % 5],
        emailSubject:
          source === "gmail"
            ? `Application received for role #${i + 1}`
            : undefined,
        emailFrom:
          source === "gmail" ? `careers${i}@workday.com` : undefined,
        timestamp: isoOffset(weekStart, 0, minute),
        note: source === "manual" ? "Manual backfill from networking outreach" : undefined,
        matchedRuleId: source === "gmail" ? "rule-workday" : undefined,
        isCounted: true
      });
      index += 1;
    }
  }

  logs.push({
    id: `log-${weekId}-excluded-1`,
    userId: "user-alex",
    groupId: group.id,
    source: "gmail",
    company: "Spam Corp",
    roleTitle: "Unknown",
    emailSubject: "Newsletter from talent community",
    emailFrom: "newsletter@randommail.com",
    timestamp: isoOffset(weekStart, 1, 30),
    matchedRuleId: undefined,
    isCounted: false
  });

  return logs;
}

function createWallet(userId: string, initialBalanceCents: number): Wallet {
  const now = new Date().toISOString();
  const transactions: Transaction[] = [
    {
      id: `tx-deposit-${userId}`,
      userId,
      groupId: group.id,
      weekId: "bootstrap",
      type: "deposit",
      amountCents: initialBalanceCents,
      description: "Initial account funding",
      status: "completed",
      createdAt: now
    }
  ];

  return {
    id: users.find((user) => user.id === userId)?.walletId ?? `wallet-${userId}`,
    userId,
    availableBalanceCents: initialBalanceCents,
    pendingBalanceCents: 0,
    totalContributedCents: 0,
    totalPenaltiesCents: 0,
    totalWithdrawnCents: 0,
    transactions,
    bankAccounts:
      userId === "user-alex"
        ? [
            {
              id: "bank-1",
              userId,
              bankName: "Chase Checking",
              accountType: "checking",
              last4: "8888",
              routingMasked: "***0210",
              isPrimary: true,
              nickname: "Primary"
            }
          ]
        : []
  };
}

function createGmailStates(): GmailSyncState[] {
  return users.map((user) => ({
    userId: user.id,
    connected: user.id === "user-alex",
    status: "idle",
    lastSyncedAt: user.id === "user-alex" ? new Date().toISOString() : undefined,
    matchedCount: 0
  }));
}

function createActivity(now: Date): ActivityItem[] {
  return [
    {
      id: "activity-1",
      groupId: group.id,
      userId: "user-sarah",
      kind: "application",
      message: "Sarah applied to Google",
      createdAt: isoOffset(now, 0, -5)
    },
    {
      id: "activity-2",
      groupId: group.id,
      userId: "user-marcus",
      kind: "application",
      message: "Marcus applied to Netflix",
      createdAt: isoOffset(now, 0, -30)
    },
    {
      id: "activity-3",
      groupId: group.id,
      userId: "user-alex",
      kind: "warning",
      message: "Alex is falling behind target pace",
      createdAt: isoOffset(now, 0, -90)
    }
  ];
}

function createSettlement(now: Date, weekId: string): {
  cycle: SettlementCycle;
  history: SettlementResult[];
} {
  const currentWeekWindow = getWeekWindow(now, group.timezone);
  const cycle: SettlementCycle = {
    id: `cycle-${currentWeekWindow.weekId}`,
    groupId: group.id,
    weekId,
    startsAt: currentWeekWindow.startsAt,
    endsAt: currentWeekWindow.endsAt,
    timezone: group.timezone,
    status: "scheduled",
    triggeredBy: "auto"
  };

  const previousWeekAnchor = new Date(new Date(currentWeekWindow.startsAt).getTime() - 24 * 60 * 60 * 1000);
  const previousWeekWindow = getWeekWindow(previousWeekAnchor, group.timezone);
  const historyCalc = calculateSettlement({
    groupId: group.id,
    cycleId: `cycle-${previousWeekWindow.weekId}`,
    weekId: previousWeekWindow.weekId,
    baseStakeCents: group.rules.baseStakeCents,
    goalLockedStakeCents: group.rules.goalLockedStakeCents,
    members: [
      { userId: "user-alex", applicationsSent: 17, goal: group.weeklyGoal },
      { userId: "user-sarah", applicationsSent: 26, goal: group.weeklyGoal },
      { userId: "user-marcus", applicationsSent: 23, goal: group.weeklyGoal },
      { userId: "user-elena", applicationsSent: 21, goal: group.weeklyGoal },
      { userId: "user-david", applicationsSent: 14, goal: group.weeklyGoal }
    ]
  });

  const history: SettlementResult[] = [
    {
      ...historyCalc,
      completedAt: new Date(previousWeekWindow.endsAt).toISOString()
    }
  ];

  return { cycle, history };
}

export function createSeedState(): MockState {
  const now = new Date();
  const weekWindow = getWeekWindow(now, group.timezone);
  const weekStart = new Date(weekWindow.startsAt);

  const applicationLogs = generateLogs(weekStart, weekWindow.weekId, {
    "user-sarah": 28,
    "user-marcus": 22,
    "user-elena": 18,
    "user-alex": 12,
    "user-david": 8
  });

  const { cycle, history } = createSettlement(now, weekWindow.weekId);

  const wallets = [
    createWallet("user-alex", 14500),
    createWallet("user-sarah", 12000),
    createWallet("user-marcus", 9600),
    createWallet("user-elena", 8800),
    createWallet("user-david", 7600)
  ];

  const session: AuthSession | null = null;

  return {
    users,
    session,
    group,
    wallets,
    gmailSyncStates: createGmailStates(),
    applicationLogs,
    counterApplicationLogs: [],
    settlementCycles: [cycle],
    settlementResults: history,
    activities: createActivity(now),
    platformConfig
  };
}
