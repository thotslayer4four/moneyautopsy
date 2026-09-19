import type {
  BettingSummary,
  Category,
  CategoryBreakdownEntry,
  DataAirtimeSummary,
  DayOfWeekSpend,
  FinancialAnalysis,
  InflowBreakdownEntry,
  MonthlyTrendEntry,
  MostExpensiveDay,
  NormalizedTransaction,
  PerceivedSpend,
  UnusualTransaction,
  UserProfile,
} from "@/lib/types";
import { PERCEIVED_SPEND_OPTIONS, labelFor } from "@/lib/profile/options";
import { CATEGORY_KIND } from "@/lib/categorization/categories";
import { isTransferRail } from "@/lib/categorization/channels";
import { bettingTagline, bettingTier, dataTagline, dataTier } from "./slang";
import { detectRecurringExpenses } from "./recurring";
import { computeBalanceInsights, computeFeeEfficiency, computeLedger, computePriceCreep, computeTimePatterns } from "./behavior";
import { detectPatterns } from "./patterns";
import {
  dayOfWeek,
  groupByRecipient,
  isInflow,
  isOutflow,
  isSpendLike,
  mean,
  median,
  pickQuestions,
  periodInMonths,
  sortByDate,
  stddev,
  topKnownCategory,
} from "./helpers";

/** What each "what do you think you overspend on" answer maps to in real transaction data. */
const PERCEIVED_CATEGORY_MAP: Record<PerceivedSpend, Category[]> = {
  food: ["Food"],
  data_airtime: ["Data", "Airtime"],
  transport: ["Transport"],
  shopping: ["Shopping"],
  betting: ["Betting"],
  entertainment: ["Entertainment", "Subscriptions"],
  helping_others: ["Gifts & support"],
  nightlife: ["Entertainment"],
  online_purchases: ["Shopping", "Subscriptions"],
  other: [],
  dont_know: [],
};

const sum = (txs: NormalizedTransaction[]) => txs.reduce((s, t) => s + t.amount, 0);
const monthOf = (iso: string) => iso.slice(0, 7);

function computeBetting(outflowTx: NormalizedTransaction[], inflowTx: NormalizedTransaction[], base: number): BettingSummary | null {
  const deposits = outflowTx.filter((t) => t.category === "Betting");
  const withdrawals = inflowTx.filter((t) => t.category === "Betting");
  if (deposits.length === 0 && withdrawals.length === 0) return null;

  const deposited = sum(deposits);
  const withdrawn = sum(withdrawals);
  const activeDays = new Set(deposits.map((t) => t.date)).size;
  const tier = bettingTier({ netResult: withdrawn - deposited, depositCount: deposits.length, base });
  return {
    deposited: Math.round(deposited),
    withdrawn: Math.round(withdrawn),
    netOutflow: Math.round(Math.max(0, deposited - withdrawn)),
    netResult: Math.round(withdrawn - deposited),
    tier,
    tagline: bettingTagline(tier, deposited + deposits.length),
    depositCount: deposits.length,
    withdrawalCount: withdrawals.length,
    averageDeposit: Math.round(mean(deposits.map((t) => t.amount))),
    largestDeposit: Math.round(Math.max(0, ...deposits.map((t) => t.amount))),
    activeDays,
    depositsPerActiveDay: activeDays > 0 ? Math.round((deposits.length / activeDays) * 10) / 10 : 0,
  };
}

function computeDataAirtime(outflowTx: NormalizedTransaction[], base: number): DataAirtimeSummary | null {
  const data = outflowTx.filter((t) => t.category === "Data");
  const airtime = outflowTx.filter((t) => t.category === "Airtime");
  const all = [...data, ...airtime];
  if (all.length === 0) return null;

  const months = new Map<string, { total: number; count: number }>();
  for (const t of all) {
    const m = monthOf(t.date);
    const e = months.get(m) ?? { total: 0, count: 0 };
    e.total += t.amount;
    e.count += 1;
    months.set(m, e);
  }
  const tier = dataTier({ total: sum(all), count: all.length, base });
  return {
    dataTotal: Math.round(sum(data)),
    dataCount: data.length,
    airtimeTotal: Math.round(sum(airtime)),
    airtimeCount: airtime.length,
    averagePurchase: Math.round(mean(all.map((t) => t.amount))),
    byMonth: Array.from(months.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({ month, total: Math.round(v.total), count: v.count })),
    largestPurchase: Math.round(Math.max(...all.map((t) => t.amount))),
    tier,
    tagline: dataTagline(tier, sum(all) + all.length),
  };
}

