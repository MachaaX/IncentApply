import type { MemberProgress, User } from "../domain/types";
import { initialism } from "../utils/format";
import { StatusBadge } from "./ui/StatusBadge";

interface MemberListProps {
  users: User[];
  progress: MemberProgress[];
  weeklyGoal: number;
}

export function MemberList({ users, progress, weeklyGoal }: MemberListProps) {
  const progressByUser = Object.fromEntries(progress.map((entry) => [entry.userId, entry]));

  return (
    <section className="rounded-xl border border-primary/10 bg-surface-dark p-5">
      <h2 className="mb-4 text-lg font-bold text-white">Group Members</h2>
      <ul className="space-y-3">
        {users.map((user) => {
          const item = progressByUser[user.id];
          const isMet = item?.applicationsSent >= weeklyGoal;

          return (
            <li
              key={user.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/10 bg-background-dark px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/25 bg-surface-dark font-bold text-primary">
                  {initialism(user.firstName, user.lastName)}
                </div>
                <div>
                  <p className="font-semibold text-white">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="text-xs text-slate-500">{user.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-white">
                  {item?.applicationsSent ?? 0}/{weeklyGoal}
                </span>
                <StatusBadge tone={isMet ? "success" : "warning"}>{isMet ? "Goal Met" : "In Progress"}</StatusBadge>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
