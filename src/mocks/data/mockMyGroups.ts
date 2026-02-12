export type GroupMemberStatus = "crushing" | "on_track" | "at_risk" | "slow_start";
export type ActivityTone = "success" | "warning" | "danger";

export interface MockGroupMember {
  id: string;
  name: string;
  role: string;
  appsSent: number;
  goal: number;
  status: GroupMemberStatus;
  isYou?: boolean;
  avatarUrl?: string;
}

export interface MockGroupActivity {
  id: string;
  message: string;
  timeLabel: string;
  tone: ActivityTone;
}

export interface MockGroupDashboard {
  id: string;
  name: string;
  potTotalUsd: number;
  potDeltaLabel: string;
  potTag: string;
  timeRemaining: {
    days: string;
    hours: string;
    mins: string;
  };
  goalCompleted: number;
  goalTarget: number;
  members: MockGroupMember[];
  activity: MockGroupActivity[];
}

export const mockMyGroups: MockGroupDashboard[] = [
  {
    id: "group-1",
    name: "Alpha Squad",
    potTotalUsd: 450,
    potDeltaLabel: "+$50 since yesterday",
    potTag: "Accumulating",
    timeRemaining: {
      days: "02",
      hours: "14",
      mins: "45"
    },
    goalCompleted: 128,
    goalTarget: 150,
    members: [
      {
        id: "member-1",
        name: "Sarah M.",
        role: "Frontend Dev Role",
        appsSent: 28,
        goal: 25,
        status: "crushing"
      },
      {
        id: "member-2",
        name: "Marcus J.",
        role: "Product Manager Role",
        appsSent: 22,
        goal: 25,
        status: "on_track"
      },
      {
        id: "member-3",
        name: "Elena R.",
        role: "UX Designer Role",
        appsSent: 18,
        goal: 25,
        status: "on_track"
      },
      {
        id: "member-4",
        name: "Alex D.",
        role: "Full Stack Role",
        appsSent: 12,
        goal: 25,
        status: "at_risk",
        isYou: true
      },
      {
        id: "member-5",
        name: "David K.",
        role: "Data Science Role",
        appsSent: 8,
        goal: 25,
        status: "slow_start"
      }
    ],
    activity: [
      {
        id: "activity-1",
        message: "Sarah M. applied to Google",
        timeLabel: "2 mins ago",
        tone: "success"
      },
      {
        id: "activity-2",
        message: "Marcus J. applied to Netflix",
        timeLabel: "15 mins ago",
        tone: "success"
      },
      {
        id: "activity-3",
        message: "Alex D. is falling behind!",
        timeLabel: "1 hour ago",
        tone: "danger"
      }
    ]
  },
  {
    id: "group-2",
    name: "Offer Sprint Squad",
    potTotalUsd: 620,
    potDeltaLabel: "+$80 since yesterday",
    potTag: "Rising",
    timeRemaining: {
      days: "01",
      hours: "09",
      mins: "18"
    },
    goalCompleted: 143,
    goalTarget: 180,
    members: [
      {
        id: "member-11",
        name: "Noah P.",
        role: "Backend Engineer Role",
        appsSent: 31,
        goal: 30,
        status: "crushing"
      },
      {
        id: "member-12",
        name: "Maya T.",
        role: "Product Designer Role",
        appsSent: 24,
        goal: 30,
        status: "on_track"
      },
      {
        id: "member-13",
        name: "Jay N.",
        role: "QA Engineer Role",
        appsSent: 20,
        goal: 30,
        status: "at_risk"
      },
      {
        id: "member-14",
        name: "Rin S.",
        role: "Data Analyst Role",
        appsSent: 18,
        goal: 30,
        status: "slow_start"
      },
      {
        id: "member-15",
        name: "Alex D.",
        role: "Full Stack Role",
        appsSent: 26,
        goal: 30,
        status: "on_track",
        isYou: true
      }
    ],
    activity: [
      {
        id: "activity-11",
        message: "Noah P. matched 3 Gmail applications",
        timeLabel: "6 mins ago",
        tone: "success"
      },
      {
        id: "activity-12",
        message: "Alex D. logged a manual application",
        timeLabel: "21 mins ago",
        tone: "success"
      },
      {
        id: "activity-13",
        message: "Jay N. is below pace for this week",
        timeLabel: "45 mins ago",
        tone: "warning"
      }
    ]
  },
  {
    id: "group-3",
    name: "Backend Grind Crew",
    potTotalUsd: 370,
    potDeltaLabel: "+$20 since yesterday",
    potTag: "Steady",
    timeRemaining: {
      days: "03",
      hours: "03",
      mins: "04"
    },
    goalCompleted: 92,
    goalTarget: 140,
    members: [
      {
        id: "member-21",
        name: "Liam W.",
        role: "Platform Engineer Role",
        appsSent: 20,
        goal: 28,
        status: "on_track"
      },
      {
        id: "member-22",
        name: "Ava C.",
        role: "Site Reliability Role",
        appsSent: 18,
        goal: 28,
        status: "on_track"
      },
      {
        id: "member-23",
        name: "Milo B.",
        role: "DevOps Engineer Role",
        appsSent: 16,
        goal: 28,
        status: "at_risk"
      },
      {
        id: "member-24",
        name: "Zoe F.",
        role: "Security Engineer Role",
        appsSent: 11,
        goal: 28,
        status: "slow_start"
      },
      {
        id: "member-25",
        name: "Alex D.",
        role: "Full Stack Role",
        appsSent: 27,
        goal: 28,
        status: "crushing",
        isYou: true
      }
    ],
    activity: [
      {
        id: "activity-21",
        message: "Alex D. reached 96% of weekly target",
        timeLabel: "3 mins ago",
        tone: "success"
      },
      {
        id: "activity-22",
        message: "Ava C. applied to Stripe",
        timeLabel: "17 mins ago",
        tone: "success"
      },
      {
        id: "activity-23",
        message: "Milo B. needs 2 more applications today",
        timeLabel: "39 mins ago",
        tone: "warning"
      }
    ]
  },
  {
    id: "group-4",
    name: "Design Momentum Circle",
    potTotalUsd: 540,
    potDeltaLabel: "+$35 since yesterday",
    potTag: "Hot Streak",
    timeRemaining: {
      days: "01",
      hours: "22",
      mins: "09"
    },
    goalCompleted: 111,
    goalTarget: 160,
    members: [
      {
        id: "member-31",
        name: "Priya L.",
        role: "Product Designer Role",
        appsSent: 29,
        goal: 32,
        status: "on_track"
      },
      {
        id: "member-32",
        name: "Kian O.",
        role: "UI Designer Role",
        appsSent: 27,
        goal: 32,
        status: "on_track"
      },
      {
        id: "member-33",
        name: "Sofia M.",
        role: "UX Research Role",
        appsSent: 18,
        goal: 32,
        status: "at_risk"
      },
      {
        id: "member-34",
        name: "Troy H.",
        role: "Visual Designer Role",
        appsSent: 14,
        goal: 32,
        status: "slow_start"
      },
      {
        id: "member-35",
        name: "Alex D.",
        role: "Full Stack Role",
        appsSent: 23,
        goal: 32,
        status: "on_track",
        isYou: true
      }
    ],
    activity: [
      {
        id: "activity-31",
        message: "Priya L. applied to Airbnb",
        timeLabel: "9 mins ago",
        tone: "success"
      },
      {
        id: "activity-32",
        message: "Alex D. synced Gmail and counted 2",
        timeLabel: "18 mins ago",
        tone: "success"
      },
      {
        id: "activity-33",
        message: "Sofia M. is at risk for this cycle",
        timeLabel: "34 mins ago",
        tone: "warning"
      }
    ]
  },
  {
    id: "group-5",
    name: "Data Interview Lab",
    potTotalUsd: 705,
    potDeltaLabel: "+$110 since yesterday",
    potTag: "Peak Mode",
    timeRemaining: {
      days: "00",
      hours: "18",
      mins: "31"
    },
    goalCompleted: 172,
    goalTarget: 200,
    members: [
      {
        id: "member-41",
        name: "Hana V.",
        role: "Data Scientist Role",
        appsSent: 42,
        goal: 40,
        status: "crushing"
      },
      {
        id: "member-42",
        name: "Ben C.",
        role: "ML Engineer Role",
        appsSent: 37,
        goal: 40,
        status: "on_track"
      },
      {
        id: "member-43",
        name: "Olivia R.",
        role: "Analytics Engineer Role",
        appsSent: 32,
        goal: 40,
        status: "on_track"
      },
      {
        id: "member-44",
        name: "Niko Y.",
        role: "BI Engineer Role",
        appsSent: 24,
        goal: 40,
        status: "at_risk"
      },
      {
        id: "member-45",
        name: "Alex D.",
        role: "Full Stack Role",
        appsSent: 37,
        goal: 40,
        status: "on_track",
        isYou: true
      }
    ],
    activity: [
      {
        id: "activity-41",
        message: "Hana V. crossed goal early this week",
        timeLabel: "5 mins ago",
        tone: "success"
      },
      {
        id: "activity-42",
        message: "Ben C. applied to OpenAI",
        timeLabel: "13 mins ago",
        tone: "success"
      },
      {
        id: "activity-43",
        message: "Niko Y. needs 3 more applications",
        timeLabel: "42 mins ago",
        tone: "warning"
      }
    ]
  }
];
