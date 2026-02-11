import { useMemo, useState } from "react";
import { BankAccountForm } from "../components/BankAccountForm";
import { TransactionTable } from "../components/TransactionTable";
import { WalletCard } from "../components/WalletCard";
import { useAddBankAccount, useWallet, useWithdraw } from "../hooks/useAppQueries";
import { centsToUsd } from "../utils/format";

export function WalletPage() {
  const walletQuery = useWallet();
  const addBankMutation = useAddBankAccount();
  const withdrawMutation = useWithdraw();
  const [selectedBank, setSelectedBank] = useState<string>("");
  const [withdrawAmount, setWithdrawAmount] = useState("0");
  const [message, setMessage] = useState<string | null>(null);

  const wallet = walletQuery.data;

  const sortedTransactions = useMemo(() => {
    return [...(wallet?.transactions ?? [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [wallet?.transactions]);

  if (!wallet) {
    return <p className="text-sm text-slate-400">Loading wallet...</p>;
  }

  const primaryBank = wallet.bankAccounts.find((account) => account.isPrimary);

  const submitWithdrawal = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    const amountCents = Math.round(Number(withdrawAmount) * 100);
    const bankId = selectedBank || primaryBank?.id;

    if (!bankId) {
      setMessage("Please connect a bank account before withdrawing.");
      return;
    }

    try {
      await withdrawMutation.mutateAsync({ amountCents, bankAccountId: bankId });
      setMessage(`Withdrawal submitted for ${centsToUsd(amountCents)}.`);
      setWithdrawAmount("0");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Withdrawal failed.");
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="space-y-6">
        <WalletCard wallet={wallet} />

        <section className="rounded-xl border border-primary/10 bg-surface-dark p-5">
          <h3 className="mb-3 text-lg font-semibold text-white">Withdraw Funds</h3>
          <form onSubmit={submitWithdrawal} className="space-y-3">
            <label htmlFor="withdraw-amount" className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Amount (USD)</span>
              <input
                id="withdraw-amount"
                type="number"
                min={0}
                step="0.01"
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value)}
                className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
              />
            </label>
            <label htmlFor="withdraw-bank" className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Destination Account</span>
              <select
                id="withdraw-bank"
                value={selectedBank}
                onChange={(event) => setSelectedBank(event.target.value)}
                className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
              >
                <option value="">Primary ({primaryBank?.bankName ?? "None"})</option>
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
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-background-dark transition-colors hover:bg-primary-dark disabled:opacity-60"
            >
              {withdrawMutation.isPending ? "Processing..." : "Withdraw"}
            </button>
          </form>
          {message ? <p className="mt-2 text-sm text-primary">{message}</p> : null}
        </section>

        <BankAccountForm
          onSubmit={async (input) => {
            setMessage(null);
            try {
              await addBankMutation.mutateAsync(input);
              setMessage("Bank account connected.");
            } catch (reason) {
              setMessage(reason instanceof Error ? reason.message : "Could not connect bank account.");
            }
          }}
        />

        <section className="rounded-xl border border-primary/10 bg-surface-dark p-5">
          <h3 className="mb-3 text-lg font-semibold text-white">Linked Accounts</h3>
          <ul className="space-y-2">
            {wallet.bankAccounts.map((account) => (
              <li key={account.id} className="rounded-lg border border-primary/10 bg-background-dark px-4 py-3">
                <p className="font-semibold text-white">
                  {account.bankName} •••• {account.last4}
                </p>
                <p className="text-xs text-slate-500">
                  {account.accountType} · routing {account.routingMasked}
                  {account.isPrimary ? " · primary" : ""}
                </p>
              </li>
            ))}
            {!wallet.bankAccounts.length ? (
              <li className="rounded-lg border border-dashed border-border-dark px-4 py-3 text-sm text-slate-500">
                No linked accounts yet.
              </li>
            ) : null}
          </ul>
        </section>
      </div>

      <div className="space-y-6">
        <section className="rounded-xl border border-primary/10 bg-gradient-to-r from-background-dark to-surface-dark p-5">
          <h2 className="text-lg font-bold text-white">Weekly Pot Rules</h2>
          <ol className="mt-3 space-y-2 text-sm text-slate-300">
            <li>1. Every member contributes $14 weekly ($7 base + $7 goal-locked).</li>
            <li>2. Everyone receives $7 base back at settlement.</li>
            <li>3. Missed-goal goal-locked amounts are split equally across all members.</li>
          </ol>
        </section>

        <TransactionTable transactions={sortedTransactions} />
      </div>
    </div>
  );
}
