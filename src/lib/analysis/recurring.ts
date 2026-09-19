import type { NormalizedTransaction, RecurringExpense } from "@/lib/types";
import { extractRecipientKey } from "@/lib/categorization/recipientKey";
import { isSpendLike, mean, stddev, daysBetween, sortByDate } from "./helpers";

const SUBSCRIPTION_KEYWORDS = /netflix|spotify|showmax|prime|dstv|gotv|icloud|apple\s?music|youtube\s?premium|chatgpt|openai|subscription/i;

/** Groups repeated outflows to the same counterparty and flags likely recurring/subscription spend. */
export function detectRecurringExpenses(transactions: NormalizedTransaction[]): RecurringExpense[] {
  const outflows = sortByDate(transactions.filter(isSpendLike));
  const groups = new Map<string, NormalizedTransaction[]>();

  for (const tx of outflows) {
    const key = extractRecipientKey(tx.rawDescription, tx.merchant) ?? `desc:${tx.description.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  const recurring: RecurringExpense[] = [];

  for (const txs of groups.values()) {
    if (txs.length < 3) continue;

    const amounts = txs.map((t) => t.amount);
    const avg = mean(amounts);
    const amountVariance = stddev(amounts) / (avg || 1);
    if (amountVariance > 0.35) continue; // too irregular to call "recurring"

    const gaps: number[] = [];
    for (let i = 1; i < txs.length; i++) gaps.push(daysBetween(txs[i - 1].date, txs[i].date));
    const avgGap = mean(gaps);
    const gapVariance = stddev(gaps);

    const merchantLabel = txs[0].merchant ?? txs[0].description;
    const looksLikeSubscription =
      SUBSCRIPTION_KEYWORDS.test(txs[0].rawDescription) ||
      (avgGap >= 25 && avgGap <= 35 && gapVariance <= 5);

    recurring.push({
      merchant: merchantLabel,
      category: txs[0].category,
      averageAmount: Math.round(avg),
      occurrences: txs.length,
      cadenceDays: gaps.length > 0 ? Math.round(avgGap) : null,
      likelySubscription: looksLikeSubscription,
      lastDate: txs[txs.length - 1].date,
    });
  }

  return recurring.sort((a, b) => b.averageAmount * b.occurrences - a.averageAmount * a.occurrences);
}
