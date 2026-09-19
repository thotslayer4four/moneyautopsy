import type { FinancialAnalysis, IncomeSource, NormalizedTransaction, PlanIncome, UserProfile } from "@/lib/types";
import { INCOME_SOURCE_OPTIONS, labelFor } from "@/lib/profile/options";
import { mean, median, sortByDate, stddev } from "@/lib/analysis/helpers";
import { cap, roundTo } from "./numbers";

/** Sources whose amount and timing move around, however steady one month happened to look. */
const VARIABLE_SOURCES: readonly IncomeSource[] = ["freelance", "business", "side_hustle", "commissions", "family_support", "gifts_support"];
/** Sources that arrive as money from people, which a statement can't tell apart from a gift. */
const SUPPORT_SOURCES: readonly IncomeSource[] = ["allowance", "family_support", "gifts_support"];

/**
 * The lower edge of the range they picked (the first band uses its midpoint). Only ever used
 * when the statement shows no earnings we can confirm — and it is deliberately the cautious end.
 */
const STATED_MONTHLY: Record<UserProfile["income"], number> = {
  "0_50k": 25_000,
  "50k_100k": 50_000,
  "100k_250k": 100_000,
  "250k_500k": 250_000,
  "500k_1m": 500_000,
  "1m_2m": 1_000_000,
  "2m_plus": 2_000_000,
};

const IRREGULAR_VARIATION = 0.35;

export const statedMonthlyIncome = (income: UserProfile["income"]) => STATED_MONTHLY[income];

/**
 * Earned income per calendar month, for the months the statement covers in full — that is,
 * everything strictly between its first and last month. The edge months are partial (a
 * statement can start after payday or end before the next one), so a "missing" income there
 * would be an artefact of where the statement was cut, not a fact about the person.
 */
function interiorMonthTotals(incomeTx: NormalizedTransaction[], start: string, end: string): number[] {
  const totals = new Map<string, number>();
  for (const t of incomeTx) totals.set(t.date.slice(0, 7), (totals.get(t.date.slice(0, 7)) ?? 0) + t.amount);
  const result: number[] = [];
  const cursor = new Date(start.slice(0, 7) + "-01T00:00:00Z");
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  const last = end.slice(0, 7);
  for (; cursor.toISOString().slice(0, 7) < last; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    result.push(totals.get(cursor.toISOString().slice(0, 7)) ?? 0);
  }
  return result;
}

/**
 * A typical month for money that arrives in lumps. Middle month it actually landed in — but
 * when most full months had nothing (one big payment in a long statement), the middle is 0,
 * which would erase real income; the average month is the honest figure then.
 */
function typicalMonth(txs: NormalizedTransaction[], start: string | undefined, end: string | undefined, irregular: boolean, monthsCovered: number): number {
  const full = start && end ? interiorMonthTotals(txs, start, end) : [];
  if (irregular && full.length >= 2) {
    const middle = median(full);
    if (middle > 0) return middle;
    const average = mean(full);
    if (average > 0) return average;
    // Everything landed in the partial first/last month: spread it over the months covered
    // rather than pretend nothing came in.
    return txs.reduce((s, t) => s + t.amount, 0) / Math.max(1, monthsCovered);
  }
  const byMonth = new Map<string, number>();
  for (const t of txs) byMonth.set(t.date.slice(0, 7), (byMonth.get(t.date.slice(0, 7)) ?? 0) + t.amount);
  return median(Array.from(byMonth.values()));
}

/** Credits from people we haven't confirmed as anything: possibly earnings, possibly not. */
const UNCONFIRMED_CATEGORIES = new Set(["Uncertain", "Other", "Gifts & support"]);
const MIN_UNCONFIRMED_CREDIT = 5_000;
const MIN_ESTIMATED_MONTHLY = 5_000;

