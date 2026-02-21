import { useSettlementLogs } from "../hooks/useAppQueries";
import { centsToUsd, dateTimeWithYearLabel } from "../utils/format";

function signedSettlementAmount(entry: {
  metGoal: boolean;
  amountWonCents: number;
  stakeUsd: number;
}): number {
  const stakeCents = Math.max(0, Math.round(Number(entry.stakeUsd ?? 0) * 100));
  const gross = Number(entry.amountWonCents ?? 0);
  return entry.metGoal ? gross : gross - stakeCents;
}

function signedCurrencyLabel(cents: number): string {
  const absolute = centsToUsd(Math.abs(cents));
  if (cents > 0) {
    return `+${absolute}`;
  }
  if (cents < 0) {
    return `-${absolute}`;
  }
  return absolute;
}

function hasMultipleUniqueParticipants(entry: {
  participantCount: number;
  participants: Array<{ userId: string }>;
}): boolean {
  if (Array.isArray(entry.participants) && entry.participants.length > 0) {
    const uniqueIds = new Set(
      entry.participants
        .map((participant) => String(participant?.userId ?? "").trim())
        .filter((userId) => userId.length > 0)
    );
    return uniqueIds.size > 1;
  }
  return Math.max(0, Number(entry.participantCount ?? 0)) > 1;
}

export function SettlementsPage() {
  const logsQuery = useSettlementLogs();

  if (logsQuery.isLoading) {
    return <p className="text-sm text-slate-400">Loading settlements...</p>;
  }

  if (logsQuery.error) {
    return (
      <p className="text-sm text-red-300">
        {logsQuery.error instanceof Error ? logsQuery.error.message : "Unable to load settlements."}
      </p>
    );
  }

  const logs = (logsQuery.data ?? []).filter((entry) => hasMultipleUniqueParticipants(entry));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="shrink-0">
        <h2 className="text-3xl font-black text-white">Settlements</h2>
        <p className="mt-1 text-slate-400">
          Immutable settlement logs captured at cycle settlement time with stake, pot, participants, and payout.
        </p>
      </header>

      <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-primary/15 bg-surface-dark">
        <header className="border-b border-primary/10 px-4 py-3 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Settlement History
          </p>
          <p className="mt-1 text-sm text-[#92c9b7]">{logs.length} logged settlements</p>
        </header>

        <div className="custom-scrollbar min-h-0 h-full overflow-y-auto p-3 sm:p-4">
          {!logs.length ? (
            <div className="rounded-lg border border-dashed border-primary/20 bg-background-dark/40 p-5 text-sm text-slate-400">
              No settlements logged yet. Settlements appear here automatically once a cycle is settled.
            </div>
          ) : (
            <div className="space-y-3">
              {logs.map((entry) => (
                <article
                  key={entry.id}
                  className="rounded-lg border border-primary/15 bg-background-dark/55 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-stretch md:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">{entry.groupName}</p>
                      <p className="mt-2 text-sm text-[#92c9b7]">
                        {entry.metGoal ? "Goal met" : "Goal missed"} · You won {centsToUsd(entry.amountWonCents)}.
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Stake ${entry.stakeUsd.toFixed(2)} · Pot {centsToUsd(entry.potValueCents)} · Participants{" "}
                        {entry.participantCount} ({entry.qualifiedParticipantCount} qualified).
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Cycle key: {entry.cycleKey} · Window: {dateTimeWithYearLabel(entry.cycleStartsAt)} -{" "}
                        {dateTimeWithYearLabel(entry.cycleEndsAt)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Snapshot: goal {entry.applicationGoal}, cycle {entry.goalCycle}, start day{" "}
                        {entry.goalStartDay}, your count {entry.applicationsCount}.
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Participants: {entry.participants.map((participant) => participant.name).join(", ")}
                      </p>
                    </div>

                    {(() => {
                      const netCents = signedSettlementAmount(entry);
                      const amountClass =
                        netCents < 0 ? "text-[#ff9ba5]" : netCents > 0 ? "text-primary" : "text-slate-200";
                      return (
                        <div className="relative flex shrink-0 flex-col gap-2 md:min-w-[170px] md:self-stretch md:items-end">
                          <p className="text-xs text-slate-400">{dateTimeWithYearLabel(entry.settledAt)}</p>
                          <p
                            className={`text-5xl font-black tracking-tight ${amountClass} md:absolute md:right-0 md:top-1/2 md:-translate-y-1/2`}
                          >
                            {signedCurrencyLabel(netCents)}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
