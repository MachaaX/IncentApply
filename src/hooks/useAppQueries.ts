import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServices } from "./useServices";

export function usePlatformConfig() {
  const { configService } = useServices();
  return useQuery({
    queryKey: ["platform-config"],
    queryFn: () => configService.getPlatformConfig()
  });
}

export function useCurrentGroup() {
  const { groupService } = useServices();
  return useQuery({
    queryKey: ["group"],
    queryFn: () => groupService.getCurrentGroup()
  });
}

export function useMembers() {
  const { groupService } = useServices();
  return useQuery({
    queryKey: ["members"],
    queryFn: () => groupService.getMembers()
  });
}

export function useWeekWindow() {
  const { applicationService } = useServices();
  return useQuery({
    queryKey: ["week-window"],
    queryFn: () => applicationService.getCurrentWeekWindow()
  });
}

export function useMemberProgress(weekId?: string) {
  const { groupService } = useServices();
  return useQuery({
    enabled: Boolean(weekId),
    queryKey: ["member-progress", weekId],
    queryFn: () => groupService.getMemberProgress(weekId ?? "")
  });
}

export function useLeaderboard(weekId?: string) {
  const { groupService } = useServices();
  return useQuery({
    enabled: Boolean(weekId),
    queryKey: ["leaderboard", weekId],
    queryFn: () => groupService.getLeaderboard(weekId ?? "")
  });
}

export function useActivityFeed() {
  const { groupService } = useServices();
  return useQuery({
    queryKey: ["activity-feed"],
    queryFn: () => groupService.getActivityFeed()
  });
}

export function useWeekLogs(weekId?: string) {
  const { applicationService } = useServices();
  return useQuery({
    enabled: Boolean(weekId),
    queryKey: ["week-logs", weekId],
    queryFn: () => applicationService.getLogsForWeek(weekId ?? "")
  });
}

export function useGmailState() {
  const { applicationService } = useServices();
  return useQuery({
    queryKey: ["gmail-state"],
    queryFn: () => applicationService.getGmailSyncState()
  });
}

export function useWallet() {
  const { walletService } = useServices();
  return useQuery({
    queryKey: ["wallet"],
    queryFn: () => walletService.getWallet()
  });
}

export function useCurrentCycle() {
  const { settlementService } = useServices();
  return useQuery({
    queryKey: ["settlement-cycle"],
    queryFn: () => settlementService.getCurrentCycle()
  });
}

export function useSettlementHistory() {
  const { settlementService } = useServices();
  return useQuery({
    queryKey: ["settlement-history"],
    queryFn: () => settlementService.getHistory()
  });
}

export function useSyncGmail() {
  const { applicationService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => applicationService.syncGmailNow(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gmail-state"] });
      void queryClient.invalidateQueries({ queryKey: ["week-logs"] });
      void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      void queryClient.invalidateQueries({ queryKey: ["member-progress"] });
      void queryClient.invalidateQueries({ queryKey: ["activity-feed"] });
    }
  });
}

export function useConnectGmail() {
  const { applicationService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => applicationService.connectGmail(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gmail-state"] });
    }
  });
}

export function useCreateManualLog() {
  const { applicationService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { company: string; roleTitle: string; note?: string }) =>
      applicationService.createManualLog(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["week-logs"] });
      void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      void queryClient.invalidateQueries({ queryKey: ["member-progress"] });
      void queryClient.invalidateQueries({ queryKey: ["activity-feed"] });
    }
  });
}

export function useUpdateGroupGoal() {
  const { groupService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { weeklyGoal: number; adminGoalNote?: string }) =>
      groupService.updateGoal(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["group"] });
      void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      void queryClient.invalidateQueries({ queryKey: ["member-progress"] });
    }
  });
}

export function useUpdateGroupName() {
  const { groupService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => groupService.updateGroupName(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["group"] });
    }
  });
}

export function useJoinGroup() {
  const { groupService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteCode: string) => groupService.joinWithInviteCode(inviteCode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["group"] });
      void queryClient.invalidateQueries({ queryKey: ["members"] });
    }
  });
}

export function useWithdraw() {
  const { walletService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { amountCents: number; bankAccountId: string }) =>
      walletService.withdraw(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
    }
  });
}

export function useAddBankAccount() {
  const { walletService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      bankName: string;
      accountType: "checking" | "savings";
      accountNumber: string;
      routingNumber: string;
      nickname?: string;
    }) => walletService.addBankAccount(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
    }
  });
}

export function useSimulateSettlement() {
  const { settlementService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => settlementService.simulateSettlementNow(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
      void queryClient.invalidateQueries({ queryKey: ["settlement-history"] });
      void queryClient.invalidateQueries({ queryKey: ["settlement-cycle"] });
      void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      void queryClient.invalidateQueries({ queryKey: ["member-progress"] });
      void queryClient.invalidateQueries({ queryKey: ["activity-feed"] });
    }
  });
}
