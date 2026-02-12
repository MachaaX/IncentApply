import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  useCurrentGroup,
  usePlatformConfig,
  useUpdateGroupGoal,
  useUpdateGroupName
} from "../hooks/useAppQueries";
import { centsToUsd } from "../utils/format";

export function MyGroupsCreatePage() {
  const navigate = useNavigate();
  const groupQuery = useCurrentGroup();
  const configQuery = usePlatformConfig();
  const updateGroupName = useUpdateGroupName();
  const updateGroupGoal = useUpdateGroupGoal();

  const [name, setName] = useState("");
  const [goal, setGoal] = useState(20);
  const [stake, setStake] = useState(15);
  const [status, setStatus] = useState<string | null>(null);

  const group = groupQuery.data;
  const config = configQuery.data;

  useEffect(() => {
    if (!group) {
      return;
    }
    setName((current) => current || group.name);
    setGoal((current) => (current === 20 ? group.weeklyGoal : current));
  }, [group]);

  if (!group || !config) {
    return <p className="text-sm text-slate-400">Loading create group...</p>;
  }

  const onSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);

    const nextName = name.trim();
    if (!nextName) {
      setStatus("Group name is required.");
      return;
    }

    try {
      if (nextName !== group.name) {
        await updateGroupName.mutateAsync(nextName);
      }
      await updateGroupGoal.mutateAsync({ weeklyGoal: goal });
      setStatus("Group setup saved. Redirecting to group dashboard...");
      navigate(`/my-groups/${group.id}`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Unable to save group.");
    }
  };

  const pending = updateGroupGoal.isPending || updateGroupName.isPending;
  const goalPercent = ((goal - 5) / (50 - 5)) * 100;
  const stakePercent = ((stake - 0) / (100 - 0)) * 100;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-5 text-center">
        <h1 className="text-4xl font-black leading-tight tracking-[-0.03em] text-white md:text-5xl">
          Squad Up & <span className="text-primary">Get Hired</span>
        </h1>
        <p className="mx-auto mt-2 max-w-2xl text-base text-[#92c9b7] md:text-lg">
          Create a circle to compete with friends. Hit your goals to win the pot, or miss them and
          pay the price.
        </p>
      </div>

      <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border-dark bg-surface-dark shadow-2xl shadow-black/40">
        <div className="grid h-full min-h-0 md:grid-cols-[290px_1fr]">
          <aside className="flex min-h-0 flex-col border-b border-border-dark bg-[#11221c] p-6 md:border-b-0 md:border-r md:p-7">
            <div>
              <h3 className="text-xl font-bold text-white">Setup Wizard</h3>
              <p className="mt-1 text-sm text-[#64877a]">Complete these steps to launch your group.</p>
            </div>

            <ol className="relative mt-7 space-y-6">
              <li className="flex items-start gap-3">
                <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-background-dark shadow-[0_0_10px_rgba(17,212,147,0.4)]">
                  1
                </span>
                <div className="pt-1">
                  <p className="text-sm font-bold text-white">Group Details</p>
                  <p className="text-xs text-primary">In Progress</p>
                </div>
              </li>
              <li className="flex items-start gap-3 opacity-50">
                <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[#326755] bg-[#23483c] text-sm font-bold text-[#64877a]">
                  2
                </span>
                <div className="pt-1">
                  <p className="text-sm font-bold text-white">Set The Stakes</p>
                  <p className="text-xs text-[#64877a]">Pending</p>
                </div>
              </li>
              <li className="flex items-start gap-3 opacity-50">
                <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[#326755] bg-[#23483c] text-sm font-bold text-[#64877a]">
                  3
                </span>
                <div className="pt-1">
                  <p className="text-sm font-bold text-white">Review & Invite</p>
                  <p className="text-xs text-[#64877a]">Pending</p>
                </div>
              </li>
            </ol>

            <div className="mt-auto rounded-lg border border-[#326755] bg-gradient-to-br from-[#23483c] to-[#162e26] p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="material-icons text-sm text-primary">info</span>
                <span className="text-xs font-bold uppercase tracking-wider text-white">Pro Tip</span>
              </div>
              <p className="text-xs leading-relaxed text-[#92c9b7]">
                Groups with stakes over $10/week see a 40% higher application rate.
              </p>
            </div>
          </aside>

          <form onSubmit={onSave} className="flex min-h-0 flex-col p-6 md:p-7">
            <div className="mb-6 inline-flex w-fit flex-none items-center self-start rounded-lg border border-border-dark bg-[#10221c] p-1">
              <button
                type="button"
                className="inline-flex flex-none items-center rounded-md bg-primary px-6 py-2 text-sm font-bold text-background-dark"
              >
                Create Group
              </button>
              <Link
                to="/my-groups/join"
                className="inline-flex flex-none items-center rounded-md px-6 py-2 text-sm font-bold text-[#92c9b7] transition-colors hover:text-white"
              >
                Join Group
              </Link>
            </div>

            <div className="min-h-0 flex-1 space-y-5">
              <label htmlFor="create-group-name" className="block space-y-2">
                <span className="text-base font-medium text-white">Group Name</span>
                <div className="relative">
                  <span className="material-icons pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#64877a]">
                    groups
                  </span>
                  <input
                    id="create-group-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-lg border border-[#23483c] bg-[#10221c] py-3 pl-12 pr-4 text-white placeholder:text-[#4a6b5d] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="e.g. The Job Hunters"
                    required
                  />
                </div>
              </label>

              <div className="space-y-4 border-t border-border-dark pt-4">
                <div className="flex items-end justify-between">
                  <span className="text-base font-medium text-white">Weekly Application Goal</span>
                  <span className="text-2xl font-bold text-primary">
                    {goal} <span className="text-sm font-normal text-[#92c9b7]">apps</span>
                  </span>
                </div>
                <div className="relative h-6">
                  <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded bg-[#23483c]" />
                  <div
                    className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded bg-primary transition-[width] duration-150"
                    style={{ width: `${goalPercent}%` }}
                  />
                  <input
                    type="range"
                    min={5}
                    max={50}
                    step={5}
                    value={goal}
                    onChange={(event) => setGoal(Number(event.target.value))}
                    className="group-setup-range relative z-10"
                  />
                </div>
                <div className="flex justify-between text-xs font-medium uppercase tracking-wide text-[#64877a]">
                  <span>Casual (5)</span>
                  <span>Grind (50)</span>
                </div>
              </div>

              <div className="space-y-4 border-t border-border-dark pt-4">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-base font-medium text-white">Weekly Stake</p>
                    <p className="text-xs text-[#64877a]">Amount per person, held in escrow.</p>
                  </div>
                  <span className="text-2xl font-bold text-white">{centsToUsd(stake * 100)}</span>
                </div>
                <div className="relative h-6">
                  <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded bg-[#23483c]" />
                  <div
                    className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded bg-primary transition-[width] duration-150"
                    style={{ width: `${stakePercent}%` }}
                  />
                  <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded bg-gradient-to-r from-transparent via-transparent to-[#ff4d4d] opacity-20" />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={stake}
                    onChange={(event) => setStake(Number(event.target.value))}
                    className="group-setup-range relative z-10"
                  />
                </div>
                <div className="flex justify-between text-xs font-medium uppercase tracking-wide text-[#64877a]">
                  <span>Free ($0)</span>
                  <span className="text-[#ff4d4d]">High Stakes ($100)</span>
                </div>
                <p className="text-xs text-[#64877a]">
                  Platform split: {centsToUsd(config.stakeSplit.baseStakeCents)} base +{" "}
                  {centsToUsd(config.stakeSplit.goalLockedStakeCents)} goal-locked.
                </p>
              </div>
            </div>

            <div className="mt-6 border-t border-border-dark pt-5">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="px-3 py-2 text-sm font-bold text-[#92c9b7] transition-colors hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3 text-sm font-bold text-background-dark shadow-[0_4px_14px_0_rgba(17,212,147,0.39)] transition-all hover:-translate-y-0.5 hover:bg-emerald-400 disabled:opacity-70"
                >
                  <span>{pending ? "Saving..." : "Continue"}</span>
                  <span className="material-icons text-base">arrow_forward</span>
                </button>
              </div>
              {status ? <p className="mt-2 text-sm text-primary">{status}</p> : null}
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
