import type { MoneyPlan, PlanBucket, PlanChange } from "@/lib/types";
import { formatNaira } from "@/lib/format";
import { percentsOf, roundTo } from "./numbers";

/**
 * Everything here is arithmetic on numbers the plan already holds, so it runs the same on
 * the server (to build the default plan) and in the browser (when someone picks which
 * changes they want to make). It never imports anything server-only.
 */

export const MAX_RULES = 4;
export const MAX_RESET_STEPS = 5;
export const MIN_RESET_STEPS = 3;

export interface PlanAllocation {
  bucket: PlanBucket;
  amount: number;
  percent: number;
}

export interface PlanView {
  allocations: PlanAllocation[];
  goals: number;
  goalsPercent: number;
  /** How much more than arrives each month the plan still spends, when it does. */
  gap: number;
  freedMonthly: number;
  freedYearly: number;
  selected: PlanChange[];
  rules: string[];
  reset: string[];
}

const BUCKET_ORDER: PlanBucket[] = ["essentials", "goals", "everyday", "fun", "buffer"];

/** "if you cut this by 25%" — rounded to ₦500 so it reads like something you'd budget. */
export function scenarioFigures(base: number, percent: number) {
  const monthly = roundTo((base * percent) / 100, 500);
  return { monthly, yearly: monthly * 12 };
}

export function fillTokens(text: string, view: Pick<PlanView, "goals" | "goalsPercent">): string {
  return text.replace(/\{goals\}/g, formatNaira(view.goals)).replace(/\{goalsPercent\}/g, `${view.goalsPercent}%`);
}

/** The sentence that ties betting to the goal — computed from the chosen plan, so it stays true as it changes. */
export function goalLinkLine(change: PlanChange, view: PlanView): string | null {
  if (!change.vsGoalAmount || view.goals <= 0) return null;
  const pct = Math.round((change.vsGoalAmount / view.goals) * 100);
  const size = pct >= 100 ? "more than all of" : `${pct}% of`;
  return `Your ${change.label} deposits alone came to ${size} the ${formatNaira(view.goals)} a month this plan sets aside for your goal.`;
}

export function computePlanView(plan: MoneyPlan, selectedIds: readonly string[]): PlanView {
  const chosen = new Set(selectedIds);
  const selected = plan.changes.filter((c) => chosen.has(c.id));

  const saved: Record<PlanBucket, number> = { essentials: 0, goals: 0, everyday: 0, fun: 0, buffer: 0 };
  for (const c of selected) saved[c.bucket] += c.monthlySaving;

  const income = plan.income.monthly;
  const essentials = Math.max(0, plan.baseline.essentials - saved.essentials);
  const everyday = Math.max(0, plan.baseline.everyday - saved.everyday);
  const fun = Math.max(0, plan.baseline.fun - saved.fun);

  // Priority when money is tight: essentials, then a buffer, then goals. When there is room,
  // what is left after the buffer is split by the goal's share; the rest is theirs, guilt-free.
  const pool = income - essentials - everyday - fun - plan.baseline.buffer;
  let goals = 0;
  let buffer = plan.baseline.buffer;
  let funOut = fun;
  let gap = 0;
  if (pool >= 0) {
    const target = Math.max(plan.baseline.saving, plan.baseline.goalShare * pool);
    goals = Math.min(pool, roundTo(target, 1_000));
    funOut = fun + (pool - goals);
  } else {
    buffer = Math.max(0, plan.baseline.buffer + pool);
    gap = Math.max(0, -(income - essentials - everyday - fun));
  }

  const amounts: Record<PlanBucket, number> = {
    essentials: roundTo(essentials, 1_000),
    goals: roundTo(goals, 1_000),
    everyday: roundTo(everyday, 1_000),
    fun: roundTo(funOut, 1_000),
    buffer: roundTo(buffer, 1_000),
  };
  // Rounding each part can leave the total a few thousand off the income; fun absorbs it,
  // because it is the flexible part of the plan. When the plan overspends, nothing is forced to fit.
  if (gap === 0) {
    const others = amounts.essentials + amounts.goals + amounts.everyday + amounts.buffer;
    amounts.fun = Math.max(0, income - others);
  }

  const parts = BUCKET_ORDER.map((b) => amounts[b]);
  // A share of the plan's own total, so it always adds to 100. When the plan spends more than
  // arrives, a share of income would pass 100%, which means nothing.
  const percents = percentsOf(parts);
  const allocations = BUCKET_ORDER.map((bucket, i) => ({ bucket, amount: amounts[bucket], percent: percents[i] }));
  const goalsPercent = allocations.find((a) => a.bucket === "goals")?.percent ?? 0;

  const partial = { goals: amounts.goals, goalsPercent };
  const freedMonthly = selected.reduce((s, c) => s + c.monthlySaving, 0);

  return {
    allocations,
    goals: amounts.goals,
    goalsPercent,
    gap: roundTo(gap, 1_000),
    freedMonthly,
    freedYearly: freedMonthly * 12,
    selected,
    rules: buildRules(plan, selected, partial),
    reset: buildReset(plan, selected, partial, amounts.buffer),
  };
}

function buildRules(plan: MoneyPlan, selected: PlanChange[], view: Pick<PlanView, "goals" | "goalsPercent">): string[] {
  const rules: string[] = [];
  if (view.goals > 0) rules.push(fillTokens(plan.paydayRule, view));
  for (const c of selected) rules.push(fillTokens(c.rule, view));
  for (const r of plan.extraRules) rules.push(fillTokens(r.text, view));
  return rules.slice(0, MAX_RULES);
}

function buildReset(
  plan: MoneyPlan,
  selected: PlanChange[],
  view: Pick<PlanView, "goals" | "goalsPercent">,
  buffer: number
): string[] {
  // The first and last steps are fixed points; the chosen changes fill whatever room is left.
  const first = view.goals > 0 ? [fillTokens(plan.paydayReset, view)] : [];
  const last = buffer > 0 ? [`Keep ${formatNaira(buffer)} untouched as your buffer.`] : [];
  const room = MAX_RESET_STEPS - first.length - last.length;
  const middle = selected.slice(0, Math.max(0, room)).map((c) => fillTokens(c.reset, view));

  const steps = [...first, ...middle, ...last];
  const pads = [
    plan.safeToSpend ? "Check your safe-to-spend number once a week." : "Note what you spend for a week, then compare it to this plan.",
    "Come back in 30 days with a fresh statement and see what moved.",
  ];
  for (const pad of pads) if (steps.length < MIN_RESET_STEPS) steps.push(pad);
  return steps.slice(0, MAX_RESET_STEPS);
}
