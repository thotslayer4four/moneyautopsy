/**
 * Runs the full extraction -> categorization -> analysis -> report pipeline against the
 * mock statements in /test-fixtures and asserts the behaviors called out in the product
 * spec: transfers aren't blindly categorized, uncertain transactions stay uncertain,
 * recurring subscriptions are detected, and the free/paywall split never leaks locked
 * numbers. Run with `npm run verify:pipeline`.
 */
import fs from "fs";
import path from "path";
import { extractStatement } from "../src/lib/extraction";
import { parseStatementLines, extractPdfLines } from "../src/lib/extraction/pdf";
import { generateReportPdf } from "../src/lib/report/pdf";
import { categorizeTransactions } from "../src/lib/categorization";
import { computeFinancialAnalysis } from "../src/lib/analysis";
import { generateMockInsights } from "../src/lib/llm/mock";
import { buildReport, shapeForStatus } from "../src/lib/report";
import { applyNarrative, buildMoneyPlan, computeIncomeCheck, computePlanView, scenarioFigures } from "../src/lib/plan";
import { answerFollowerIds } from "../src/lib/analysis/helpers";
import { deriveType } from "../src/lib/categorization";
import { formatNaira } from "../src/lib/format";
import type { UserProfile } from "../src/lib/types";

const FIXTURES_DIR = path.join(__dirname, "..", "test-fixtures");

const PROFILE: UserProfile = {
  gender: "female",
  ageRange: "26_30",
  situation: "employed",
  livingWith: "alone",
  incomeSources: ["salary", "freelance"],
  primaryIncomeSource: "salary",
  income: "500k_1m",
  goal: "stop_overspending",
  expensesCovered: ["rent", "electricity"],
  supports: ["parents_family"],
  borrowing: "never",
  lending: "sometimes",
  lendingAmount: "10k_50k",
  paysForOthers: "sometimes",
  withdrawsCash: "yes",
  cashMonthly: "10k_25k",
  perceivedOverspending: "food",
};

let failures = 0;

function check(label: string, pass: boolean) {
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) failures++;
}

async function verifyCsvFixture() {
  console.log("\n== mock-statement-1.csv (salary, food transfers, cash, subscriptions, fees) ==");
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, "mock-statement-1.csv"));
  const extraction = await extractStatement({ buffer, filename: "mock-statement-1.csv", mimeType: "text/csv" });

  check("extraction found transactions", extraction.transactions.length > 0);
  check("extraction not flagged for review", !extraction.needsReview);

  const categorized = await categorizeTransactions(extraction.transactions, { accountHolderName: extraction.accountHolderName, profile: PROFILE });
  const foodCount = categorized.filter((t) => t.category === "Food").length;

  check("not every transaction is Food (categorization isn't naive)", foodCount < categorized.length);
  check(
    "a no-remark, unknown-recipient transfer never gets wrongly guessed as something specific",
    categorized
      .filter((t) => /TRANSFER TO JOHN ADEYEMI|TRANSFER TO EMEKA/.test(t.rawDescription))
      .every((t) => ["Uncertain", "Transfers", "Other"].includes(t.category))
  );
  check(
    "repeated food-remark transfers to the same recipient resolve to Food via merchant memory",
    categorized.filter((t) => /08031234567/.test(t.rawDescription) && t.category === "Food").length >= 6
  );

  const analysis = computeFinancialAnalysis(categorized, PROFILE);
  check("bank charges detected", analysis.bankCharges > 0);
  check("cash withdrawals detected", analysis.cashWithdrawalCount >= 6);
  check("Netflix detected as a recurring subscription", analysis.potentialSubscriptions.some((s) => /netflix/i.test(s.merchant)));
  check("Uncertain is never reported as the 'actual top category'", analysis.perceivedVsActual.actualTopCategory !== "Uncertain");

  const insights = generateMockInsights(PROFILE, analysis);
  const report = buildReport(analysis, insights);
  const freeShape = shapeForStatus(report, "free");
  const unlockedShape = shapeForStatus(report, "unlocked");

  check("free report never includes the real category breakdown", !("categoryBreakdown" in freeShape));
  check("free report never includes recommendations", !("recommendations" in freeShape));
  check("free report never leaks 'actually spent' or earned income", !("spent" in freeShape.overview) && !("earnedIncome" in freeShape.overview));
  check("free report never leaks highlights or the inflow breakdown", !("highlights" in freeShape) && !("inflowBreakdown" in freeShape));
  check("free report still exposes the true overview numbers", freeShape.overview.totalInflow === analysis.totalInflow);
  check(
    "unlocked report includes the full category breakdown and every teased finding",
    unlockedShape.status === "unlocked" &&
      unlockedShape.categoryBreakdown.length > 0 &&
      unlockedShape.lockedFindings.length === report.lockedFindings.length
  );
}

async function verifyPdfFixture() {
  console.log("\n== mock-statement-1.pdf (text-based PDF extraction) ==");
  const pdfPath = path.join(FIXTURES_DIR, "mock-statement-1.pdf");
  if (!fs.existsSync(pdfPath)) {
    console.log("SKIP — no PDF fixture present");
    return;
  }
  const buffer = fs.readFileSync(pdfPath);
  const extraction = await extractStatement({ buffer, filename: "mock-statement-1.pdf", mimeType: "application/pdf" });

  check("PDF extraction found transactions", extraction.transactions.length > 0);
  check("PDF extraction not flagged for review", !extraction.needsReview);
  check(
    "PDF-extracted descriptions aren't truncated by the amount parser",
    extraction.transactions.every((t) => !/[a-z]{2,}$/i.test(t.rawDescription) || t.rawDescription.length > 5)
  );
}

async function verifyEncryptedPdfFixture() {
  console.log("\n== mock-statement-encrypted.pdf (password-protected PDF) ==");
  const pdfPath = path.join(FIXTURES_DIR, "mock-statement-encrypted.pdf");
  if (!fs.existsSync(pdfPath)) {
    console.log("SKIP — no encrypted PDF fixture present");
    return;
  }
  const buffer = fs.readFileSync(pdfPath);
  const extraction = await extractStatement({ buffer, filename: "mock-statement-encrypted.pdf", mimeType: "application/pdf" });

  check("password-protected PDF is flagged for review, not silently empty", extraction.needsReview);
  check(
    "the error names the password, not a generic 'scanned image' guess",
    extraction.issues.some((i) => /password-protected/i.test(i.message))
  );
}

