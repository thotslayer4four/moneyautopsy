import { ChevronDown, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { formatDate, formatNaira } from "@/lib/format";
import type { MoneyPlan } from "@/lib/types";

export function SafeToSpendCard({ plan }: { plan: MoneyPlan }) {
  const s = plan.safeToSpend;

  if (!s) {
    return (
      <Card className="flex flex-col gap-4">
        <IconTile icon={Wallet} />
        <div className="flex max-w-prose flex-col gap-2">
          <p className="text-sm font-medium text-foreground-secondary">Safe to spend</p>
          <p className="text-base leading-7 text-foreground-secondary">
            {plan.safeToSpendNote ?? "We can't work out what's safe to spend from this statement."}
          </p>
        </div>
      </Card>
    );
  }

  const until = s.endsAtPayday ? `your next payday, around ${formatDate(s.periodEnd)}` : `the end of the month, ${formatDate(s.periodEnd)}`;

  return (
    <Card className="flex flex-col gap-6">
      <IconTile icon={Wallet} />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground-secondary">Safe to spend</p>
        <p className="text-4xl font-semibold tracking-tight tabular-nums">
          {formatNaira(s.daily)}
          <span className="text-xl font-medium text-foreground-muted">/day</span>
        </p>
        <p className="max-w-prose text-base leading-7 text-foreground-secondary">
          {s.over > 0
            ? `You're already about ${formatNaira(s.over)} past what's safe until ${until}. Hold off on anything that isn't essential until then.`
            : `That's about ${formatNaira(s.remaining)} of flexible room until ${until}. You usually spend about ${formatNaira(s.usualDaily)} a day on everyday and fun things.`}
        </p>
        <p className="text-xs text-foreground-muted">As of {formatDate(s.asOf)}, the last day of your statement.</p>
      </div>

      <details className="group border-t border-border pt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground-secondary [&::-webkit-details-marker]:hidden">
          How we worked this out
          <ChevronDown size={16} className="shrink-0 transition-transform duration-200 group-open:rotate-180" aria-hidden />
        </summary>
        <dl className="flex flex-col divide-y divide-border pt-2">
          {s.working.map((w) => (
            <div key={w.label} className="flex items-baseline justify-between gap-4 py-3 text-sm">
              <dt className="text-foreground-secondary">{w.label}</dt>
              <dd className="tabular-nums">{w.amount < 0 ? `− ${formatNaira(-w.amount)}` : formatNaira(w.amount)}</dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-4 py-3 text-sm font-medium">
            <dt>Left to spend over {s.daysLeft} {s.daysLeft === 1 ? "day" : "days"}</dt>
            <dd className="tabular-nums">{formatNaira(s.remaining)}</dd>
          </div>
        </dl>
      </details>
    </Card>
  );
}
