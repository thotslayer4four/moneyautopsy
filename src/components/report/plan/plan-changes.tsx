"use client";

import { useState } from "react";
import { Check, ChevronDown, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SecondaryCard } from "@/components/ui/card";
import { goalLinkLine, type PlanView } from "@/lib/plan/allocate";
import { formatNaira } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MoneyPlan, PlanChange } from "@/lib/types";
import { CategoryIcon } from "../icons";

function ChangeCard({
  change,
  index,
  chosen,
  onToggle,
  goalLink,
}: {
  change: PlanChange;
  index: string | null;
  chosen: boolean;
  onToggle: () => void;
  goalLink: string | null;
}) {
  return (
    <SecondaryCard className={cn("flex flex-col gap-6", chosen && "border-accent bg-accent-wash")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-medium text-foreground-muted">
          {index && <span className="tabular-nums">{index}</span>}
          <CategoryIcon category={change.category} size={16} className="text-accent" aria-hidden />
          {change.label}
        </span>
        <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-background px-3 py-1 text-xs font-medium tabular-nums text-foreground">
          {change.nature === "cut" ? (
            <>
              <TrendingDown size={14} className="text-accent" aria-hidden />~{formatNaira(change.monthlySaving)}/mo
            </>
          ) : (
            "A limit, not a cut"
          )}
        </span>
      </div>

      <div className="flex max-w-prose flex-col gap-4">
        <p className="text-base leading-7 text-foreground-secondary">{change.fact}</p>
        <p className="text-xl font-semibold leading-8 tracking-tight">{change.proposal}</p>
        <p className="text-sm leading-6 text-foreground-muted">{change.why}</p>
        {goalLink && <p className="text-sm leading-6 text-foreground-secondary">{goalLink}</p>}
      </div>

      {change.stats.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {change.stats.map((s) => (
            <div key={s.label} className="flex min-w-0 flex-col gap-1 rounded-2xl border border-border bg-background px-4 py-3">
              <dt className="text-xs text-foreground-muted">{s.label}</dt>
              <dd className="break-words text-sm font-semibold tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <Button variant={chosen ? "primary" : "secondary"} aria-pressed={chosen} onClick={onToggle} className="w-full sm:w-fit">
        {chosen && <Check size={16} aria-hidden />}
        {change.optional ? "I want to change this" : "I'll do this"}
      </Button>
    </SecondaryCard>
  );
}

export function PlanChanges({
  plan,
  view,
  selected,
  onToggle,
}: {
  plan: MoneyPlan;
  view: PlanView;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  if (plan.changes.length === 0) {
    return (
      <Callout>
        We didn&apos;t find a habit big enough to be worth changing. Your plan is simply your current pattern, with your goal set aside first.
      </Callout>
    );
  }

  const top = plan.changes.filter((c) => plan.defaultSelected.includes(c.id));
  const rest = plan.changes.filter((c) => !plan.defaultSelected.includes(c.id));
  const chosen = new Set(selected);
  const card = (c: PlanChange, index: string | null) => (
    <ChangeCard key={c.id} change={c} index={index} chosen={chosen.has(c.id)} onToggle={() => onToggle(c.id)} goalLink={goalLinkLine(c, view)} />
  );

  return (
    <div className="flex flex-col gap-8">
      {top.length > 0 && (
        <div className="flex flex-col gap-4">{top.map((c, i) => card(c, String(i + 1).padStart(2, "0")))}</div>
      )}

      {rest.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex max-w-prose flex-col gap-2">
            <p className="text-base font-medium">{top.length > 0 ? "More you could work on" : "Things you could work on"}</p>
            <p className="text-sm leading-6 text-foreground-muted">
              Yours to decide. Nothing here is assumed, and the plan only changes for the ones you pick.
            </p>
          </div>
          <Button variant="ghost" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)} className="w-fit">
            {moreOpen ? "Hide" : `Show ${rest.length}`}
            <ChevronDown size={16} className={cn("transition-transform duration-200", moreOpen && "rotate-180")} aria-hidden />
          </Button>
          {moreOpen && <div className="flex flex-col gap-4">{rest.map((c) => card(c, null))}</div>}
        </div>
      )}

      {view.freedMonthly > 0 && (
        <Callout leadIn="If you made these changes.">
          About {formatNaira(view.freedMonthly)} a month could stay with you, or {formatNaira(view.freedYearly)} a year, if your pattern stayed similar. That&apos;s a scenario, not a promise.
        </Callout>
      )}
    </div>
  );
}
