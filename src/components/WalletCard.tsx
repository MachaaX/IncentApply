import type { Wallet } from "../domain/types";
import { centsToUsd } from "../utils/format";

interface WalletCardProps {
  wallet: Wallet;
}

export function WalletCard({ wallet }: WalletCardProps) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-primary/10 bg-surface-dark p-6">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
      <div className="relative space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Available Balance
        </p>
        <div className="flex items-end gap-2">
          <p className="text-5xl font-bold text-white">{centsToUsd(wallet.availableBalanceCents)}</p>
          <span className="pb-2 text-sm text-slate-400">USD</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-primary/10 bg-background-dark p-3">
            <p className="text-xs text-slate-500">Total Contributed</p>
            <p className="text-lg font-semibold text-white">{centsToUsd(wallet.totalContributedCents)}</p>
          </div>
          <div className="rounded-lg border border-primary/10 bg-background-dark p-3">
            <p className="text-xs text-slate-500">Total Penalties</p>
            <p className="text-lg font-semibold text-red-300">{centsToUsd(wallet.totalPenaltiesCents)}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
