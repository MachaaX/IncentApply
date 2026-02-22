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

export function useMyGroupsList() {
  const { groupService } = useServices();
  return useQuery({
    queryKey: ["my-groups-list"],
    queryFn: () => groupService.getMyGroups()
  });
}

export function useMyGroupSummary(groupId?: string) {
  const { groupService } = useServices();
  return useQuery({
    enabled: Boolean(groupId),
    queryKey: ["my-group-summary", groupId],
    queryFn: () => groupService.getGroupById(groupId ?? "")
  });
}

export function useGroupActivity(groupId?: string) {
  const { groupService } = useServices();
  return useQuery({
    enabled: Boolean(groupId),
    queryKey: ["group-activity", groupId],
    queryFn: () => groupService.getGroupActivity(groupId ?? "")
  });
}

export function useGroupChatMessages(groupId?: string) {
  const { groupService } = useServices();
  return useQuery({
    enabled: Boolean(groupId),
    queryKey: ["group-chat-messages", groupId],
    queryFn: () => groupService.getGroupChatMessages(groupId ?? ""),
    refetchInterval: 3000
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

export function useCounterApplicationLogs() {
  const { applicationService } = useServices();
  return useQuery({
    queryKey: ["counter-application-logs"],
    queryFn: () => applicationService.getCounterApplicationLogs(),
    refetchInterval: 5000
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

export function useNotifications() {
  const { notificationService } = useServices();
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationService.getNotifications(200)
  });
}

export function useDismissNotification() {
  const { notificationService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => notificationService.dismissNotification(notificationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
  });
}

export function useMarkNotificationRead() {
  const { notificationService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => notificationService.markNotificationRead(notificationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
  });
}

export function useMarkAllNotificationsRead() {
  const { notificationService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => notificationService.markAllNotificationsRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
  });
}

export function useSettlementLogs() {
  const { settlementService } = useServices();
  return useQuery({
    queryKey: ["settlement-logs"],
    queryFn: () => settlementService.getLogs(),
    refetchInterval: 5000
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

export function useSendGroupChatMessage() {
  const { groupService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { groupId: string; body: string; replyToMessageId?: string | null }) =>
      groupService.sendGroupChatMessage(input),
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({ queryKey: ["group-chat-messages", input.groupId] });
    }
  });
}

export function useToggleGroupChatReaction() {
  const { groupService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { groupId: string; messageId: string; emoji: string }) =>
      groupService.toggleGroupChatReaction(input),
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({ queryKey: ["group-chat-messages", input.groupId] });
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
      void queryClient.invalidateQueries({ queryKey: ["my-groups-list"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    }
  });
}

export function useCreateGroup() {
  const { groupService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      applicationGoal: number;
      stakeUsd: number;
      goalCycle: "daily" | "weekly" | "biweekly";
      goalStartDay:
        | "sunday"
        | "monday"
        | "tuesday"
        | "wednesday"
        | "thursday"
        | "friday"
        | "saturday";
      inviteEmails: string[];
      inviteCode?: string;
    }) => groupService.createGroup(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["my-groups-list"] });
      void queryClient.invalidateQueries({ queryKey: ["group"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    }
  });
}

export function usePendingInvites() {
  const { groupService } = useServices();
  return useQuery({
    queryKey: ["pending-invites"],
    queryFn: () => groupService.getPendingInvites()
  });
}

export function useCheckUserExistsByEmail() {
  const { groupService } = useServices();
  return useMutation({
    mutationFn: (email: string) => groupService.checkUserExistsByEmail(email)
  });
}

export function useUpdateGroupSettings() {
  const { groupService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      groupId: string;
      applicationGoal: number;
      stakeUsd: number;
      goalCycle: "daily" | "weekly" | "biweekly";
      goalStartDay:
        | "sunday"
        | "monday"
        | "tuesday"
        | "wednesday"
        | "thursday"
        | "friday"
        | "saturday";
    }) => groupService.updateGroupSettings(input),
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({ queryKey: ["my-group-summary", input.groupId] });
      void queryClient.invalidateQueries({ queryKey: ["group-activity", input.groupId] });
      void queryClient.invalidateQueries({ queryKey: ["my-groups-list"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    }
  });
}

export function useDeleteGroup() {
  const { groupService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => groupService.deleteGroup(groupId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["my-groups-list"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      void queryClient.invalidateQueries({ queryKey: ["group"] });
      void queryClient.invalidateQueries({ queryKey: ["members"] });
    }
  });
}

export function useLeaveGroup() {
  const { groupService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => groupService.leaveGroup(groupId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["my-groups-list"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      void queryClient.invalidateQueries({ queryKey: ["group"] });
      void queryClient.invalidateQueries({ queryKey: ["members"] });
    }
  });
}

export function useUpdateMemberApplicationCount() {
  const { groupService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      groupId: string;
      memberId: string;
      delta?: number;
      applicationsCount?: number;
    }) => groupService.updateMemberApplicationCount(input),
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({ queryKey: ["group-activity", input.groupId] });
      void queryClient.invalidateQueries({ queryKey: ["counter-application-logs"] });
    }
  });
}

export function useRegenerateGroupInviteCode() {
  const { groupService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => groupService.regenerateInviteCode(groupId),
    onSuccess: (_, groupId) => {
      void queryClient.invalidateQueries({ queryKey: ["my-group-summary", groupId] });
      void queryClient.invalidateQueries({ queryKey: ["my-groups-list"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    }
  });
}

export function useRespondToInvite() {
  const { groupService } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { inviteId: string; action: "accept" | "reject" }) =>
      groupService.respondToInvite(input.inviteId, input.action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      void queryClient.invalidateQueries({ queryKey: ["my-groups-list"] });
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
      void queryClient.invalidateQueries({ queryKey: ["settlement-logs"] });
      void queryClient.invalidateQueries({ queryKey: ["settlement-cycle"] });
      void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      void queryClient.invalidateQueries({ queryKey: ["member-progress"] });
      void queryClient.invalidateQueries({ queryKey: ["activity-feed"] });
    }
  });
}
