import type { FinancialAnalysis, IncomeSource, NormalizedTransaction, PlanIncome, UserProfile } from "@/lib/types";
import { INCOME_SOURCE_OPTIONS, labelFor } from "@/lib/profile/options";
import { daysBetween, mean, median, sortByDate, stddev } from "@/lib/analysis/helpers";
import { WEEKS_PER_MONTH, cap, roundTo } from "./numbers";

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

/** Steady pay's typical month: the middle month it actually landed in. Pay arrives in lumps,
 * so this is never the total divided by days, which turns one salary in a 20-day statement
 * into a bigger one. */
function medianMonth(txs: NormalizedTransaction[]): number {
  const byMonth = new Map<string, number>();
  for (const t of txs) byMonth.set(t.date.slice(0, 7), (byMonth.get(t.date.slice(0, 7)) ?? 0) + t.amount);
  return median(Array.from(byMonth.values()));
}

/** Irregular money's typical month: everything that arrived, averaged over the months the
 * statement covers. Never divided by less than one month, so a short statement with one big
 * payment isn't scaled up into a bigger month than it was. */
const averageMonth = (txs: NormalizedTransaction[], monthsCovered: number) =>
  txs.reduce((s, t) => s + t.amount, 0) / Math.max(1, monthsCovered);

/** Credits at least this share of the biggest are "the pay"; smaller ones are extras on top. */
const PAY_SHARE_OF_BIGGEST = 0.5;
/** How often pay can arrive, as the days between payments. Monthly allows for a payday moved
 * to the 30th because the 1st is a Saturday. */
const CADENCES = [
  { minDays: 5, maxDays: 9, perMonth: WEEKS_PER_MONTH },
  { minDays: 12, maxDays: 16, perMonth: WEEKS_PER_MONTH / 2 },
  { minDays: 24, maxDays: 38, perMonth: 1 },
] as const;
const PAY_AMOUNT_VARIATION = 0.2;
/** With this many earnings credits over this long and no rhythm to them, income is irregular. */
const MIN_CREDITS_TO_JUDGE = 3;
const MIN_REPEATING_EXTRAS = 2;
const MIN_DAYS_TO_JUDGE = 45;

/**
 * Salary-like pay: similar amounts arriving on a steady rhythm (weekly, fortnightly, monthly),
 * judged by the gaps between payments rather than by calendar months. Calendar months misread
 * a payday that shifts across a month-end (Jul 31, Sep 1) as one month with nothing in it.
 */
function regularPay(incomeTx: NormalizedTransaction[]): { monthly: number; ids: Set<string> } | null {
  if (incomeTx.length < 2) return null;
  // The pay is the credits close to the usual big amount; a bonus or a one-off lump is an extra.
  const biggest = Math.max(...incomeTx.map((t) => t.amount));
  const usual = median(incomeTx.filter((t) => t.amount >= biggest * PAY_SHARE_OF_BIGGEST).map((t) => t.amount));
  const pay = sortByDate(incomeTx.filter((t) => Math.abs(t.amount - usual) <= usual * PAY_AMOUNT_VARIATION));
  if (pay.length < 2) return null;
  const amounts = pay.map((t) => t.amount);
  const gaps = pay.slice(1).map((t, i) => daysBetween(pay[i].date, t.date));
  const cadence = CADENCES.find((c) => gaps.every((g) => g >= c.minDays && g <= c.maxDays));
  return cadence ? { monthly: median(amounts) * cadence.perMonth, ids: new Set(pay.map((t) => t.id)) } : null;
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

  const pay = regularPay(incomeTx);
  const variableByNature = VARIABLE_SOURCES.includes(profile.primaryIncomeSource) || profile.incomeTiming === "irregular";
  // A steady rhythm settles it: an empty calendar month is then just a shifted payday. Without
  // one, enough earnings over a long enough stretch to have shown a rhythm means there isn't one.
  const incomeDates = sortByDate(incomeTx).map((t) => t.date);
  const spanDays = incomeDates.length > 1 ? daysBetween(incomeDates[0], incomeDates[incomeDates.length - 1]) : 0;
  const variableByData =
    !pay &&
    ((incomeTx.length >= MIN_CREDITS_TO_JUDGE && spanDays >= MIN_DAYS_TO_JUDGE) ||
      (fullMonths.length >= 2 && (fullMonths.some((m) => m === 0) || stddev(fullMonths) / (mean(fullMonths) || 1) > IRREGULAR_VARIATION)));
  const regularity: PlanIncome["regularity"] = variableByNature || variableByData ? "irregular" : "steady";

  // Irregular money is planned on its average month. Steady pay is the regular payment itself,
  // with anything else that arrived averaged on top as a less certain extra.
  // Extras count only when they repeat: one bonus isn't something to plan every month on.
  const others = pay ? incomeTx.filter((t) => !pay.ids.has(t.id)) : [];
  const extras = others.length >= MIN_REPEATING_EXTRAS ? others : [];
  const payMonthly = regularity === "steady" && pay ? pay.monthly : 0;
  const extrasMonthly = payMonthly > 0 ? averageMonth(extras, months) : 0;
  const earnedTypical =
    regularity === "irregular" ? averageMonth(incomeTx, months) : payMonthly > 0 ? payMonthly + extrasMonthly : medianMonth(incomeTx);

  // Money from family or gifts counts only when they told us that is part of how they live,
  // and is always marked as the less certain part.
  const countsSupport = profile.incomeSources.some((s) => SUPPORT_SOURCES.includes(s));
  const supportMonthly = countsSupport ? analysis.support.receivedGifts / Math.max(1, months) : 0;

  const earnedLabel = profile.incomeSources.length === 1 ? cap(labelFor(INCOME_SOURCE_OPTIONS, profile.primaryIncomeSource) ?? "Income") : "Earned income";
  const streams: PlanIncome["streams"] = [];
  if (payMonthly > 0 && roundTo(extrasMonthly, 1_000) > 0) {
    streams.push({ label: cap(labelFor(INCOME_SOURCE_OPTIONS, profile.primaryIncomeSource) ?? "Regular pay"), monthly: roundTo(payMonthly, 1_000), reliability: "steady" });
    streams.push({ label: "Other earnings", monthly: roundTo(extrasMonthly, 1_000), reliability: "irregular" });
  } else if (earnedTypical > 0) {
    streams.push({ label: earnedLabel, monthly: roundTo(earnedTypical, 1_000), reliability: regularity });
  }
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
  const likely = averageMonth(unconfirmed, months);
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
