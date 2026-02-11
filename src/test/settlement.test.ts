import { describe, expect, it } from "vitest";
import { calculateSettlement } from "../utils/settlement";

describe("calculateSettlement", () => {
  it("returns zero penalty pool when all members meet goal", () => {
    const result = calculateSettlement({
      groupId: "group-1",
      cycleId: "cycle-1",
      weekId: "2026-02-06",
      baseStakeCents: 700,
      goalLockedStakeCents: 700,
      members: [
        { userId: "a", applicationsSent: 20, goal: 20 },
        { userId: "b", applicationsSent: 22, goal: 20 }
      ]
    });

    expect(result.totalPenaltyPoolCents).toBe(0);
    expect(result.breakdowns.every((entry) => entry.netCents === 0)).toBe(true);
  });

  it("applies fixed penalty to missed-goal members and redistributes equally", () => {
    const result = calculateSettlement({
      groupId: "group-1",
      cycleId: "cycle-2",
      weekId: "2026-02-06",
      baseStakeCents: 700,
      goalLockedStakeCents: 700,
      members: [
        { userId: "a", applicationsSent: 20, goal: 20 },
        { userId: "b", applicationsSent: 15, goal: 20 },
        { userId: "c", applicationsSent: 12, goal: 20 }
      ]
    });

    expect(result.totalPenaltyPoolCents).toBe(1400);
    const byId = Object.fromEntries(result.breakdowns.map((entry) => [entry.userId, entry]));
    expect(byId.a.netCents).toBe(467);
    expect(byId.b.netCents).toBe(-233);
    expect(byId.c.netCents).toBe(-234);
    expect(result.breakdowns.reduce((sum, entry) => sum + entry.penaltyShareCents, 0)).toBe(1400);
  });

  it("keeps rounding distribution stable to 1 cent max difference", () => {
    const result = calculateSettlement({
      groupId: "group-1",
      cycleId: "cycle-3",
      weekId: "2026-02-06",
      baseStakeCents: 700,
      goalLockedStakeCents: 701,
      members: [
        { userId: "a", applicationsSent: 20, goal: 20 },
        { userId: "b", applicationsSent: 10, goal: 20 },
        { userId: "c", applicationsSent: 9, goal: 20 }
      ]
    });

    const shares = result.breakdowns.map((entry) => entry.penaltyShareCents);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(result.totalPenaltyPoolCents);
  });
});
