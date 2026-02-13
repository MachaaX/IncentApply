import { type FormEvent, useMemo, useState } from "react";
import type { BankAccount, Transaction } from "../domain/types";
import { useWallet, useWithdraw } from "../hooks/useAppQueries";
import { centsToUsd, dateLabel } from "../utils/format";

type HistoryFilter = "all" | "deductions" | "winnings";

const CODE_HTML_MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: "tx-code-pot-win-2023-10-24",
    userId: "user-alex",
    groupId: "group-1",
    weekId: "week-42",
    type: "penalty_share",
    amountCents: 12500,
    description: "Week 42 Winner Distribution",
    status: "completed",
    createdAt: "2023-10-24T12:00:00.000Z"
  },
  {
    id: "tx-code-stake-2023-10-20",
    userId: "user-alex",
    groupId: "group-1",
    weekId: "week-42",
    type: "stake_contribution",
    amountCents: -2000,
    description: "Buy-in for Week 42",
    status: "completed",
    createdAt: "2023-10-20T12:00:00.000Z"
  },
  {
    id: "tx-code-penalty-2023-10-13",
    userId: "user-alex",
    groupId: "group-1",
    weekId: "week-41",
    type: "penalty_loss",
    amountCents: -500,
    description: "Missed Goal (3/5 Apps)",
    status: "completed",
    createdAt: "2023-10-13T13:00:00.000Z"
  },
  {
    id: "tx-code-stake-2023-10-13",
    userId: "user-alex",
    groupId: "group-1",
    weekId: "week-41",
    type: "stake_contribution",
    amountCents: -2000,
    description: "Buy-in for Week 41",
    status: "completed",
    createdAt: "2023-10-13T09:00:00.000Z"
  },
  {
    id: "tx-code-deposit-2023-10-06",
    userId: "user-alex",
    groupId: "group-1",
    weekId: "week-40",
    type: "deposit",
    amountCents: 10000,
    description: "Initial Account Funding",
    status: "completed",
    createdAt: "2023-10-06T15:30:00.000Z"
  },
  {
    id: "tx-code-stake-2023-09-29",
    userId: "user-alex",
    groupId: "group-1",
    weekId: "week-40",
    type: "stake_contribution",
    amountCents: -2000,
    description: "Buy-in for Week 40",
    status: "completed",
    createdAt: "2023-09-29T12:00:00.000Z"
  },
  {
    id: "tx-code-pot-win-2023-09-29",
    userId: "user-alex",
    groupId: "group-1",
    weekId: "week-40",
    type: "penalty_share",
    amountCents: 7500,
    description: "Week 40 Winner Distribution",
    status: "completed",
    createdAt: "2023-09-29T18:00:00.000Z"
  },
  {
    id: "tx-code-stake-2023-09-22",
    userId: "user-alex",
    groupId: "group-1",
    weekId: "week-39",
    type: "stake_contribution",
    amountCents: -2000,
    description: "Buy-in for Week 39",
    status: "completed",
    createdAt: "2023-09-22T12:00:00.000Z"
  },
  {
    id: "tx-code-penalty-2023-09-22",
    userId: "user-alex",
    groupId: "group-1",
    weekId: "week-39",
    type: "penalty_loss",
    amountCents: -500,
    description: "Missed Goal (4/5 Apps)",
    status: "completed",
    createdAt: "2023-09-22T14:00:00.000Z"
  },
  {
    id: "tx-code-deposit-2023-09-08",
    userId: "user-alex",
    groupId: "group-1",
    weekId: "week-37",
    type: "deposit",
    amountCents: 5000,
    description: "Top-up Deposit",
    status: "completed",
    createdAt: "2023-09-08T10:00:00.000Z"
  }
];

const FALLBACK_LINKED_ACCOUNT: BankAccount = {
  id: "bank-mock-chase",
  userId: "user-alex",
  bankName: "Chase Checking",
  accountType: "checking",
  last4: "8888",
  routingMasked: "***0210",
  nickname: "Chase Checking",
  isPrimary: true
};

