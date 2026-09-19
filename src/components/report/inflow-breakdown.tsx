import { Callout } from "@/components/ui/callout";
import { formatNaira } from "@/lib/format";
import type { Category, InflowBreakdownEntry } from "@/lib/types";

/** What each kind of incoming money actually is — money in is not the same as income. */
const INFLOW_LABELS: Partial<Record<Category, string>> = {
  Income: "Looks like income",
  "Gifts & support": "Gifts & support",
  Loans: "Borrowed money",
  Reimbursements: "Friends paying you back",
  Refunds: "Refunds & reversals",
  Transfers: "Moved from your own accounts",
  Savings: "Back from savings",
  Investments: "Back from investments",
  Betting: "Betting withdrawals",
  Uncertain: "Not yet explained",
  Other: "Other",
};

export function InflowBreakdown({
  entries,
  totalInflow,
  earnedIncome,
}: {
  entries: InflowBreakdownEntry[];
  totalInflow: number;
  earnedIncome: number;
}) {
  if (entries.length === 0) return null;
  const onlyIncome = entries.length === 1 && entries[0].category === "Income";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium text-foreground-secondary">What the money coming in actually was</p>
      <ul className="flex flex-col divide-y divide-border">
        {entries.map((e) => (
          <li key={e.category} className="flex items-center justify-between gap-4 py-3 text-sm first:pt-0 last:pb-0">
            <span className="min-w-0 flex-1">{INFLOW_LABELS[e.category] ?? e.category}</span>
            <span className="whitespace-nowrap tabular-nums text-foreground-muted">
              {formatNaira(e.total)} · {Math.round(e.percentOfInflow)}%
            </span>
          </li>
        ))}
      </ul>
      {!onlyIncome && (
        <Callout leadIn="Money in isn’t income.">
          {formatNaira(totalInflow)} was credited, but only {formatNaira(earnedIncome)} has evidence of being earnings.
          Transfers from people aren’t assumed to be income.
        </Callout>
      )}
    </div>
  );
}
