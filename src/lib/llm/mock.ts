import type { FinancialAnalysis, Finding, LLMInsights, UserProfile } from "@/lib/types";
import { topKnownCategory } from "@/lib/analysis/helpers";
import { labelFor, GOAL_OPTIONS } from "@/lib/profile/options";

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const WEEKDAYS: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-NG", { day: "numeric", month: "long", timeZone: "UTC" });
const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-NG", { month: "long", timeZone: "UTC" });

/**
 * A deterministic, data-grounded stand-in for the real LLM call. Used automatically when no
 * provider key is configured (local dev, tests, CI) so the whole pipeline stays runnable
 * without a live model. Every sentence is built from real analysis numbers — nothing is
 * fabricated, and each finding only appears when the data actually supports it.
 */
export function generateMockInsights(profile: UserProfile, analysis: FinancialAnalysis): LLMInsights {
  const topCategory = topKnownCategory(analysis.categoryBreakdown);
  const findings: Finding[] = [];

  const add = (f: Finding) => findings.push({ ...f, title: cap(f.title), summary: cap(f.summary), detail: cap(f.detail) });

  // ---- betting ----
  const b = analysis.betting;
  if (b && b.depositCount >= 3) {
    const ahead = b.netResult >= 0;
    const loud = b.tier === "heavy" || b.tier === "severe" || b.tier === "ahead";
    add({
      id: "betting",
      title: ahead
        ? `you made ${b.depositCount} betting deposits and still came out ${naira(b.netResult)} ahead`
        : `you made ${b.depositCount} betting deposits`,
      summary: ahead
        ? `${naira(b.deposited)} went into betting apps; ${naira(b.withdrawn)} came back out — a ${naira(b.netResult)} net profit.${loud ? ` ${b.tagline}` : ""}`
        : `${naira(b.deposited)} went into betting apps; ${naira(b.withdrawn)} came back out. Net cost: ${naira(-b.netResult)}.${loud ? ` ${b.tagline}` : ""}`,
      detail: `deposits averaged ${naira(b.averageDeposit)} (largest ${naira(b.largestDeposit)}) across ${plural(b.activeDays, "day")}${b.depositsPerActiveDay > 1 ? `, roughly ${b.depositsPerActiveDay} deposits on each betting day` : ""}. ${
        ahead
          ? "That profit is real, but it's kept as betting profit rather than earned income — winnings swing, and one bad stretch can erase it."
          : "Money withdrawn from betting apps isn't counted as income — it only offsets what betting cost."
      }`,
      category: "Betting",
      importance: 5,
      dataPoints: [`${b.depositCount} deposits`, `${naira(b.deposited)} deposited`, `${naira(b.withdrawn)} withdrawn`, `${naira(Math.abs(b.netResult))} ${ahead ? "profit" : "net cost"}`],
      confidence: 0.92,
    });
  }

  // ---- what they thought vs what's true ----
  const p = analysis.perceivedVsActual;
  if (p.perceivedLabel && p.matchedCategories.length > 0 && topCategory) {
    const amount = p.perceivedAmount ?? 0;
    const right = p.perceivedRank === 1;
    add({
      id: "belief-vs-data",
      title: right ? `you were right about ${p.perceivedLabel}` : `you thought ${p.perceivedLabel}. The data says otherwise.`,
      summary: right
        ? `${p.perceivedLabel} really is your biggest spending at ${naira(amount)}.`
        : `${p.perceivedLabel} came to ${naira(amount)} — ranking #${p.perceivedRank}. ${cap(topCategory.category.toLowerCase())} was bigger at ${naira(topCategory.total)}.`,
      detail: right
        ? `your instinct matched the statement: ${p.matchedCategories.join(" + ").toLowerCase()} came to ${naira(amount)}.`
        : `${p.matchedCategories.join(" + ").toLowerCase()} totalled ${naira(amount)}, but ${topCategory.category.toLowerCase()} took ${naira(topCategory.total)} (${Math.round(topCategory.percentOfOutflow)}% of everything that left).`,
      category: p.matchedCategories[0],
      importance: right ? 3 : 5,
      dataPoints: [`${naira(amount)} on ${p.perceivedLabel}`, `${naira(topCategory.total)} on ${topCategory.category.toLowerCase()}`],
      confidence: 0.9,
    });
  }

  // ---- data & airtime ----
  const d = analysis.dataAirtime;
  if (d && d.dataCount + d.airtimeCount >= 6) {
    const count = d.dataCount + d.airtimeCount;
    const total = d.dataTotal + d.airtimeTotal;
    const months = d.byMonth;
    let trend = "";
    if (months.length >= 2) {
      const last = months[months.length - 1];
      const prev = months[months.length - 2];
      if (prev.total > 0 && last.total > prev.total * 1.25) {
        trend = ` it climbed from ${naira(prev.total)} in ${monthLabel(prev.month)} to ${naira(last.total)} in ${monthLabel(last.month)}.`;
      }
    }
    add({
      id: "data-airtime",
      title: `you made ${count} separate data and airtime purchases`,
      summary: `${naira(total)} in total — about ${naira(d.averagePurchase)} each.${d.tier !== "light" ? ` ${d.tagline}` : ""}`,
      detail: `${plural(d.dataCount, "data purchase")} (${naira(d.dataTotal)}) and ${plural(d.airtimeCount, "airtime top-up")} (${naira(d.airtimeTotal)}); the biggest single one was ${naira(d.largestPurchase)}.${trend}`,
      category: "Data",
      importance: count >= 15 ? 5 : 4,
      dataPoints: [`${count} purchases`, `${naira(total)} total`, `${naira(d.averagePurchase)} average`],
      confidence: 0.9,
    });
  }

  // ---- transfers to people ----
  const t = analysis.peopleTransfers;
  if (t.count >= 3 && t.total > 0 && t.explainedPercent < 70) {
    add({
      id: "people-transfers",
      title: `${naira(t.total)} went to people, but we can only explain ${Math.round(t.explainedPercent)}% of it`,
      summary: `${plural(t.count, "transfer")} to people; ${naira(t.explained)} has a clear purpose, ${naira(t.total - t.explained)} doesn't.`,
      detail: `a transfer is only how money moved — most of these have no remark or recognisable recipient, so we haven't guessed. Labelling the biggest recipients in your report will sharpen every number in it.`,
      category: "Transfers",
      importance: 4,
      dataPoints: [`${naira(t.total)} to people`, `${Math.round(t.explainedPercent)}% explained`],
      confidence: 0.85,
    });
  }

  // ---- bank charges ----
  if (analysis.bankChargeCount >= 5 || analysis.bankCharges >= 1000) {
    add({
      id: "bank-charges",
      title: `you paid ${naira(analysis.bankCharges)} in bank charges`,
      summary: `${plural(analysis.bankChargeCount, "charge")} — transfer fees, SMS alerts, VAT and stamp duty add up quietly.`,
      detail: `that's about ${naira(analysis.bankCharges / Math.max(analysis.monthlyTrend.length, 1))} per month. it's small per transaction, which is exactly why it's easy to miss.`,
      category: "Banking fees",
      importance: analysis.bankCharges >= 5000 ? 4 : 3,
      dataPoints: [`${naira(analysis.bankCharges)} in fees`, `${analysis.bankChargeCount} charges`],
      confidence: 0.9,
    });
  }

  // ---- honesty: how much of the money in is really income ----
  const inflowUnexplained = analysis.inflowBreakdown.filter((e) => e.category !== "Income");
  if (analysis.totalInflow > 0 && analysis.earnedIncome / analysis.totalInflow < 0.6 && inflowUnexplained.length > 0) {
    const biggest = inflowUnexplained[0];
    add({
      id: "inflow-not-income",
      title: `${naira(analysis.totalInflow)} came in, but only ${naira(analysis.earnedIncome)} looks like income`,
      summary: `the biggest non-income inflow was ${biggest.category.toLowerCase()}: ${naira(biggest.total)}.`,
      detail: `money in isn't the same as money earned — transfers between your own accounts, loans, reimbursements and unexplained transfers from people all inflate the total, so we don't count them as income.`,
      category: "Income",
      importance: 4,
      dataPoints: [`${naira(analysis.totalInflow)} in`, `${naira(analysis.earnedIncome)} income`],
      confidence: 0.85,
    });
  }

  // ---- most expensive day ----
  const day = analysis.mostExpensiveDay;
  if (day && day.typicalDay > 0 && day.spent >= day.typicalDay * 3) {
    add({
      id: "expensive-day",
      title: `your most expensive day was a ${WEEKDAYS[day.weekday] ?? day.weekday}`,
      summary: `${naira(day.spent)} on ${dayLabel(day.date)}, against a typical day of ${naira(day.typicalDay)}.`,
      detail: `${plural(day.transactionCount, "transaction")} that day${day.topCategory ? `, led by ${day.topCategory.toLowerCase()}` : ""}. Money merely moved (savings, own-account transfers) isn't counted here.`,
      category: day.topCategory ?? "Other",
      importance: 4,
      dataPoints: [`${naira(day.spent)} on ${dayLabel(day.date)}`, `${naira(day.typicalDay)} typical day`],
      confidence: 0.85,
    });
  }

  // ---- support & gifts ----
  const s = analysis.support;
  if (s.sent > 0 || s.receivedGifts > 0) {
    add({
      id: "support",
      title: s.sent >= s.receivedGifts ? `you sent ${naira(s.sent)} as gifts or support` : `you received ${naira(s.receivedGifts)} in gifts or support`,
      summary: [
        s.sent > 0 ? `sent ${naira(s.sent)} (${plural(s.sentCount, "transfer")})` : null,
        s.receivedGifts > 0 ? `received ${naira(s.receivedGifts)} (${plural(s.receivedCount, "transfer")})` : null,
      ]
        .filter(Boolean)
        .join("; ") + ".",
      detail: `these are inferred from remarks and recipient names like family members — not assumed from every transfer to a person. incoming gifts aren't counted as income.`,
      category: "Gifts & support",
      importance: s.sent >= analysis.totalOutflow * 0.15 ? 4 : 3,
      dataPoints: [`${naira(s.sent)} sent`, `${naira(s.receivedGifts)} received`],
      confidence: 0.75,
    });
  }

  // ---- loans ----
  const l = analysis.loans;
  if (l.borrowed > 0 || l.lent > 0 || l.repaid > 0) {
    add({
      id: "loans",
      title: l.borrowed >= l.lent + l.repaid ? `${naira(l.borrowed)} came in as borrowed money` : `${naira(l.lent + l.repaid)} left as loans or repayments`,
      summary: `borrowed ${naira(l.borrowed)}; repaid ${naira(l.repaid)}; lent out ${naira(l.lent)}; paid back to you ${naira(l.receivedBack)}.`,
      detail: `loans are kept out of both income and spending — borrowed money isn't earnings and repaying it isn't consumption.`,
      category: "Loans",
      importance: 3,
      dataPoints: [`${naira(l.borrowed)} borrowed`, `${naira(l.repaid)} repaid`, `${naira(l.lent)} lent`],
      confidence: 0.75,
    });
  }

  // ---- reimbursements ----
  const r = analysis.reimbursements;
  if (r.sharedExpenses > 0) {
    add({
      id: "reimbursements",
      title: `you covered ${naira(r.sharedExpenseTotal)} for other people and got some back`,
      summary: `${naira(r.received)} came back from friends, so those outings actually cost you ${naira(r.netBurden)}.`,
      detail: `similar-sized transfers arrived shortly after larger payments — they look like people paying back their share, so they're treated as reimbursements, not income.`,
      category: "Reimbursements",
      importance: 4,
      dataPoints: [`${naira(r.sharedExpenseTotal)} paid`, `${naira(r.received)} paid back`, `${naira(r.netBurden)} net`],
      confidence: 0.7,
    });
  }

  // ---- savings (net — pockets like OWealth move money in and out on every payment) ----
  const sv = analysis.savings;
  const grossIn = sv.savedOut + sv.investedOut;
  if (grossIn > 0) {
    const churn = grossIn >= 20000 && Math.abs(sv.netSaved) < grossIn * 0.2;
    add({
      id: "savings",
      title: churn
        ? `your savings pocket is mostly a pass-through: ${naira(grossIn)} in, ${naira(sv.withdrawnBack)} out`
        : sv.netSaved >= 0
          ? `you actually saved ${naira(sv.netSaved)}`
          : `you drew ${naira(-sv.netSaved)} down from savings`,
      summary: churn
        ? `net, only ${naira(Math.abs(sv.netSaved))} ${sv.netSaved >= 0 ? "stayed saved" : "was drawn down"}.`
        : `${naira(grossIn)} went in and ${naira(sv.withdrawnBack)} came back out.`,
      detail: `savings and investments are money moved, not spent, so none of it counts as a leak. wallets like OWealth top up and pay out on almost every transaction, which is why the gross figures look huge.`,
      category: sv.investedOut > sv.savedOut ? "Investments" : "Savings",
      importance: churn ? 4 : 3,
      dataPoints: [`${naira(grossIn)} in`, `${naira(sv.withdrawnBack)} out`, `${naira(Math.abs(sv.netSaved))} net`],
      confidence: 0.9,
    });
  }

  // ---- balance and runway ----
  const bal = analysis.balance;
  if (bal?.runway) {
    const r = bal.runway;
    add({
      id: "runway",
      title: `your money is mostly gone about ${r.medianDays} days after it arrives`,
      summary: `after ${naira(r.example.amount)} landed on ${dayLabel(r.example.date)}, most of it was gone within ${plural(r.example.days, "day")}.`,
      detail: `across ${plural(r.events, "time")} money arrived, the typical stretch until your balance was down to roughly a fifth of what it started at was ${plural(r.medianDays, "day")}.`,
      category: "Income",
      importance: 5,
      dataPoints: [`${plural(r.medianDays, "day")} typical runway`, `${naira(r.example.amount)} on ${dayLabel(r.example.date)}`],
      confidence: 0.8,
    });
  }
  if (bal && bal.daysBelowFloor >= Math.max(3, bal.daysTracked * 0.15)) {
    add({
      id: "low-balance",
      title: `your balance was under ${naira(bal.floor)} on ${bal.daysBelowFloor} of ${bal.daysTracked} days`,
      summary: `the lowest point was ${naira(bal.lowest.balance)} on ${dayLabel(bal.lowest.date)}.`,
      detail: `your average closing balance was ${naira(bal.averageClosing)}, and it peaked at ${naira(bal.highest.balance)} on ${dayLabel(bal.highest.date)}.`,
      category: "Other",
      importance: 4,
      dataPoints: [`${bal.daysBelowFloor} low days`, `${naira(bal.lowest.balance)} lowest`],
      confidence: 0.8,
    });
  }

  // ---- when money moves ----
  const tp = analysis.timePatterns;
  const session = tp?.betting?.sessions.largest;
  if (tp?.betting && tp.betting.sessions.count > 0 && session) {
    add({
      id: "betting-sessions",
      title: session.spanMinutes !== null
        ? `you made ${session.deposits} betting deposits in ${plural(session.spanMinutes, "minute")}`
        : `you made ${session.deposits} betting deposits in a single day`,
      summary: `${naira(session.total)} on ${dayLabel(session.date)} — your biggest session, out of ${plural(tp.betting.sessions.count, "session")} of 3+ deposits close together.`,
      detail: `deposits that bunch up like this usually mean topping up again straight after a loss, rather than one planned bet.${tp.betting.lateNightDeposits > 0 ? ` ${tp.betting.lateNightDeposits} of ${tp.betting.depositCount} deposits were after 10pm.` : ""}`,
      category: "Betting",
      importance: 5,
      dataPoints: [`${session.deposits} deposits`, `${naira(session.total)} total`],
      confidence: 0.75,
    });
  }
  if (tp?.lateNight && tp.lateNight.percentOfSpend >= 25 && tp.lateNight.count >= 5) {
    add({
      id: "late-night",
      title: `${Math.round(tp.lateNight.percentOfSpend)}% of your spending happens after 10pm`,
      summary: `${plural(tp.lateNight.count, "transaction")} between 10pm and 5am, ${naira(tp.lateNight.total)} in total.`,
      detail: `late-night spending tends to be more impulsive. your busiest hour overall is ${tp.peakHour ? `${tp.peakHour.hour % 12 === 0 ? 12 : tp.peakHour.hour % 12}${tp.peakHour.hour >= 12 ? "pm" : "am"}` : "unclear"}.`,
      category: "Other",
      importance: 4,
      dataPoints: [`${Math.round(tp.lateNight.percentOfSpend)}% after 10pm`, `${naira(tp.lateNight.total)}`],
      confidence: 0.8,
    });
  }
  const ritual = tp?.rituals[0];
  if (ritual) {
    add({
      id: "ritual",
      title: `every ${WEEKDAYS[ritual.weekday] ?? ritual.weekday} you spend on ${ritual.category.toLowerCase()}`,
      summary: `about ${naira(ritual.medianAmount)} a time, ${ritual.count} times over ${plural(ritual.weeks, "week")}.`,
      detail: `that's ${naira(ritual.total)} in total — a routine, not a coincidence.`,
      category: ritual.category,
      importance: 4,
      dataPoints: [`${ritual.count} times`, `${naira(ritual.medianAmount)} typical`, `${naira(ritual.total)} total`],
      confidence: 0.8,
    });
  }

  // ---- who owes whom ----
  const led = analysis.ledger[0];
  if (led && Math.abs(led.net) >= 10000) {
    const sentMore = led.net < 0;
    add({
      id: "ledger",
      title: sentMore ? `you've sent ${led.name} ${naira(-led.net)} more than they've sent back` : `${led.name} has sent you ${naira(led.net)} more than you've sent them`,
      summary: `${naira(led.sent)} sent across ${plural(led.sentCount, "transfer")}; ${naira(led.received)} received across ${plural(led.receivedCount, "transfer")}.`,
      detail: `this is net money flow, not proof of a debt — but if some of it was a loan or a shared bill, ${sentMore ? "this is the gap." : "this is what you may owe back."}`,
      category: led.categories[0] ?? "Transfers",
      importance: 4,
      dataPoints: [`${naira(led.sent)} sent`, `${naira(led.received)} received`, `${naira(Math.abs(led.net))} net`],
      confidence: 0.7,
    });
  }

  // ---- what moving money costs, and what got pricier ----
  const fe = analysis.feeEfficiency;
  if (fe && fe.smallTransfers.count >= 10 && fe.estimatedSmallTransferFees !== null && fe.estimatedSmallTransferFees >= 300) {
    add({
      id: "fee-efficiency",
      title: `you made ${fe.smallTransfers.count} transfers under ${naira(2000)} — about ${naira(fe.estimatedSmallTransferFees)} in fees to move ${naira(fe.smallTransfers.total)}`,
      summary: `a typical ${naira(fe.medianFee ?? 0)} fee on a ${naira(fe.smallTransfers.medianAmount)} transfer is ${fe.overheadPercentOnSmall !== null ? `${Math.round(fe.overheadPercentOnSmall * 10) / 10}%` : "a real share"} overhead.`,
      detail: `across all ${plural(fe.transferCount, "transfer")} you paid ${naira(fe.totalFees)} in bank charges. batching small transfers into fewer, larger ones cuts that.`,
      category: "Banking fees",
      importance: 3,
      dataPoints: [`${fe.smallTransfers.count} small transfers`, `${naira(fe.estimatedSmallTransferFees)} est. fees`],
      confidence: 0.7,
    });
  }
  const creep = analysis.priceCreep[0];
  if (creep) {
    add({
      id: "price-creep",
      title: `${creep.label} went from ${naira(creep.firstAmount)} to ${naira(creep.lastAmount)}`,
      summary: `+${creep.changePercent}% across ${plural(creep.occurrences, "payment")} between ${dayLabel(creep.firstDate)} and ${dayLabel(creep.lastDate)}.`,
      detail: `Same thing, higher price — easy to miss when it's paid in small pieces. Worth checking whether a different plan or provider costs less.`,
      category: creep.category,
      importance: 4,
      dataPoints: [`${naira(creep.firstAmount)} → ${naira(creep.lastAmount)}`, `+${creep.changePercent}%`],
      confidence: 0.8,
    });
  }

  // ---- unexplained money ----
  if (analysis.uncertainOutflow.percentOfOutflow >= 15) {
    const topUncertain = analysis.uncertainBreakdown.topRecipients[0];
    const note = topUncertain
      ? ` the biggest piece is ${topUncertain.name}: ${naira(topUncertain.totalAmount)} across ${plural(topUncertain.transactionCount, "transaction")} — you probably know exactly what that is.`
      : "";
    add({
      id: "uncertain-outflow",
      title: "a real chunk of your money is untraceable from the statement alone",
      summary: `${Math.round(analysis.uncertainOutflow.percentOfOutflow)}% of outflow has no clear purpose in the narration.`,
      detail: `${naira(analysis.uncertainOutflow.total)} left as payments or transfers we couldn't confidently categorise.${note}`,
      category: "Uncertain",
      importance: 4,
      dataPoints: [`${naira(analysis.uncertainOutflow.total)} unexplained`, `${Math.round(analysis.uncertainOutflow.percentOfOutflow)}% of outflow`],
      confidence: 0.95,
    });
  }

  // ---- biggest real spending ----
  if (topCategory) {
    add({
      id: "top-category",
      title: `${topCategory.category.toLowerCase()} is where most of your actual spending goes`,
      summary: `${naira(topCategory.total)} — ${Math.round(topCategory.percentOfOutflow)}% of everything that left your account.`,
      detail: `across ${plural(topCategory.transactionCount, "transaction")}, more than any other spending category.`,
      category: topCategory.category,
      importance: 4,
      dataPoints: [`${naira(topCategory.total)} total`, `${Math.round(topCategory.percentOfOutflow)}% of outflow`],
      confidence: 0.9,
    });
  }

  for (const pattern of analysis.patterns.slice(0, 2)) {
    add({
      id: `pattern-${pattern.type}`,
      title: patternTitle(pattern.type),
      summary: pattern.description,
      detail: `${pattern.description} ${pattern.evidence}`,
      category: "Other",
      importance: 3,
      dataPoints: [pattern.evidence],
      confidence: 0.75,
    });
  }

  if (analysis.potentialSubscriptions.length > 0) {
    const total = analysis.potentialSubscriptions.reduce((sum, x) => sum + x.averageAmount, 0);
    add({
      id: "subscriptions",
      title: "recurring charges are running quietly in the background",
      summary: `${plural(analysis.potentialSubscriptions.length, "likely subscription")} cost about ${naira(total)}/month combined.`,
      detail: analysis.potentialSubscriptions.map((x) => `${x.merchant}: ~${naira(x.averageAmount)} every ~${x.cadenceDays ?? 30} days`).join(". "),
      category: "Subscriptions",
      importance: 3,
      dataPoints: analysis.potentialSubscriptions.map((x) => `${x.merchant}: ${naira(x.averageAmount)}`),
      confidence: 0.7,
    });
  }

  if (findings.length < 3) {
    add({
      id: "cash-flow",
      title: analysis.netCashFlow >= 0 ? "more came in than went out" : "more went out than came in",
      summary: `net cash flow was ${naira(analysis.netCashFlow)} across ${analysis.transactionCount} transactions.`,
      detail: `${naira(analysis.totalInflow)} came in and ${naira(analysis.totalOutflow)} went out — of which ${naira(analysis.outflowSplit.spent)} was actually spent.`,
      category: "Other",
      importance: 3,
      dataPoints: [`${naira(analysis.totalInflow)} in`, `${naira(analysis.totalOutflow)} out`],
      confidence: 0.95,
    });
  }

  const goalLabel = labelFor(GOAL_OPTIONS, profile.goal);
  const recommendations = analysis.savingsOpportunities.map((o) => ({
    title: o.description,
    description: `based on this statement, addressing this could free up around ${naira(o.estimatedMonthlyImpact)} per month — an estimate, not a guarantee.`,
    estimatedMonthlyImpact: o.estimatedMonthlyImpact,
  }));
  if (analysis.uncertainOutflow.percentOfOutflow >= 15) {
    recommendations.push({
      title: "label your biggest unexplained recipients",
      description: "it takes a minute and turns the most uncertain part of this report into real numbers.",
      estimatedMonthlyImpact: 0,
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      title: `keep an eye on ${topCategory?.category.toLowerCase() ?? "your top category"}`,
      description: `${topCategory?.category ?? "this category"} is your largest real outflow${goalLabel ? ` — and you said your goal is to ${goalLabel}` : ""}. even a small reduction there moves the needle most.`,
      estimatedMonthlyImpact: Math.round((topCategory?.total ?? 0) * 0.1),
    });
  }

  const sorted = [...findings].sort((a, b) => b.importance - a.importance).slice(0, 10);

  const belief = buildBeliefComparison(analysis);

  return {
    financialPersonality: pickPersonality(analysis),
    findings: sorted,
    recommendations: recommendations.slice(0, 5).map((r) => ({ ...r, title: cap(r.title), description: cap(r.description) })),
    userBeliefComparison: {
      whatTheyThought: cap(belief.whatTheyThought),
      whatDataShows: cap(belief.whatDataShows),
      explanation: cap(belief.explanation),
    },
    thirtyDayReset: buildReset(analysis).map(cap),
  };
}

