import { formatNaira } from "@/lib/format";
import { formatMonth } from "@/lib/plan/obligations";
import { cap } from "@/lib/plan/numbers";
import type { MoneyPlan, PlanObligation } from "@/lib/types";

const n = formatNaira;

function cadence(o: PlanObligation): string {
  switch (o.everyMonths) {
    case 1:
      return "a month";
    case 12:
      return "a year";
    case 6:
      return o.id === "school" ? "a semester" : "every 6 months";
    case null:
      return "on no fixed schedule";
    default:
      return `every ${o.everyMonths} months`;
  }
}

function detail(o: PlanObligation): string {
  if (o.id === "debt") return o.note ? `Repayment, ${o.note}` : "Monthly repayment";
  if (o.id === "upcoming") return o.dueMonth ? `${n(o.amount)} by ${formatMonth(o.dueMonth)}` : `${n(o.amount)}, no date yet`;
  return `${n(o.amount)} ${cadence(o)}${o.dueMonth ? ` · next due ${formatMonth(o.dueMonth)}` : ""}`;
}

/** The cash-flow side: whether the monthly amount is enough by the time the bill is due. */
function timing(o: PlanObligation, savings: number | null): string | null {
  const savingsHelp = savings ? ` Your ${n(savings)} of savings could cover ${savings >= o.amount ? "it" : "part of it"}.` : "";
  if (o.id === "upcoming" && !o.dueMonth) return "With no due date there's nothing to spread it over, so nothing is set aside for it yet.";
  if (o.id === "upcoming" && o.monthsUntilDue === 0) return `It's due this month, so the plan aims to set all of it aside now.${savingsHelp}`;
  if (!o.everyMonths && o.id !== "upcoming") return "With no fixed schedule we can't spread it, so the plan uses what your statement shows.";
  if (o.catchUpMonthly === null || o.setAsideByDue === null || !o.dueMonth) return null;
  if (o.monthsUntilDue === 0) return `It's due this month, so the full ${n(o.amount)} needs to be ready now.${savingsHelp}`;
  return `At ${n(o.monthly)} a month you'd have ${n(o.setAsideByDue)} by ${formatMonth(o.dueMonth)}. Starting from nothing, being fully ready would take about ${n(o.catchUpMonthly)} a month, so count anything already put aside toward it.`;
}

/**
 * Bills paid in lumps, shown as what they really cost per month — the reason a ₦1.2m yearly
 * rent doesn't swallow one month of the plan. Already inside the totals above; this is the why.
 */
export function PlanObligations({ plan }: { plan: MoneyPlan }) {
  const obligations = plan.obligations ?? [];
  if (obligations.length === 0) return null;

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-8">
      <div className="flex max-w-prose flex-col gap-1">
        <p className="text-sm font-medium">Bigger bills, spread out</p>
        <p className="text-xs leading-5 text-foreground-muted">Already counted in your essentials and goals above, as what they cost each month.</p>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {obligations.map((o) => {
          const note = timing(o, plan.savingsBalance);
          return (
            <li key={o.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-medium">{cap(o.label)}</span>
                  <span className="text-xs leading-5 text-foreground-muted">{detail(o)}</span>
                </div>
                {o.monthly > 0 && (
                  <div className="flex shrink-0 flex-col items-end gap-1 tabular-nums">
                    <span className="text-base font-semibold tracking-tight">{n(o.monthly)}</span>
                    <span className="text-xs text-foreground-muted">a month</span>
                  </div>
                )}
              </div>
              {note && <p className="max-w-prose text-sm leading-6 text-foreground-secondary">{note}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
