import { MemberList } from "../components/MemberList";
import { useCurrentGroup, useMemberProgress, useMembers, useWeekWindow } from "../hooks/useAppQueries";

export function MembersPage() {
  const groupQuery = useCurrentGroup();
  const membersQuery = useMembers();
  const weekQuery = useWeekWindow();
  const progressQuery = useMemberProgress(weekQuery.data?.weekId);

  if (!groupQuery.data || !membersQuery.data || !weekQuery.data || !progressQuery.data) {
    return <p className="text-sm text-slate-400">Loading members...</p>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-3xl font-black text-white">Members</h2>
        <p className="mt-1 text-slate-400">
          Week {weekQuery.data.weekId} · Shared goal {groupQuery.data.weeklyGoal} applications
        </p>
      </header>
      <MemberList
        users={membersQuery.data}
        progress={progressQuery.data}
        weeklyGoal={groupQuery.data.weeklyGoal}
      />
    </div>
  );
}
