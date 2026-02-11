interface StatusBadgeProps {
  tone?: "success" | "warning" | "danger" | "neutral" | "primary";
  children: React.ReactNode;
}

const toneClasses: Record<NonNullable<StatusBadgeProps["tone"]>, string> = {
  success: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  warning: "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
  danger: "bg-red-500/10 text-red-300 border-red-500/30",
  neutral: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  primary: "bg-primary/15 text-primary border-primary/30"
};

export function StatusBadge({ tone = "neutral", children }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}