async function verifyCategorizationImprovements() {
  console.log("\n== categorization improvements (self-transfer, single-occurrence memory, recurring pattern) ==");

  const memoryLines = [
    "05 Aug 2026 16:55:45 05 Aug 2026 Transfer to FRUTYZ -N- MORE LIMITED | MONIE POINT | 5316426923 | shawarma 3,750.00 -- 0.00 Mobile 111",
    "05 Aug 2026 17:10:45 05 Aug 2026 Transfer to FRUTYZ -N- MORE LIMITED | MONIE POINT | 5316426923 5,350.00 -- 0.00 Mobile 222",
  ];
  const { transactions: memoryTx } = parseStatementLines(memoryLines);
  check("PDF lines keep their time of day", memoryTx[0]?.time === "16:55" && memoryTx[1]?.time === "17:10");
  const memoryResult = await categorizeTransactions(memoryTx, { profile: PROFILE });
  check(
    "a single prior remarked transaction to a recipient informs a later unremarked one to the same recipient",
    memoryResult[1]?.category === "Food" && memoryResult[1]?.categoryConfidence >= 0.6
  );

  const selfTransferLines = [
    "05 Aug 2026 12:51:49 05 Aug 2026 Transfer to EMMANUEL FWANGSHAK JARED | Zenith Bank | 2275374578 706,000.00 -- 0.00 Mobile 333",
  ];
  const { transactions: selfTx } = parseStatementLines(selfTransferLines);
  const selfResult = await categorizeTransactions(selfTx, { accountHolderName: "FWANGSHAK JARED EMMANUEL", profile: PROFILE });
  check(
    "a transfer to the account holder's own (reordered) name is recognized as a self-transfer",
    selfResult[0]?.category === "Transfers" && selfResult[0]?.categoryConfidence >= 0.85
  );

  const recurringLines = [
    "01 Jun 2026 09:00:00 01 Jun 2026 Transfer to ABUBAKAR SANI | OPay | 8100000001 15,000.00 -- 0.00 Mobile 444",
    "01 Jul 2026 09:00:00 01 Jul 2026 Transfer to ABUBAKAR SANI | OPay | 8100000001 15,200.00 -- 0.00 Mobile 555",
    "01 Aug 2026 09:00:00 01 Aug 2026 Transfer to ABUBAKAR SANI | OPay | 8100000001 14,900.00 -- 0.00 Mobile 666",
  ];
  const { transactions: recurringTx } = parseStatementLines(recurringLines);
  const recurringResult = await categorizeTransactions(recurringTx, { profile: PROFILE });
  check(
    "a tightly recurring, unlabeled transfer to the same recipient is inferred as a bill-like pattern",
    recurringResult.every((t) => t.category === "Bills" && t.categoryConfidence >= 0.6)
  );
}

async function verifyNigerianFixture() {
  console.log("\n== mock-statement-2.csv (Nigerian transaction intelligence) ==");
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, "mock-statement-2.csv"));
  const extraction = await extractStatement({ buffer, filename: "mock-statement-2.csv", mimeType: "text/csv" });
  check("fixture extracted cleanly", extraction.transactions.length === 44 && !extraction.needsReview);

  const txs = await categorizeTransactions(extraction.transactions, { profile: PROFILE });
  const find = (text: string, direction?: "in" | "out") =>
    txs.find((t) => t.rawDescription.includes(text) && (!direction || t.direction === direction));
  const analysis = computeFinancialAnalysis(txs, PROFILE);

  // Rail is not purpose
  const nipFood = find("NIP TRANSFER TO ABC RESTAURANT");
  check("NIP transfer to a restaurant is Food (rail: nip), not 'Transfers'", nipFood?.category === "Food" && nipFood.paymentMethod === "nip");
  const paystackFood = find("PAYSTACK*ABC RESTAURANT");
  check(
    "Paystack payment keeps Paystack as processor and the restaurant as merchant, category Food",
    paystackFood?.category === "Food" && paystackFood.paymentProcessor === "Paystack" && !!paystackFood.merchant && !/paystack/i.test(paystackFood.merchant)
  );
  const paystackBet = find("PAYSTACK*BET9JA");
  check("betting through a payment processor is still Betting", paystackBet?.category === "Betting" && paystackBet.paymentProcessor === "Paystack");

  // Betting
  check("betting: 6 deposits, ₦22,000 in, ₦12,000 back, ₦10,000 net", analysis.betting?.depositCount === 6 && analysis.betting.netResult === -10000 && analysis.betting.deposited === 22000 && analysis.betting.withdrawn === 12000 && analysis.betting.netOutflow === 10000);
  check("betting withdrawals are not income", find("BET9JA WITHDRAWAL")?.category === "Betting" && analysis.earnedIncome === 400000);

  // Data / airtime
  check("data purchases (4, ₦6,500) are their own category", analysis.dataAirtime?.dataCount === 4 && analysis.dataAirtime.dataTotal === 6500);
  const bareMtn = txs.find((t) => t.rawDescription.trim() === "MTN");
  check("a bare telecom-provider line is a weak airtime guess, not a confident one", bareMtn?.category === "Airtime" && bareMtn.categoryConfidence < 0.6);

  // Savings / investments / loans: moved, not spent
  check("savings and investments are Savings/Investments, never spending", find("PIGGYVEST SAVINGS")?.category === "Savings" && find("COWRYWISE")?.category === "Investments");
  check("money coming back from savings is not income", find("PIGGYVEST WITHDRAWAL")?.category === "Savings" && find("PIGGYVEST WITHDRAWAL")?.direction === "in");
  check("savings/investments totals are tracked separately", analysis.savings.savedOut === 50000 && analysis.savings.investedOut === 30000 && analysis.savings.netSaved === 60000);
  check("loans: ₦50,000 borrowed, ₦20,000 repaid — neither income nor spending", analysis.loans.borrowed === 50000 && analysis.loans.repaid === 20000);
  const bettingReturned = Math.min(analysis.betting?.deposited ?? 0, analysis.betting?.withdrawn ?? 0);
  check(
    "outflow splits cleanly into spent / support / moved / unexplained (net of betting withdrawn and friends paying back a shared expense)",
    analysis.outflowSplit.spent + analysis.outflowSplit.support + analysis.outflowSplit.moved + analysis.outflowSplit.uncertain === analysis.totalOutflow - bettingReturned - analysis.reimbursements.received
  );
  check("savings, investments, loans and reversals sit under 'moved', not 'spent'", analysis.outflowSplit.moved >= 50000 + 30000 + 20000 + 50000);

  // Reversals
  const reversedDebit = txs.find((t) => t.rawDescription === "TRANSFER TO XYZ VENTURES");
  const reversalCredit = find("REVERSAL TRANSFER TO XYZ");
  check(
    "a debit and its reversal are paired and both excluded from spending",
    reversedDebit?.category === "Refunds" && reversalCredit?.category === "Refunds" && reversedDebit.relatedTransactionId === reversalCredit.id
  );

  // POS is never cash
  const pos1 = find("POS PURCHASE 2XY93");
  check("an unidentifiable POS payment stays Uncertain and is never guessed as cash", pos1?.category === "Uncertain" && analysis.cashWithdrawalCount === 1);
  check("ambiguous POS spending is reported separately", analysis.ambiguousPos.count >= 2);
  check("an explicit ATM withdrawal is Cash", find("ATM WITHDRAWAL")?.category === "Cash");

  // Fees
  check("bank charges (NIP charge, VAT, stamp duty, SMS alert) all roll up to Banking fees", analysis.bankChargeCount === 4);

  // Other Nigerian specifics
  check("electricity + TV are Bills, fuel is Transport, tax is Government", find("IKEDC")?.category === "Bills" && find("DSTV")?.category === "Bills" && find("NNPC")?.category === "Transport" && find("FIRS")?.category === "Government");
  check("Netflix is a subscription, Uber is transport", find("NETFLIX")?.category === "Subscriptions" && find("UBER")?.category === "Transport");

  // Gifts / people / income evidence
  check("money to and from a parent is Gifts & support, not spending or income", find("TRANSFER TO MUM", "out")?.category === "Gifts & support" && find("TRANSFER FROM MUM", "in")?.category === "Gifts & support");
  const john = find("FROM JOHN DOE");
  check("a plain incoming transfer from a person is NOT assumed to be income", !!john && john.category !== "Income" && john.category !== "Food");
  check("only the salary counts as earned income", analysis.earnedIncome === 400000 && analysis.support.receivedGifts === 30000);

  // Reimbursements
  const groupExpense = find("THE PLACE LEKKI");
  const reimbursed = ["CHIDI", "AMA NWOSU", "TUNDE"].map((n) => find(n));
  check(
    "three similar transfers after a big expense are reimbursements linked to it, not income",
    reimbursed.every((t) => t?.category === "Reimbursements" && t.relatedTransactionId === groupExpense?.id)
  );
  check("net burden of the shared expense is computed", analysis.reimbursements.received === 59500 && analysis.reimbursements.netBurden === 500);

  // Questions: individual, big/unusual only, never merged
  const qs = analysis.uncertainBreakdown.questions;
  check("questions are single transactions above the minimum, one per recipient", qs.every((q) => q.amount >= 2000) && new Set(qs.map((q) => q.name)).size === qs.length && qs.every((q) => txs.some((t) => t.id === q.transactionId && t.amount === q.amount)));

  // Structural guarantees
  const INFLOW_OK = ["Income", "Gifts & support", "Loans", "Reimbursements", "Refunds", "Transfers", "Savings", "Investments", "Betting", "Uncertain", "Other"];
  check("incoming money is never labelled with a spending category", txs.filter((t) => t.direction === "in").every((t) => INFLOW_OK.includes(t.category)));
  check("every transaction keeps its raw description and a reason", txs.every((t) => t.rawDescription.length > 0 && t.categoryReason.length > 0));
  check("'top category' is always a real spending category", analysis.perceivedVsActual.actualTopCategory === null || !["Uncertain", "Savings", "Investments", "Loans", "Transfers", "Refunds", "Reimbursements", "Income"].includes(analysis.perceivedVsActual.actualTopCategory));

  const insights = generateMockInsights(PROFILE, analysis);
  check("findings surface betting and data from the data", ["betting", "data-airtime"].every((id) => insights.findings.some((f) => f.id === id)));
}

