import { useState } from "react";
import { FormField } from "./ui/FormField";

interface GoalSettingsCardProps {
  weeklyGoal: number;
  adminNote?: string;
  onSave: (input: { weeklyGoal: number; adminGoalNote?: string }) => Promise<void>;
}

export function GoalSettingsCard({ weeklyGoal, adminNote, onSave }: GoalSettingsCardProps) {
  const [goal, setGoal] = useState(String(weeklyGoal));
  const [note, setNote] = useState(adminNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsedGoal = Number(goal);
    if (!Number.isFinite(parsedGoal) || parsedGoal < 1) {
      setError("Goal must be a positive number.");
      return;
    }

    setSaving(true);
    try {
      await onSave({ weeklyGoal: parsedGoal, adminGoalNote: note });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save goal.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-primary/10 bg-surface-dark p-5">
      <h3 className="text-lg font-bold text-white">Goal Settings</h3>
      <FormField
        id="settings-goal"
        label="Shared Weekly Goal"
        value={goal}
        onChange={setGoal}
        type="number"
        helperText="Admin sets the threshold all members must hit each week."
        required
      />
      <label htmlFor="settings-note" className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Admin Note
        </span>
        <textarea
          id="settings-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </label>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-background-dark transition-colors hover:bg-primary-dark disabled:opacity-60"
      >
        {saving ? "Saving..." : "Save Goal"}
      </button>
    </form>
  );
}
