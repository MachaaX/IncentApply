import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useDeleteGroup,
  useGroupActivity,
  useLeaveGroup,
  useMyGroupSummary,
  useMyGroupsList,
  useRegenerateGroupInviteCode,
  useUpdateGroupSettings,
  useUpdateMemberApplicationCount
} from "../hooks/useAppQueries";
import type { GroupActivityMember, GroupGoalCycle, GroupGoalStartDay } from "../domain/types";
import { centsToUsd, dateTimeWithYearLabel } from "../utils/format";
import { useAuth } from "../app/AuthContext";
import { clearLastOpenedGroupId, setLastOpenedGroupId } from "../utils/groupNavigation";

function initials(name: string): string {
  const parts = name
    .replace(".", "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((part) => part.charAt(0)).join("").toUpperCase();
}

function statusLabel(status: GroupActivityMember["status"]): string {
  if (status === "crushing") {
    return "Crushing It";
  }
  if (status === "on_track") {
    return "On Track";
  }
  if (status === "at_risk") {
    return "At Risk";
  }
  return "Slow Start";
}

function statusClass(status: GroupActivityMember["status"]): string {
  if (status === "crushing") {
    return "border-primary/20 bg-primary/20 text-primary";
  }
  if (status === "on_track") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";
  }
  if (status === "at_risk") {
    return "border-red-500/20 bg-red-500/10 text-red-400";
  }
  return "border-slate-600/30 bg-slate-700/30 text-slate-400";
}

function rowClass(member: GroupActivityMember): string {
  if (member.isCurrentUser) {
    return "bg-primary/5 border-l-4 border-primary hover:bg-primary/10";
  }
  if (member.status === "slow_start") {
    return "opacity-70 hover:opacity-100";
  }
  return "hover:bg-primary/5";
}

function progressBarClass(status: GroupActivityMember["status"]): string {
  if (status === "at_risk") {
    return "bg-red-500";
  }
  if (status === "slow_start") {
    return "bg-slate-500";
  }
  if (status === "crushing") {
    return "bg-gradient-to-r from-primary to-emerald-300";
  }
  return "bg-primary";
}

function progressTextClass(status: GroupActivityMember["status"]): string {
  if (status === "at_risk") {
    return "text-red-400";
  }
  if (status === "slow_start") {
    return "text-slate-400";
  }
  if (status === "crushing") {
    return "text-primary";
  }
  return "text-slate-300";
}