function transactionLabel(type: Transaction["type"]): string {
  switch (type) {
    case "stake_contribution":
      return "Weekly Stake";
    case "penalty_loss":
      return "Penalty Fee";
    case "penalty_share":
      return "Pot Win Share";
    case "base_return":
      return "Base Return";
    case "goal_return":
      return "Goal Return";
    case "deposit":
      return "Deposit";
    case "withdrawal":
      return "Withdrawal";
    default:
      return "Adjustment";
  }
}

function transactionSubtitle(tx: Transaction): string {
  if (tx.description.trim().length) {
    return tx.description;
  }
  if (tx.type === "stake_contribution") {
    return "Weekly buy-in";
  }
  if (tx.type === "penalty_loss") {
    return "Penalty deduction";
  }
  if (tx.type === "penalty_share") {
    return "Winner distribution";
  }
  if (tx.type === "deposit") {
    return "Wallet funding";
  }
  if (tx.type === "withdrawal") {
    return "Payout to linked account";
  }
  return "Wallet transaction";
}

function transactionIconMeta(tx: Transaction): {
  icon: string;
  iconWrapClass: string;
  amountClass: string;
  statusClass: string;
  statusLabel: string;
} {
  const isPositive = tx.amountCents > 0;
  const isPenalty = tx.type === "penalty_loss";
  const isStake = tx.type === "stake_contribution" || tx.type === "withdrawal";
  const icon =
    tx.type === "penalty_loss"
      ? "priority_high"
      : tx.type === "stake_contribution" || tx.type === "withdrawal"
        ? "remove_circle_outline"
        : tx.type === "deposit"
          ? "account_balance_wallet"
          : "emoji_events";

  const iconWrapClass = isPenalty
    ? "bg-red-500/20 text-red-400"
    : isStake
      ? "bg-white/10 text-slate-400"
      : "bg-primary/15 text-primary";

  const amountClass = isPenalty
    ? "text-red-400"
    : isPositive
      ? "text-primary"
      : "text-white";

  const statusClass =
    tx.status === "completed"
      ? tx.type === "deposit"
        ? "bg-green-900/30 text-green-400"
        : "bg-slate-800 text-slate-300"
      : tx.status === "pending"
        ? "bg-yellow-900/40 text-secondary-gold"
        : "bg-red-900/30 text-red-300";

  const statusLabel =
    tx.status === "completed"
      ? tx.type === "deposit"
        ? "Success"
        : tx.type === "penalty_loss"
          ? "Deducted"
          : isPositive
            ? "Completed"
            : "Paid"
      : tx.status === "pending"
        ? "Pending"
        : "Failed";

  return { icon, iconWrapClass, amountClass, statusClass, statusLabel };
}

function belongsToFilter(tx: Transaction, filter: HistoryFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "deductions") {
    return tx.amountCents < 0;
  }
  return tx.amountCents > 0;
}