export function computePlanIncome(
  transactions: NormalizedTransaction[],
  analysis: FinancialAnalysis,
  profile: UserProfile,
  months: number
): PlanIncome {
  const sorted = sortByDate(transactions);
  const start = sorted[0]?.date;
  const end = sorted[sorted.length - 1]?.date;
  const incomeTx = transactions.filter((t) => t.direction === "in" && t.category === "Income");
  // Needs at least two full months before the data can call income irregular by itself.
  const fullMonths = start && end ? interiorMonthTotals(incomeTx, start, end) : [];

  const variableByNature = VARIABLE_SOURCES.includes(profile.primaryIncomeSource);
  const variableByData =
    fullMonths.length >= 2 && (fullMonths.some((m) => m === 0) || stddev(fullMonths) / (mean(fullMonths) || 1) > IRREGULAR_VARIATION);
  const regularity: PlanIncome["regularity"] = variableByNature || variableByData ? "irregular" : "steady";

  // Pay arrives in lumps, so a typical month is the middle month it actually landed in — never
  // the total divided by days, which turns one salary in a 20-day statement into a bigger one.
  const earnedTypical = typicalMonth(incomeTx, start, end, regularity === "irregular", months);

  // Money from family or gifts counts only when they told us that is part of how they live,
  // and is always marked as the less certain part.
  const countsSupport = profile.incomeSources.some((s) => SUPPORT_SOURCES.includes(s));
  const supportMonthly = countsSupport ? analysis.support.receivedGifts / Math.max(1, months) : 0;

  const earnedLabel = profile.incomeSources.length === 1 ? cap(labelFor(INCOME_SOURCE_OPTIONS, profile.primaryIncomeSource) ?? "Income") : "Earned income";
  const streams: PlanIncome["streams"] = [];
  if (earnedTypical > 0) streams.push({ label: earnedLabel, monthly: roundTo(earnedTypical, 1_000), reliability: regularity });
  if (supportMonthly > 0) streams.push({ label: "Support and gifts", monthly: roundTo(supportMonthly, 1_000), reliability: "irregular" });

  const uncountedCategories = new Set(["Gifts & support", "Loans", "Uncertain", "Betting", "Other"]);
  const otherInflow = Math.max(
    0,
    analysis.inflowBreakdown.filter((e) => uncountedCategories.has(e.category)).reduce((s, e) => s + e.total, 0) / months - supportMonthly
  );

  const evidenced = earnedTypical + supportMonthly;
  if (evidenced >= 1_000) {
    return {
      monthly: roundTo(evidenced, 1_000),
      basis: "statement",
      regularity,
      lowestMonth: fullMonths.length >= 2 ? roundTo(Math.min(...fullMonths), 1_000) : null,
      otherInflow: roundTo(otherInflow, 1_000),
      streams,
    };
  }

  // Nothing confirmed as earnings. Before falling back to a dropdown answer, look at what the
  // statement itself shows arriving from people: that is real evidence, if unconfirmed.
  const unconfirmed = transactions.filter(
    (t) => t.direction === "in" && UNCONFIRMED_CATEGORIES.has(t.category) && t.amount >= MIN_UNCONFIRMED_CREDIT
  );
  const likely = unconfirmed.length > 0 ? typicalMonth(unconfirmed, start, end, true, months) : 0;
  if (likely >= MIN_ESTIMATED_MONTHLY) {
    return {
      monthly: roundTo(likely, 1_000),
      basis: "estimated",
      regularity: "irregular",
      lowestMonth: null,
      otherInflow: roundTo(Math.max(0, otherInflow - likely), 1_000),
      streams: [{ label: "Money from people, not confirmed as earnings", monthly: roundTo(likely, 1_000), reliability: "irregular" }],
    };
  }

  // No credits worth planning on at all: all that's left is what they told us.
  const stated = STATED_MONTHLY[profile.income];
  return {
    monthly: stated,
    basis: "stated",
    regularity,
    lowestMonth: null,
    otherInflow: roundTo(otherInflow, 1_000),
    streams: [{ label: earnedLabel, monthly: stated, reliability: regularity }],
  };
}
