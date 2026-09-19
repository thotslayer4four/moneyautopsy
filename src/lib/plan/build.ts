import type { FinancialAnalysis, MoneyPlan, NormalizedTransaction, PlanBaseline, UserProfile } from "@/lib/types";
import { GOAL_OPTIONS, MONTHLY_INCOME_OPTIONS, labelFor } from "@/lib/profile/options";
import { daysBetween, periodInMonths } from "@/lib/analysis/helpers";
import { formatNaira } from "@/lib/format";
import { computePlanIncome, statedMonthlyIncome } from "./income";
import { computeMonthlySpending, supportsDependants } from "./spending";
import { buildChanges, buildExtraRules } from "./changes";
import { computeSafeToSpend } from "./safeToSpend";
import { computePlanView } from "./allocate";
import { WEEKS_PER_MONTH, cap, plural, roundTo } from "./numbers";

const n = formatNaira;

/** Less than this and monthly figures would be a guess dressed up as an average. */
const MIN_DAYS_FOR_PLAN = 14;
const MIN_TRANSACTIONS_FOR_PLAN = 10;
const DEFAULT_CHANGES_SHOWN = 3;
const SCENARIOS_SHOWN = 2;
/** How many weeks of everyday spending the buffer covers: more when income is unpredictable. */
const BUFFER_WEEKS = { steady: 1, irregular: 2 } as const;
/** Unexplained outflow worth telling them about, because it blurs the plan. */
const NOTABLE_UNEXPLAINED_SHARE = 0.15;

/**
 * Of what is left after needs, everyday spending and the buffer, the share pointed at the
 * goal — the rest is theirs to enjoy. Goals that are about tightening up take a smaller share
 * than goals that are about building something.
 */
const GOAL_SHARE: Record<UserProfile["goal"], number> = {
  save_more: 0.6,
  stop_overspending: 0.4,
  emergency_fund: 0.7,
  invest: 0.6,
  pay_off_debt: 0.7,
  buy_something: 0.65,
  grow_business: 0.6,
  travel: 0.6,
  understand_spending: 0.4,
  other: 0.5,
};

const EXPENSE_LABEL: Partial<Record<UserProfile["expensesCovered"][number], { label: string; categories: string[] }>> = {
  rent: { label: "rent", categories: ["Housing"] },
  electricity: { label: "electricity", categories: ["Bills"] },
  school: { label: "school fees", categories: ["Education"] },
};

export function isEnoughToPlan(analysis: FinancialAnalysis): boolean {
  if (!analysis.periodStart || !analysis.periodEnd) return false;
  return daysBetween(analysis.periodStart, analysis.periodEnd) + 1 >= MIN_DAYS_FOR_PLAN && analysis.transactionCount >= MIN_TRANSACTIONS_FOR_PLAN;
}

/**
 * The deterministic Money Plan. Every figure here is arithmetic on the person's own
 * transactions and answers; the model only ever gets to reword it (see narrative.ts).
 * Returns null when the statement is too thin to plan on honestly.
 */
export function buildMoneyPlan(
  transactions: NormalizedTransaction[],
  profile: UserProfile,
  analysis: FinancialAnalysis,
  now: Date = new Date()
): MoneyPlan | null {
  if (!isEnoughToPlan(analysis)) return null;

  const months = periodInMonths(analysis.periodStart, analysis.periodEnd);
  const income = computePlanIncome(transactions, analysis, profile, months);
  const spending = computeMonthlySpending(transactions, analysis, profile, months);

  const rawEveryday = spending.buckets.everyday;
  const baseline: PlanBaseline = {
    essentials: roundTo(spending.buckets.essentials, 1_000),
    everyday: roundTo(rawEveryday, 1_000),
    fun: roundTo(spending.buckets.fun, 1_000),
    saving: roundTo(spending.saving, 1_000),
    buffer: roundTo(((rawEveryday + spending.buckets.fun) / WEEKS_PER_MONTH) * BUFFER_WEEKS[income.regularity], 1_000),
    goalShare: GOAL_SHARE[profile.goal],
  };

  const ctx = { analysis, profile, months, income: income.monthly, spending };
  const changes = buildChanges(ctx);
  const defaultSelected = changes.filter((c) => !c.optional).slice(0, DEFAULT_CHANGES_SHOWN).map((c) => c.id);
  const scenarioIds = changes.filter((c) => c.scenario && !c.optional).slice(0, SCENARIOS_SHOWN).map((c) => c.id);

  const irregular = income.regularity === "irregular";
  const goalLabel = profile.goal === "other" ? null : labelFor(GOAL_OPTIONS, profile.goal);

  const plan: MoneyPlan = {
    income,
    baseline,
    goalLabel,
    changes,
    defaultSelected,
    scenarioIds,
    extraRules: buildExtraRules(ctx),
    paydayRule: irregular
      ? "Every time money comes in, move {goalsPercent} toward your goal before you spend the rest."
      : "Move {goals} to savings the day your income lands, before you spend anything else.",
    paydayReset: irregular
      ? "The next time money lands, move {goalsPercent} of it toward your goal before spending the rest."
      : "Move {goals} to savings when your next income lands.",
    safeToSpend: null,
    safeToSpendNote: null,
    intro: defaultIntro(profile, income.monthly, income.basis, goalLabel),
    assumptions: [],
  };

  // Safe-to-spend leans on what the plan sets aside for goals, so it is computed from the
  // plan as first shown and stays put while someone explores other choices.
  const firstView = computePlanView(plan, defaultSelected);
  const safe = computeSafeToSpend({
    transactions,
    analysis,
    profile,
    income,
    baseline,
    goalsMonthly: firstView.goals,
    today: now.toISOString().slice(0, 10),
  });
  plan.safeToSpend = safe.value;
  plan.safeToSpendNote = safe.note;
  plan.assumptions = buildAssumptions(profile, analysis, plan, months);
  return plan;
}

