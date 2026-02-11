import type {
  MemberSettlementBreakdown,
  SettlementInputMember,
  SettlementResult
} from "../domain/types";

export interface SettlementCalculationInput {
  groupId: string;
  cycleId: string;
  weekId: string;
  members: SettlementInputMember[];
  baseStakeCents: number;
  goalLockedStakeCents: number;
}

export function calculateSettlement(
  input: SettlementCalculationInput
): Omit<SettlementResult, "completedAt"> {
  const sortedMembers = [...input.members].sort((a, b) =>
    a.userId.localeCompare(b.userId)
  );

  let totalPenaltyPoolCents = 0;

  const prelim = sortedMembers.map((member) => {
    const metGoal = member.applicationsSent >= member.goal;
    const penaltyLostCents = metGoal ? 0 : input.goalLockedStakeCents;
    totalPenaltyPoolCents += penaltyLostCents;

    return {
      member,
      metGoal,
      penaltyLostCents
    };
  });

  const baseShare = Math.floor(totalPenaltyPoolCents / sortedMembers.length);
  let remainder = totalPenaltyPoolCents % sortedMembers.length;

  const breakdowns: MemberSettlementBreakdown[] = prelim.map((item) => {
    const penaltyShareCents = baseShare + (remainder > 0 ? 1 : 0);
    if (remainder > 0) {
      remainder -= 1;
    }

    const baseContributionCents = input.baseStakeCents;
    const goalLockedContributionCents = input.goalLockedStakeCents;
    const baseReturnCents = input.baseStakeCents;
    const goalReturnCents = item.metGoal ? input.goalLockedStakeCents : 0;

    const netCents =
      -baseContributionCents -
      goalLockedContributionCents +
      baseReturnCents +
      goalReturnCents +
      penaltyShareCents;

    return {
      userId: item.member.userId,
      applicationsSent: item.member.applicationsSent,
      goal: item.member.goal,
      metGoal: item.metGoal,
      baseContributionCents,
      goalLockedContributionCents,
      baseReturnCents,
      goalReturnCents,
      penaltyLostCents: item.penaltyLostCents,
      penaltyShareCents,
      netCents
    };
  });

  return {
    cycleId: input.cycleId,
    groupId: input.groupId,
    weekId: input.weekId,
    totalMembers: sortedMembers.length,
    totalPenaltyPoolCents,
    penaltySharePerMemberCents: baseShare,
    breakdowns
  };
}
