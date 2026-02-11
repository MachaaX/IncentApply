import type { SettlementResult, User } from "../domain/types";
import { centsToUsd } from "../utils/format";

interface SettlementSummaryProps {
  result: SettlementResult;
  usersById: Record<string, User>;
}

export function SettlementSummary({ result, usersById }: SettlementSummaryProps) {
  return (
    <section className="rounded-xl border border-primary/10 bg-surface-dark p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-white">Settlement {result.weekId}</h3>
        <span className="rounded bg-primary/15 px-2 py-1 text-xs font-semibold text-primary">
          Pool {centsToUsd(result.totalPenaltyPoolCents)}
        </span>
      </div>
      <div className="space-y-2">
        {result.breakdowns.map((item) => {
          const user = usersById[item.userId];
          const netTone = item.netCents >= 0 ? "text-primary" : "text-red-300";
          return (
            <div key={item.userId} className="flex items-center justify-between rounded-lg border border-primary/10 bg-background-dark px-4 py-2.5">
              <div>
                <p className="font-medium text-white">
                  {user ? `${user.firstName} ${user.lastName}` : item.userId}
                </p>
                <p className="text-xs text-slate-500">
                  Apps {item.applicationsSent}/{item.goal} · Penalty Share {centsToUsd(item.penaltyShareCents)}
                </p>
              </div>
              <p className={`font-semibold ${netTone}`}>{item.netCents >= 0 ? "+" : ""}{centsToUsd(item.netCents)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
