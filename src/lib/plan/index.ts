import type { FinancialAnalysis, MoneyPlan, NormalizedTransaction, PlanNarrative, UserProfile } from "@/lib/types";
import { buildMoneyPlan } from "./build";
import { applyNarrative, generatePlanNarrative } from "./narrative";

export { buildMoneyPlan, isEnoughToPlan } from "./build";
export { computeIncomeCheck } from "./incomeCheck";
export { applyNarrative } from "./narrative";
export { computePlanView, fillTokens, goalLinkLine, scenarioFigures } from "./allocate";

/**
 * The plan as it goes into a report: deterministic figures, with the model's wording laid
 * over them where it passed the checks. `narrative` is returned so it can be kept and
 * re-applied when corrections change the numbers, without another model call.
 */
export async function generateMoneyPlan(
  transactions: NormalizedTransaction[],
  profile: UserProfile,
  analysis: FinancialAnalysis
): Promise<{ plan: MoneyPlan | null; narrative: PlanNarrative | null }> {
  const base = buildMoneyPlan(transactions, profile, analysis);
  if (!base) return { plan: null, narrative: null };
  const narrative = await generatePlanNarrative(profile, base);
  return { plan: applyNarrative(base, narrative), narrative };
}

/** Rebuilds the plan from current transactions using wording already written — no model call. */
export function assembleMoneyPlan(
  transactions: NormalizedTransaction[],
  profile: UserProfile,
  analysis: FinancialAnalysis,
  narrative: PlanNarrative | null | undefined
): MoneyPlan | null {
  const base = buildMoneyPlan(transactions, profile, analysis);
  return base ? applyNarrative(base, narrative) : null;
}