function buildBeliefComparison(analysis: FinancialAnalysis): LLMInsights["userBeliefComparison"] {
  const p = analysis.perceivedVsActual;
  const top = analysis.categoryBreakdown.find((c) => c.kind === "spend");
  const topNote = top ? `${top.category.toLowerCase()} was your biggest real spending at ${naira(top.total)}` : "there wasn't enough categorised spending to name a biggest category";

  if (!p.perceivedLabel || p.matchedCategories.length === 0) {
    return {
      whatTheyThought: p.perceivedLabel ?? "you weren't sure",
      whatDataShows: `${topNote}.`,
      explanation: p.perceivedLabel
        ? "we can't line up “something else” with a category, so here's what the statement says instead."
        : "not knowing is normal — most people guess wrong. now you have a starting point.",
    };
  }

  const amount = p.perceivedAmount ?? 0;
  if (p.perceivedRank === 1) {
    return {
      whatTheyThought: p.perceivedLabel,
      whatDataShows: `${p.perceivedLabel} really is your biggest real spending: ${naira(amount)}.`,
      explanation: "your instinct was right — this one's worth your attention first.",
    };
  }
  return {
    whatTheyThought: p.perceivedLabel,
    whatDataShows:
      amount > 0
        ? `${p.perceivedLabel} came to ${naira(amount)}, ranking #${p.perceivedRank} — and ${topNote}.`
        : `we found almost nothing for ${p.perceivedLabel} — and ${topNote}.`,
    explanation: "you were looking in the right general direction, but the money is going somewhere else.",
  };
}