async function verifyTransportGroceriesAndFronting() {
  console.log("\n== transport/fuel, supermarket abbreviations, paying for someone ==");
  const csv = [
    "Value Date,Narration,Debit,Credit,Balance",
    '01-Mar-2024,"BOLT RIDE 4F2",2000,,98000',
    '02-Mar-2024,"INDRIVE TRIP",1500,,96500',
    '03-Mar-2024,"UBER TRIP 9A",3000,,93500',
    '04-Mar-2024,"POS OANDO OIL AND GAS LEKKI",12000,,81500',
    '05-Mar-2024,"NNPC MEGA STATION FUEL",10000,,71500',
    '06-Mar-2024,"POS SPAR SMKT AJAH",9000,,62500',
    '07-Mar-2024,"POS PRIME CHOICE S/MKT",4000,,58500',
    '08-Mar-2024,"TRANSFER TO GRACE OKON",30000,,28500',
    '09-Mar-2024,"TRANSFER FROM GRACE OKON",,30000,58500',
    '10-Mar-2024,"Auto-save to OWealth Balance",5000,,53500',
    '11-Mar-2024,"OWealth Withdrawal(Transaction Payment)",,5000,58500',
    '12-Mar-2024,"TRANSFER TO 08077778888 | pop corn",1500,,57000',
    '12-Mar-2024,"TRANSFER TO 08099990000 | chow",1200,,55800',
    '13-Mar-2024,"TRANSFER TO 08012345678 | personal expenses",8000,,47800',
  ].join("\n");
  const extraction = await extractStatement({ buffer: Buffer.from(csv), filename: "t.csv", mimeType: "text/csv" });
  const txs = await categorizeTransactions(extraction.transactions, { profile: PROFILE });
  const cat = (text: string) => txs.find((t) => t.rawDescription.includes(text))?.category;
  check("Bolt, inDrive, Uber, fuel and oil & gas stations are all Transport", ["BOLT", "INDRIVE", "UBER", "OANDO", "NNPC"].every((n) => cat(n) === "Transport"));
  check("'smkt' and 's/mkt' mean supermarket", cat("SPAR SMKT") === "Groceries" && cat("S/MKT") === "Groceries");

  check("everyday food remarks (pop corn, chow) are Food", cat("pop corn") === "Food" && cat("| chow") === "Food");
  check("'personal expenses' is its own category", cat("personal expenses") === "Personal expenses");
  const pocketOut = txs.find((t) => t.rawDescription.includes("Auto-save to OWealth"));
  const pocketIn = txs.find((t) => t.rawDescription.includes("OWealth Withdrawal"));
  check(
    "OPay OWealth moves (both ways) are own-pocket transfers, not savings",
    pocketOut?.category === "Transfers" && pocketIn?.category === "Transfers" && pocketOut.subtype === "wallet_pocket"
  );
  const pocketAnalysis = computeFinancialAnalysis(txs, PROFILE);
  check("wallet pockets are tracked separately and add nothing to savings", pocketAnalysis.walletPockets.movedOut === 5000 && pocketAnalysis.walletPockets.movedIn === 5000 && pocketAnalysis.savings.savedOut === 0);

  // The person says: the ₦30,000 payment was for someone else, and the transfer back was them paying me back.
  const relabelled = txs.map((t) =>
    t.rawDescription === "TRANSFER TO GRACE OKON" || t.rawDescription === "TRANSFER FROM GRACE OKON" ? { ...t, category: "Reimbursements" as const, categoryConfidence: 1 } : t
  );
  const a = computeFinancialAnalysis(relabelled, PROFILE);
  check("paid-for-someone + paid-back nets to zero cost and counts as neither spending nor income", a.reimbursements.netBurden === 0 && a.reimbursements.sharedExpenseTotal === 30000 && a.earnedIncome === 0);
  check("the fronted payment is not counted as spending", a.outflowSplit.spent === 2000 + 1500 + 3000 + 12000 + 10000 + 9000 + 4000 + 1500 + 1200 + 8000);
}

