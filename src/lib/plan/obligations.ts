import type { PlanObligation, UserProfile } from "@/lib/types";
import { DEBT_PAYOFF_OPTIONS, MONTHS_BETWEEN, labelFor } from "@/lib/profile/options";
import { roundTo } from "./numbers";

/**
 * What they told us about bills a statement can't size or time: rent paid yearly, school fees
 * per semester, a debt repayment, a big expense coming up. Each becomes a true monthly cost
 * (₦1.2m yearly rent is ₦100k a month, not ₦1.2m in the month it's paid), plus whether that
 * monthly amount is enough by the time the next payment is due.
 *
 * An answer is only used while the answer it hangs off still applies: rent only while they
 * still say they pay rent, and so on — so going back and changing onboarding can't leave a
 * stale bill in the plan.
 */

const MONTH_STEP = 1_000;

/** Whole calendar months from `today` until "YYYY-MM" (0 = this month), rolled forward by the
 * cadence when the month they gave has already passed. Null when it can't be known. */
function monthsUntil(due: string | undefined, today: string, everyMonths: number | null): number | null {
  if (!due) return null;
  const [dy, dm] = due.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  let diff = dy * 12 + dm - (ty * 12 + tm);
  if (diff < 0) {
    if (!everyMonths) return null;
    diff += Math.ceil(-diff / everyMonths) * everyMonths;
  }
  return diff;
}

function monthLabel(fromToday: string, add: number): string {
  const [y, m] = fromToday.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + add, 1));
  return d.toISOString().slice(0, 7);
}

/** A bill paid every `everyMonths`, with how the monthly set-aside lines up against its due date. */
function periodic(
  id: "rent" | "school",
  label: string,
  amount: number,
  frequency: string | undefined,
  nextDue: string | undefined,
  today: string
): PlanObligation {
  const everyMonths = frequency ? (MONTHS_BETWEEN[frequency] ?? null) : null;
  const monthly = everyMonths ? roundTo(amount / everyMonths, MONTH_STEP) : 0;
  const until = everyMonths && everyMonths > 1 ? monthsUntil(nextDue, today, everyMonths) : null;

  // Due before a full cycle of setting aside could cover it: say what it would take from
  // scratch. "Due in 2 months" leaves two monthly set-asides; due this month leaves none.
  let setAsideByDue: number | null = null;
  let catchUpMonthly: number | null = null;
  if (until !== null && everyMonths && monthly > 0) {
    const saved = monthly * until;
    if (saved < amount) {
      setAsideByDue = saved;
      catchUpMonthly = roundTo(amount / Math.max(1, until), MONTH_STEP);
    }
  }

  return {
    id,
    label,
    amount,
    everyMonths,
    monthly,
    bucket: "essentials",
    dueMonth: until !== null ? monthLabel(today, until) : null,
    monthsUntilDue: until,
    setAsideByDue,
    catchUpMonthly,
    note: null,
  };
}

export function computeObligations(profile: UserProfile, today: string): PlanObligation[] {
  const out: PlanObligation[] = [];

  if (profile.expensesCovered.includes("rent") && profile.rentAmount) {
    out.push(periodic("rent", "rent", profile.rentAmount, profile.rentFrequency, profile.rentNextDue, today));
  }
  if (profile.expensesCovered.includes("school") && profile.schoolAmount) {
    out.push(periodic("school", "school fees", profile.schoolAmount, profile.schoolFrequency, profile.schoolNextDue, today));
  }

  if (profile.hasDebt === "yes" && profile.debtMonthly) {
    const payoff = profile.debtPayoff && profile.debtPayoff !== "not_sure" ? labelFor(DEBT_PAYOFF_OPTIONS, profile.debtPayoff) : null;
    const when = payoff && (payoff.startsWith("within") ? payoff : `in ${payoff}`);
    out.push({
      id: "debt",
      label: "debt repayments",
      amount: profile.debtMonthly,
      everyMonths: 1,
      monthly: roundTo(profile.debtMonthly, MONTH_STEP) || profile.debtMonthly,
      bucket: "essentials",
      dueMonth: null,
      monthsUntilDue: null,
      setAsideByDue: null,
      catchUpMonthly: null,
      note: when ? `expected to be paid off ${when}` : null,
    });
  }

  // A one-off: saved up for in equal parts until it's due. Due this month means all of it now.
  // Without a due date there is nothing honest to divide by, so it's listed but not reserved.
  if (profile.hasUpcomingExpense === "yes" && profile.upcomingAmount) {
    const until = monthsUntil(profile.upcomingDue, today, null);
    const what = profile.upcomingWhat?.trim().replace(/^(a|an|the|my|our)\s+/i, "");
    out.push({
      id: "upcoming",
      // "New laptop" → "your new laptop", so it reads naturally mid-sentence.
      label: what ? `your ${what.charAt(0).toLowerCase()}${what.slice(1)}` : "your upcoming expense",
      amount: profile.upcomingAmount,
      everyMonths: null,
      monthly: until !== null ? roundTo(profile.upcomingAmount / Math.max(1, until), MONTH_STEP) : 0,
      bucket: "goals",
      dueMonth: until !== null ? monthLabel(today, until) : null,
      monthsUntilDue: until,
      setAsideByDue: null,
      catchUpMonthly: null,
      note: null,
    });
  }

  return out;
}

/** The monthly amount a stated bill replaces in the statement's own figures, by category. */
export function statedCategoryMonthly(obligations: PlanObligation[]): { Housing?: number; Education?: number } {
  const out: { Housing?: number; Education?: number } = {};
  for (const o of obligations) {
    // No fixed cadence means we can't spread it, so the statement's own figure stands.
    if (!o.everyMonths || o.monthly <= 0) continue;
    if (o.id === "rent") out.Housing = o.monthly;
    if (o.id === "school") out.Education = o.monthly;
  }
  return out;
}

/** "YYYY-MM" → "March 2027". */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" });
}
