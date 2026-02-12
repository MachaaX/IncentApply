import { useParams } from "react-router-dom";
import { mockMyGroups, type MockGroupMember } from "../mocks/data/mockMyGroups";
import { centsToUsd } from "../utils/format";

function initials(name: string): string {
  const parts = name
    .replace(".", "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((part) => part.charAt(0)).join("").toUpperCase();
}

function statusLabel(status: MockGroupMember["status"]): string {
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

function statusClass(status: MockGroupMember["status"]): string {
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

function rowClass(member: MockGroupMember): string {
  if (member.isYou) {
    return "bg-primary/5 border-l-4 border-primary hover:bg-primary/10";
  }
  if (member.status === "slow_start") {
    return "opacity-70 hover:opacity-100";
  }
  return "hover:bg-primary/5";
}

function progressBarClass(status: MockGroupMember["status"]): string {
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

function progressTextClass(status: MockGroupMember["status"]): string {
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

function activityIcon(tone: "success" | "warning" | "danger"): string {
  if (tone === "danger") {
    return "warning";
  }
  return "send";
}

function activityIconClass(tone: "success" | "warning" | "danger"): string {
  if (tone === "danger") {
    return "bg-red-500/20 text-red-500";
  }
  return "bg-primary/20 text-primary";
}

export function MyGroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const selectedGroup = mockMyGroups.find((group) => group.id === groupId) ?? mockMyGroups[0];

  if (!selectedGroup) {
    return <p className="text-sm text-slate-400">No groups available.</p>;
  }

  const goalPercent = Math.round((selectedGroup.goalCompleted / selectedGroup.goalTarget) * 100);

  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-3">
        <article className="relative overflow-hidden rounded-2xl border border-primary/10 bg-[#162e25] p-6">
          <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative z-10 mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Pot Total</p>
            <span className="rounded-md bg-primary/15 px-2 py-1 text-xs font-semibold text-primary">
              {selectedGroup.potTag}
            </span>
          </div>
          <p className="relative z-10 text-6xl font-extrabold tracking-tight text-white">
            {centsToUsd(selectedGroup.potTotalUsd * 100)}
          </p>
          <div className="relative z-10 mt-4 flex items-center gap-2 text-xs text-slate-400">
            <span className="material-icons text-sm text-primary">trending_up</span>
            <span>{selectedGroup.potDeltaLabel}</span>
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
                {selectedGroup.timeRemaining.days}
              </span>
              <span className="mt-1 block text-[10px] font-bold uppercase text-slate-500">Days</span>
            </div>
            <span className="mb-4 text-xl font-bold text-slate-600">:</span>
            <div className="text-center">
              <span className="block min-w-[3rem] rounded-lg bg-background-dark/50 p-2 font-mono text-4xl font-bold text-white">
                {selectedGroup.timeRemaining.hours}
              </span>
              <span className="mt-1 block text-[10px] font-bold uppercase text-slate-500">Hrs</span>
            </div>
            <span className="mb-4 text-xl font-bold text-slate-600">:</span>
            <div className="text-center">
              <span className="block min-w-[3rem] rounded-lg bg-background-dark/50 p-2 font-mono text-4xl font-bold text-white">
                {selectedGroup.timeRemaining.mins}
              </span>
              <span className="mt-1 block text-[10px] font-bold uppercase text-slate-500">Mins</span>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-primary/10 bg-[#162e25] p-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Group Goal</p>
            <p className="text-2xl font-bold text-white">
              {selectedGroup.goalCompleted}/{selectedGroup.goalTarget} Apps
            </p>
          </div>
          <div className="mb-2 mt-2 flex items-end gap-2">
            <p className="text-6xl font-bold text-primary">{goalPercent}%</p>
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
            <p className="mt-1 text-slate-400">Top performers this week by applications sent.</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-primary/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/30"
            >
              Current Week
            </button>
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              Last Week
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
              {selectedGroup.members.map((member, index) => {
                const percent = Math.round((member.appsSent / member.goal) * 100);
                return (
                  <tr key={member.id} className={`transition-colors ${rowClass(member)}`}>
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
                              member.isYou ? "border-primary" : "border-primary/20"
                            }`}
                          />
                        ) : (
                          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-transparent bg-slate-700 font-bold text-slate-400">
                            {initials(member.name)}
                          </span>
                        )}
                        <div>
                          <p className={`font-bold ${member.isYou ? "text-primary" : "text-white"}`}>
                            {member.name}
                            {member.isYou ? (
                              <span className="ml-2 rounded border border-slate-600 bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                YOU
                              </span>
                            ) : null}
                          </p>
                          <p className="text-sm text-slate-400">{member.role}</p>
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
                        {String(member.appsSent).padStart(2, "0")}
                        <span className="ml-1 text-xs font-normal font-sans text-slate-500">/ {member.goal}</span>
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
                        <p className={`text-xs font-bold ${progressTextClass(member.status)}`}>
                          {percent}%
                        </p>
                      </div>
                      {member.status === "at_risk" ? (
                        <p className="mt-1 text-[10px] font-medium text-red-400/80">Needs 2 more today</p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-white">
          <span className="material-icons text-base text-primary">bolt</span>
          Recent Activity
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {selectedGroup.activity.map((item) => (
            <article key={item.id} className="flex items-center gap-3 rounded-xl border border-primary/5 bg-[#162e25] p-4">
              <div className="flex items-start gap-3">
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${activityIconClass(item.tone)}`}>
                  <span className="material-icons text-sm">{activityIcon(item.tone)}</span>
                </span>
                <div>
                  <p className="text-sm">
                    <span className="font-bold text-white">
                      {item.message.split(" ").slice(0, 2).join(" ")}
                    </span>{" "}
                    <span className="text-slate-300">{item.message.split(" ").slice(2).join(" ")}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{item.timeLabel}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
