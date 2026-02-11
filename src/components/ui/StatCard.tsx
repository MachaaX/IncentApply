interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  badge?: string;
  children?: React.ReactNode;
}

export function StatCard({ title, value, subtitle, badge, children }: StatCardProps) {
  return (
    <section className="rounded-2xl border border-primary/10 bg-surface-dark p-5 shadow-lg">
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</p>
        {badge ? (
          <span className="rounded bg-primary/15 px-2 py-1 text-xs font-semibold text-primary">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="text-3xl font-extrabold text-white">{value}</p>
      {subtitle ? <p className="mt-1 text-xs text-slate-400">{subtitle}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}