async function verifyQuestionSelection() {
  console.log("\n== 'what was this for' question selection ==");
  const csv = [
    "Value Date,Narration,Debit,Credit,Balance",
    '01-Mar-2024,"NIP TRANSFER TO 08011112222",7000,,93000',
    '01-Mar-2024,"NIP TRANSFER TO 08011112222",50000,,43000',
    '01-Mar-2024,"NIP TRANSFER TO 08011112222",6000,,37000',
    '02-Mar-2024,"NIP TRANSFER TO 08033334444",1000,,36000',
    '03-Mar-2024,"NIP TRANSFER TO 08055556666",120000,,-84000',
  ].join("\n");
  const extraction = await extractStatement({ buffer: Buffer.from(csv), filename: "q.csv", mimeType: "text/csv" });
  const txs = await categorizeTransactions(extraction.transactions, { profile: PROFILE });
  const a = computeFinancialAnalysis(txs, PROFILE);
  const qs = a.uncertainBreakdown.questions;
  const same = qs.find((q) => q.name.includes("08011112222") || q.description.includes("08011112222"));
  check("three same-day payments to one number become ONE question about the largest, not a ₦63,000 blob", qs.filter((q) => q.description.includes("08011112222")).length === 1 && same?.amount === 50000 && same.followers === 2);
  check("the biggest unexplained payment is asked first", qs[0]?.amount === 120000);
  check("a ₦1,000 payment is not worth asking about", !qs.some((q) => q.amount === 1000) && a.uncertainBreakdown.notAsked.out.count === 1);
}

async function verifyBettingProfit() {
  console.log("\n== betting: coming out ahead ==");
  const csv = [
    "Value Date,Narration,Debit,Credit,Balance",
    '01-Mar-2024,"SPORTYBET FUNDING",8000,,92000',
    '02-Mar-2024,"SPORTYBET FUNDING",9000,,83000',
    '03-Mar-2024,"BET9JA DEPOSIT",9362,,73638',
    '04-Mar-2024,"SPORTYBET WITHDRAWAL",,28000,101638',
  ].join("\n");
  const extraction = await extractStatement({ buffer: Buffer.from(csv), filename: "b.csv", mimeType: "text/csv" });
  const txs = await categorizeTransactions(extraction.transactions, { profile: PROFILE });
  const a = computeFinancialAnalysis(txs, PROFILE);
  check("₦26,362 in and ₦28,000 out is a ₦1,638 betting profit", a.betting?.netResult === 1638 && a.betting.netOutflow === 0);
  const finding = generateMockInsights(PROFILE, a).findings.find((f) => f.id === "betting");
  check("the betting finding says they came out ahead, not '₦0 cost'", !!finding && /ahead/.test(finding.title) && /1,638/.test(finding.summary));
  check("betting profit stays out of earned income", a.earnedIncome === 0);
  check("a profit gets the 'ahead' tier and its tagline appears on the finding", a.betting?.tier === "ahead" && !!finding && finding.summary.includes(a.betting.tagline));

  const heavyCsv = [
    "Value Date,Narration,Debit,Credit,Balance",
    '01-Mar-2024,"SALARY PAYMENT ACME LTD",,300000,400000',
    '02-Mar-2024,"SPORTYBET FUNDING",60000,,340000',
    '03-Mar-2024,"SPORTYBET FUNDING",50000,,290000',
    '04-Mar-2024,"BET9JA DEPOSIT",30000,,260000',
  ].join("\n");
  const heavyEx = await extractStatement({ buffer: Buffer.from(heavyCsv), filename: "h.csv", mimeType: "text/csv" });
  const heavyA = computeFinancialAnalysis(await categorizeTransactions(heavyEx.transactions, { profile: PROFILE }), PROFILE);
  const heavyFinding = generateMockInsights(PROFILE, heavyA).findings.find((f) => f.id === "betting");
  check("a ₦140,000 net betting loss is 'severe' and gets sharp slang on the finding", heavyA.betting?.tier === "severe" && !!heavyFinding && heavyFinding.summary.includes(heavyA.betting.tagline));
}

