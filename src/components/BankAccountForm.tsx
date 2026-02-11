import { useState } from "react";

interface BankAccountFormProps {
  onSubmit: (input: {
    bankName: string;
    accountType: "checking" | "savings";
    accountNumber: string;
    routingNumber: string;
    nickname?: string;
  }) => Promise<void>;
}

export function BankAccountForm({ onSubmit }: BankAccountFormProps) {
  const [bankName, setBankName] = useState("");
  const [accountType, setAccountType] = useState<"checking" | "savings">("checking");
  const [accountNumber, setAccountNumber] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        bankName,
        accountType,
        accountNumber,
        routingNumber,
        nickname: nickname || undefined
      });
      setBankName("");
      setAccountNumber("");
      setRoutingNumber("");
      setNickname("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-primary/10 bg-surface-dark p-5">
      <h3 className="text-lg font-semibold text-white">Connect Bank Account</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="bank-name" className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Bank Name</span>
          <input
            id="bank-name"
            className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
            value={bankName}
            onChange={(event) => setBankName(event.target.value)}
            required
          />
        </label>
        <label htmlFor="account-type" className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Account Type</span>
          <select
            id="account-type"
            className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
            value={accountType}
            onChange={(event) => setAccountType(event.target.value as "checking" | "savings")}
          >
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="account-number" className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Account Number</span>
          <input
            id="account-number"
            className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value)}
            required
          />
        </label>
        <label htmlFor="routing-number" className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Routing Number</span>
          <input
            id="routing-number"
            className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
            value={routingNumber}
            onChange={(event) => setRoutingNumber(event.target.value)}
            required
          />
        </label>
      </div>
      <label htmlFor="nickname" className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Nickname</span>
        <input
          id="nickname"
          className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white focus:border-primary focus:outline-none"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="Optional"
        />
      </label>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-background-dark transition-colors hover:bg-primary-dark disabled:opacity-60"
      >
        {busy ? "Connecting..." : "Connect Account"}
      </button>
    </form>
  );
}