function buildReset(analysis: FinancialAnalysis): string[] {
  const steps: string[] = [];
  if (analysis.uncertainOutflow.percentOfOutflow >= 15) steps.push("label your biggest unexplained recipients in the report, then re-read the numbers.");
  if (analysis.betting && analysis.betting.depositCount >= 3) steps.push("set a weekly betting cap and stick to one deposit per week for 30 days.");
  if (analysis.dataAirtime && analysis.dataAirtime.dataCount + analysis.dataAirtime.airtimeCount >= 8) steps.push("replace small daily data/airtime top-ups with one monthly bundle and compare the cost.");
  if (analysis.bankChargeCount >= 5) steps.push("cut avoidable bank charges: turn off SMS alerts you don't read and batch small transfers.");
  if (analysis.potentialSubscriptions.length > 0) steps.push("cancel or pause at least one recurring subscription you haven't used this month.");
  steps.push("move a fixed amount into savings the day money arrives, before spending anything.");
  steps.push("track every transaction in your biggest spending category for 30 days before deciding what to cut.");
  steps.push("re-run this autopsy in 30 days and compare the numbers.");
  return steps.slice(0, 8);
}

function pickPersonality(analysis: FinancialAnalysis): { name: string; description: string } {
  const spent = analysis.outflowSplit.spent || 1;
  const out = analysis.totalOutflow || 1;
  if (analysis.support.sent / out >= 0.25) {
    return { name: "The Support-Heavy Giver", description: "A large share of what leaves your account goes to other people — support, gifts and family — rather than to yourself." };
  }
  if (analysis.savings.netSaved / (analysis.totalInflow || 1) >= 0.15) {
    return { name: "The Quiet Saver", description: "A meaningful slice of what comes in goes straight into savings or investments rather than spending." };
  }
  if (analysis.cashWithdrawals / spent >= 0.25) {
    return { name: "The Cash-Heavy Spender", description: "A big share of your spending leaves the account as cash, which makes it much harder to trace." };
  }
  if (analysis.spendingAfterIncome72h / spent > 0.35) {
    return { name: "The Payday Sprinter", description: "A big share of your spending happens in the first few days after income lands — then things slow down." };
  }
  const monthsCount = Math.max(analysis.monthlyTrend.length, 1);
  if (analysis.transactionCount / monthsCount >= 60) {
    return { name: "The High-Frequency Spender", description: "Lots of small transactions rather than a few big ones — the habits are in the volume." };
  }
  if (analysis.potentialSubscriptions.length >= 2) {
    return { name: "The Digitally Dependent", description: "Recurring digital charges chip away at your balance in the background every month." };
  }
  return { name: "The Balanced Spender", description: "No single behaviour dominates this statement — spending is spread out rather than concentrated in one habit." };
}

function patternTitle(type: string): string {
  const titles: Record<string, string> = {
    spending_spike: "one day stands out from all the rest",
    repeated_small_purchases: "small purchases are adding up more than they look",
    end_of_month_squeeze: "the end of the month hits differently",
    post_payday_spending: "money moves fastest right after it arrives",
    weekend_spending: "weekends cost more than weekdays",
    frequent_transfers: "your account is mostly a pass-through to other people",
    lifestyle_inflation: "spending is trending upward",
    disproportionate_category: "one category is carrying more weight than it should",
  };
  return titles[type] ?? "a pattern worth knowing about";
}
