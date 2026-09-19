import type { Category, FinancialAnalysis, NormalizedTransaction, PlanBucket, UserProfile } from "@/lib/types";
import { CATEGORY_KIND } from "@/lib/categorization/categories";
import { median } from "@/lib/analysis/helpers";
import { roundTo } from "./numbers";

/** Categories paid in big periodic lumps (rent, fees). Their typical month is the middle month
 * they were paid in, since dividing one rent payment by the days in a short statement inflates it. */
const LUMPY_CATEGORIES: readonly Category[] = ["Housing", "Education"];

const DEPENDANT_SUPPORT = ["parents_family", "partner", "children"] as const;
const DEPENDANT_EXPENSES = ["family_expenses", "children"] as const;

/** Whether supporting people is a need for them (family, partner, children) or a choice (friends…). */
export function supportsDependants(profile: UserProfile): boolean {
  return (
    profile.supports.some((s) => (DEPENDANT_SUPPORT as readonly string[]).includes(s)) ||
    profile.expensesCovered.some((e) => (DEPENDANT_EXPENSES as readonly string[]).includes(e))
  );
}

/**
 * Which kind of money a category is. Groceries, housing, bills, data and the like are needs;
 * eating out, shopping and personal spending are everyday; entertainment, travel and betting
 * are fun. Transport is a need only when they told us they cover it themselves.
 */
export function bucketFor(category: Category, profile: UserProfile): PlanBucket | null {
  switch (category) {
    case "Housing":
    case "Bills":
    case "Groceries":
    case "Education":
    case "Health":
    case "Government":
    case "Data":
    case "Airtime":
    case "Banking fees":
      return "essentials";
    case "Transport":
      return profile.expensesCovered.includes("transportation") ? "essentials" : "everyday";
    case "Food":
    case "Shopping":
    case "Personal expenses":
    case "Subscriptions":
    case "Other":
    case "Cash":
    case "Uncertain":
      return "everyday";
    case "Entertainment":
    case "Travel":
    case "Betting":
      return "fun";
    case "Gifts & support":
      return supportsDependants(profile) ? "essentials" : "fun";
    default:
      return null; // savings, loans, transfers… are money moved, not lifestyle
  }
}

/** The bucket for money given to or lent to other people. */
export const helpingBucket = (profile: UserProfile): PlanBucket => (supportsDependants(profile) ? "essentials" : "fun");

export interface MonthlySpending {
  /** Typical monthly spend per category, net of what friends paid back. */
  byCategory: Map<Category, { monthly: number; count: number }>;
  /** Shared costs they fronted and haven't been repaid for — real money out of their pocket. */
  frontedNet: number;
  buckets: Record<"essentials" | "everyday" | "fun", number>;
  /** Net money lent (lent minus repaid to them), per month. */
  lentNet: number;
  supportSent: number;
  bettingNet: number;
  /** Money already being moved toward goals: net savings and debt repayment, per month. */
  saving: number;
  uncertainShare: number;
}

/**
 * A typical month of real spending, by kind of money. Betting counts net of winnings
 * withdrawn; shared expenses count net of what friends paid back; savings, loans and
 * transfers between own accounts never count as spending.
 */
export function computeMonthlySpending(
  transactions: NormalizedTransaction[],
  analysis: FinancialAnalysis,
  profile: UserProfile,
  months: number
): MonthlySpending {
  const byId = new Map(transactions.map((t) => [t.id, t]));

  const offsetByCategory = new Map<Category, number>();
  let unlinkedReceived = 0;
  for (const t of transactions) {
    if (t.direction !== "in" || t.category !== "Reimbursements") continue;
    const expense = t.relatedTransactionId ? byId.get(t.relatedTransactionId) : undefined;
    if (expense && expense.direction === "out") {
      offsetByCategory.set(expense.category, (offsetByCategory.get(expense.category) ?? 0) + t.amount);
    } else {
      unlinkedReceived += t.amount;
    }
  }

  const totals = new Map<Category, { total: number; count: number }>();
  const lumpsByMonth = new Map<Category, Map<string, number>>();
  let fronted = 0;
  for (const t of transactions) {
    if (t.direction !== "out") continue;
    if (t.category === "Reimbursements") {
      fronted += t.amount;
      continue;
    }
    const e = totals.get(t.category) ?? { total: 0, count: 0 };
    e.total += t.amount;
    e.count += 1;
    totals.set(t.category, e);
    if (LUMPY_CATEGORIES.includes(t.category)) {
      const m = lumpsByMonth.get(t.category) ?? new Map<string, number>();
      m.set(t.date.slice(0, 7), (m.get(t.date.slice(0, 7)) ?? 0) + t.amount);
      lumpsByMonth.set(t.category, m);
    }
  }

  const byCategory = new Map<Category, { monthly: number; count: number }>();
  for (const [category, { total, count }] of totals) {
    const net = Math.max(0, total - (offsetByCategory.get(category) ?? 0));
    const lumps = lumpsByMonth.get(category);
    byCategory.set(category, { monthly: lumps ? median(Array.from(lumps.values())) : net / months, count });
  }

  const bettingNet = (analysis.betting?.netOutflow ?? 0) / months;
  const supportSent = analysis.support.sent / months;
  const lentNet = Math.max(0, analysis.loans.lent - analysis.loans.receivedBack) / months;
  // Only fronted costs someone paid back nothing for are real burden; the rest came back.
  const frontedNet = Math.max(0, fronted - unlinkedReceived) / months;

  const buckets = { essentials: 0, everyday: 0, fun: 0 };
  for (const [category, { monthly }] of byCategory) {
    if (CATEGORY_KIND[category] === "moved") continue;
    // Betting and giving are taken from their own summaries below (net of winnings; plus lending).
    if (category === "Betting" || category === "Gifts & support") continue;
    const bucket = bucketFor(category, profile);
    if (bucket && bucket !== "goals" && bucket !== "buffer") buckets[bucket] += monthly;
  }
  buckets.fun += bettingNet;
  const helping = helpingBucket(profile);
  if (helping === "essentials" || helping === "fun") buckets[helping] += supportSent + lentNet;
  buckets.everyday += frontedNet;

  // Savings and repayments are lumps too: one transfer in a short statement is one month's worth.
  const lumpMonths = Math.max(1, months);
  const saving = (Math.max(0, analysis.savings.netSaved) + analysis.loans.repaid) / lumpMonths;
  const uncertainShare = analysis.totalOutflow > 0 ? analysis.uncertainOutflow.total / analysis.totalOutflow : 0;

  return {
    byCategory,
    frontedNet: roundTo(frontedNet, 1),
    buckets: { essentials: buckets.essentials, everyday: buckets.everyday, fun: buckets.fun },
    lentNet,
    supportSent,
    bettingNet,
    saving,
    uncertainShare,
  };
}
