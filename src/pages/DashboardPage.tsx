import { useMemo, useState } from "react";
import { LeaderboardTable } from "../components/LeaderboardTable";
import { StatCard } from "../components/ui/StatCard";
import {
  useActivityFeed,
  useConnectGmail,
  useCreateManualLog,
  useCurrentGroup,
  useGmailState,
  useLeaderboard,
  useMembers,
  useMemberProgress,
  useSyncGmail,
  useWeekWindow
} from "../hooks/useAppQueries";
import { centsToUsd, dateTimeLabel } from "../utils/format";
import { getTimeRemainingToSettlement } from "../utils/week";

export function DashboardPage() {
  const groupQuery = useCurrentGroup();
  const membersQuery = useMembers();
  const weekQuery = useWeekWindow();
  const gmailQuery = useGmailState();
  const activityQuery = useActivityFeed();

  const weekId = weekQuery.data?.weekId;
  const leaderboardQuery = useLeaderboard(weekId);
  const progressQuery = useMemberProgress(weekId);

  const connectGmail = useConnectGmail();
  const syncGmail = useSyncGmail();
  const createManualLog = useCreateManualLog();

  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const usersById = useMemo(() => {
    return Object.fromEntries((membersQuery.data ?? []).map((user) => [user.id, user]));
  }, [membersQuery.data]);

  if (!groupQuery.data || !weekQuery.data || !membersQuery.data) {
    return <p className="text-sm text-slate-400">Loading dashboard...</p>;
  }

  const progress = progressQuery.data ?? [];
  const belowGoal = progress.filter((item) => item.applicationsSent < item.goal).length;
  const pendingPenaltyPool = belowGoal * groupQuery.data.rules.goalLockedStakeCents;

  const countdown = getTimeRemainingToSettlement(new Date(), groupQuery.data.timezone);
  const completeApps = progress.reduce((total, item) => total + item.applicationsSent, 0);
  const totalGoal = groupQuery.data.weeklyGoal * groupQuery.data.memberIds.length;

  const submitManualLog = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    try {
      await createManualLog.mutateAsync({ company, roleTitle, note: note || undefined });
      setCompany("");
      setRoleTitle("");
      setNote("");
      setMessage("Application logged.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not log application.");
    }
  };

  const doConnect = async () => {
    setMessage(null);
    try {
      await connectGmail.mutateAsync();
      setMessage("Google account connected.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not connect Google account.");
    }
  };

  const doSync = async () => {
    setMessage(null);
    try {
      const result = await syncGmail.mutateAsync();
      const matched = result.created.filter((entry) => entry.isCounted).length;
      setMessage(`Gmail synced. ${matched} matched applications counted.`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not sync Gmail.");
    }
  };

  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Pending Penalty Pool"
          value={centsToUsd(pendingPenaltyPool)}
          subtitle={`${belowGoal} members currently below target`}
          badge="Live"
        />
        <StatCard
          title="Time Remaining"
          value={`${String(countdown.days).padStart(2, "0")}d ${String(countdown.hours).padStart(2, "0")}h ${String(countdown.minutes).padStart(2, "0")}m`}
          subtitle={`Auto settlement every Friday (${groupQuery.data.timezone})`}
        />
        <StatCard
          title="Group Goal"
          value={`${completeApps}/${totalGoal}`}
          subtitle={`Shared threshold: ${groupQuery.data.weeklyGoal} per member`}
          badge={`${Math.round((completeApps / totalGoal) * 100)}%`}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-primary/10 bg-surface-dark p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-white">Leaderboard</h2>
                <p className="text-sm text-slate-400">Week {weekQuery.data.weekId}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void doConnect()}
                  className="rounded-lg border border-primary/30 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10"
                >
                  {gmailQuery.data?.connected ? "Google Connected" : "Connect Google"}
                </button>
                <button
                  type="button"
                  onClick={() => void doSync()}
                  disabled={!gmailQuery.data?.connected || syncGmail.isPending}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-background-dark transition-colors hover:bg-primary-dark disabled:opacity-60"
                >
                  {syncGmail.isPending ? "Syncing..." : "Sync Gmail"}
                </button>
              </div>
            </div>
            <LeaderboardTable entries={leaderboardQuery.data ?? []} usersById={usersById} />
          </div>

          <div className="rounded-2xl border border-primary/10 bg-surface-dark p-6">
            <h3 className="mb-3 text-lg font-bold text-white">Recent Activity</h3>
            <ul className="space-y-2">
              {(activityQuery.data ?? []).slice(0, 6).map((activity) => (
                <li key={activity.id} className="rounded-lg border border-primary/10 bg-background-dark px-4 py-3">
                  <p className="text-sm text-white">{activity.message}</p>
                  <p className="mt-1 text-xs text-slate-500">{dateTimeLabel(activity.createdAt)}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <aside className="space-y-4">
          <form onSubmit={submitManualLog} className="space-y-3 rounded-2xl border border-primary/10 bg-surface-dark p-6">
            <h3 className="text-lg font-bold text-white">Manual Log</h3>
            <label htmlFor="manual-company" className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Company</span>
              <input
                id="manual-company"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
                required
              />
            </label>
            <label htmlFor="manual-role" className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Role</span>
              <input
                id="manual-role"
                value={roleTitle}
                onChange={(event) => setRoleTitle(event.target.value)}
                className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
                required
              />
            </label>
            <label htmlFor="manual-note" className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Note</span>
              <textarea
                id="manual-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={createManualLog.isPending}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-background-dark hover:bg-primary-dark disabled:opacity-60"
            >
              {createManualLog.isPending ? "Saving..." : "Log Application"}
            </button>
            <div className="rounded-lg border border-primary/10 bg-background-dark px-3 py-2 text-xs text-slate-400">
              Gmail status: {gmailQuery.data?.connected ? "Connected" : "Not connected"}
              {gmailQuery.data?.lastSyncedAt
                ? ` · last synced ${dateTimeLabel(gmailQuery.data.lastSyncedAt)}`
                : ""}
            </div>
          </form>
          {message ? <p className="text-sm text-primary">{message}</p> : null}
        </aside>
      </section>
    </div>
  );
}
