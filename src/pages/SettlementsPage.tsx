import { useMemo, useState } from "react";
import { SettlementSummary } from "../components/SettlementSummary";
import {
  useCurrentCycle,
  useMembers,
  useSettlementHistory,
  useSimulateSettlement,
  useWeekWindow
} from "../hooks/useAppQueries";
import { dateLabel } from "../utils/format";

export function SettlementsPage() {
  const cycleQuery = useCurrentCycle();
  const historyQuery = useSettlementHistory();
  const membersQuery = useMembers();
  const weekQuery = useWeekWindow();
  const simulate = useSimulateSettlement();
  const [message, setMessage] = useState<string | null>(null);

  const usersById = useMemo(
    () => Object.fromEntries((membersQuery.data ?? []).map((user) => [user.id, user])),
    [membersQuery.data]
  );

  if (!cycleQuery.data || !historyQuery.data || !membersQuery.data || !weekQuery.data) {
    return <p className="text-sm text-slate-400">Loading settlements...</p>;
  }

  const runSimulation = async () => {
    setMessage(null);
    try {
      const result = await simulate.mutateAsync();
      setMessage(`Settlement completed for week ${result.weekId}.`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Unable to run settlement.");
    }
  };

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-primary/10 bg-surface-dark p-5">
        <h2 className="text-2xl font-bold text-white">Settlements</h2>
        <p className="mt-2 text-sm text-slate-400">
          Auto settlement schedule: every Friday in {cycleQuery.data.timezone}.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded bg-primary/15 px-2 py-1 font-semibold text-primary">
            Current week {weekQuery.data.weekId}
          </span>
          <span className="text-slate-400">Cycle ends {dateLabel(cycleQuery.data.endsAt)}</span>
        </div>
        <button
          type="button"
          onClick={() => void runSimulation()}
          disabled={simulate.isPending}
          className="mt-4 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-background-dark transition-colors hover:bg-primary-dark disabled:opacity-60"
        >
          {simulate.isPending ? "Running..." : "Simulate Settlement Now"}
        </button>
        {message ? <p className="mt-2 text-sm text-primary">{message}</p> : null}
      </header>

      <section className="space-y-4">
        {historyQuery.data.map((result) => (
          <SettlementSummary key={result.cycleId + result.completedAt} result={result} usersById={usersById} />
        ))}
      </section>
    </div>
  );
}
