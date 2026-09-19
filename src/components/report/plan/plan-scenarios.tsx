"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { scenarioFigures } from "@/lib/plan/allocate";
import { formatNaira } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MoneyPlan, PlanChange } from "@/lib/types";

const CUTS = [10, 25, 50] as const;
const DEFAULT_CUT = 25;

function Scenario({ change }: { change: PlanChange }) {
  const [cut, setCut] = useState<number>(DEFAULT_CUT);
  const { monthly, yearly } = scenarioFigures(change.monthlyNow, cut);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground-secondary">You spent about</p>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {formatNaira(change.monthlyNow)}
          <span className="text-lg font-medium text-foreground-muted"> a month on {change.label}</span>
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p id={`cut-${change.id}`} className="text-sm text-foreground-secondary">
          If you reduced that by
        </p>
        <div role="group" aria-labelledby={`cut-${change.id}`} className="inline-flex w-fit gap-1 rounded-full border border-border-strong bg-background p-1">
          {CUTS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={cut === c}
              onClick={() => setCut(c)}
              className={cn(
                "min-h-11 min-w-16 rounded-full px-4 text-sm font-medium tabular-nums transition-colors duration-200",
                cut === c ? "bg-foreground text-background" : "text-foreground-secondary hover:bg-foreground/[0.04] hover:text-foreground"
              )}
            >
              {c}%
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {formatNaira(monthly)}
          <span className="text-lg font-medium text-foreground-muted">/month</span>
        </p>
        <p className="text-xl font-semibold tracking-tight tabular-nums text-foreground-secondary">
          {formatNaira(yearly)}
          <span className="text-base font-medium text-foreground-muted">/year</span>
        </p>
        <p className="max-w-prose pt-2 text-base leading-7 text-foreground-secondary">
          That&apos;s {formatNaira(yearly)} a year that could stay in your account if the pattern stayed similar.
        </p>
      </div>
    </div>
  );
}

/** "If you changed just this…" — a question, not a promise. Every figure is plain arithmetic. */
export function PlanScenarios({ plan }: { plan: MoneyPlan }) {
  const scenarios = plan.scenarioIds.map((id) => plan.changes.find((c) => c.id === id)).filter((c): c is PlanChange => !!c);
  if (scenarios.length === 0) return null;

  return (
    <Card className="flex flex-col gap-8">
      <h3 className="text-xl font-semibold tracking-tight">If you changed just this...</h3>
      <div className="flex flex-col gap-8 divide-y divide-border">
        {scenarios.map((c) => (
          <div key={c.id} className="pt-8 first:pt-0">
            <Scenario change={c} />
          </div>
        ))}
      </div>
    </Card>
  );
}
