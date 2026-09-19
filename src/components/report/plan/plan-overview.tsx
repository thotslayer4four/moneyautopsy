"use client";

import { m } from "framer-motion";
import { Coffee, House, PartyPopper, ShieldCheck, Target, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { fillTokens, type PlanView } from "@/lib/plan/allocate";
import { formatNaira } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MoneyPlan, PlanBucket } from "@/lib/types";

const BUCKETS: Record<PlanBucket, { label: string; icon: LucideIcon; blurb: (goal: string | null) => string; emphasis: boolean }> = {
  essentials: { label: "Essentials", icon: House, blurb: () => "What you genuinely need to cover", emphasis: false },
  goals: {
    label: "Goals",
    icon: Target,
    blurb: (goal) => (goal ? `Moved toward your goal to ${goal}` : "Moved toward what you're building"),
    emphasis: true,
  },
  everyday: { label: "Everyday spending", icon: Coffee, blurb: () => "Eating out, shopping, the normal stuff", emphasis: false },
  fun: { label: "Fun", icon: PartyPopper, blurb: () => "Yours to spend, no guilt attached", emphasis: true },
  buffer: { label: "Buffer", icon: ShieldCheck, blurb: () => "Left alone for the unexpected", emphasis: false },
};

const INCOME_CAPTION: Record<string, (plan: MoneyPlan) => string> = {
  "statement-steady": () => "What your statement shows arriving as earnings.",
  "statement-irregular": (plan) =>
    `Your income moves around, so we planned on a typical month rather than your best one.${
      plan.income.lowestMonth === null ? "" : plan.income.lowestMonth > 0 ? ` Your lowest month was ${formatNaira(plan.income.lowestMonth)}.` : " At least one month had nothing arriving."
    }`,
  "estimated-steady": () => "Based on the money that arrived from people. We couldn't confirm it's earnings, so treat it as a rough guide.",
  "estimated-irregular": () => "Based on the money that arrived from people, and it moves around. We couldn't confirm it's earnings, so treat it as a rough guide.",
  "stated-steady": () => "Based on the range you gave us. We couldn't confirm earnings in this statement.",
  "stated-irregular": () => "Based on the range you gave us, and it moves around. Treat it as a rough guide.",
};

function AllocationRow({ bucket, amount, percent, goal, percentFirst, overspent }: { bucket: PlanBucket; amount: number; percent: number; goal: string | null; percentFirst: boolean; overspent: boolean }) {
  const meta = BUCKETS[bucket];
  const Icon = meta.icon;
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Icon size={16} className={cn("mt-1 shrink-0", meta.emphasis ? "text-accent" : "text-foreground-muted")} aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-medium">{meta.label}</span>
            <span className="text-xs leading-5 text-foreground-muted">{meta.blurb(goal)}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 tabular-nums">
          <span className="text-xl font-semibold tracking-tight">{percentFirst ? `${percent}%` : formatNaira(amount)}</span>
          <span className="text-xs text-foreground-muted">
            {percentFirst ? `about ${formatNaira(amount)}` : overspent ? `${percent}% of what you spend` : `${percent}%`}
          </span>
        </div>
      </div>
      <div aria-hidden className={cn("h-2 w-full overflow-hidden rounded-full", meta.emphasis ? "bg-accent-track/40" : "bg-foreground/[0.06]")}>
        <m.div
          className={cn("h-full rounded-full", meta.emphasis ? "bg-accent" : "bg-foreground-muted")}
          initial={{ width: 0 }}
          whileInView={{ width: `${Math.max(percent, amount > 0 ? 2 : 0)}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

export function PlanOverview({
  plan,
  view,
  incomeQuestionCount = 0,
  onCheckIncome,
}: {
  plan: MoneyPlan;
  view: PlanView;
  /** Heavy credits we could ask about; when there are some, the gap note offers to. */
  incomeQuestionCount?: number;
  onCheckIncome?: () => void;
}) {
  const irregular = plan.income.regularity === "irregular";
  const overspent = view.gap > 0;
  // "Every time money lands, X%" only means something when the plan actually fits inside income.
  const percentFirst = irregular && !overspent;
  const caption = INCOME_CAPTION[`${plan.income.basis}-${plan.income.regularity}`](plan);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-prose flex-col gap-4">
        <p className="text-balance text-xl font-semibold tracking-tight">If I were you...</p>
        <p className="text-base leading-7 text-foreground-secondary">
          We looked at what happened to your money. Here&apos;s what we&apos;d actually change. {plan.intro}
        </p>
      </div>

      <Card className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground-secondary">
            {irregular ? "Typical monthly income" : "Expected monthly income"}
          </p>
          <p className="text-4xl font-semibold tracking-tight tabular-nums">{formatNaira(plan.income.monthly)}</p>
          <p className="max-w-prose text-sm leading-6 text-foreground-muted">{caption}</p>
          {plan.income.streams.length > 1 && (
            <ul className="flex flex-wrap gap-2 pt-2">
              {plan.income.streams.map((s) => (
                <li key={s.label} className="rounded-full border border-border bg-background px-3 py-1 text-xs tabular-nums text-foreground-secondary">
                  {s.label} · {formatNaira(s.monthly)}
                  {s.reliability === "irregular" ? " · less certain" : ""}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col divide-y divide-border border-t border-border pt-8">
          {view.allocations.map((a) => (
            <AllocationRow key={a.bucket} {...a} goal={plan.goalLabel} percentFirst={percentFirst} overspent={overspent} />
          ))}
        </div>

        {irregular && view.goals > 0 && (
          <Callout leadIn="Think in percentages.">
            {fillTokens("Because money doesn't land the same way each month, every time it does, move {goalsPercent} toward your goal first, then spend the rest.", view)}
          </Callout>
        )}

        {view.gap > 0 && (
          <div className="flex flex-col gap-4">
            <Callout icon={<TriangleAlert size={16} className="shrink-0 text-accent" aria-hidden />}>
              At your current pace you spend about {formatNaira(view.gap)} more each month than the {formatNaira(plan.income.monthly)} we count as income, so there&apos;s nothing to set aside yet.
              {plan.income.otherInflow > 0 &&
                ` About ${formatNaira(plan.income.otherInflow)} a month also arrived from money we don't count as income (support, loans, transfers or betting withdrawals), which may be what covers the difference.`}{" "}
              {incomeQuestionCount > 0 && onCheckIncome ? "If some of it is your income, tell us and this plan will follow." : "The changes below are how the gap closes."}
            </Callout>
            {incomeQuestionCount > 0 && onCheckIncome && (
              <Button variant="secondary" onClick={onCheckIncome} className="w-full sm:w-fit">
                Tell us what this money was
              </Button>
            )}
          </div>
        )}
      </Card>

      <p className="max-w-prose text-base leading-7 text-foreground-secondary">
        You don&apos;t need to spend less everywhere. We&apos;re moving money away from the things you care about least and toward the things you care about most.
      </p>
    </div>
  );
}
