interface ProgressBarProps {
  value: number;
  max?: number;
  tone?: "primary" | "danger" | "neutral";
}

export function ProgressBar({ value, max = 100, tone = "primary" }: ProgressBarProps) {
  const percent = Math.min(100, Math.max(0, Math.round((value / max) * 100)));
  const fillClass =
    tone === "danger"
      ? "bg-red-500"
      : tone === "neutral"
        ? "bg-slate-400"
        : "bg-gradient-to-r from-primary to-emerald-300";

  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-background-dark/80" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] duration-300 ${fillClass}`} style={{ width: `${percent}%` }} />
    </div>
  );
}
