import { useCounterApplicationLogs } from "../hooks/useAppQueries";
import { dateTimeWithYearLabel } from "../utils/format";

export function MembersPage() {
  const logsQuery = useCounterApplicationLogs();

  if (logsQuery.isLoading) {
    return <p className="text-sm text-slate-400">Loading applications...</p>;
  }

  if (logsQuery.error) {
    return (
      <p className="text-sm text-red-300">
        {logsQuery.error instanceof Error ? logsQuery.error.message : "Unable to load applications."}
      </p>
    );
  }

  const logs = logsQuery.data ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="shrink-0">
        <h2 className="text-3xl font-black text-white">Applications</h2>
        <p className="mt-1 text-slate-400">
          Counter-based application logs captured at the moment you updated a group cycle count.
        </p>
      </header>

      <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-primary/15 bg-surface-dark">
        <header className="border-b border-primary/10 px-4 py-3 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Immutable History
          </p>
          <p className="mt-1 text-sm text-[#92c9b7]">{logs.length} logged applications</p>
        </header>

        <div className="custom-scrollbar min-h-0 h-full overflow-y-auto p-3 sm:p-4">
          {!logs.length ? (
            <div className="rounded-lg border border-dashed border-primary/20 bg-background-dark/40 p-5 text-sm text-slate-400">
              No applications logged yet. Increase your group counter to create immutable logs.
            </div>
          ) : (
            <div className="space-y-3">
              {logs.map((entry) => (
                <article
                  key={entry.id}
                  className="rounded-lg border border-primary/15 bg-background-dark/55 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">{entry.groupName}</p>
                    <p className="text-xs text-slate-400">{dateTimeWithYearLabel(entry.loggedAt)}</p>
                  </div>
                  <p className="mt-2 text-sm text-[#92c9b7]">
                    Application {entry.applicationIndex}/{entry.applicationGoal} in this{" "}
                    {entry.goalCycle} cycle.
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Cycle key: {entry.cycleKey} · Window: {dateTimeWithYearLabel(entry.cycleStartsAt)} -{" "}
                    {dateTimeWithYearLabel(entry.cycleEndsAt)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Snapshot: goal {entry.applicationGoal}, stake ${entry.stakeUsd.toFixed(2)}, cycle{" "}
                    {entry.goalCycle}, start day {entry.goalStartDay}.
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
