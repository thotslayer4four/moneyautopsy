import { randomUUID } from "crypto";
import type { FinancialAnalysis, Highlight, IncomeCheck, LLMInsights, MoneyPlan, Report } from "@/lib/types";
import { topKnownCategory } from "@/lib/analysis/helpers";
import { formatNaira } from "@/lib/format";
import { buildShareCards } from "./shareCards";

/**
 * Teasers reveal that we found something specific — a count, a category — without giving
 * away the amounts or the interpretation, which are what the full report is for.
 */
function buildTeaserBullets(analysis: FinancialAnalysis): string[] {
  const candidates: string[] = [];
  const b = analysis.betting;
  const tp = analysis.timePatterns;
  const d = analysis.dataAirtime;
  const top = topKnownCategory(analysis.categoryBreakdown);

  if (tp?.betting?.sessions.count) candidates.push("you made several betting deposits in one sitting.");
  if (analysis.balance?.runway) candidates.push("your money tends to run low soon after it arrives.");
  if (tp?.lateNight && tp.lateNight.percentOfSpend >= 25) candidates.push("a big share of your spending happens late at night.");
  if (analysis.priceCreep.length > 0) candidates.push("something you pay for regularly quietly got more expensive.");
  if (analysis.ledger.some((l) => Math.abs(l.net) >= 20000)) candidates.push("money between you and one person is quite lopsided.");
  if (b && b.depositCount >= 3) candidates.push(`you made ${b.depositCount} betting deposits.`);
  if (d && d.dataCount + d.airtimeCount >= 6) candidates.push(`you made ${d.dataCount + d.airtimeCount} separate data and airtime purchases.`);
  if (analysis.bankChargeCount >= 5) candidates.push(`you were charged bank fees on ${analysis.bankChargeCount} transactions.`);
  if (analysis.peopleTransfers.count >= 3 && analysis.peopleTransfers.explainedPercent < 60) {
    candidates.push(`${analysis.peopleTransfers.count} transfers to people — and most had no clear purpose.`);
  }
  if (analysis.reimbursements.sharedExpenses > 0) candidates.push("some of your big expenses look like they were shared — and paid back.");
  if (top) candidates.push(`your biggest spending category was ${top.category.toLowerCase()}.`);
  if (analysis.unusualTransactions.length > 0) {
    candidates.push(`you had ${analysis.unusualTransactions.length} transaction${analysis.unusualTransactions.length === 1 ? "" : "s"} worth looking into.`);
  }
  if (analysis.patterns.some((p) => p.type === "post_payday_spending")) {
    candidates.push("you spent more right after money arrived than at other points in the period.");
  } else if (analysis.patterns.some((p) => p.type === "weekend_spending")) {
    candidates.push("weekends cost you more than weekdays did.");
  }
  if (analysis.uncertainOutflow.total > 0 && !top) candidates.push("most of your outflow was money we couldn't confidently label.");

  if (candidates.length === 0) candidates.push(`you made ${analysis.transactionCount} transactions across the period covered.`);
  return candidates.slice(0, 3).map((c) => c.charAt(0).toUpperCase() + c.slice(1));
}