async function verifyBehavior() {
  console.log("\n== mock-statement-3.csv (balance, timing, ledger, fees, price creep) ==");
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, "mock-statement-3.csv"));
  const extraction = await extractStatement({ buffer, filename: "mock-statement-3.csv", mimeType: "text/csv" });
  check("timestamps are read off the statement", extraction.transactions.length === 65 && extraction.transactions.every((t) => !!t.time));
  const txs = await categorizeTransactions(extraction.transactions, { profile: PROFILE });
  const a = computeFinancialAnalysis(txs, PROFILE);

  const bal = a.balance;
  check("balance: money runs low a few days after each payday", !!bal?.runway && bal.runway.events >= 2 && bal.runway.medianDays >= 2 && bal.runway.medianDays <= 6);
  check("balance: days under the floor and the low point are found", !!bal && bal.daysBelowFloor >= 1 && bal.lowest.balance < 5000 && bal.series.length > 5);

  const tp = a.timePatterns;
  check("time: four betting deposits in 50 minutes is one session", tp?.betting?.sessions.count === 1 && tp.betting.sessions.largest?.deposits === 4 && tp.betting.sessions.largest.spanMinutes === 50);
  check("time: late-night spending is counted", !!tp?.lateNight && tp.lateNight.count >= 6);
  check("rituals: Friday food is spotted", tp?.rituals[0]?.weekday === "Fri" && tp.rituals[0].category === "Food" && tp.rituals[0].count >= 6);

  const led = a.ledger[0];
  check("ledger: net flow with one person is computed (₦90,000 sent, ₦10,000 back)", !!led && /CHIDI/i.test(led.name) && led.sent === 90000 && led.received === 10000 && led.net === -80000);
  check("fees: small transfers and the typical per-transfer fee are found", !!a.feeEfficiency && a.feeEfficiency.smallTransfers.count >= 10 && a.feeEfficiency.medianFee === 10.75);
  check("price creep: the same data plan going from ₦1,000 to ₦1,300 is caught", a.priceCreep[0]?.category === "Data" && a.priceCreep[0].firstAmount === 1000 && a.priceCreep[0].lastAmount === 1300 && a.priceCreep[0].changePercent === 30);

  // Shareable cards and the PDF export
  const insights3 = generateMockInsights(PROFILE, a);
  const report3 = buildReport(a, insights3);
  const cardIds = report3.shareCards.map((c) => c.id);
  check("share cards are built for betting, fees, people, runway and a summary", ["betting", "bank-charges", "people", "runway", "summary"].every((id) => cardIds.includes(id)));
  const allCardText = JSON.stringify(report3.shareCards);
  check("share cards carry only figures — no recipient names or narrations", !/CHIDI|OKAFOR|SHOPRITE|ACME|08033311111/i.test(allCardText));
  check("cards that lead with an amount offer a masked version for sharing without naira figures", report3.shareCards.filter((c) => /₦/.test(c.big)).every((c) => !!c.bigMasked && !/₦/.test(c.bigMasked)));
  const pdf = await generateReportPdf(report3);
  const pdfLines = (await extractPdfLines(Buffer.from(pdf))).join("\n");
  check("the PDF export is a real, multi-section document", pdf.length > 5000 && /Your money autopsy/.test(pdfLines) && /Where your money actually went/.test(pdfLines) && /Your 30-day money reset/.test(pdfLines));
  check("the PDF keeps the report's actual figures", /400,000/.test(pdfLines) && /page 1 of/i.test(pdfLines));
  fs.writeFileSync(path.join(process.env.PDF_OUT ?? "/tmp", "money-autopsy-sample.pdf"), pdf);

  const ids = generateMockInsights(PROFILE, a).findings.map((f) => f.id);
  check("findings include runway, betting session, ritual, ledger and price creep", ["runway", "betting-sessions", "ritual", "ledger", "price-creep"].every((id) => ids.includes(id)));

  // Honesty: no timestamps -> no time findings; balances that don't follow the amounts -> none either.
  const untimed = computeFinancialAnalysis(await categorizeTransactions((await extractStatement({ buffer: fs.readFileSync(path.join(FIXTURES_DIR, "mock-statement-2.csv")), filename: "x.csv", mimeType: "text/csv" })).transactions, { profile: PROFILE }), PROFILE);
  check("a statement without times gets no time-of-day findings", !untimed.timePatterns?.hasTime && !untimed.timePatterns?.lateNight);
  const sweep = ["Value Date,Narration,Debit,Credit,Balance", ...Array.from({ length: 12 }, (_, i) => `2024-03-${String(i + 1).padStart(2, "0")},"NIP TRANSFER TO 08011112222 x",${1000 + i},,0`)].join("\n");
  const sweepA = computeFinancialAnalysis(await categorizeTransactions((await extractStatement({ buffer: Buffer.from(sweep), filename: "s.csv", mimeType: "text/csv" })).transactions, { profile: PROFILE }), PROFILE);
  check("balances that don't follow from the amounts (e.g. a swept wallet) produce no balance findings", sweepA.balance === null);
}

function csvOf(rows: [string, number][]): string {
  let balance = 1_000_000;
  return [
    "Value Date,Narration,Debit,Credit,Balance",
    ...rows.map(([narration, debit], i) => {
      balance -= debit;
      return `2024-03-${String((i % 27) + 1).padStart(2, "0")},"${narration}",${debit},,${balance}`;
    }),
  ].join("\n");
}

async function questionsFor(rows: [string, number][]) {
  const extraction = await extractStatement({ buffer: Buffer.from(csvOf(rows)), filename: "m.csv", mimeType: "text/csv" });
  const txs = await categorizeTransactions(extraction.transactions, { profile: PROFILE });
  return computeFinancialAnalysis(txs, PROFILE).uncertainBreakdown;
}

async function verifyMateriality() {
  console.log("\n== 'what was this for': only ask what matters ==");
  const food: [string, number][] = Array.from({ length: 8 }, () => ["NIP TRANSFER TO 08011110000 food", 10000]);

  const small = await questionsFor([...Array.from({ length: 10 }, () => ["NIP TRANSFER TO 08011110000 food", 10000] as [string, number]), ["NIP TRANSFER TO 08099990001", 5000]]);
  check("unexplained money under 10% of the total is not worth asking about", small.questions.length === 0);

  const covered = await questionsFor([...food, ["NIP TRANSFER TO 08099990001", 9000], ["NIP TRANSFER TO 08099990002", 2500], ["NIP TRANSFER TO 08099990003", 2200]]);
  check("stops asking once the questions cover ~65% of the unexplained money", covered.questions.length === 1 && covered.questions[0].amount === 9000 && covered.notAsked.out.count === 2 && covered.coverage.out >= 65);

  const impact = await questionsFor([
    ...Array.from({ length: 6 }, () => ["NIP TRANSFER TO 08011110000 food", 10000] as [string, number]),
    ...Array.from({ length: 5 }, () => ["UBER TRIP", 10000] as [string, number]),
    ["NIP TRANSFER TO 08099990001", 12000],
    ["NIP TRANSFER TO 08099990002", 3000],
  ]);
  check("a payment big enough to flip the biggest category is asked, and says why", /which category is your biggest/i.test(impact.questions.find((q) => q.amount === 12000)?.why ?? ""));

  const many = await questionsFor(Array.from({ length: 12 }, (_, i) => [`NIP TRANSFER TO 0809999${String(1000 + i)}`, 5000 + i * 100] as [string, number]));
  check("even with no big items, a large unexplained share still gets a few questions, capped at 5", many.questions.length >= 3 && many.questions.length <= 5);
  check("each question explains itself and its share", many.questions.every((q) => q.why.length > 0 && q.shareOfUnexplained > 0));
}


type Row = [date: string, narration: string, debit: number, credit: number];

/** A statement from rows, with the running balance worked out so it reads like a real one. */
function statementCsv(rows: Row[], opening: number, withBalance = true): string {
  let balance = opening;
  const lines = ["Value Date,Narration,Debit,Credit,Balance"];
  for (const [date, narration, debit, credit] of rows) {
    balance += credit - debit;
    lines.push(`${date},"${narration}",${debit || ""},${credit || ""},${withBalance ? balance : ""}`);
  }
  return lines.join("\n");
}

