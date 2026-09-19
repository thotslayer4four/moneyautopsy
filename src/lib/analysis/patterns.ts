import type { CategoryBreakdownEntry, DetectedPattern, NormalizedTransaction } from "@/lib/types";
import { isSpendLike, mean, stddev, dayOfMonth, sortByDate } from "./helpers";

export function detectPatterns(params: {
  transactions: NormalizedTransaction[];
  categoryBreakdown: CategoryBreakdownEntry[];
  totalOutflow: number;
  weekendSpend: number;
  weekdaySpend: number;
  spendingAfterIncome72h: number;
  peopleTransfersCount: number;
  transactionCount: number;
}): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const outflows = sortByDate(params.transactions.filter(isSpendLike));

  // Spending spikes: any single day where outflow is far above the daily average.
  const byDay = new Map<string, number>();
  for (const tx of outflows) byDay.set(tx.date, (byDay.get(tx.date) ?? 0) + tx.amount);
  const dailyTotals = Array.from(byDay.values());
  if (dailyTotals.length >= 5) {
    const avgDaily = mean(dailyTotals);
    const sdDaily = stddev(dailyTotals);
    const spikeDays = Array.from(byDay.entries()).filter(([, total]) => total > avgDaily + 2 * sdDaily && total > avgDaily * 2);
    if (spikeDays.length > 0) {
      const [worstDate, worstAmount] = spikeDays.sort((a, b) => b[1] - a[1])[0];
      patterns.push({
        type: "spending_spike",
        description: `Spending spiked well above your daily average on ${worstDate}.`,
        evidence: `₦${Math.round(worstAmount).toLocaleString()} spent that day vs. a ₦${Math.round(avgDaily).toLocaleString()} daily average.`,
        magnitude: sdDaily > 0 ? (worstAmount - avgDaily) / sdDaily : 0,
      });
    }
  }

  // Repeated small purchases.
  const small = outflows.filter((t) => t.amount > 0 && t.amount <= 2000);
  if (small.length >= 10) {
    const total = small.reduce((s, t) => s + t.amount, 0);
    patterns.push({
      type: "repeated_small_purchases",
      description: `${small.length} small purchases (₦2,000 or less) added up to more than you'd expect.`,
      evidence: `${small.length} transactions totalling ₦${Math.round(total).toLocaleString()}.`,
      magnitude: total,
    });
  }

  // End-of-month squeeze: spend in the last 6 days of a month vs. an even daily share.
  const endOfMonth = outflows.filter((t) => dayOfMonth(t.date) >= 25);
  if (outflows.length >= 15 && endOfMonth.length > 0) {
    const endTotal = endOfMonth.reduce((s, t) => s + t.amount, 0);
    const expectedShare = (6 / 30) * params.totalOutflow;
    if (endTotal > expectedShare * 1.5) {
      patterns.push({
        type: "end_of_month_squeeze",
        description: "Spending is noticeably heavier in the last few days of the month.",
        evidence: `₦${Math.round(endTotal).toLocaleString()} spent from the 25th onward, vs. an expected ₦${Math.round(expectedShare).toLocaleString()} for that stretch.`,
        magnitude: endTotal / (expectedShare || 1),
      });
    }
  }

  // Post-payday spending.
  if (params.totalOutflow > 0 && params.spendingAfterIncome72h / params.totalOutflow > 0.25) {
    patterns.push({
      type: "post_payday_spending",
      description: "A large share of spending happens within 3 days of money coming in.",
      evidence: `${Math.round((params.spendingAfterIncome72h / params.totalOutflow) * 100)}% of your spending happens within 72 hours of income arriving.`,
      magnitude: params.spendingAfterIncome72h / params.totalOutflow,
    });
  }

  // Weekend spending.
  const weekendTotal = params.weekendSpend + params.weekdaySpend;
  if (weekendTotal > 0) {
    const weekendShare = params.weekendSpend / weekendTotal;
    if (weekendShare > (2 / 7) * 1.3) {
      patterns.push({
        type: "weekend_spending",
        description: "Weekends carry a disproportionate share of spending.",
        evidence: `${Math.round(weekendShare * 100)}% of outflow happens on Saturday/Sunday, despite those being 2 of 7 days.`,
        magnitude: weekendShare,
      });
    }
  }

  // Frequent transfers.
  if (params.transactionCount > 0 && params.peopleTransfersCount / params.transactionCount > 0.4) {
    patterns.push({
      type: "frequent_transfers",
      description: "A large portion of all activity on the account is transfers out to people.",
      evidence: `${params.peopleTransfersCount} of ${params.transactionCount} transactions (${Math.round((params.peopleTransfersCount / params.transactionCount) * 100)}%) were transfers to people.`,
      magnitude: params.peopleTransfersCount / params.transactionCount,
    });
  }

  // Lifestyle inflation: compare first half vs second half of the period.
  if (outflows.length >= 10) {
    const mid = Math.floor(outflows.length / 2);
    const firstHalf = outflows.slice(0, mid).reduce((s, t) => s + t.amount, 0);
    const secondHalf = outflows.slice(mid).reduce((s, t) => s + t.amount, 0);
    if (firstHalf > 0 && secondHalf > firstHalf * 1.25) {
      patterns.push({
        type: "lifestyle_inflation",
        description: "Spending has been trending upward over the period covered.",
        evidence: `Outflow in the second half of the statement (₦${Math.round(secondHalf).toLocaleString()}) is well above the first half (₦${Math.round(firstHalf).toLocaleString()}).`,
        magnitude: secondHalf / firstHalf,
      });
    }
  }

  // Disproportionate category.
  const relevant = params.categoryBreakdown.filter((c) => c.kind === "spend");
  const top = relevant[0];
  if (top && top.percentOfOutflow > 35) {
    patterns.push({
      type: "disproportionate_category",
      description: `${top.category} takes up an unusually large share of total outflow.`,
      evidence: `${top.category} accounts for ${Math.round(top.percentOfOutflow)}% of everything that left the account.`,
      magnitude: top.percentOfOutflow,
    });
  }

  return patterns;
}
