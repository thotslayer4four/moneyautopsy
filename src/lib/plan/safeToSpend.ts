import type { FinancialAnalysis, NormalizedTransaction, PlanBaseline, PlanIncome, SafeToSpend, UserProfile } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { dayOfMonth, daysBetween, median, sortByDate } from "@/lib/analysis/helpers";
import { bucketFor } from "./spending";
import { DAYS_PER_MONTH, roundTo } from "./numbers";

/** A balance older than this says nothing reliable about what is safe to spend today. */
const MAX_STATEMENT_AGE_DAYS = 14;
/** The running balance must come from the statement's last few days, not somewhere mid-way. */
const BALANCE_RECENCY_DAYS = 3;
/** Paydays this far apart within a month are not one regular payday. */
const PAYDAY_SPREAD_DAYS = 7;
/** The payday must be most of what arrived that month, not one of several small credits. */
const MAIN_EVENT_SHARE = 0.6;

const DAY_MS = 24 * 60 * 60 * 1000;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => iso(new Date(new Date(date + "T00:00:00Z").getTime() + days * DAY_MS));
const daysInMonth = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
const dateOn = (year: number, month0: number, day: number) => iso(new Date(Date.UTC(year, month0, Math.min(day, daysInMonth(year, month0)))));

/** One regular payday a month, when the evidence says there is one: each month's biggest
 * income event lands on about the same day, and is most of what arrived that month. */
function regularPaydayDay(incomeTx: NormalizedTransaction[], steady: boolean): number | null {
  if (!steady) return null;
  const byMonth = new Map<string, NormalizedTransaction[]>();
  for (const t of incomeTx) byMonth.set(t.date.slice(0, 7), [...(byMonth.get(t.date.slice(0, 7)) ?? []), t]);
  if (byMonth.size < 2) return null;
  const days: number[] = [];
  for (const txs of byMonth.values()) {
    const biggest = txs.reduce((a, b) => (b.amount > a.amount ? b : a));
    if (biggest.amount < txs.reduce((s, t) => s + t.amount, 0) * MAIN_EVENT_SHARE) return null;
    days.push(dayOfMonth(biggest.date));
  }
  return Math.max(...days) - Math.min(...days) <= PAYDAY_SPREAD_DAYS ? Math.round(median(days)) : null;
}

export interface SafeToSpendInput {
  transactions: NormalizedTransaction[];
  analysis: FinancialAnalysis;
  profile: UserProfile;
  income: PlanIncome;
  baseline: PlanBaseline;
  /** What the plan sets aside for goals each month (from the plan as first shown). */
  goalsMonthly: number;
  today: string;
}

/**
 * What is safe to spend until the next money is expected. Deterministic, and honest about
 * what it can't know: without a recent running balance it returns a reason instead of a number.
 *
 * The working: balance now, minus essentials still to come, recurring payments due, whatever
 * is still to move toward the goal this cycle, and the buffer. Future income is only counted
 * when it is a regular payday — then the period simply ends at that payday.
 */