async function planFor(rows: Row[], opening: number, profile: UserProfile, withBalance = true) {
  const extraction = await extractStatement({ buffer: Buffer.from(statementCsv(rows, opening, withBalance)), filename: "plan.csv", mimeType: "text/csv" });
  const txs = await categorizeTransactions(extraction.transactions, { profile });
  const analysis = computeFinancialAnalysis(txs, profile);
  return { txs, analysis, plan: buildMoneyPlan(txs, profile, analysis, new Date(`${analysis.periodEnd}T12:00:00Z`)), profile };
}

async function verifyMoneyPlan() {
  console.log("\n== money plan ==");

  // Three months: a steady ₦400k salary on the 1st, rent, lots of food, a subscription, data, betting.
  const rows: Row[] = [];
  for (const m of ["2024-01", "2024-02", "2024-03"]) {
    rows.push([`${m}-01`, "SALARY PAYMENT ACME LTD", 0, 400000]);
    rows.push([`${m}-02`, "HOUSE RENT PAYMENT", 100000, 0]);
    rows.push([`${m}-05`, "NETFLIX.COM SUBSCRIPTION", 4500, 0]);
    for (let d = 3; d <= 27; d += 2) rows.push([`${m}-${String(d).padStart(2, "0")}`, "NIP TRANSFER TO 08031234567 food", 6000, 0]);
    for (const d of ["06", "13", "20", "27"]) rows.push([`${m}-${d}`, "MTN DATA BUNDLE PURCHASE", 5000, 0]);
    for (const d of ["08", "15", "22"]) rows.push([`${m}-${d}`, "SPORTYBET FUNDING", 8000, 0]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const steadyProfile: UserProfile = { ...PROFILE, incomeSources: ["salary"], primaryIncomeSource: "salary", supports: ["no_one"], goal: "save_more" };
  const { txs, analysis, plan } = await planFor(rows, 200000, steadyProfile);

  check("a steady three-month statement gets a plan", !!plan);
  if (!plan) return;
  check("income is the salary that actually arrived (₦400,000), not divided by days", plan.income.monthly === 400000 && plan.income.basis === "statement");
  check("a salary on the same day every month is steady income", plan.income.regularity === "steady");

  const everything = plan.changes.map((c) => c.id);
  for (const [label, ids] of [["as first shown", plan.defaultSelected], ["with every change chosen", everything]] as const) {
    const v = computePlanView(plan, ids);
    const total = v.allocations.reduce((s, a) => s + a.amount, 0);
    check(`allocations add up to the income ${label}`, v.gap > 0 || total === plan.income.monthly);
    check(`percentages add up to 100 ${label}`, v.gap > 0 || v.allocations.reduce((s, a) => s + a.percent, 0) === 100);
  }

  check("every cut is strictly below what they spend now, and its saving is exactly the difference", plan.changes.filter((c) => c.nature === "cut").every((c) => c.monthlyTarget < c.monthlyNow && c.monthlySaving === c.monthlyNow - c.monthlyTarget));
  check("a limit never claims a saving", plan.changes.filter((c) => c.nature === "limit").every((c) => c.monthlySaving === 0));
  check("food shows up as a swap, not a ban", /home|around/i.test(plan.changes.find((c) => c.id === "food")?.proposal ?? "") && !/\bstop\b/i.test(plan.changes.map((c) => c.proposal).join(" ")));
  check("betting is offered but never pre-selected", plan.changes.find((c) => c.id === "betting")?.optional === true && !plan.defaultSelected.includes("betting"));
  check("data is answered with a bigger plan, not a smaller allowance", /bigger plan/i.test(plan.changes.find((c) => c.id === "data")?.proposal ?? ""));
  check("nothing is invented: every change comes from a category that exists in the data", plan.changes.every((c) => analysis.categoryBreakdown.some((b) => b.category === c.category && b.total > 0)));
  check("the plan never counts betting money in as income", plan.income.monthly === 400000);

  const defaultView = computePlanView(plan, plan.defaultSelected);
  check("rules are capped at 4 and reset at 3–5, with no placeholders left in them", defaultView.rules.length <= 4 && defaultView.reset.length >= 3 && defaultView.reset.length <= 5 && ![...defaultView.rules, ...defaultView.reset].some((t) => /[{}]/.test(t)));
  check("no rule is written for something that isn't in the data", !defaultView.rules.some((r) => /cash|lend|helping/i.test(r)));

  const safe = plan.safeToSpend;
  check("safe to spend is produced from a real running balance", !!safe && safe.daily >= 0 && safe.working[0].label === "In your account");
  check("and stops at the next payday when the salary lands on the same day each month", safe?.endsAtPayday === true);
  const stale = buildMoneyPlan(txs, steadyProfile, analysis, new Date("2024-06-30T12:00:00Z"));
  check("safe to spend is withheld, with a reason, when the statement is old", stale?.safeToSpend === null && /newer one/i.test(stale?.safeToSpendNote ?? ""));

  const free = shapeForStatus(buildReport(analysis, generateMockInsights(steadyProfile, analysis), plan), "free");
  const unlocked = shapeForStatus(buildReport(analysis, generateMockInsights(steadyProfile, analysis), plan), "unlocked");
  check("the plan is never sent to a free-status client", !("moneyPlan" in free) && !JSON.stringify(free).includes("safeToSpend"));
  check("it is sent once unlocked", unlocked.status === "unlocked" && !!unlocked.moneyPlan);

  check("'if you cut this by 25%' is plain arithmetic (₦82,000 → ₦20,500 a month, ₦246,000 a year)", scenarioFigures(82000, 25).monthly === 20500 && scenarioFigures(82000, 25).yearly === 246000);

  // ---- the model can only reword: ungrounded amounts and stray placeholders are thrown out ----
  const first = plan.changes[0];
  const good = `Try ${formatNaira(first.monthlyTarget)} a month as a gentle starting point.`;
  const applied = applyNarrative(plan, {
    intro: "Built around your salary and your goal to save more.",
    priority: [...plan.changes.map((c) => c.id)].reverse(),
    texts: {
      [`change.${first.id}.proposal`]: good,
      [`change.${first.id}.why`]: "Because ₦987,654 is a lot of money.",
      [`change.${first.id}.rule`]: "Hold it to {invented}.",
      [`change.${first.id}.reset`]: "x".repeat(400),
    },
  });
  const after = applied.changes.find((c) => c.id === first.id)!;
  check("wording that uses only supplied amounts is kept", after.proposal === good);
  check("wording with an amount the plan never supplied is dropped for the default", after.why === first.why);
  check("wording with an unknown placeholder, or an essay, is dropped too", after.rule === first.rule && after.reset === first.reset);
  check("the model can reorder changes by relevance but never invent one", applied.changes.length === plan.changes.length && applied.changes.every((c) => plan.changes.some((p) => p.id === c.id)) && applied.changes.slice(0, -1).every((c, i) => !c.optional || applied.changes[i + 1].optional));
  check("no wording at all leaves the plan exactly as computed", applyNarrative(plan, null) === plan);

  // ---- irregular income: percentages, not a fixed monthly amount ----
  const freelance: Row[] = [
    ["2024-01-08", "TRANSFER FROM ACME CLIENT invoice payment", 0, 90000],
    ["2024-01-20", "NIP TRANSFER TO 08031234567 food", 40000, 0],
    ["2024-02-24", "TRANSFER FROM ACME CLIENT invoice payment", 0, 300000],
    ["2024-02-26", "NIP TRANSFER TO 08031234567 food", 45000, 0],
    ["2024-03-05", "NIP TRANSFER TO 08031234567 food", 40000, 0],
    ["2024-03-28", "TRANSFER FROM ACME CLIENT invoice payment", 0, 60000],
    ...["2024-01-12", "2024-01-27", "2024-02-06", "2024-02-15", "2024-03-12", "2024-03-20"].map((d) => [d, "NIP TRANSFER TO 08031234567 food", 12000, 0] as Row),
  ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))) as Row[];
  const freelanceProfile: UserProfile = { ...PROFILE, incomeSources: ["freelance"], primaryIncomeSource: "freelance", supports: ["no_one"] };
  const irregular = await planFor(freelance, 100000, freelanceProfile);
  if (irregular.plan) {
    check("freelance income is treated as irregular", irregular.plan.income.regularity === "irregular");
    check("irregular income gets a percentage rule instead of a fixed amount", /goalsPercent/.test(irregular.plan.paydayRule) && !/\{goals\}/.test(irregular.plan.paydayRule));
    const { everyday, fun, buffer } = irregular.plan.baseline;
    check("irregular income holds two weeks of everyday spending as buffer, not one", Math.abs(buffer - ((everyday + fun) / 4.345) * 2) <= 1500 && buffer > 0);
  } else {
    check("freelance statement produced a plan", false);
  }

  // ---- nothing to plan on: be honest, don't fabricate ----
  const noIncome = await planFor(
    Array.from({ length: 12 }, (_, i) => [`2024-03-${String(i * 2 + 1).padStart(2, "0")}`, "NIP TRANSFER TO 08031234567 food", 5000, 0] as Row),
    500000,
    { ...PROFILE, income: "500k_1m", incomeSources: ["salary"], primaryIncomeSource: "salary" }
  );
  check("with no earnings evidenced, the plan falls back to the stated range and says so", noIncome.plan?.income.basis === "stated" && noIncome.plan.income.monthly === 500000 && (noIncome.plan.assumptions.some((a) => /range you gave/i.test(a))));

  const tooShort = await planFor(
    Array.from({ length: 12 }, (_, i) => [`2024-03-${String(i + 1).padStart(2, "0")}`, "NIP TRANSFER TO 08031234567 food", 5000, 0] as Row),
    500000,
    PROFILE
  );
  check("a statement under two weeks long gets no plan rather than a guess", tooShort.plan === null);

  // ---- a monthly salary must never look irregular just because months aren't 30 days ----
  // Paid on the 1st, statement cut on the 3rd → 11th: the old 30-day windows produced an empty
  // last window and called this person irregular.
  const paidMonthly: Row[] = [];
  for (const m of ["02", "03", "04", "05", "06"]) {
    paidMonthly.push([`2024-${m}-01`, "SALARY PAYMENT ACME LTD", 0, 250000]);
    for (const d of ["07", "14", "21"]) paidMonthly.push([`2024-${m}-${d}`, "NIP TRANSFER TO 08031234567 food", 20000, 0]);
  }
  paidMonthly.unshift(["2024-01-03", "NIP TRANSFER TO 08031234567 food", 20000, 0]);
  paidMonthly.push(["2024-06-11", "NIP TRANSFER TO 08031234567 food", 20000, 0]);
  const monthly = await planFor(paidMonthly, 300000, steadyProfile);
  check("a salary paid every month reads as steady, with no phantom empty month", monthly.plan?.income.regularity === "steady" && monthly.plan.income.lowestMonth === 250000 && monthly.plan.income.monthly === 250000);

  // ---- spending more than arrives: never a percentage above 100, and the gap is named ----
  const overspend = await planFor(
    [
      ["2024-01-01", "SALARY PAYMENT ACME LTD", 0, 100000],
      ...Array.from({ length: 24 }, (_, i) => [`2024-01-${String(i + 2).padStart(2, "0")}`, "NIP TRANSFER TO 08031234567 food", 15000, 0] as Row),
    ],
    500000,
    steadyProfile
  );
  if (overspend.plan) {
    const v = computePlanView(overspend.plan, overspend.plan.defaultSelected);
    check("spending more than arrives is reported as a gap", v.gap > 0);
    check("…and no allocation percentage passes 100 or fails to add up", v.allocations.every((a) => a.percent <= 100) && v.allocations.reduce((s, a) => s + a.percent, 0) === 100);
    check("…nothing is set aside for goals while there's a gap", v.goals === 0);
  } else {
    check("overspending statement produced a plan", false);
  }

  const noBalance = await planFor(rows, 200000, steadyProfile, false);
  check("without a running balance there is no safe-to-spend number, only a reason", noBalance.plan?.safeToSpend === null && !!noBalance.plan?.safeToSpendNote);
}

