"use client";

import { useCallback, useMemo, useState } from "react";
import { computePlanView, type PlanView } from "@/lib/plan/allocate";
import type { MoneyPlan } from "@/lib/types";

const storageKey = (reportId: string) => `money-plan-choices:${reportId}`;

function readChoices(reportId: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(storageKey(reportId)) ?? "null");
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function writeChoices(reportId: string, ids: string[]) {
  try {
    sessionStorage.setItem(storageKey(reportId), JSON.stringify(ids));
  } catch {
    // Choices simply won't survive a refresh; nothing else depends on them.
  }
}

/**
 * Which changes the person has chosen to make, and the plan that follows from them. Until
 * they choose anything the plan shows its own recommended starting point. Once they do, their
 * choices win — even if the plan is later rebuilt around a correction they made.
 */
export function useMoneyPlan(plan: MoneyPlan | null, reportId: string) {
  const [chosen, setChosen] = useState<string[] | null>(() => (typeof window === "undefined" ? null : readChoices(reportId)));

  const known = useMemo(() => new Set(plan?.changes.map((c) => c.id) ?? []), [plan]);
  const selected = useMemo(
    () => (chosen ? chosen.filter((id) => known.has(id)) : (plan?.defaultSelected ?? [])),
    [chosen, known, plan]
  );

  const toggle = useCallback(
    (id: string) => {
      const next = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
      setChosen(next);
      writeChoices(reportId, next);
    },
    [selected, reportId]
  );

  const view: PlanView | null = useMemo(() => (plan ? computePlanView(plan, selected) : null), [plan, selected]);
  return { selected, toggle, view };
}