/** Specific, shareable, evidence-backed numbers — only ever included when the data has them. */
function buildHighlights(analysis: FinancialAnalysis): Highlight[] {
  const out: Highlight[] = [];
  const b = analysis.betting;
  const d = analysis.dataAirtime;
  const n = formatNaira;

  if (b && b.depositCount >= 1) {
    out.push({ id: "betting", label: "betting deposits", value: String(b.depositCount), note: `${n(b.deposited)} in, ${n(b.withdrawn)} back — ${b.netResult >= 0 ? `you came out ${n(b.netResult)} ahead` : `net cost ${n(-b.netResult)}`}`, tagline: b.tagline });
  }
  if (d) {
    const count = d.dataCount + d.airtimeCount;
    out.push({ id: "data-airtime", label: "data & airtime", value: n(d.dataTotal + d.airtimeTotal), note: `${count} purchase${count === 1 ? "" : "s"}, ${n(d.averagePurchase)} on average`, tagline: d.tier === "light" ? undefined : d.tagline });
  }
  if (analysis.bankChargeCount >= 5 || analysis.bankCharges >= 1000) {
    out.push({ id: "bank-charges", label: "bank charges", value: n(analysis.bankCharges), note: `${analysis.bankChargeCount} separate charge${analysis.bankChargeCount === 1 ? "" : "s"}` });
  }
  if (analysis.peopleTransfers.count > 0 && analysis.peopleTransfers.explainedPercent < 90) {
    out.push({
      id: "people",
      label: "sent to people",
      value: n(analysis.peopleTransfers.total),
      note: `${Math.round(analysis.peopleTransfers.explainedPercent)}% has a clear purpose`,
    });
  }
  if (analysis.support.receivedGifts > 0) {
    out.push({ id: "gifts-in", label: "gifts & support received", value: n(analysis.support.receivedGifts), note: `${analysis.support.receivedCount} transfer${analysis.support.receivedCount === 1 ? "" : "s"}, not counted as income` });
  }
  if (analysis.support.sent > 0) {
    out.push({ id: "support-out", label: "gifts & support sent", value: n(analysis.support.sent), note: `${analysis.support.sentCount} transfer${analysis.support.sentCount === 1 ? "" : "s"}` });
  }
  const sv = analysis.savings;
  if (sv.savedOut + sv.investedOut > 0) {
    const gross = sv.savedOut + sv.investedOut;
    out.push({
      id: "savings",
      label: sv.netSaved >= 0 ? "actually saved (net)" : "drawn down from savings (net)",
      value: n(Math.abs(sv.netSaved)),
      note: `${n(gross)} went in and ${n(sv.withdrawnBack)} came back out — moved, not spent`,
    });
  }
  if (analysis.cashWithdrawals > 0) {
    out.push({ id: "cash", label: "cash withdrawn", value: n(analysis.cashWithdrawals), note: `${analysis.cashWithdrawalCount} explicit ATM/cash withdrawal${analysis.cashWithdrawalCount === 1 ? "" : "s"}` });
  }
  const bal = analysis.balance;
  if (bal?.runway) {
    out.push({ id: "runway", label: "money lasts about", value: `${bal.runway.medianDays} days`, note: `after it arrives, based on ${bal.runway.events} time${bal.runway.events === 1 ? "" : "s"} money landed` });
  }
  if (bal && bal.daysBelowFloor > 0) {
    out.push({ id: "low-balance", label: "days under ₦5,000", value: `${bal.daysBelowFloor} of ${bal.daysTracked}`, note: `lowest point ${n(bal.lowest.balance)} on ${bal.lowest.date}` });
  }
  const tp = analysis.timePatterns;
  if (tp?.lateNight && tp.lateNight.count >= 5) {
    out.push({ id: "late-night", label: "spent after 10pm", value: `${Math.round(tp.lateNight.percentOfSpend)}%`, note: `${tp.lateNight.count} transactions, ${n(tp.lateNight.total)}` });
  }
  const top = analysis.ledger[0];
  if (top && Math.abs(top.net) >= 10000) {
    out.push({
      id: "ledger",
      label: top.net < 0 ? `sent more than they sent back` : `sent you more than you sent back`,
      value: n(Math.abs(top.net)),
      note: `${top.name}: ${n(top.sent)} sent, ${n(top.received)} received`,
    });
  }
  return out.slice(0, 8);
}

export function buildReport(
  analysis: FinancialAnalysis,
  insights: LLMInsights,
  moneyPlan: MoneyPlan | null = null,
  incomeCheck: IncomeCheck | null = null
): Report {
  const sortedFindings = [...insights.findings].sort((a, b) => b.importance - a.importance);
  const [freeFinding, ...lockedFindings] = sortedFindings;

  return {
    id: randomUUID(),
    status: "free",
    overview: {
      totalInflow: analysis.totalInflow,
      totalOutflow: analysis.totalOutflow,
      netCashFlow: analysis.netCashFlow,
      earnedIncome: analysis.earnedIncome,
      spent: analysis.outflowSplit.spent,
      transactionCount: analysis.transactionCount,
      periodStart: analysis.periodStart,
      periodEnd: analysis.periodEnd,
    },
    teaserBullets: buildTeaserBullets(analysis),
    freeFinding: freeFinding ?? null,
    lockedFindings,
    categoryBreakdown: analysis.categoryBreakdown,
    inflowBreakdown: analysis.inflowBreakdown,
    outflowSplit: analysis.outflowSplit,
    highlights: buildHighlights(analysis),
    savings: analysis.savings,
    walletPockets: analysis.walletPockets,
    balance: analysis.balance,
    shareCards: buildShareCards(analysis),
    moneyPersonality: insights.financialPersonality,
    userBeliefComparison: insights.userBeliefComparison,
    recommendations: insights.recommendations,
    thirtyDayReset: insights.thirtyDayReset,
    unusualTransactions: analysis.unusualTransactions,
    recurringExpenses: analysis.recurringExpenses,
    topRecipients: analysis.topRecipients,
    patterns: analysis.patterns,
    uncertainBreakdown: analysis.uncertainBreakdown,
    moneyPlan,
    incomeCheck,
  };
}

export { shapeForStatus } from "./shape";
