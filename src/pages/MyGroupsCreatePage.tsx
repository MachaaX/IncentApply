import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCheckUserExistsByEmail, useCreateGroup } from "../hooks/useAppQueries";
import { centsToUsd } from "../utils/format";

const GROUP_NAME_LIMIT = 30;
const GOAL_MIN = 3;
const GOAL_MAX = 300;
const STAKE_MIN = 0;
const STAKE_MAX = 100;

type WizardStep = 1 | 2;
type GoalCycle = "daily" | "weekly" | "biweekly";

const cycleOptions: Array<{ value: GoalCycle; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" }
];

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function previewInviteCode(): string {
  return `SQ-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function MyGroupsCreatePage() {
  const navigate = useNavigate();
  const createGroup = useCreateGroup();
  const checkUserExists = useCheckUserExistsByEmail();

  const [step, setStep] = useState<WizardStep>(1);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState(20);
  const [stake, setStake] = useState(15);
  const [goalCycle, setGoalCycle] = useState<GoalCycle>("weekly");
  const [inviteEmailInput, setInviteEmailInput] = useState("");
  const [inviteEmails, setInviteEmails] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [codePreview, setCodePreview] = useState(() => previewInviteCode());

  const resetWizard = useCallback(() => {
    setStep(1);
    setName("");
    setGoal(20);
    setStake(15);
    setGoalCycle("weekly");
    setInviteEmailInput("");
    setInviteEmails([]);
    setStatus(null);
    setCodePreview(previewInviteCode());
  }, []);

  useEffect(() => {
    const handler = () => {
      resetWizard();
    };
    window.addEventListener("incentapply:create-group-fresh-start", handler);
    return () => window.removeEventListener("incentapply:create-group-fresh-start", handler);
  }, [resetWizard]);

  const goalPercent = useMemo(
    () => ((goal - GOAL_MIN) / (GOAL_MAX - GOAL_MIN)) * 100,
    [goal]
  );
  const stakePercent = useMemo(
    () => ((stake - STAKE_MIN) / (STAKE_MAX - STAKE_MIN)) * 100,
    [stake]
  );

  const handleContinue = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatus("Group name is required.");
      return;
    }

    if (trimmedName.length > GROUP_NAME_LIMIT) {
      window.alert("Group name must stay within 30 characters before continuing.");
      setStatus("Please keep the group name within 30 characters.");
      return;
    }

    setStatus(null);
    setStep(2);
  };

  const addInviteEmail = async () => {
    const normalized = inviteEmailInput.trim().toLowerCase();
    if (!normalized) {
      return;
    }
    if (!isValidEmail(normalized)) {
      setStatus("Enter a valid email address.");
      return;
    }
    if (inviteEmails.includes(normalized)) {
      setStatus("This email is already added.");
      return;
    }

    try {
      const exists = await checkUserExists.mutateAsync(normalized);
      if (!exists) {
        window.alert(
          "This user does not exist. Ask them to sign up first, or send them the invite code instead."
        );
        setStatus("User not found in database.");
        return;
      }

      setInviteEmails((current) => [...current, normalized]);
      setInviteEmailInput("");
      setStatus(null);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Unable to verify user email.");
    }
  };

  const removeInviteEmail = (targetEmail: string) => {
    setInviteEmails((current) => current.filter((email) => email !== targetEmail));
  };

  const handleCreateGroup = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatus("Group name is required.");
      return;
    }
    if (trimmedName.length > GROUP_NAME_LIMIT) {
      window.alert("Group name must stay within 30 characters before creating the group.");
      setStatus("Please keep the group name within 30 characters.");
      return;
    }

    try {
      const createdGroup = await createGroup.mutateAsync({
        name: trimmedName,
        applicationGoal: goal,
        stakeUsd: stake,
        goalCycle,
        inviteEmails
      });
      navigate(`/my-groups/${createdGroup.group.id}`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Unable to create group.");
    }
  };

  const pending = createGroup.isPending || checkUserExists.isPending;

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
              <li className={`flex items-start gap-3 ${step === 2 ? "opacity-60" : ""}`}>
                <span
                  className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    step === 1
                      ? "bg-primary text-background-dark shadow-[0_0_10px_rgba(17,212,147,0.4)]"
                      : "border border-[#326755] bg-[#23483c] text-[#b9e8d8]"
                  }`}
                >
                  1
                </span>
                <div className="pt-1">
                  <p className="text-sm font-bold text-white">Group Details</p>
                  <p className={`text-xs ${step === 1 ? "text-primary" : "text-[#92c9b7]"}`}>
                    {step === 1 ? "In Progress" : "Finished"}
                  </p>
                </div>
              </li>
              <li className={`flex items-start gap-3 ${step === 1 ? "opacity-50" : ""}`}>
                <span
                  className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    step === 2
                      ? "bg-primary text-background-dark shadow-[0_0_10px_rgba(17,212,147,0.4)]"
                      : "border border-[#326755] bg-[#23483c] text-[#64877a]"
                  }`}
                >
                  2
                </span>
                <div className="pt-1">
                  <p className="text-sm font-bold text-white">Review & Invite</p>
                  <p className={`text-xs ${step === 2 ? "text-primary" : "text-[#64877a]"}`}>
                    {step === 2 ? "In Progress" : "Pending"}
                  </p>
                </div>
              </li>
            </ol>

            <div className="mt-auto rounded-lg border border-[#326755] bg-gradient-to-br from-[#23483c] to-[#162e26] p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="material-icons text-sm text-primary">info</span>
                <span className="text-xs font-bold uppercase tracking-wider text-white">Pro Tip</span>
              </div>
              <p className="text-xs leading-relaxed text-[#92c9b7]">
                Choose a cycle your members can sustain. You can update cycle, goal, and stake later
                from group settings as admin.
              </p>
            </div>
          </aside>

          <div className="flex min-h-0 flex-col p-6 md:p-7">
            <div className="min-h-0 flex-1 pr-1">
              {step === 1 ? (
                <div className="space-y-5">
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
                    <p className="text-xs text-[#64877a]">{name.length}/{GROUP_NAME_LIMIT}</p>
                  </label>

                  <div className="space-y-3 border-t border-border-dark pt-4">
                    <p className="text-base font-medium text-white">Goal Cycle</p>
                    <div className="inline-flex rounded-lg border border-border-dark bg-[#10221c] p-1">
                      {cycleOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setGoalCycle(option.value)}
                          className={`rounded-md px-4 py-2 text-sm font-bold transition-colors ${
                            goalCycle === option.value
                              ? "bg-primary text-background-dark"
                              : "text-[#92c9b7] hover:text-white"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4 border-t border-border-dark pt-4">
                    <div className="flex items-end justify-between">
                      <span className="text-base font-medium text-white">Application Goal</span>
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
                        min={GOAL_MIN}
                        max={GOAL_MAX}
                        step={1}
                        value={goal}
                        onChange={(event) => setGoal(Number(event.target.value))}
                        className="group-setup-range relative z-10"
                      />
                    </div>
                    <div className="flex justify-between text-xs font-medium uppercase tracking-wide text-[#64877a]">
                      <span>Casual (3)</span>
                      <span>Grind (300)</span>
                    </div>
                  </div>

                  <div className="space-y-4 border-t border-border-dark pt-4">
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-base font-medium text-white">Stake</p>
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
                      <input
                        type="range"
                        min={STAKE_MIN}
                        max={STAKE_MAX}
                        step={1}
                        value={stake}
                        onChange={(event) => setStake(Number(event.target.value))}
                        className="group-setup-range relative z-10"
                      />
                    </div>
                    <div className="flex justify-between text-xs font-medium uppercase tracking-wide text-[#64877a]">
                      <span>Free ($0)</span>
                      <span className="text-[#ff4d4d]">High Stakes ($100)</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-xl border border-primary/20 bg-[#11221c] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#92c9b7]">
                      Group Invite Code
                    </p>
                    <p className="mt-1 text-2xl font-black text-white">{codePreview}</p>
                    <p className="mt-2 text-xs text-[#64877a]">
                      Final invite code and expiry are written to the database when you click Create
                      Group.
                    </p>
                  </div>

                  <div className="rounded-xl border border-primary/20 bg-[#11221c] p-4">
                    <p className="text-sm font-bold text-white">Current Settings</p>
                    <p className="mt-1 text-xs text-[#64877a]">
                      Cycle: <span className="text-[#92c9b7] capitalize">{goalCycle}</span> · Goal:{" "}
                      <span className="text-[#92c9b7]">{goal} apps</span> · Stake:{" "}
                      <span className="text-[#92c9b7]">{centsToUsd(stake * 100)}</span>
                    </p>
                  </div>

                  <div className="rounded-xl border border-primary/20 bg-[#11221c] p-4">
                    <p className="text-sm font-bold text-white">Invite by Email</p>
                    <p className="mt-1 text-xs text-[#64877a]">
                      We only add users who already exist in the database.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input
                        value={inviteEmailInput}
                        onChange={(event) => setInviteEmailInput(event.target.value)}
                        placeholder="name@example.com"
                        className="w-full rounded-lg border border-[#23483c] bg-[#10221c] px-4 py-2.5 text-white placeholder:text-[#4a6b5d] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={() => void addInviteEmail()}
                        disabled={checkUserExists.isPending}
                        className="rounded-lg border border-primary/30 bg-[#162e26] px-4 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-[#1f4236] disabled:opacity-70"
                      >
                        {checkUserExists.isPending ? "Checking..." : "Add"}
                      </button>
                    </div>

                    <ul className="mt-3 space-y-2">
                      {inviteEmails.map((email) => (
                        <li
                          key={email}
                          className="flex items-center justify-between rounded-lg border border-[#23483c] bg-[#10221c] px-3 py-2 text-sm"
                        >
                          <span className="text-[#92c9b7]">{email}</span>
                          <button
                            type="button"
                            onClick={() => removeInviteEmail(email)}
                            className="text-xs font-bold uppercase tracking-wide text-slate-300 transition-colors hover:text-white"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 border-t border-border-dark pt-5">
              <div className="flex items-center justify-between">
                {step === 1 ? (
                  <button
                    type="button"
                    onClick={() => navigate(-1)}
                    className="px-3 py-2 text-sm font-bold text-[#92c9b7] transition-colors hover:text-white"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="px-3 py-2 text-sm font-bold text-[#92c9b7] transition-colors hover:text-white"
                  >
                    Previous
                  </button>
                )}

                {step === 1 ? (
                  <button
                    type="button"
                    onClick={handleContinue}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3 text-sm font-bold text-background-dark shadow-[0_4px_14px_0_rgba(17,212,147,0.39)] transition-all hover:-translate-y-0.5 hover:bg-emerald-400"
                  >
                    <span>Continue</span>
                    <span className="material-icons text-base">arrow_forward</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleCreateGroup()}
                    disabled={pending}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3 text-sm font-bold text-background-dark shadow-[0_4px_14px_0_rgba(17,212,147,0.39)] transition-all hover:-translate-y-0.5 hover:bg-emerald-400 disabled:opacity-70"
                  >
                    <span>{createGroup.isPending ? "Creating..." : "Create Group"}</span>
                    <span className="material-icons text-base">check_circle</span>
                  </button>
                )}
              </div>
              {status ? <p className="mt-2 text-sm text-primary">{status}</p> : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
