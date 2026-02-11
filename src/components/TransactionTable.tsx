import type { Transaction } from "../domain/types";
import { centsToUsd, dateLabel } from "../utils/format";
import { StatusBadge } from "./ui/StatusBadge";

interface TransactionTableProps {
  transactions: Transaction[];
}

function labelForType(type: Transaction["type"]): string {
  switch (type) {
    case "deposit":
      return "Deposit";
    case "stake_contribution":
      return "Weekly Stake";
    case "base_return":
      return "Base Return";
    case "goal_return":
      return "Goal Return";
    case "penalty_loss":
      return "Penalty";
    case "penalty_share":
      return "Penalty Share";
    case "withdrawal":
      return "Withdrawal";
    default:
      return "Adjustment";
  }
}

export function TransactionTable({ transactions }: TransactionTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-primary/10 bg-surface-dark">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-background-dark/60 text-xs uppercase tracking-wider text-slate-400">
          <tr>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Description</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-primary/10">
          {transactions.map((tx) => {
            const positive = tx.amountCents > 0;
            return (
              <tr key={tx.id}>
                <td className="px-4 py-3 text-slate-400">{dateLabel(tx.createdAt)}</td>
                <td className="px-4 py-3 text-white">{labelForType(tx.type)}</td>
                <td className="px-4 py-3 text-slate-300">{tx.description}</td>
                <td className="px-4 py-3">
                  <StatusBadge tone={tx.status === "completed" ? "success" : "warning"}>
                    {tx.status}
                  </StatusBadge>
                </td>
                <td className={`px-4 py-3 text-right font-semibold ${positive ? "text-primary" : "text-white"}`}>
                  {positive ? "+" : ""}
                  {centsToUsd(tx.amountCents)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