function splitRemaining(totalMs: number): { days: number; hours: number; minutes: number } {
  const safeTotalMs = Math.max(0, totalMs);
  const days = Math.floor(safeTotalMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((safeTotalMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((safeTotalMs % (60 * 60 * 1000)) / (60 * 1000));
  return { days, hours, minutes };
}

function currentCycleLabel(goalCycle: GroupGoalCycle): string {
  if (goalCycle === "daily") {
    return "Current Day";
  }
  if (goalCycle === "biweekly") {
    return "Current Biweekly";
  }
  return "Current Week";
}

function statusFromApplications(
  applicationsCount: number,
  goal: number
): GroupActivityMember["status"] {
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

const goalStartDayOptions: Array<{ value: GroupGoalStartDay; label: string }> = [
  { value: "sunday", label: "Sunday" },
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" }
];

export function MyGroupPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const groupSummaryQuery = useMyGroupSummary(groupId);
  const groupActivityQuery = useGroupActivity(groupId);
  const myGroupsListQuery = useMyGroupsList();
  const updateGroupSettings = useUpdateGroupSettings();
  const regenerateInviteCode = useRegenerateGroupInviteCode();
  const deleteGroup = useDeleteGroup();
  const leaveGroup = useLeaveGroup();
  const updateMemberApplicationCount = useUpdateMemberApplicationCount();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [goalCycle, setGoalCycle] = useState<GroupGoalCycle>("weekly");
  const [goalStartDay, setGoalStartDay] = useState<GroupGoalStartDay>("monday");
  const [applicationGoal, setApplicationGoal] = useState(20);
  const [stakeUsd, setStakeUsd] = useState(15);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);
  const [settingsStatusTone, setSettingsStatusTone] = useState<"success" | "warning">("success");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [counterStatus, setCounterStatus] = useState<string | null>(null);
  const [counterStatusTone, setCounterStatusTone] = useState<"success" | "warning">("success");
  const [localCounterCount, setLocalCounterCount] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const summary = groupSummaryQuery.data;
    if (!summary) {
      return;
    }
    setGoalCycle(summary.goalCycle);
    setGoalStartDay(summary.goalStartDay);
    setApplicationGoal(summary.applicationGoal);
    setStakeUsd(summary.stakeUsd);
  }, [groupSummaryQuery.data]);

  useEffect(() => {
    if (settingsOpen) {
      return;
    }
    setConfirmDelete(false);
  }, [settingsOpen]);

  useEffect(() => {
    setConfirmLeave(false);
  }, [groupId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const activityCycleKey = groupActivityQuery.data?.cycle.key ?? "";
  const currentMemberCountInQuery =
    groupActivityQuery.data?.members.find((member) => member.userId === user?.id)?.applicationsCount ??
    groupActivityQuery.data?.members.find((member) => member.isCurrentUser)?.applicationsCount;

  useEffect(() => {
    if (!groupId) {
      setLocalCounterCount(null);
      return;
    }
    setLocalCounterCount(null);
  }, [groupId, activityCycleKey]);

  useEffect(() => {
    if (localCounterCount === null || currentMemberCountInQuery === undefined) {
      return;
    }
    if (currentMemberCountInQuery === localCounterCount) {
      setLocalCounterCount(null);
    }
  }, [currentMemberCountInQuery, localCounterCount]);

  if (groupSummaryQuery.isLoading || groupActivityQuery.isLoading) {
    return <p className="text-sm text-slate-400">Loading group...</p>;
  }

  if (!groupSummaryQuery.data || !groupActivityQuery.data) {
    const reason =
      groupSummaryQuery.error ??
      groupActivityQuery.error ??
      new Error("Unable to load this group.");
    return (
      <p className="text-sm text-red-300">
        {reason instanceof Error ? reason.message : "Unable to load this group."}
      </p>
    );
  }

  const summary = groupSummaryQuery.data;
  const activitySnapshot = groupActivityQuery.data;
  const isAdmin = summary.myRole === "admin";
  const members = activitySnapshot.members;
  const currentMemberId =
    members.find((member) => member.userId === user?.id) ??
    members.find((member) => member.isCurrentUser);
  const membersForDisplay =
    localCounterCount === null || !currentMemberId
      ? members
      : members.map((member) =>
          member.userId === currentMemberId.userId
            ? {
                ...member,
                applicationsCount: localCounterCount,
                status: statusFromApplications(localCounterCount, member.goal)
              }
            : member
        );
  const currentMember =
    membersForDisplay.find((member) => member.userId === currentMemberId?.userId) ??
    membersForDisplay.find((member) => member.isCurrentUser) ??
    null;

  const leaderboardMembers = [...membersForDisplay].sort((left, right) => {
    if (right.applicationsCount !== left.applicationsCount) {
      return right.applicationsCount - left.applicationsCount;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });

  const totalMembers = membersForDisplay.length;
  const totalGoal = membersForDisplay.reduce((sum, member) => sum + Math.max(0, member.goal), 0);
  const totalApplications = membersForDisplay.reduce(
    (sum, member) => sum + Math.min(Math.max(0, member.applicationsCount), Math.max(0, member.goal)),
    0
  );
  const goalPercentRaw = totalGoal > 0 ? Math.round((totalApplications / totalGoal) * 100) : 0;
  const goalPercent = Math.max(0, Math.min(100, goalPercentRaw));
  const potTotalCents = Math.round(summary.stakeUsd * totalMembers * 100);
  const cycleEndsAtMs = new Date(activitySnapshot.cycle.endsAt).getTime();
  const remaining = splitRemaining(cycleEndsAtMs - nowMs);
  const cycleUnitLabel =
    summary.goalCycle === "daily" ? "day" : summary.goalCycle === "weekly" ? "week" : "biweekly";
  const displayedCounterCount = currentMember?.applicationsCount ?? 0;
  const counterGoal = currentMember?.goal ?? summary.applicationGoal;
  const counterProgressRaw =
    counterGoal > 0 ? Math.round((displayedCounterCount / counterGoal) * 100) : 0;
  const counterProgress = Math.max(0, Math.min(100, counterProgressRaw));

  const saveSettings = async () => {
    if (!groupId || !isAdmin) {
      return;
    }
    setSettingsStatus(null);
    try {
      setConfirmDelete(false);
      await updateGroupSettings.mutateAsync({
        groupId,
        goalCycle,
        goalStartDay,
        applicationGoal,
        stakeUsd
      });
      setSettingsStatusTone("success");
      setSettingsStatus("Group settings saved.");
    } catch (reason) {
      setSettingsStatusTone("warning");
      setSettingsStatus(reason instanceof Error ? reason.message : "Unable to save settings.");
    }
  };

  const handleRegenerateInviteCode = async () => {
    if (!groupId || !isAdmin) {
      return;
    }

    setSettingsStatus(null);
    try {
      setConfirmDelete(false);
      const updated = await regenerateInviteCode.mutateAsync(groupId);
      setSettingsStatusTone("success");
      setSettingsStatus(`Invite code regenerated: ${updated.inviteCode}`);
    } catch (reason) {
      setSettingsStatusTone("warning");
      setSettingsStatus(reason instanceof Error ? reason.message : "Unable to regenerate invite code.");
    }
  };

  const handleDeleteGroup = async () => {
    if (!groupId || !isAdmin) {
      return;
    }

    if (!confirmDelete) {
      setConfirmDelete(true);
      setSettingsStatusTone("warning");
      setSettingsStatus("Click Delete Group again to permanently remove this group and all data.");
      return;
    }

    setSettingsStatus(null);
    try {
      await deleteGroup.mutateAsync(groupId);
      await navigateAfterGroupRemoved(groupId);
    } catch (reason) {
      setSettingsStatusTone("warning");
      setSettingsStatus(reason instanceof Error ? reason.message : "Unable to delete group.");
    }
  };

  const navigateAfterGroupRemoved = async (removedGroupId: string) => {
    const refreshed = await myGroupsListQuery.refetch();
    const nextGroups = (refreshed.data ?? []).filter((entry) => entry.id !== removedGroupId);

    if (nextGroups.length > 0) {
      const nextGroupId = nextGroups[0].id;
      setLastOpenedGroupId(nextGroupId);
      navigate(`/my-groups/${nextGroupId}`, { replace: true });
      return;
    }

    clearLastOpenedGroupId();
    navigate("/my-groups", { replace: true });
  };

  const handleLeaveGroup = async () => {
    if (!groupId || isAdmin) {
      return;
    }

    if (!confirmLeave) {
      setConfirmLeave(true);
      setSettingsStatusTone("warning");
      setSettingsStatus("Click Leave Group again to confirm you want to leave.");
      return;
    }

    setSettingsStatus(null);
    try {
      await leaveGroup.mutateAsync(groupId);
      await navigateAfterGroupRemoved(groupId);
    } catch (reason) {
      setSettingsStatusTone("warning");
      setSettingsStatus(reason instanceof Error ? reason.message : "Unable to leave group.");
    }
  };

  const adjustMemberCount = async (delta: -1 | 1) => {
    if (!groupId || !currentMember) {
      return;
    }

    setCounterStatus(null);
    try {
      const updated = await updateMemberApplicationCount.mutateAsync({
        groupId,
        memberId: currentMember.userId,
        delta
      });
      setLocalCounterCount(updated.applicationsCount);
      setCounterStatusTone("success");
      setCounterStatus("Application counts updated.");
    } catch (reason) {
      setCounterStatusTone("warning");
      setCounterStatus(
        reason instanceof Error ? reason.message : "Unable to update member application count."
      );
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-primary/10 bg-[#162e25] p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-black text-white">{summary.name}</h1>
            <p className="mt-1 text-sm text-[#92c9b7]">
              Cycle: <span className="capitalize">{summary.goalCycle}</span>
              {summary.goalCycle === "daily" ? null : (
                <>
                  {" "}
                  · Start Day: <span className="capitalize">{summary.goalStartDay}</span>
                </>
              )}{" "}
              · Application Goal: {summary.applicationGoal} · Stake: {centsToUsd(summary.stakeUsd * 100)}
            </p>
            <p className="mt-1 text-xs text-[#64877a]">
              Invite Code: <span className="font-semibold text-[#92c9b7]">{summary.inviteCode}</span> ·
              Expires:{" "}
              <span className="text-[#92c9b7]">{dateTimeWithYearLabel(summary.inviteCodeExpiresAt)}</span>
            </p>
          </div>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setSettingsOpen((open) => !open)}
              className="inline-flex items-center gap-1.5 self-start rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary/20"
            >
              <span className="material-icons text-base">tune</span>
              Group Settings
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleLeaveGroup()}
              disabled={leaveGroup.isPending}
              className="inline-flex items-center gap-1.5 self-start rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-70"
            >
              <span className="material-icons text-base">logout</span>
              {leaveGroup.isPending ? "Leaving..." : confirmLeave ? "Confirm Leave Group" : "Leave Group"}
            </button>
          )}
        </div>
        {!isAdmin && settingsStatus ? (
          <p className={`mt-3 text-sm ${settingsStatusTone === "warning" ? "text-secondary-gold" : "text-[#92c9b7]"}`}>
            {settingsStatus}
          </p>
        ) : null}

        {isAdmin && settingsOpen ? (
          <div className="mt-4 space-y-4 rounded-xl border border-primary/20 bg-background-dark/40 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Goal Cycle
                </span>
                <select
                  value={goalCycle}
                  onChange={(event) => setGoalCycle(event.target.value as GroupGoalCycle)}
                  className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-white focus:border-primary focus:outline-none"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Goal Start Day
                </span>
                <select
                  value={goalStartDay}
                  onChange={(event) => setGoalStartDay(event.target.value as GroupGoalStartDay)}
                  disabled={goalCycle === "daily"}
                  className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-white focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {goalStartDayOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Application Goal
                </span>
                <input
                  type="number"
                  min={1}
                  value={applicationGoal}
                  onChange={(event) => setApplicationGoal(Number(event.target.value))}
                  className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-white focus:border-primary focus:outline-none"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Stake (USD)
                </span>
                <input
                  type="number"
                  min={0}
                  value={stakeUsd}
                  onChange={(event) => setStakeUsd(Number(event.target.value))}
                  className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-white focus:border-primary focus:outline-none"
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void saveSettings()}
                disabled={updateGroupSettings.isPending || regenerateInviteCode.isPending}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-background-dark disabled:opacity-70"
              >
                {updateGroupSettings.isPending ? "Saving..." : "Save Settings"}
              </button>
              <button
                type="button"
                onClick={() => void handleRegenerateInviteCode()}
                disabled={updateGroupSettings.isPending || regenerateInviteCode.isPending}
                className="rounded-lg border border-primary/35 bg-primary/10 px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary/20 disabled:opacity-70"
              >
                {regenerateInviteCode.isPending ? "Generating..." : "Generate New Invite Code"}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteGroup()}
                disabled={deleteGroup.isPending || regenerateInviteCode.isPending}
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-70"
              >
                {deleteGroup.isPending ? "Deleting..." : confirmDelete ? "Confirm Delete Group" : "Delete Group"}
              </button>
              {settingsStatus ? (
                <p className={`text-sm ${settingsStatusTone === "warning" ? "text-secondary-gold" : "text-[#92c9b7]"}`}>
                  {settingsStatus}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-primary/10 bg-[#162e25] p-6">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Manual Application Counter
            </p>
            <h2 className="text-2xl font-black text-white">Update Member Counts</h2>
            <p className="text-sm text-[#92c9b7]">Only your personal counter is visible and editable.</p>
          </div>
          <p className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-primary">
            Cycle Ends {dateTimeWithYearLabel(activitySnapshot.cycle.endsAt)}
          </p>
        </div>
        {currentMember ? (
          <div className="max-w-xl">
            <article className="relative overflow-hidden rounded-xl border border-primary/15 bg-background-dark/50 p-4">
              <div className="absolute -right-10 -top-10 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
              <div className="relative z-10">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {currentMember.avatarUrl ? (
                      <img
                        src={currentMember.avatarUrl}
                        alt={currentMember.name}
                        className="h-10 w-10 rounded-full border-2 border-primary object-cover"
                      />
                    ) : (
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-xs font-bold text-slate-300">
                        {initials(currentMember.name)}
                      </span>
                    )}
                    <div>
                      <p className="text-sm font-bold text-white">
                        {currentMember.name}
                        <span className="ml-2 rounded border border-slate-600 bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          YOU
                        </span>
                      </p>
                      <p className="text-xs capitalize text-slate-400">{currentMember.role}</p>
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass(
                      currentMember.status
                    )}`}
                  >
                    {statusLabel(currentMember.status)}
                  </span>
                </div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Applications</p>
                  <p className="text-xs text-slate-400">
                    {displayedCounterCount}/{counterGoal}
                  </p>
                </div>
                <div className="mb-3 h-2 overflow-hidden rounded-full bg-background-dark">
                  <div
                    className={`h-full rounded-full ${progressBarClass(currentMember.status)}`}
                    style={{ width: `${counterProgress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center rounded-xl border border-primary/20 bg-primary/10 p-1">
                    <button
                      type="button"
                      onClick={() => void adjustMemberCount(-1)}
                      disabled={updateMemberApplicationCount.isPending || displayedCounterCount <= 0}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-lg font-black text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Decrease count for ${currentMember.name}`}
                    >
                      -
                    </button>
                    <p className="w-12 text-center font-mono text-xl font-bold text-white">
                      {String(displayedCounterCount).padStart(2, "0")}
                    </p>
                    <button
                      type="button"
                      onClick={() => void adjustMemberCount(1)}
                      disabled={updateMemberApplicationCount.isPending}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-lg font-black text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Increase count for ${currentMember.name}`}
                    >
                      +
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {counterGoal > displayedCounterCount
                      ? `${counterGoal - displayedCounterCount} to goal`
                      : "Goal reached"}
                  </p>
                </div>
              </div>
            </article>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Unable to locate your counter for this group.</p>
        )}
        {counterStatus ? (
          <p className={`mt-4 text-sm ${counterStatusTone === "warning" ? "text-secondary-gold" : "text-[#92c9b7]"}`}>
            {counterStatus}
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="relative overflow-hidden rounded-2xl border border-primary/10 bg-[#162e25] p-6">
          <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative z-10 mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Pot Total</p>
            <span className="rounded-md bg-primary/15 px-2 py-1 text-xs font-semibold text-primary">
              Live
            </span>
          </div>
          <p className="relative z-10 text-6xl font-extrabold tracking-tight text-white">
            {centsToUsd(potTotalCents)}
          </p>
          <div className="relative z-10 mt-4 flex items-center gap-2 text-xs text-slate-400">
            <span className="material-icons text-sm text-primary">groups</span>
            <span>
              {totalMembers} members × {centsToUsd(Math.round(summary.stakeUsd * 100))}
            </span>
          </div>
        </article>

        <article className="rounded-2xl border border-primary/10 bg-[#162e25] p-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Time Remaining</p>
            <span className="material-icons text-slate-600">timer</span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="text-center">
              <span className="block min-w-[3rem] rounded-lg bg-background-dark/50 p-2 font-mono text-4xl font-bold text-white">
                {String(remaining.days).padStart(2, "0")}
              </span>
              <span className="mt-1 block text-[10px] font-bold uppercase text-slate-500">Days</span>
            </div>
            <span className="mb-4 text-xl font-bold text-slate-600">:</span>
            <div className="text-center">
              <span className="block min-w-[3rem] rounded-lg bg-background-dark/50 p-2 font-mono text-4xl font-bold text-white">
                {String(remaining.hours).padStart(2, "0")}
              </span>
              <span className="mt-1 block text-[10px] font-bold uppercase text-slate-500">Hrs</span>
            </div>
            <span className="mb-4 text-xl font-bold text-slate-600">:</span>
            <div className="text-center">
              <span className="block min-w-[3rem] rounded-lg bg-background-dark/50 p-2 font-mono text-4xl font-bold text-white">
                {String(remaining.minutes).padStart(2, "0")}
              </span>
              <span className="mt-1 block text-[10px] font-bold uppercase text-slate-500">Mins</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Resets at {dateTimeWithYearLabel(activitySnapshot.cycle.endsAt)}
          </p>
        </article>

        <article className="rounded-2xl border border-primary/10 bg-[#162e25] p-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Group Goal</p>
            <p className="text-2xl font-bold text-white">
              {totalApplications}/{totalGoal} Apps
            </p>
          </div>
          <div className="mb-2 mt-2 flex items-end gap-2">
            <p className="text-6xl font-bold text-primary">{goalPercentRaw}%</p>
            <p className="mb-1 text-base font-medium text-slate-400">Complete</p>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-background-dark">
            <div className="relative h-3 rounded-full bg-primary" style={{ width: `${goalPercent}%` }}>
              <div className="absolute inset-0 h-full w-full animate-pulse bg-white/20" />
            </div>
          </div>
        </article>
      </section>

      <section className="overflow-hidden rounded-2xl border border-primary/10 bg-[#162e25] shadow-xl">
        <div className="flex flex-col justify-between gap-4 border-b border-primary/10 p-6 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-bold text-white">Leaderboard</h2>
            <p className="mt-1 text-slate-400">Top performers this {cycleUnitLabel} by applications sent.</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-primary/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/30"
            >
              {currentCycleLabel(summary.goalCycle)}
            </button>
          </div>
        </div>

        <div className="custom-scrollbar overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="border-b border-primary/5 bg-background-dark/50 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="w-16 p-5 text-center">Rank</th>
                <th className="px-5 py-3">Member</th>
                <th className="px-5 py-3">Status</th>
                <th className="p-5 text-right">Apps Sent</th>
                <th className="w-1/4 p-5">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary/5 text-sm">
              {leaderboardMembers.map((member, index) => {
                const percentRaw = member.goal > 0 ? Math.round((member.applicationsCount / member.goal) * 100) : 0;
                const percent = Math.max(0, Math.min(100, percentRaw));

                return (
                  <tr key={member.userId} className={`transition-colors ${rowClass(member)}`}>
                    <td className="p-5 text-center">
                      <span
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-full border font-bold ${
                          index === 0
                            ? "border border-yellow-500/30 bg-yellow-500/20 text-yellow-400"
                            : "border border-slate-600/30 bg-slate-700/50 text-slate-300"
                        }`}
                      >
                        {index + 1}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        {member.avatarUrl ? (
                          <img
                            src={member.avatarUrl}
                            alt={member.name}
                            className={`h-10 w-10 rounded-full border-2 object-cover transition-colors ${
                              member.isCurrentUser ? "border-primary" : "border-primary/20"
                            }`}
                          />
                        ) : (
                          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-transparent bg-slate-700 font-bold text-slate-400">
                            {initials(member.name)}
                          </span>
                        )}
                        <div>
                          <p className={`font-bold ${member.isCurrentUser ? "text-primary" : "text-white"}`}>
                            {member.name}
                            {member.isCurrentUser ? (
                              <span className="ml-2 rounded border border-slate-600 bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                YOU
                              </span>
                            ) : null}
                          </p>
                          <p className="text-sm capitalize text-slate-400">{member.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(member.status)} ${
                          member.status === "at_risk" ? "animate-pulse" : ""
                        }`}
                      >
                        {member.status === "crushing" ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                        ) : null}
                        {statusLabel(member.status)}
                      </span>
                    </td>
                    <td className="p-5 text-right font-mono text-2xl font-bold text-white">
                      <p>
                        {String(member.applicationsCount).padStart(2, "0")}
                        <span className="ml-1 text-xs font-normal font-sans text-slate-500">
                          / {member.goal}
                        </span>
                      </p>
                    </td>
                    <td className="p-5">
                      <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-background-dark">
                          <div
                            className={`h-full rounded-full ${progressBarClass(member.status)}`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <p className={`text-xs font-bold ${progressTextClass(member.status)}`}>{percentRaw}%</p>
                      </div>
                      {member.goal > member.applicationsCount ? (
                        <p className="mt-1 text-[10px] font-medium text-red-400/80">
                          Needs {member.goal - member.applicationsCount} more this {cycleUnitLabel}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
