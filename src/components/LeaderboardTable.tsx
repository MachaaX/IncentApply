import type { LeaderboardEntry, User } from "../domain/types";
import { ProgressBar } from "./ui/ProgressBar";
import { StatusBadge } from "./ui/StatusBadge";
import { initialism } from "../utils/format";

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  usersById: Record<string, User>;
}

function toneFromStatus(label: string): "success" | "danger" | "primary" {
  if (label === "At Risk") {
    return "danger";
  }
  if (label === "Crushing It") {
    return "primary";
  }
  return "success";
}

export function LeaderboardTable({ entries, usersById }: LeaderboardTableProps) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-primary/10 bg-surface-dark">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-background-dark/60 text-xs uppercase tracking-wider text-slate-400">
          <tr>
            <th className="px-4 py-4">Rank</th>
            <th className="px-4 py-4">Member</th>
            <th className="px-4 py-4">Status</th>
            <th className="px-4 py-4 text-right">Apps</th>
            <th className="px-4 py-4">Progress</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-primary/10">
          {entries.map((entry) => {
            const user = usersById[entry.userId];
            const initials = user ? initialism(user.firstName, user.lastName) : "?";
            const name = user ? `${user.firstName} ${user.lastName}` : entry.userId;

            return (
              <tr
                key={entry.userId}
                className={`transition-colors hover:bg-primary/5 ${
                  entry.isCurrentUser ? "bg-primary/5" : ""
                }`}
              >
                <td className="px-4 py-4">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-background-dark text-xs font-bold text-white">
                    {entry.rank}
                  </span>
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 bg-background-dark font-bold text-primary">
                      {initials}
                    </div>
                    <div>
                      <p className={`font-semibold ${entry.isCurrentUser ? "text-primary" : "text-white"}`}>
                        {name}
                      </p>
                      <p className="text-xs text-slate-500">{user?.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <StatusBadge tone={toneFromStatus(entry.statusLabel)}>{entry.statusLabel}</StatusBadge>
                </td>
                <td className="px-4 py-4 text-right font-mono text-white">
                  {entry.applicationsSent}
                  <span className="ml-1 text-xs text-slate-500">/ {entry.goal}</span>
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <ProgressBar
                        value={entry.progressPercent}
                        max={100}
                        tone={entry.progressPercent < 70 ? "danger" : "primary"}
                      />
                    </div>
                    <span className="text-xs font-semibold text-slate-300">{entry.progressPercent}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
