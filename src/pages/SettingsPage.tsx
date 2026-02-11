import { GoalSettingsCard } from "../components/GoalSettingsCard";
import { useCurrentGroup, usePlatformConfig, useUpdateGroupGoal } from "../hooks/useAppQueries";
import { centsToUsd } from "../utils/format";

export function SettingsPage() {
  const groupQuery = useCurrentGroup();
  const configQuery = usePlatformConfig();
  const updateGoal = useUpdateGroupGoal();

  if (!groupQuery.data || !configQuery.data) {
    return <p className="text-sm text-slate-400">Loading settings...</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <GoalSettingsCard
        weeklyGoal={groupQuery.data.weeklyGoal}
        adminNote={groupQuery.data.adminGoalNote}
        onSave={(input) => updateGoal.mutateAsync(input).then(() => undefined)}
      />

      <aside className="space-y-4 rounded-xl border border-primary/10 bg-surface-dark p-5">
        <h3 className="text-lg font-bold text-white">Platform Defaults</h3>
        <div className="rounded-lg border border-primary/10 bg-background-dark p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Base Stake</p>
          <p className="text-xl font-semibold text-white">
            {centsToUsd(configQuery.data.stakeSplit.baseStakeCents)}
          </p>
        </div>
        <div className="rounded-lg border border-primary/10 bg-background-dark p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Goal-Locked Stake</p>
          <p className="text-xl font-semibold text-white">
            {centsToUsd(configQuery.data.stakeSplit.goalLockedStakeCents)}
          </p>
        </div>
        <div className="rounded-lg border border-primary/10 bg-background-dark p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Timezone</p>
          <p className="text-sm font-semibold text-white">{groupQuery.data.timezone}</p>
        </div>
        <div className="rounded-lg border border-dashed border-border-dark bg-background-dark p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">Keyword Rules</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {configQuery.data.keywordRules.map((rule) => (
              <li key={rule.id}>{rule.label}</li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