export function computeSafeToSpend(input: SafeToSpendInput): { value: SafeToSpend | null; note: string | null } {
  const { transactions, analysis, profile, income, baseline, goalsMonthly, today } = input;
  const sorted = sortByDate(transactions);
  const last = [...sorted].reverse().find((t) => t.balance !== null);
  if (!last || !analysis.periodEnd || daysBetween(last.date, analysis.periodEnd) > BALANCE_RECENCY_DAYS) {
    return { value: null, note: "This statement doesn't show a running balance, so we can't say what's safe to spend right now." };
  }
  const asOf = last.date;
  const balance = last.balance as number;
  if (daysBetween(asOf, today) > MAX_STATEMENT_AGE_DAYS) {
    return { value: null, note: `Your statement ends on ${formatDate(asOf)}. Upload a newer one and we'll work out what's safe to spend right now.` };
  }

  // ---- the period we are spending through ----
  const incomeTx = transactions.filter((t) => t.direction === "in" && t.category === "Income");
  const paydayDay = regularPaydayDay(incomeTx, income.regularity === "steady");
  const asOfDate = new Date(asOf + "T00:00:00Z");
  const year = asOfDate.getUTCFullYear();
  const month0 = asOfDate.getUTCMonth();

  let cycleStart: string;
  let cycleEnd: string; // last day of the period; money is expected the day after (payday) or a new month begins
  if (paydayDay !== null) {
    const thisMonth = dateOn(year, month0, paydayDay);
    const nextPayday = thisMonth > asOf ? thisMonth : dateOn(year, month0 + 1, paydayDay);
    const prevPayday = thisMonth <= asOf ? thisMonth : dateOn(year, month0 - 1, paydayDay);
    cycleStart = prevPayday;
    cycleEnd = addDays(nextPayday, -1);
  } else {
    cycleStart = dateOn(year, month0, 1);
    cycleEnd = dateOn(year, month0, daysInMonth(year, month0));
    if (cycleEnd <= asOf) cycleEnd = dateOn(year, month0 + 1, daysInMonth(year, month0 + 1));
  }
  const daysLeft = Math.max(1, daysBetween(asOf, cycleEnd) + (paydayDay !== null ? 1 : 0));

  // ---- what is already spoken for ----
  // A typical month's essentials, less what has already gone out this cycle — so rent paid on
  // the 2nd isn't counted again on the 12th, and rent still to come is counted in full.
  const cycleDays = daysBetween(cycleStart, cycleEnd) + 1;
  const essentialsPaid = transactions
    .filter((t) => t.direction === "out" && t.date >= cycleStart && t.date <= asOf && bucketFor(t.category, profile) === "essentials")
    .reduce((s, t) => s + t.amount, 0);
  const essentialsRemaining = Math.max(0, (baseline.essentials * cycleDays) / DAYS_PER_MONTH - essentialsPaid);

  // Subscription-style payments falling due before the period ends. Repeating everyday spend
  // (a weekly cash-out, lunch) isn't a commitment, and essentials are in the line above.
  let upcoming = 0;
  for (const r of analysis.recurringExpenses) {
    if (!r.likelySubscription || !r.lastDate || !r.cadenceDays || r.cadenceDays < 7 || r.occurrences < 3) continue;
    if (bucketFor(r.category, profile) === "essentials") continue;
    for (let due = addDays(r.lastDate, r.cadenceDays); due <= cycleEnd; due = addDays(due, r.cadenceDays)) {
      if (due > asOf) upcoming += r.averageAmount;
    }
  }

  const movedSince = transactions
    .filter((t) => t.date >= cycleStart && t.date <= asOf && (t.category === "Savings" || t.category === "Investments"))
    .reduce((s, t) => s + (t.direction === "out" ? t.amount : -t.amount), 0);
  const goalStillToMove = Math.max(0, goalsMonthly - Math.max(0, movedSince));

  const working = [
    { label: "In your account", amount: roundTo(balance, 500) },
    { label: "Essentials still to come", amount: -roundTo(essentialsRemaining, 500) },
    ...(upcoming > 0 ? [{ label: "Recurring payments due", amount: -roundTo(upcoming, 500) }] : []),
    ...(goalStillToMove > 0 ? [{ label: "Still to move toward your goal", amount: -roundTo(goalStillToMove, 500) }] : []),
    ...(baseline.buffer > 0 ? [{ label: "Buffer you leave alone", amount: -roundTo(baseline.buffer, 500) }] : []),
  ];
  const room = working.reduce((s, w) => s + w.amount, 0);

  return {
    value: {
      daily: Math.max(0, roundTo(room / daysLeft, 100)),
      remaining: Math.max(0, room),
      over: Math.max(0, -room),
      daysLeft,
      asOf,
      periodEnd: paydayDay !== null ? addDays(cycleEnd, 1) : cycleEnd,
      endsAtPayday: paydayDay !== null,
      usualDaily: roundTo((baseline.everyday + baseline.fun) / DAYS_PER_MONTH, 100),
      working,
    },
    note: null,
  };
}