async function verifyIncomeCheck() {
  console.log("\n== income check: is this heavy credit your income? ==");
  const lowIncomeProfile: UserProfile = { ...PROFILE, income: "0_50k", incomeSources: ["salary"], primaryIncomeSource: "salary", supports: ["no_one"] };

  // Three months, no salary keyword anywhere: a client pays by plain transfer, in different
  // amounts on different days (so nothing about it looks like a regular payday).
  const rows: Row[] = [
    ["2024-01-05", "NIP TRANSFER FROM CHIDI OKAFOR 08033311111", 0, 200000],
    ["2024-02-21", "NIP TRANSFER FROM CHIDI OKAFOR 08033311111", 0, 340000],
    ["2024-03-09", "NIP TRANSFER FROM CHIDI OKAFOR 08033311111", 0, 90000],
  ];
  for (const m of ["2024-01", "2024-02", "2024-03"]) {
    for (let d = 3; d <= 27; d += 4) rows.push([`${m}-${String(d).padStart(2, "0")}`, "NIP TRANSFER TO 08031234567 food", 9000, 0]);
  }
  rows.push(["2024-02-14", "NIP TRANSFER FROM AMAKA NWOSU 08044455555", 0, 6000]);
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const a = await planFor(rows, 100000, lowIncomeProfile);
  const check1 = computeIncomeCheck(a.txs, lowIncomeProfile, a.analysis);

  check("a plain transfer that is most of the money in is asked about, not assumed to be income", a.analysis.earnedIncome === 0 && !!check1 && check1.questions[0]?.name.length > 0);
  const chidi = check1?.questions[0];
  check("it is one question covering all three credits, worth ₦630,000", chidi?.count === 3 && chidi.total === 630000 && chidi.followers === 2);
  check("it says how much of the money in it is", (chidi?.sharePercent ?? 0) >= 90);
  check("a ₦6,000 credit is too small to ask about", !check1?.questions.some((q) => q.total === 6000));
  check("the effect is previewed: the plan's monthly income would rise", !!chidi && chidi.monthlyBefore !== null && chidi.monthlyAfter !== null && chidi.monthlyAfter > chidi.monthlyBefore && chidi.monthlyAfter === 200000);

  // The categorizer already recognises regular same-sender deposits as income; those aren't re-asked.
  const regular = await planFor(
    ["2024-01-05", "2024-02-05", "2024-03-05"].map((d) => [d, "NIP TRANSFER FROM CHIDI OKAFOR 08033311111", 0, 200000] as Row).concat(
      Array.from({ length: 10 }, (_, i) => [`2024-02-${String(i + 8).padStart(2, "0")}`, "NIP TRANSFER TO 08031234567 food", 4000, 0] as Row)
    ).sort((x, y) => x[0].localeCompare(y[0])),
    100000, lowIncomeProfile);
  check("a regular same-sender deposit the categorizer already calls income isn't questioned", computeIncomeCheck(regular.txs, lowIncomeProfile, regular.analysis) === null);

  // Answering "income": every credit from that sender follows, and it is never asked again.
  const target = a.txs.find((t) => t.id === chidi!.transactionId)!;
  const followers = answerFollowerIds(a.txs, target);
  check("the answer follows to the other credits from the same sender", followers.length === 2 && (chidi?.coversTransactionIds.length ?? 0) === 3);
  const covered = new Set(chidi!.coversTransactionIds);
  const answered = a.txs.map((t) => {
    if (!covered.has(t.id)) return t;
    const r = { ...t, category: "Income" as const, categoryConfidence: 1, categoryReason: "you told us what this money was" };
    return { ...r, type: deriveType(r) };
  });
  const analysisAfter = computeFinancialAnalysis(answered, lowIncomeProfile);
  const planAfter = buildMoneyPlan(answered, lowIncomeProfile, analysisAfter, new Date(`${analysisAfter.periodEnd}T12:00:00Z`));
  check("once confirmed, the plan really does work from that income", planAfter?.income.monthly === 200000 && planAfter.income.basis === "statement");
  check("a confirmed income is never asked about again", !computeIncomeCheck(answered, lowIncomeProfile, analysisAfter)?.questions.some((q) => q.transactionId === chidi!.transactionId));

  // Answering "something else" is remembered too: it isn't re-asked as a gift, and isn't income.
  const gifted = a.txs.map((t) => {
    if (!covered.has(t.id)) return t;
    const r = { ...t, category: "Gifts & support" as const, categoryConfidence: 1, categoryReason: "you told us what this money was" };
    return { ...r, type: deriveType(r) };
  });
  const giftedAnalysis = computeFinancialAnalysis(gifted, lowIncomeProfile);
  check("an answer of 'something else' is not asked again either", !computeIncomeCheck(gifted, lowIncomeProfile, giftedAnalysis)?.questions.some((q) => covered.has(q.transactionId)));
  check("…and it does not become income", giftedAnalysis.earnedIncome === 0);

  // Confidently labelled income is never asked about.
  const salaried = await planFor(
    [["2024-01-01", "SALARY PAYMENT ACME LTD", 0, 500000], ["2024-02-01", "SALARY PAYMENT ACME LTD", 0, 500000], ["2024-03-01", "SALARY PAYMENT ACME LTD", 0, 500000],
     ...Array.from({ length: 12 }, (_, i) => [`2024-02-${String(i + 2).padStart(2, "0")}`, "NIP TRANSFER TO 08031234567 food", 5000, 0] as Row)].sort((x, y) => String(x[0]).localeCompare(String(y[0]))) as Row[],
    100000, PROFILE);
  check("a salary we recognise is never questioned", computeIncomeCheck(salaried.txs, PROFILE, salaried.analysis) === null);

  // Weight: a ₦90k credit is ~5.7% of the money in — under the 10% bar normally, over the 5% bar when spending outruns income.
  const base: Row[] = [
    ["2024-01-01", "SALARY PAYMENT ACME LTD", 0, 500000],
    ["2024-02-01", "SALARY PAYMENT ACME LTD", 0, 500000],
    ["2024-02-10", "NIP TRANSFER FROM AMAKA NWOSU 08044455555", 0, 90000],
    ["2024-03-01", "SALARY PAYMENT ACME LTD", 0, 500000],
    ...Array.from({ length: 12 }, (_, i) => [`2024-02-${String(i + 12).padStart(2, "0")}`, "NIP TRANSFER TO 08031234567 food", 5000, 0] as Row),
  ];
  const calm = await planFor([...base].sort((x, y) => x[0].localeCompare(y[0])), 100000, PROFILE);
  check("a ~5.7% credit is not asked about when spending is under control", computeIncomeCheck(calm.txs, PROFILE, calm.analysis) === null);
  const stretched = await planFor(
    [...base, ["2024-03-05", "NIP TRANSFER TO 08031234567 food", 2000000, 0] as Row].sort((x, y) => x[0].localeCompare(y[0])),
    3000000, PROFILE);
  const stretchedCheck = computeIncomeCheck(stretched.txs, PROFILE, stretched.analysis);
  check("when spending is well above the income we can confirm, the same credit is asked about", stretchedCheck?.overspending === true && !!stretchedCheck.questions.some((q) => q.total === 90000));

  // It never leaks to a free client.
  const free = shapeForStatus(buildReport(a.analysis, generateMockInsights(lowIncomeProfile, a.analysis), a.plan, check1), "free");
  check("income questions are only sent once unlocked", !("incomeCheck" in free));
}

async function main() {
  await verifyCsvFixture();
  await verifyMateriality();
  await verifyBehavior();
  await verifyMoneyPlan();
  await verifyIncomeCheck();
  await verifyBettingProfit();
  await verifyQuestionSelection();
  await verifyTransportGroceriesAndFronting();
  await verifyNigerianFixture();
  await verifyPdfFixture();
  await verifyEncryptedPdfFixture();
  await verifyCategorizationImprovements();

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