function defaultIntro(profile: UserProfile, monthly: number, basis: "statement" | "stated", goalLabel: string | null): string {
  const source = basis === "statement" ? "what actually comes in" : "the income range you gave us";
  const goal = goalLabel ? `your goal to ${goalLabel}` : "the goal you set";
  return `Built around ${source} (about ${n(monthly)} a month), ${goal}, and how you really spend.`;
}

/** The working, in plain words — what the plan leaned on, so nothing in it is a mystery. */
function buildAssumptions(
  profile: UserProfile,
  analysis: FinancialAnalysis,
  plan: MoneyPlan,
  months: number
): string[] {
  const out: string[] = [];
  const { income } = plan;

  const span = months < 1.25 ? "about a month" : `about ${Math.round(months)} months`;
  out.push(`Your statement covers ${span}, so every monthly figure is an average of that.`);

  if (income.basis === "statement") {
    out.push(
      income.regularity === "irregular"
        ? `Your income varies, so we planned on a typical month (${n(income.monthly)}) rather than the best one${income.lowestMonth !== null ? `. Your lowest month was ${n(income.lowestMonth)}` : ""}.`
        : `We planned on ${n(income.monthly)} a month, which is what your statement shows arriving as earnings.`
    );
    const stated = statedMonthlyIncome(profile.income);
    if (stated >= income.monthly * 1.5) {
      out.push(`You told us ${labelFor(MONTHLY_INCOME_OPTIONS, profile.income)} a month. We planned on what this statement shows, since that's what we can see.`);
    }
  } else {
    out.push(`We couldn't confirm any earnings in this statement, so we used the low end of the range you gave us (${n(income.monthly)}). If that's off, the plan will be too.`);
  }

  if (income.streams.some((s) => s.label === "Support and gifts")) {
    out.push("Money from family or gifts counts as income only because you told us you rely on it, and we mark it as the less certain part.");
  }

  if (analysis.loans.borrowed > 0) {
    out.push(
      `You borrowed ${n(analysis.loans.borrowed)} across ${plural(analysis.loans.borrowedCount, "time")}. We don't count borrowed money as income or as spending money. Keeping a buffer is what makes the next borrow less likely.`
    );
  }

  if (analysis.reimbursements.sharedExpenses > 0) {
    out.push(
      `${plural(analysis.reimbursements.sharedExpenses, "expense")} looked shared. We counted your share (${n(analysis.reimbursements.netBurden)}) instead of the ${n(analysis.reimbursements.sharedExpenseTotal)} you first paid.`
    );
  }

  if (analysis.support.sent > 0) {
    out.push(
      supportsDependants(profile)
        ? "Money you send to family counts as an essential, since you told us you support them."
        : "Money you give to people counts as fun money, because it's a choice you're making."
    );
  }

  const unseen = profile.expensesCovered.flatMap((e) => {
    const expected = EXPENSE_LABEL[e];
    if (!expected) return [];
    const seen = analysis.categoryBreakdown.some((c) => expected.categories.includes(c.category) && c.total > 0);
    return seen ? [] : [expected.label];
  });
  if (unseen.length > 0) {
    out.push(
      `You said you cover ${unseen.join(" and ")}, but we can't see ${unseen.length > 1 ? "them" : "it"} in this statement. If you pay from elsewhere, your real essentials are higher than shown.`
    );
  }

  if (analysis.uncertainOutflow.percentOfOutflow >= NOTABLE_UNEXPLAINED_SHARE * 100) {
    out.push(
      `${Math.round(analysis.uncertainOutflow.percentOfOutflow)}% of what left your account is still unexplained, and we've counted it as everyday spending. Labelling it in your autopsy will sharpen this plan.`
    );
  }

  if (plan.safeToSpend) {
    out.push(
      plan.safeToSpend.endsAtPayday
        ? "Safe to spend runs until your next regular payday, and we don't count money that hasn't arrived."
        : "We don't count future income you can't rely on, so safe to spend runs to the end of the month."
    );
  }
  return out.map(cap);
}
