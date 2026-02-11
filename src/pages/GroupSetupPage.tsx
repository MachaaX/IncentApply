import { useState } from "react";
import { useCurrentGroup, useJoinGroup, usePlatformConfig, useUpdateGroupGoal, useUpdateGroupName } from "../hooks/useAppQueries";
import { centsToUsd } from "../utils/format";

export function GroupSetupPage() {
  const groupQuery = useCurrentGroup();
  const configQuery = usePlatformConfig();
  const updateGoal = useUpdateGroupGoal();
  const updateGroupName = useUpdateGroupName();
  const joinGroup = useJoinGroup();

  const group = groupQuery.data;
  const config = configQuery.data;

  const [name, setName] = useState(group?.name ?? "");
  const [goal, setGoal] = useState(String(group?.weeklyGoal ?? 20));
  const [note, setNote] = useState(group?.adminGoalNote ?? "");
  const [inviteCode, setInviteCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  if (!group || !config) {
    return <p className="text-sm text-slate-400">Loading group setup...</p>;
  }

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);

    try {
      if (name.trim() && name !== group.name) {
        await updateGroupName.mutateAsync(name.trim());
      }
      const parsedGoal = Number(goal);
      if (!Number.isFinite(parsedGoal) || parsedGoal <= 0) {
        setStatus("Goal must be a positive number.");
        return;
      }
      await updateGoal.mutateAsync({ weeklyGoal: parsedGoal, adminGoalNote: note });
      setStatus("Group settings saved.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Unable to update group settings.");
    }
  };

  const join = async () => {
    setStatus(null);
    try {
      await joinGroup.mutateAsync(inviteCode);
      setStatus("Invite code verified. You are in this group.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Invite verification failed.");
    }
  };

  return (
    <div className="space-y-8">
      <header className="max-w-2xl">
        <h2 className="text-3xl font-black text-white">Squad Setup</h2>
        <p className="mt-2 text-slate-400">
          Admin sets the shared weekly threshold. Stake values are platform-controlled and read-only.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <form onSubmit={save} className="space-y-6 rounded-2xl border border-primary/10 bg-surface-dark p-6">
          <label htmlFor="group-name" className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Group Name</span>
            <input
              id="group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-3 text-sm text-white focus:border-primary focus:outline-none"
            />
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="goal-range" className="text-sm font-semibold text-white">
                Shared Weekly Goal
              </label>
              <span className="text-xl font-bold text-primary">{goal} apps</span>
            </div>
            <input
              id="goal-range"
              type="range"
              min={5}
              max={50}
              step={1}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              className="w-full accent-primary"
            />
            <p className="mt-1 text-xs text-slate-500">Applies to every member equally for this week.</p>
          </div>

          <label htmlFor="goal-note" className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Admin Note</span>
            <textarea
              id="goal-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-3 text-sm text-white focus:border-primary focus:outline-none"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-primary/10 bg-background-dark p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">Base Stake (returned)</p>
              <p className="mt-1 text-xl font-semibold text-white">
                {centsToUsd(config.stakeSplit.baseStakeCents)}
              </p>
            </div>
            <div className="rounded-lg border border-primary/10 bg-background-dark p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">Goal-Locked Stake</p>
              <p className="mt-1 text-xl font-semibold text-white">
                {centsToUsd(config.stakeSplit.goalLockedStakeCents)}
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            Stake split is controlled by platform configuration and is read-only for group admins.
          </p>

          <button
            type="submit"
            disabled={updateGoal.isPending || updateGroupName.isPending}
            className="rounded-lg bg-primary px-6 py-3 text-sm font-bold text-background-dark transition-colors hover:bg-primary-dark disabled:opacity-70"
          >
            {updateGoal.isPending || updateGroupName.isPending ? "Saving..." : "Save Group Settings"}
          </button>
          {status ? <p className="text-sm text-primary">{status}</p> : null}
        </form>

        <aside className="space-y-4 rounded-2xl border border-primary/10 bg-surface-dark p-6">
          <h3 className="text-lg font-bold text-white">Join Existing Group</h3>
          <p className="text-sm text-slate-400">Use an invite code to verify membership.</p>
          <input
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
            placeholder="Enter invite code"
            className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-3 text-sm text-white focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void join()}
            disabled={joinGroup.isPending}
            className="w-full rounded-lg border border-primary/30 px-4 py-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-70"
          >
            {joinGroup.isPending ? "Checking..." : "Join Group"}
          </button>
          <div className="rounded-lg border border-dashed border-border-dark bg-background-dark p-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">Your Current Invite Code</p>
            <p className="mt-1 text-xl font-bold text-white">{group.inviteCode}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