function computeMostExpensiveDay(spendLikeTx: NormalizedTransaction[]): MostExpensiveDay | null {
  const byDay = new Map<string, NormalizedTransaction[]>();
  for (const t of spendLikeTx) {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date)!.push(t);
  }
  if (byDay.size < 5) return null;

  const totals = Array.from(byDay.entries()).map(([date, txs]) => ({ date, total: sum(txs), txs }));
  const typicalDay = median(totals.map((d) => d.total));
  const top = [...totals].sort((a, b) => b.total - a.total)[0];
  const byCategory = new Map<Category, number>();
  for (const t of top.txs) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
  const topCategory = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    date: top.date,
    weekday: dayOfWeek(top.date),
    spent: Math.round(top.total),
    typicalDay: Math.round(typicalDay),
    topCategory,
    transactionCount: top.txs.length,
  };
}

function computeMonthlyTrend(transactions: NormalizedTransaction[]): MonthlyTrendEntry[] {
  const map = new Map<string, MonthlyTrendEntry>();
  for (const t of transactions) {
    const m = monthOf(t.date);
    const e = map.get(m) ?? { month: m, inflow: 0, outflow: 0, spent: 0 };
    if (isInflow(t)) e.inflow += t.amount;
    else {
      e.outflow += t.amount;
      if (CATEGORY_KIND[t.category] === "spend") e.spent += t.amount;
    }
    map.set(m, e);
  }
  return Array.from(map.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((e) => ({ month: e.month, inflow: Math.round(e.inflow), outflow: Math.round(e.outflow), spent: Math.round(e.spent) }));
}

export function computeFinancialAnalysis(
  transactions: NormalizedTransaction[],
  profile: UserProfile
): FinancialAnalysis {
  const sorted = sortByDate(transactions);
  const periodStart = sorted[0]?.date ?? null;
  const periodEnd = sorted[sorted.length - 1]?.date ?? null;
  const months = periodInMonths(periodStart, periodEnd);

  const inflowTx = transactions.filter(isInflow);
  const outflowTx = transactions.filter(isOutflow);
  const spendLikeTx = outflowTx.filter(isSpendLike);

  const reimbursedIn = inflowTx.filter((t) => t.category === "Reimbursements");
  const totalInflow = sum(inflowTx);
  const totalOutflow = sum(outflowTx);

  // ---- inflow: what the money coming in actually was ----
  const incomeTx = inflowTx.filter((t) => t.category === "Income");
  const earnedIncome = sum(incomeTx);
  const inflowMap = new Map<Category, { total: number; count: number }>();
  for (const tx of inflowTx) {
    const e = inflowMap.get(tx.category) ?? { total: 0, count: 0 };
    e.total += tx.amount;
    e.count += 1;
    inflowMap.set(tx.category, e);
  }
  const inflowBreakdown: InflowBreakdownEntry[] = Array.from(inflowMap.entries())
    .map(([category, { total, count }]) => ({
      category,
      total: Math.round(total),
      count,
      percentOfInflow: totalInflow > 0 ? (total / totalInflow) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // ---- outflow by category ----
  const categoryMap = new Map<Category, { total: number; count: number }>();
  for (const tx of outflowTx) {
    const entry = categoryMap.get(tx.category) ?? { total: 0, count: 0 };
    entry.total += tx.amount;
    entry.count += 1;
    categoryMap.set(tx.category, entry);
  }
  const categoryBreakdown: CategoryBreakdownEntry[] = Array.from(categoryMap.entries())
    .map(([category, { total, count }]) => ({
      category,
      kind: CATEGORY_KIND[category],
      total: Math.round(total),
      percentOfOutflow: totalOutflow > 0 ? (total / totalOutflow) * 100 : 0,
      transactionCount: count,
    }))
    .sort((a, b) => b.total - a.total);

  // ---- betting, data/airtime ----
  // Tiers are judged against what the person earns, or failing that what they spend.
  const roughSpend = sum(outflowTx.filter((t) => CATEGORY_KIND[t.category] === "spend"));
  const tierBase = earnedIncome > 0 ? earnedIncome : roughSpend;
  const betting = computeBetting(outflowTx, inflowTx, tierBase);
  const dataAirtime = computeDataAirtime(outflowTx, tierBase);

  // ---- outflow split: consumed / given / merely moved / unexplained ----
  const kindTotal = (kind: string) => sum(outflowTx.filter((t) => CATEGORY_KIND[t.category] === kind));
  // Winnings withdrawn from betting apps offset what betting actually cost.
  const bettingReturned = betting ? Math.min(betting.deposited, betting.withdrawn) : 0;
  // Friends paying back their share of an expense also offsets what it cost, in whichever
  // bucket that expense sits (spent, or still unexplained).
  const offsetByKind: Record<string, number> = {};
  for (const t of reimbursedIn) {
    const expense = t.relatedTransactionId ? outflowTx.find((o) => o.id === t.relatedTransactionId) : undefined;
    if (!expense) continue;
    const kind = CATEGORY_KIND[expense.category];
    offsetByKind[kind] = (offsetByKind[kind] ?? 0) + t.amount;
  }
  const bucket = (kind: string, extra = 0) => Math.round(Math.max(0, kindTotal(kind) - (offsetByKind[kind] ?? 0) - extra));
  const outflowSplit = {
    spent: bucket("spend", bettingReturned),
    support: bucket("support"),
    moved: bucket("moved"),
    uncertain: bucket("uncertain"),
  };

  // ---- largest expenses (real spending only, never money merely moved) ----
  const largestExpenses = [...spendLikeTx].sort((a, b) => b.amount - a.amount).slice(0, 5);

  // ---- recurring / subscriptions ----
  const recurringExpenses = detectRecurringExpenses(transactions);
  const potentialSubscriptions = recurringExpenses.filter((r) => r.likelySubscription);

  // ---- fees / cash ----
  const feeTx = outflowTx.filter((t) => t.category === "Banking fees");
  const bankCharges = sum(feeTx);
  const cashTx = outflowTx.filter((t) => t.category === "Cash");
  const cashWithdrawals = sum(cashTx);

  // ---- transfers to people (a rail, not a purpose) ----
  const personTransfers = outflowTx.filter(
    (t) =>
      isTransferRail(t.paymentMethod) &&
      !["Savings", "Investments", "Refunds", "Banking fees", "Transfers"].includes(t.category) &&
      t.subtype !== "own_account"
  );
  const personTransfersTotal = sum(personTransfers);
  const explainedTransfers = sum(personTransfers.filter((t) => t.category !== "Uncertain"));
  const peopleTransfers = {
    total: Math.round(personTransfersTotal),
    count: personTransfers.length,
    explained: Math.round(explainedTransfers),
    explainedPercent: personTransfersTotal > 0 ? (explainedTransfers / personTransfersTotal) * 100 : 0,
  };

  // ---- POS with no merchant: stays unresolved, never guessed as cash ----
  const posUnknown = outflowTx.filter((t) => t.paymentMethod === "pos" && t.category === "Uncertain");
  const ambiguousPos = { total: Math.round(sum(posUnknown)), count: posUnknown.length };

  // ---- wallet pockets (e.g. OWealth): own-pocket shuffling ----
  const pocketOut = outflowTx.filter((t) => t.subtype === "wallet_pocket");
  const pocketIn = inflowTx.filter((t) => t.subtype === "wallet_pocket");
  const walletPockets = {
    movedOut: Math.round(sum(pocketOut)),
    movedIn: Math.round(sum(pocketIn)),
    count: pocketOut.length + pocketIn.length,
  };

  // ---- savings / investments ----
  const savedTx = outflowTx.filter((t) => t.category === "Savings");
  const investedTx = outflowTx.filter((t) => t.category === "Investments");
  const savedOutTotal = sum(savedTx) + sum(investedTx);
  const withdrawnBackTotal = sum(inflowTx.filter((t) => t.category === "Savings" || t.category === "Investments"));
  const savings = {
    savedOut: Math.round(sum(savedTx)),
    investedOut: Math.round(sum(investedTx)),
    withdrawnBack: Math.round(withdrawnBackTotal),
    netSaved: Math.round(savedOutTotal - withdrawnBackTotal),
    savedCount: savedTx.length + investedTx.length,
  };

  // ---- support / gifts ----
  const supportOut = outflowTx.filter((t) => t.category === "Gifts & support");
  const supportIn = inflowTx.filter((t) => t.category === "Gifts & support");
  const support = {
    sent: Math.round(sum(supportOut)),
    sentCount: supportOut.length,
    receivedGifts: Math.round(sum(supportIn)),
    receivedCount: supportIn.length,
  };

  // ---- loans ----
  const loanIn = inflowTx.filter((t) => t.category === "Loans");
  const loanOut = outflowTx.filter((t) => t.category === "Loans");
  const borrowedTx = loanIn.filter((t) => t.subtype !== "repaid_to_you");
  const loans = {
    borrowed: Math.round(sum(borrowedTx)),
    borrowedCount: borrowedTx.length,
    repaid: Math.round(sum(loanOut.filter((t) => t.subtype === "repayment"))),
    lent: Math.round(sum(loanOut.filter((t) => t.subtype !== "repayment"))),
    receivedBack: Math.round(sum(loanIn.filter((t) => t.subtype === "repaid_to_you"))),
    outCount: loanOut.length,
  };

  // ---- reimbursements: what shared expenses actually cost ----
  // Two ways an expense becomes "shared": we linked friends' transfers to it automatically,
  // or the person told us they paid for someone else (a "Reimbursements" outflow).
  const linkedIds = new Set(reimbursedIn.map((t) => t.relatedTransactionId).filter((id): id is string => !!id));
  const frontedTx = outflowTx.filter((t) => t.category === "Reimbursements");
  const sharedExpenseTx = [...transactions.filter((t) => linkedIds.has(t.id)), ...frontedTx];
  const linkedReimbursed = sum(reimbursedIn.filter((t) => t.relatedTransactionId));
  const otherReimbursed = sum(reimbursedIn.filter((t) => !t.relatedTransactionId));
  // Unlinked paybacks only offset costs the person said they fronted.
  const offsetting = linkedReimbursed + (frontedTx.length > 0 ? otherReimbursed : 0);
  const reimbursements = {
    received: Math.round(sum(reimbursedIn)),
    receivedCount: reimbursedIn.length,
    sharedExpenses: sharedExpenseTx.length,
    sharedExpenseTotal: Math.round(sum(sharedExpenseTx)),
    netBurden: Math.round(Math.max(0, sum(sharedExpenseTx) - offsetting)),
  };

  // ---- day of week (spending only) ----
  const dowMap = new Map<string, { total: number; count: number }>();
  for (const tx of spendLikeTx) {
    const d = dayOfWeek(tx.date);
    const entry = dowMap.get(d) ?? { total: 0, count: 0 };
    entry.total += tx.amount;
    entry.count += 1;
    dowMap.set(d, entry);
  }
  const dayOrder: DayOfWeekSpend["day"][] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const spendingByDayOfWeek: DayOfWeekSpend[] = dayOrder.map((day) => ({
    day,
    total: Math.round(dowMap.get(day)?.total ?? 0),
    count: dowMap.get(day)?.count ?? 0,
  }));
  const spendLikeTotal = sum(spendLikeTx);
  const weekendSpend = (dowMap.get("Sat")?.total ?? 0) + (dowMap.get("Sun")?.total ?? 0);
  const weekdaySpend = spendLikeTotal - weekendSpend;

  // ---- payday effect: only evidenced income counts as a payday ----
  const countedTowardPostIncome = new Set<string>();
  let spendingAfterIncome72h = 0;
  for (const income of incomeTx) {
    const incomeTime = new Date(income.date + "T00:00:00Z").getTime();
    for (const tx of spendLikeTx) {
      if (countedTowardPostIncome.has(tx.id)) continue;
      const diffHours = (new Date(tx.date + "T00:00:00Z").getTime() - incomeTime) / (1000 * 60 * 60);
      if (diffHours >= 0 && diffHours <= 72) {
        spendingAfterIncome72h += tx.amount;
        countedTowardPostIncome.add(tx.id);
      }
    }
  }

  // ---- recipients ----
  const topRecipients = groupByRecipient(spendLikeTx);

  // ---- what's inside the Uncertain bucket ----
  const uncertainOut = outflowTx.filter((t) => t.category === "Uncertain");
  const uncertainIn = inflowTx.filter((t) => t.category === "Uncertain");
  // What an answer could change: the "biggest leak" ranking, and whether their belief held up.
  const realSpend = categoryBreakdown.filter((c) => c.kind === "spend");
  const rawTopGap = realSpend.length >= 2 ? realSpend[0].total - realSpend[1].total : 0;
  const topCategoryGap = rawTopGap > 0 ? rawTopGap : null;
  const believedTotal = PERCEIVED_CATEGORY_MAP[profile.perceivedOverspending]?.reduce((s, c) => s + (categoryMap.get(c)?.total ?? 0), 0) ?? 0;
  // Only meaningful when what they believed is NOT already the top: then a big enough unexplained
  // group in that category could make them right.
  const beliefGap = realSpend.length > 0 && believedTotal > 0 && believedTotal < realSpend[0].total ? realSpend[0].total - believedTotal : null;
  const outQuestions = pickQuestions(uncertainOut, "out", { sideTotal: totalOutflow, earnedIncome, topCategoryGap, beliefGap });
  const inQuestions = pickQuestions(uncertainIn, "in", { sideTotal: totalInflow, earnedIncome, topCategoryGap: null, beliefGap: null });
  const uncertainBreakdown: FinancialAnalysis["uncertainBreakdown"] = {
    questions: [...outQuestions.questions, ...inQuestions.questions],
    notAsked: { out: outQuestions.notAsked, in: inQuestions.notAsked },
    coverage: { out: outQuestions.coverage, in: inQuestions.coverage },
    topRecipients: groupByRecipient(uncertainOut, 6),
    incomingSenders: groupByRecipient(uncertainIn, 6, "received"),
    largestTransactions: [...uncertainOut]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8)
      .map((t) => ({ date: t.date, description: t.description, amount: t.amount })),
  };

  // ---- unusual transactions (among real spending) ----
  const amounts = spendLikeTx.map((t) => t.amount);
  const avgAmount = mean(amounts);
  const sdAmount = stddev(amounts);
  const unusualTransactions: UnusualTransaction[] = spendLikeTx
    .filter((t) => sdAmount > 0 && t.amount > avgAmount + 2.5 * sdAmount)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((t) => ({
      transactionId: t.id,
      reason: `Significantly larger than your typical transaction (~₦${Math.round(avgAmount).toLocaleString()}).`,
      amount: t.amount,
      date: t.date,
      description: t.description,
    }));

  // ---- savings opportunities (hypothetical, never guaranteed) ----
  const savingsOpportunities: FinancialAnalysis["savingsOpportunities"] = [];
  if (potentialSubscriptions.length > 0) {
    const monthlySubTotal = potentialSubscriptions.reduce((s, r) => s + r.averageAmount, 0);
    savingsOpportunities.push({
      description: `${potentialSubscriptions.length} recurring subscription(s) cost about ₦${Math.round(monthlySubTotal).toLocaleString()} per month combined.`,
      estimatedMonthlyImpact: Math.round(monthlySubTotal),
    });
  }
  if (bankCharges > 0) {
    savingsOpportunities.push({
      description: "Bank charges and fees are a small but steady leak.",
      estimatedMonthlyImpact: Math.round(bankCharges / months),
    });
  }
  if (cashTx.length >= 4) {
    savingsOpportunities.push({
      description: "Frequent ATM withdrawals often come with fees and make spending harder to track.",
      estimatedMonthlyImpact: Math.round((cashWithdrawals / months) * 0.02),
    });
  }
  if (betting && betting.netOutflow > 0) {
    savingsOpportunities.push({
      description: "Betting's net cost over this period, after subtracting what you withdrew from betting apps.",
      estimatedMonthlyImpact: Math.round(betting.netOutflow / months),
    });
  }
  if (dataAirtime && dataAirtime.dataCount + dataAirtime.airtimeCount >= 8) {
    savingsOpportunities.push({
      description: `${dataAirtime.dataCount + dataAirtime.airtimeCount} separate data/airtime purchases — fewer, larger bundles are usually cheaper per GB than many small top-ups.`,
      estimatedMonthlyImpact: Math.round(((dataAirtime.dataTotal + dataAirtime.airtimeTotal) / months) * 0.1),
    });
  }

  // ---- patterns ----
  const patterns = detectPatterns({
    transactions,
    categoryBreakdown,
    totalOutflow: spendLikeTotal,
    weekendSpend,
    weekdaySpend,
    spendingAfterIncome72h,
    peopleTransfersCount: personTransfers.length,
    transactionCount: transactions.length,
  });

  // ---- perceived vs actual ----
  const perceivedCategories = PERCEIVED_CATEGORY_MAP[profile.perceivedOverspending] ?? [];
  const perceivedAmount = perceivedCategories.length
    ? perceivedCategories.reduce((s, c) => s + (categoryMap.get(c)?.total ?? 0), 0)
    : null;
  // Ranked against real spending, plus giving to people only when that is what they said.
  const rankable = categoryBreakdown.filter((c) => c.kind === "spend" || perceivedCategories.includes(c.category));
  const outsideGroupBigger =
    perceivedAmount !== null
      ? rankable.filter((c) => !perceivedCategories.includes(c.category) && c.total > perceivedAmount).length
      : null;
  const topKnown = topKnownCategory(categoryBreakdown);

  return {
    periodStart,
    periodEnd,
    totalInflow: Math.round(totalInflow),
    totalOutflow: Math.round(totalOutflow),
    netCashFlow: Math.round(totalInflow - totalOutflow),
    earnedIncome: Math.round(earnedIncome),
    incomeEvents: incomeTx.length,
    inflowBreakdown,
    outflowSplit,
    transactionCount: transactions.length,
    categoryBreakdown,
    largestExpenses,
    recurringExpenses,
    bankCharges: Math.round(bankCharges),
    bankChargeCount: feeTx.length,
    cashWithdrawals: Math.round(cashWithdrawals),
    cashWithdrawalCount: cashTx.length,
    peopleTransfers,
    ambiguousPos,
    spendingByDayOfWeek,
    weekendSpend: Math.round(weekendSpend),
    weekdaySpend: Math.round(weekdaySpend),
    spendingAfterIncome72h: Math.round(spendingAfterIncome72h),
    topRecipients,
    unusualTransactions,
    potentialSubscriptions,
    savingsOpportunities,
    patterns,
    betting,
    dataAirtime,
    savings,
    walletPockets,
    support,
    loans,
    reimbursements,
    balance: computeBalanceInsights(transactions),
    timePatterns: computeTimePatterns(transactions),
    ledger: computeLedger(transactions),
    feeEfficiency: computeFeeEfficiency(outflowTx, personTransfers),
    priceCreep: computePriceCreep(spendLikeTx),
    mostExpensiveDay: computeMostExpensiveDay(spendLikeTx),
    monthlyTrend: computeMonthlyTrend(transactions),
    uncertainOutflow: {
      total: Math.round(sum(uncertainOut)),
      percentOfOutflow: totalOutflow > 0 ? (sum(uncertainOut) / totalOutflow) * 100 : 0,
    },
    uncertainInflow: {
      total: Math.round(sum(uncertainIn)),
      percentOfInflow: totalInflow > 0 ? (sum(uncertainIn) / totalInflow) * 100 : 0,
    },
    uncertainBreakdown,
    perceivedVsActual: {
      perceivedLabel: labelFor(PERCEIVED_SPEND_OPTIONS, profile.perceivedOverspending),
      matchedCategories: perceivedCategories,
      perceivedAmount: perceivedAmount === null ? null : Math.round(perceivedAmount),
      perceivedRank: outsideGroupBigger === null ? null : outsideGroupBigger + 1,
      actualTopCategory: topKnown?.category ?? null,
      actualTopCategoryAmount: topKnown?.total ?? 0,
    },
  };
}
