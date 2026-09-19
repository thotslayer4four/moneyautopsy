import type { Category, FinancialAnalysis, IncomeCheck, IncomeQuestion, NormalizedTransaction, UserProfile } from "@/lib/types";
import { computeFinancialAnalysis } from "@/lib/analysis";
import { answerFollowerIds, isStrongRecipientKey, isUserAnswered, periodInMonths, recipientKeyFor } from "@/lib/analysis/helpers";
import { deriveType } from "@/lib/categorization";
import { computePlanIncome } from "./income";
import { isEnoughToPlan } from "./build";

/** Credits that could be earnings. Everything else that arrives is money merely moved (own
 * accounts, savings, loans, paybacks, refunds) or betting winnings — never income. */
const COULD_BE_INCOME: readonly Category[] = ["Income", "Gifts & support", "Uncertain", "Other"];
/** The ones we haven't confidently called income, and so are worth asking about. */
const ASKABLE: readonly Category[] = ["Uncertain", "Gifts & support", "Other"];

/** A sender is asked about once they are this share of the money that came in… */
const HEAVY_SHARE = 0.1;
/** …or this share when spending is well above the income we can confirm. */
const HEAVY_SHARE_WHEN_OVERSPENDING = 0.05;
/** "Well above": spending more than a quarter over the income we can confirm. */
const OVERSPENDING_RATIO = 1.25;
const MAX_QUESTIONS = 4;
const MAX_QUESTIONS_WHEN_OVERSPENDING = 5;
/** Never worth a person's time below this. */
const MIN_CREDIT = 5_000;

export function isOverspending(analysis: FinancialAnalysis): boolean {
  const spending = analysis.outflowSplit.spent + analysis.outflowSplit.support + analysis.outflowSplit.uncertain;
  return analysis.earnedIncome > 0 ? spending > analysis.earnedIncome * OVERSPENDING_RATIO : spending > 0;
}

/** The statement as it would be if these credits were confirmed as income. */
function withIncome(transactions: NormalizedTransaction[], ids: Set<string>): NormalizedTransaction[] {
  return transactions.map((t) => {
    if (!ids.has(t.id)) return t;
    const relabelled = { ...t, category: "Income" as Category, categoryConfidence: 1, subtype: null, relatedTransactionId: null };
    return { ...relabelled, type: deriveType(relabelled) };
  });
}

/**
 * Finds the heavy credits we haven't confidently called income and works out what answering
 * would do to the plan. Deterministic: a credit group is asked about because of how much of
 * the money in it accounts for, never because of what we guess it is.
 */
export function computeIncomeCheck(
  transactions: NormalizedTransaction[],
  profile: UserProfile,
  analysis: FinancialAnalysis
): IncomeCheck | null {
  const realInflow = transactions.filter((t) => t.direction === "in" && COULD_BE_INCOME.includes(t.category)).reduce((s, t) => s + t.amount, 0);
  if (realInflow <= 0) return null;

  const overspending = isOverspending(analysis);
  const threshold = (overspending ? HEAVY_SHARE_WHEN_OVERSPENDING : HEAVY_SHARE) * realInflow;

  // Strong sender identities (a number, a full name) are one question however many credits;
  // anything weaker can't be safely merged, so each credit stands on its own.
  const groups = new Map<string, NormalizedTransaction[]>();
  for (const t of transactions) {
    if (t.direction !== "in" || !ASKABLE.includes(t.category) || isUserAnswered(t)) continue;
    const key = recipientKeyFor(t);
    const groupKey = isStrongRecipientKey(key) ? key : `single:${t.id}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), t]);
  }

  const canPreview = isEnoughToPlan(analysis);
  const months = periodInMonths(analysis.periodStart, analysis.periodEnd);
  const before = canPreview ? computePlanIncome(transactions, analysis, profile, months).monthly : null;

  const questions: IncomeQuestion[] = [];
  for (const group of groups.values()) {
    const target = group.reduce((a, b) => (b.amount > a.amount ? b : a));
    if (target.amount < MIN_CREDIT) continue;
    const covers = [target.id, ...answerFollowerIds(transactions, target)];
    const coveredTx = transactions.filter((t) => covers.includes(t.id));
    const total = coveredTx.reduce((s, t) => s + t.amount, 0);
    if (total < threshold) continue;

    const sharePercent = Math.round((total / realInflow) * 100);
    let after: number | null = null;
    if (canPreview) {
      const hypothetical = withIncome(transactions, new Set(covers));
      after = computePlanIncome(hypothetical, computeFinancialAnalysis(hypothetical, profile), profile, months).monthly;
    }

    questions.push({
      transactionId: target.id,
      direction: "in",
      name: target.merchant ?? recipientKeyFor(target).replace(/^(phone|acct|name|desc):/, ""),
      date: target.date,
      amount: Math.round(target.amount),
      description: target.description,
      followers: covers.length - 1,
      why: `${covers.length > 1 ? `${covers.length} credits, ` : ""}${sharePercent}% of the money that came in`,
      shareOfUnexplained: sharePercent,
      coversTransactionIds: covers,
      count: covers.length,
      total: Math.round(total),
      sharePercent,
      monthlyBefore: before,
      monthlyAfter: after,
    });
  }

  questions.sort((a, b) => b.total - a.total);
  const kept = questions.slice(0, overspending ? MAX_QUESTIONS_WHEN_OVERSPENDING : MAX_QUESTIONS);
  return kept.length > 0 ? { realInflow: Math.round(realInflow), overspending, questions: kept } : null;
}
