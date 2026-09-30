import type { FinancialAnalysis, MoneyPlan, NormalizedTransaction, PlanBaseline, UserProfile } from "@/lib/types";
import { GOAL_OPTIONS, MONTHLY_INCOME_OPTIONS, REDUCE_AREA_OPTIONS, RENT_FREQUENCY_OPTIONS, SCHOOL_FREQUENCY_OPTIONS, labelFor } from "@/lib/profile/options";
import { daysBetween, periodInMonths } from "@/lib/analysis/helpers";
import { formatNaira } from "@/lib/format";
import { computePlanIncome, statedMonthlyIncome } from "./income";
import { computeMonthlySpending, supportsDependants } from "./spending";
import { computeObligations, formatMonth, statedCategoryMonthly } from "./obligations";
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
/** How many weeks of everyday and fun spending the buffer holds: more when income is unpredictable. */
const BUFFER_WEEKS = { steady: 2, irregular: 4 } as const;
/** A buffer is built once, over about this many months, then left alone. */
const BUFFER_FILL_MONTHS = 3;
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
  const today = now.toISOString().slice(0, 10);
  const income = computePlanIncome(transactions, analysis, profile, months);
  const obligations = computeObligations(profile, today);
  const debt = obligations.find((o) => o.id === "debt");
  const spending = computeMonthlySpending(transactions, analysis, profile, months, {
    categoryMonthly: statedCategoryMonthly(obligations),
    supportMonthly: profile.supportMonthly ?? 0,
    debtMonthly: debt?.monthly ?? 0,
  });
  const preference = profile.savingsPreference;

  const rawEveryday = spending.buckets.everyday;
  // Savings they already have count toward the cushion first; only the rest is built, in a few
  // monthly steps, and then the plan stops asking for it.
  const bufferTarget = roundTo(((rawEveryday + spending.buckets.fun) / WEEKS_PER_MONTH) * BUFFER_WEEKS[income.regularity], 1_000);
  const bufferCovered = Math.min(bufferTarget, profile.savingsBalance ?? 0);
  const bufferLeft = bufferTarget - bufferCovered;
  const baseline: PlanBaseline = {
    essentials: roundTo(spending.buckets.essentials, 1_000),
    everyday: roundTo(rawEveryday, 1_000),
    fun: roundTo(spending.buckets.fun, 1_000),
    saving: roundTo(spending.saving, 1_000),
    buffer: bufferLeft > 0 ? Math.min(bufferLeft, Math.max(1_000, roundTo(bufferTarget / BUFFER_FILL_MONTHS, 1_000))) : 0,
    bufferTarget,
    bufferCovered,
    goalShare: GOAL_SHARE[profile.goal],
    goalPercent: preference && preference !== "dont_know" ? Number(preference) : null,
    reserved: obligations.filter((o) => o.bucket === "goals").reduce((s, o) => s + o.monthly, 0),
  };

  const ctx = { analysis, profile, months, income: income.monthly, spending, obligations };
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
    obligations,
    savingsBalance: profile.savingsBalance ?? null,
    unexplainedMonthly:
      spending.uncertainShare >= NOTABLE_UNEXPLAINED_SHARE ? roundTo(analysis.uncertainOutflow.total / months, 1_000) : 0,
    defaultSelected,
    scenarioIds,
    extraRules: [],
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
  // A weekly number is the easiest limit to keep when spending already runs past income, or
  // when reining it in is the whole point.
  plan.extraRules = buildExtraRules(ctx, { weeklyLimit: firstView.gap > 0 || profile.goal === "stop_overspending" });
  const safe = computeSafeToSpend({
    transactions,
    analysis,
    profile,
    income,
    baseline,
    goalsMonthly: firstView.goals,
    obligations,
    today,
  });
  plan.safeToSpend = safe.value;
  plan.safeToSpendNote = safe.note;
  plan.assumptions = buildAssumptions(profile, analysis, plan, months);
  return plan;
}

function joinWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function defaultIntro(profile: UserProfile, monthly: number, basis: MoneyPlan["income"]["basis"], goalLabel: string | null): string {
  const source =
    basis === "statement" ? "what actually comes in" : basis === "estimated" ? "the money that has actually been arriving" : "the income range you gave us";
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
        ? `Your income varies, so we planned on your average month (${n(income.monthly)}): everything that arrived as earnings, spread over the months this statement covers${income.lowestMonth !== null ? `. Your lowest full month was ${n(income.lowestMonth)}, so keep the buffer for months like that` : ""}.`
        : `We planned on ${n(income.monthly)} a month, which is what your statement shows arriving as earnings.`
    );
    const stated = statedMonthlyIncome(profile.income);
    if (stated >= income.monthly * 1.5) {
      out.push(`You told us ${labelFor(MONTHLY_INCOME_OPTIONS, profile.income)} a month. We planned on what this statement shows, since that's what we can see.`);
    }
  } else if (income.basis === "estimated") {
    out.push(
      `We couldn't confirm which money is earnings, so we planned on what arrived from people in an average month (${n(income.monthly)}). That can include transfers between your own accounts or one-off help, so tell us which credits are income and the plan firms up.`
    );
    const stated = statedMonthlyIncome(profile.income);
    if (stated >= income.monthly * 1.5 || income.monthly >= stated * 2) {
      out.push(`You told us ${labelFor(MONTHLY_INCOME_OPTIONS, profile.income)} a month, which is quite different. We went with what this statement shows, since that's what we can see.`);
    }
  } else {
    out.push(`This statement shows no money arriving that we could plan on, so we used the low end of the range you gave us (${n(income.monthly)}). If that's off, the plan will be too.`);
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

  for (const o of plan.obligations) {
    if (o.id === "rent" || o.id === "school") {
      const freqLabel = o.id === "rent" ? labelFor(RENT_FREQUENCY_OPTIONS, profile.rentFrequency) : labelFor(SCHOOL_FREQUENCY_OPTIONS, profile.schoolFrequency);
      if (!o.everyMonths) {
        out.push(`You told us ${o.label} is ${n(o.amount)} on an irregular schedule, so we couldn't spread it into a monthly amount and used what this statement shows instead.`);
      } else if (o.everyMonths > 1) {
        out.push(`You told us ${o.label} is ${n(o.amount)} ${freqLabel}. Instead of counting it as one month's spending, the plan sets aside ${n(o.monthly)} a month toward it.`);
      } else {
        out.push(`You told us ${o.label} is ${n(o.amount)} a month, so that's what the plan uses, whichever account you pay it from.`);
      }
    }
    if (o.id === "debt") {
      out.push(`You told us you repay about ${n(o.amount)} a month on debt${o.note ? `, ${o.note}` : ""}. It counts as an essential, because it isn't optional.`);
    }
    if (o.id === "upcoming") {
      out.push(
        o.monthly > 0 && o.dueMonth
          ? o.monthsUntilDue === 0
            ? `${cap(o.label)} (${n(o.amount)}) is due this month, so all of it is set aside inside your goals.`
            : `To have ${n(o.amount)} for ${o.label} by ${formatMonth(o.dueMonth)}, the plan puts ${n(o.monthly)} a month toward it inside your goals.`
          : `You mentioned ${o.label} (${n(o.amount)}) but not when it's due, so the plan doesn't reserve for it yet.`
      );
    }
  }

  if (plan.savingsBalance !== null) {
    const due = plan.safeToSpend?.working.filter((w) => / due /.test(w.label)) ?? [];
    out.push(
      plan.savingsBalance > 0
        ? `You have about ${n(plan.savingsBalance)} saved. It's never counted as spending money${due.length > 0 ? ", so if you'll pay a bill due soon from it, you have more room day to day than safe to spend shows" : ""}.`
        : "You told us you have nothing saved yet, which is why the buffer matters so much in this plan."
    );
  }

  const areas = (profile.willingToReduce ?? []).filter((a) => a !== "not_sure" && a !== "none");
  if (areas.length > 0) {
    const labels = areas.map((a) => labelFor(REDUCE_AREA_OPTIONS, a)).filter((l): l is string => !!l);
    out.push(`You said you're open to spending less on ${joinWords(labels)}, so changes there come first. Anything else is only there if you want it.`);
  } else if (profile.willingToReduce?.includes("none")) {
    out.push("You said there's nothing you want to cut back on, so every change below is only a suggestion you can opt into.");
  }

  if (analysis.support.sent > 0) {
    out.push(
      supportsDependants(profile)
        ? "Money you send to family counts as an essential, since you told us you support them."
        : "Money you give to people counts as fun money, because it's a choice you're making."
    );
  }

  // Rent or fees they told us about are in the plan whichever account they're paid from.
  const stated = new Set<string>(plan.obligations.filter((o) => o.everyMonths && (o.id === "rent" || o.id === "school")).map((o) => o.id));
  const unseen = profile.expensesCovered.flatMap((e) => {
    const expected = EXPENSE_LABEL[e];
    if (!expected || stated.has(e)) return [];
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