export function WalletPage() {
  const walletQuery = useWallet();
  const withdrawMutation = useWithdraw();

  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [linkedAccountOverlayOpen, setLinkedAccountOverlayOpen] = useState(false);
  const [allTransactionsOverlayOpen, setAllTransactionsOverlayOpen] = useState(false);
  const [selectedBank, setSelectedBank] = useState<string>("");
  const [withdrawAmount, setWithdrawAmount] = useState("0");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "warning">("success");

  const wallet = walletQuery.data;

  const sortedTransactions = useMemo(() => {
    const mergedById = new Map<string, Transaction>();
    for (const tx of CODE_HTML_MOCK_TRANSACTIONS) {
      mergedById.set(tx.id, tx);
    }
    for (const tx of wallet?.transactions ?? []) {
      mergedById.set(tx.id, tx);
    }
    return [...mergedById.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [wallet?.transactions]);

  const recentTransactions = useMemo(() => sortedTransactions.slice(0, 10), [sortedTransactions]);

  const filteredTransactions = useMemo(
    () => recentTransactions.filter((tx) => belongsToFilter(tx, historyFilter)),
    [historyFilter, recentTransactions]
  );

  const weeklyStakeCents = useMemo(() => {
    const stake = recentTransactions.find((tx) => tx.type === "stake_contribution");
    if (!stake) {
      return 2000;
    }
    return Math.max(Math.abs(stake.amountCents), 0);
  }, [recentTransactions]);

  const potentialWinCents = useMemo(() => {
    const base = weeklyStakeCents || 2000;
    return base * 16;
  }, [weeklyStakeCents]);

  if (!wallet) {
    return <p className="text-sm text-slate-400">Loading wallet...</p>;
  }

  const primaryBank = wallet.bankAccounts.find((account) => account.isPrimary) ?? wallet.bankAccounts[0];
  const linkedAccount = primaryBank ?? {
    ...FALLBACK_LINKED_ACCOUNT,
    userId: wallet.userId
  };
  const linkedAccountSummary = `${linkedAccount.bankName} Ending in •••• ${linkedAccount.last4}`;

  const submitWithdrawal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusMessage(null);

    const amountCents = Math.round(Number(withdrawAmount) * 100);
    const destinationBankId = selectedBank || primaryBank?.id;
    if (!destinationBankId) {
      setStatusTone("warning");
      setStatusMessage("Please connect a bank account before withdrawing.");
      return;
    }

    try {
      await withdrawMutation.mutateAsync({ amountCents, bankAccountId: destinationBankId });
      setStatusTone("success");
      setStatusMessage(`Withdrawal submitted for ${centsToUsd(amountCents)}.`);
      setWithdrawAmount("0");
      setWithdrawOpen(false);
    } catch (error) {
      setStatusTone("warning");
      setStatusMessage(error instanceof Error ? error.message : "Withdrawal failed.");
    }
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-3xl font-bold text-white">My Wallet</h1>
            <p className="mt-1 text-slate-400">Manage your weekly stakes, penalties, and winnings.</p>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-5">
            <section className="group relative overflow-hidden rounded-xl border border-primary/15 bg-surface-dark p-6 shadow-lg">
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/20 blur-[60px] transition-all duration-700 group-hover:bg-primary/30" />
              <div className="relative z-10">
                <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-slate-400">
                  Available Balance
                </h2>
                <div className="mb-6 flex items-baseline gap-1">
                  <span className="text-5xl font-bold tracking-tight text-white">
                    {centsToUsd(wallet.availableBalanceCents)}
                  </span>
                  <span className="text-lg font-normal text-slate-400">USD</span>
                </div>

                <div className="mb-6 grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-white/5 bg-background-dark p-3">
                    <span className="mb-1 block text-xs text-slate-400">Weekly Stake</span>
                    <span className="block text-lg font-semibold text-white">{centsToUsd(weeklyStakeCents)}</span>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-background-dark p-3">
                    <span className="mb-1 block text-xs text-slate-400">Potential Win</span>
                    <span className="block text-lg font-semibold text-primary">
                      {centsToUsd(potentialWinCents)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setWithdrawOpen((open) => !open)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-4 font-bold text-background-dark shadow-lg shadow-primary/20 transition-all hover:scale-[1.01] hover:bg-primary-dark active:scale-[0.99]"
                >
                  <span>{withdrawOpen ? "Hide Withdraw" : "Withdraw Funds"}</span>
                  <span className="material-icons text-lg">arrow_outward</span>
                </button>

                {withdrawOpen ? (
                  <form
                    onSubmit={submitWithdrawal}
                    className="mt-4 space-y-3 rounded-lg border border-primary/20 bg-background-dark p-3"
                  >
                    <label className="block">
                      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                        Amount (USD)
                      </span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={withdrawAmount}
                        onChange={(event) => setWithdrawAmount(event.target.value)}
                        className="w-full rounded-lg border border-border-dark bg-surface-darker px-3 py-2 text-sm text-white outline-none transition-colors focus:border-primary"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                        Destination
                      </span>
                      <select
                        value={selectedBank}
                        onChange={(event) => setSelectedBank(event.target.value)}
                        className="w-full rounded-lg border border-border-dark bg-surface-darker px-3 py-2 text-sm text-white outline-none transition-colors focus:border-primary"
                      >
                        <option value="">
                          Primary ({primaryBank ? `${primaryBank.bankName} •••• ${primaryBank.last4}` : "None"})
                        </option>
                        {wallet.bankAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.bankName} •••• {account.last4}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="submit"
                      disabled={withdrawMutation.isPending}
                      className="w-full rounded-lg border border-primary/35 bg-primary/15 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {withdrawMutation.isPending ? "Processing..." : "Confirm Withdrawal"}
                    </button>
                  </form>
                ) : null}
              </div>
            </section>

            <section className="rounded-xl border border-primary/15 bg-surface-dark p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold text-white">Linked Account</h3>
                <button
                  type="button"
                  onClick={() => setLinkedAccountOverlayOpen(true)}
                  className="text-xs font-medium text-primary transition-colors hover:text-primary-dark"
                >
                  Manage
                </button>
              </div>

              <div className="flex items-center gap-4 rounded-lg border border-white/5 bg-background-dark p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-dark shadow-sm">
                  <span className="material-icons text-slate-400">account_balance</span>
                </div>
                <div className="flex-grow">
                  <p className="text-sm font-bold text-white">{linkedAccountSummary}</p>
                  <p className="text-xs text-slate-400">
                    {linkedAccount.accountType === "checking" ? "Checking" : "Savings"} · Primary
                  </p>
                </div>
                <div className="h-2 w-2 rounded-full bg-green-500" />
              </div>

              <button
                type="button"
                onClick={() => setLinkedAccountOverlayOpen(true)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-600 py-2 text-sm text-slate-400 transition-colors hover:border-primary hover:text-primary"
              >
                <span className="material-icons text-base">add</span>
                Connect New Method
              </button>
            </section>

            <section className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-primary/10 bg-surface-dark p-4">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
                  <span className="material-icons text-sm text-green-500">savings</span>
                </div>
                <p className="text-2xl font-bold text-white">
                  {centsToUsd(wallet.totalContributedCents).replace(".00", "")}
                </p>
                <p className="text-xs text-slate-400">Total Contributed</p>
              </div>
              <div className="rounded-xl border border-primary/10 bg-surface-dark p-4">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10">
                  <span className="material-icons text-sm text-red-500">gavel</span>
                </div>
                <p className="text-2xl font-bold text-white">
                  {centsToUsd(wallet.totalPenaltiesCents).replace(".00", "")}
                </p>
                <p className="text-xs text-slate-400">Total Penalties</p>
              </div>
            </section>

            {statusMessage ? (
              <p className={`text-sm ${statusTone === "warning" ? "text-secondary-gold" : "text-[#92c9b7]"}`}>
                {statusMessage}
              </p>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-col lg:col-span-7">
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-primary/15 bg-surface-dark">
              <header className="flex items-center justify-between border-b border-white/5 p-6">
                <h3 className="font-semibold text-white">Transaction History</h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setHistoryFilter("all")}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      historyFilter === "all"
                        ? "bg-primary/10 text-primary"
                        : "text-slate-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryFilter("deductions")}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      historyFilter === "deductions"
                        ? "bg-primary/10 text-primary"
                        : "text-slate-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    Deductions
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryFilter("winnings")}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      historyFilter === "winnings"
                        ? "bg-primary/10 text-primary"
                        : "text-slate-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    Winnings
                  </button>
                </div>
              </header>

              <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-darker/50 text-slate-400">
                    <tr>
                      <th className="px-6 py-4 font-medium">Date</th>
                      <th className="px-6 py-4 font-medium">Description</th>
                      <th className="px-6 py-4 font-medium">Status</th>
                      <th className="px-6 py-4 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredTransactions.map((tx) => {
                      const meta = transactionIconMeta(tx);
                      const positiveAmount = tx.amountCents > 0;
                      return (
                        <tr key={tx.id} className="transition-colors hover:bg-white/[0.02]">
                          <td className="px-6 py-4 text-slate-400">{dateLabel(tx.createdAt)}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div
                                className={`flex h-8 w-8 items-center justify-center rounded-full ${meta.iconWrapClass}`}
                              >
                                <span className="material-icons text-sm">{meta.icon}</span>
                              </div>
                              <div>
                                <span className="block font-medium text-white">{transactionLabel(tx.type)}</span>
                                <span className="block text-xs text-slate-500">{transactionSubtitle(tx)}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.statusClass}`}
                            >
                              {meta.statusLabel}
                            </span>
                          </td>
                          <td className={`px-6 py-4 text-right font-medium ${meta.amountClass}`}>
                            {positiveAmount ? "+" : ""}
                            {centsToUsd(tx.amountCents)}
                          </td>
                        </tr>
                      );
                    })}
                    {!filteredTransactions.length ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-400">
                          No transactions in this filter.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <footer className="flex justify-center border-t border-white/5 bg-surface-darker/30 p-4">
                <button
                  type="button"
                  onClick={() => setAllTransactionsOverlayOpen(true)}
                  className="flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-primary"
                >
                  View All Transactions <span className="material-icons text-sm">arrow_forward</span>
                </button>
              </footer>
            </section>
          </div>
        </div>
      </div>

      {linkedAccountOverlayOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/55"
            onClick={() => setLinkedAccountOverlayOpen(false)}
            aria-label="Close linked account modal backdrop"
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <section className="relative w-full max-w-md rounded-xl border border-primary/20 bg-surface-dark p-5 shadow-2xl">
              <button
                type="button"
                onClick={() => setLinkedAccountOverlayOpen(false)}
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 text-slate-300 transition-colors hover:text-white"
                aria-label="Cancel linked account modal"
              >
                <span className="material-icons text-base">close</span>
              </button>
              <h4 className="text-base font-semibold text-white">Linked Account Details</h4>
              <p className="mt-1 text-sm text-slate-400">Connected bank information</p>

              <div className="mt-4 flex items-center gap-4 rounded-lg border border-white/5 bg-background-dark p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-dark shadow-sm">
                  <span className="material-icons text-slate-400">account_balance</span>
                </div>
                <div className="flex-grow">
                  <p className="text-sm font-bold text-white">{linkedAccountSummary}</p>
                  <p className="text-xs text-slate-400">Routing {linkedAccount.routingMasked}</p>
                </div>
                <div className="h-2 w-2 rounded-full bg-green-500" />
              </div>
            </section>
          </div>
        </>
      ) : null}

      {allTransactionsOverlayOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/55"
            onClick={() => setAllTransactionsOverlayOpen(false)}
            aria-label="Close all transactions modal backdrop"
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <section className="relative flex h-[min(80dvh,52rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-primary/20 bg-surface-dark shadow-2xl">
              <button
                type="button"
                onClick={() => setAllTransactionsOverlayOpen(false)}
                className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 text-slate-300 transition-colors hover:text-white"
                aria-label="Cancel all transactions modal"
              >
                <span className="material-icons text-base">close</span>
              </button>
              <div className="border-b border-white/5 px-6 py-5">
                <h4 className="text-base font-semibold text-white">All Transactions</h4>
                <p className="mt-1 text-sm text-slate-400">Complete wallet transaction history</p>
              </div>

              <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-darker/50 text-slate-400">
                    <tr>
                      <th className="px-6 py-4 font-medium">Date</th>
                      <th className="px-6 py-4 font-medium">Description</th>
                      <th className="px-6 py-4 font-medium">Status</th>
                      <th className="px-6 py-4 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {sortedTransactions.map((tx) => {
                      const meta = transactionIconMeta(tx);
                      const positiveAmount = tx.amountCents > 0;
                      return (
                        <tr key={`${tx.id}-all`} className="transition-colors hover:bg-white/[0.02]">
                          <td className="px-6 py-4 text-slate-400">{dateLabel(tx.createdAt)}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div
                                className={`flex h-8 w-8 items-center justify-center rounded-full ${meta.iconWrapClass}`}
                              >
                                <span className="material-icons text-sm">{meta.icon}</span>
                              </div>
                              <div>
                                <span className="block font-medium text-white">{transactionLabel(tx.type)}</span>
                                <span className="block text-xs text-slate-500">{transactionSubtitle(tx)}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.statusClass}`}
                            >
                              {meta.statusLabel}
                            </span>
                          </td>
                          <td className={`px-6 py-4 text-right font-medium ${meta.amountClass}`}>
                            {positiveAmount ? "+" : ""}
                            {centsToUsd(tx.amountCents)}
                          </td>
                        </tr>
                      );
                    })}
                    {!sortedTransactions.length ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-400">
                          No transactions available.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      ) : null}
    </>
  );
}
