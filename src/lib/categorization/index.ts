import type {
  Category,
  NormalizedTransaction,
  TransactionDirection,
  TransactionType,
  UserProfile,
} from "@/lib/types";
import { matchSignal, isLikelyBankFee, type SignalContext } from "./signals";
import { detectPaymentMethod, detectPaymentProcessor, isTransferRail, resolveMerchant } from "./channels";
import { extractRecipientKey } from "./recipientKey";
import { isSelfTransfer } from "./selfTransfer";
import { pairReversals, linkGroupReimbursements } from "./postPasses";
import { isCashWithdrawalDescription } from "@/lib/extraction/normalize";
import { mean, stddev, daysBetween } from "@/lib/analysis/helpers";
import { classifyUncertainTransactions } from "@/lib/llm/categorizeUncertain";

export interface CategorizeOptions {
  /** The statement's own account holder name, if known — lets self-transfers between the
   * person's own accounts be recognized instead of left Uncertain. */
  accountHolderName?: string | null;
  /** About You answers. Used only as weak context (a tie-breaker between plausible
   * readings), never as evidence that overrides what the transaction itself says. */
  profile?: UserProfile | null;
}

interface RecipientEvidence {
  category: Category;
  count: number;
  share: number;
  reasonSample: string;
}

/**
 * Categorizes every transaction using a layered hierarchy, from most to least certain:
 *   1. self-transfers, then known merchants and narration keywords — direction-aware, and
 *      blind to payment rails (NIP/POS/transfer say how money moved, not what it was for)
 *   2. pairing: reversals matched to the debit they undo; groups of friends' transfers that
 *      split a large expense matched to it as reimbursements
 *   3. recipient/sender memory from this same statement, even from one prior occurrence,
 *      discounted when that person has served several different purposes
 *   4. recurring patterns (a tight repeating outflow reads as a bill; a tight repeating
 *      inflow reads as a regular income source or regular support)
 *   5. contextual defaults, and honest "Uncertain" when nothing supports a guess
 *   6. a batched LLM pass over what is still Uncertain — best-effort, never authoritative
 * Nothing is ever forced into a category to look complete.
 */
export async function categorizeTransactions(
  transactions: NormalizedTransaction[],
  options: CategorizeOptions = {}
): Promise<NormalizedTransaction[]> {
  const profile = options.profile ?? null;

  const withChannel = transactions.map(enrichChannel);
  const withPrimary = withChannel.map((tx) => applyPrimarySignals(tx, options.accountHolderName, profile));

  const paired = pairReversals(withPrimary);
  const withGroups = linkGroupReimbursements(paired);

  const memory = buildRecipientMemory(withGroups);
  const withMemory = withGroups.map((tx) => applyRecipientMemory(tx, memory));

  const withRecurringOut = applyRecurringOutflow(withMemory);
  const withRecurringIn = applyRecurringInflow(withRecurringOut, profile);
  const withDefaults = withRecurringIn.map(applyContextualDefaults);

  const llmGuesses = await classifyUncertainTransactions(withDefaults, profile);
  const finalTx =
    llmGuesses.size === 0
      ? withDefaults
      : withDefaults.map((tx) => {
          const guess = llmGuesses.get(tx.id);
          if (!guess) return tx;
          return {
            ...tx,
            category: guess.category,
            categoryConfidence: guess.confidence,
            categoryReason: `AI best-guess from the description: ${guess.reason}`,
          };
        });

  return finalTx.map((tx) => ({ ...tx, type: deriveType(tx) }));
}

/** What kind of movement this turned out to be — derived from the final category, not
 * from the payment rail. */
export function deriveType(tx: NormalizedTransaction): TransactionType {
  switch (tx.category) {
    case "Cash":
      return tx.direction === "out" ? "withdrawal" : "unknown";
    case "Banking fees":
      return "fee";
    case "Savings":
      return "savings";
    case "Investments":
      return "investment";
    case "Loans":
      return "loan";
    case "Reimbursements":
      return "reimbursement";
    case "Refunds":
      return tx.subtype === "reversal" || tx.subtype === "reversed_original" ? "reversal" : "refund";
    case "Income":
      return "income";
    case "Transfers":
      return "transfer";
    case "Uncertain":
      return isTransferRail(tx.paymentMethod) ? "transfer" : "unknown";
    default:
      return "expense";
  }
}

function directionOf(tx: NormalizedTransaction): TransactionDirection {
  return tx.direction ?? (tx.type === "income" ? "in" : "out");
}

function enrichChannel(tx: NormalizedTransaction): NormalizedTransaction {
  const text = tx.rawDescription === tx.description ? tx.rawDescription : `${tx.rawDescription} ${tx.description}`;
  return {
    ...tx,
    direction: directionOf(tx),
    paymentMethod: tx.paymentMethod ?? detectPaymentMethod(text),
    paymentProcessor: tx.paymentProcessor ?? detectPaymentProcessor(text),
    merchant: resolveMerchant(text, tx.merchant),
  };
}

function applyPrimarySignals(
  tx: NormalizedTransaction,
  accountHolderName: string | null | undefined,
  profile: UserProfile | null
): NormalizedTransaction {
  const text = [tx.rawDescription, tx.description, tx.merchant ?? ""].join(" ");

  if (isSelfTransfer(text, accountHolderName)) {
    return {
      ...tx,
      category: "Transfers",
      categoryConfidence: 0.9,
      categoryReason: "moving money to/from your own name — a transfer between your own accounts, not spending or income",
      subtype: "own_account",
    };
  }

  const ctx: SignalContext = { direction: tx.direction, amount: tx.amount, method: tx.paymentMethod };
  const match = matchSignal(text, ctx);
  if (!match) return tx;

  const { category } = match;
  let { confidence, subtype } = match;
  let reason = `${match.label} — narration contains "${match.fragment}"`;

  if (category === "Betting") subtype = tx.direction === "in" ? "withdrawal" : "deposit";

  if (category === "Loans") {
    // Explicit wording decides. What the person said about borrowing/lending only breaks a
    // tie when the narration itself doesn't say which direction the loan runs.
    const repaying = /repay|instal+ment|interest|debt|paid back|paying back/i.test(text);
    const lending = /\blend(ing|s)?\b|\blent\b|loan to\b/i.test(text);
    const disbursed = /disbursement|loan (credit|from|granted)|facility/i.test(text);
    if (tx.direction === "out") {
      if (repaying) subtype = "repayment";
      else if (lending) subtype = "lent";
      else subtype = profile?.lending === "never" && profile.borrowing !== "never" ? "repayment" : "lent";
    } else {
      if (disbursed) subtype = "borrowed";
      else if (repaying) subtype = "repaid_to_you";
      else subtype = profile?.borrowing === "never" && profile.lending !== "never" ? "repaid_to_you" : "borrowed";
    }
  }

  // Someone with regular dependants has a reason to be sending money to relatives.
  if (subtype === "family_support" && profile && profile.supports.some((s) => ["parents_family", "partner", "children"].includes(s))) {
    confidence = Math.min(0.78, confidence + 0.1);
    reason += " (you said you regularly support family)";
  }

  return { ...tx, category, categoryConfidence: confidence, categoryReason: reason, subtype };
}

const MEMORY_EXCLUDED: Category[] = ["Refunds", "Cash", "Banking fees", "Uncertain"];

function memoryKey(tx: NormalizedTransaction): string | null {
  const key = extractRecipientKey(tx.rawDescription, tx.merchant);
  return key ? `${tx.direction}|${key}` : null;
}

function buildRecipientMemory(transactions: NormalizedTransaction[]): Map<string, RecipientEvidence> {
  const buckets = new Map<string, NormalizedTransaction[]>();

  for (const tx of transactions) {
    if (tx.categoryConfidence < 0.6 || MEMORY_EXCLUDED.includes(tx.category)) continue;
    const key = memoryKey(tx);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(tx);
  }

  const resolved = new Map<string, RecipientEvidence>();
  for (const [key, entries] of buckets.entries()) {
    const counts = new Map<Category, number>();
    for (const e of entries) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    const [topCategory, topCount] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    resolved.set(key, {
      category: topCategory,
      count: topCount,
      share: topCount / entries.length,
      reasonSample: entries.find((e) => e.category === topCategory)?.categoryReason ?? "",
    });
  }
  return resolved;
}

function applyRecipientMemory(tx: NormalizedTransaction, memory: Map<string, RecipientEvidence>): NormalizedTransaction {
  if (tx.categoryConfidence >= 0.6 || tx.category !== "Uncertain") return tx;
  const key = memoryKey(tx);
  if (!key) return tx;
  const evidence = memory.get(key);
  if (!evidence) return tx;

  // One person can serve several purposes. If their history is mixed, it says little about
  // this transaction — only a clear majority is treated as a pattern, and the confidence
  // shrinks with how mixed it is. It also never locks: it only fills in where nothing else
  // was found, and it stays below the confidence of a direct signal.
  if (evidence.share < 0.6) return tx;
  const confidence = Math.min(0.88, (0.5 + evidence.count * 0.15) * evidence.share);
  if (confidence <= tx.categoryConfidence) return tx;

  const who = tx.direction === "in" ? "sender" : "recipient";
  return {
    ...tx,
    category: evidence.category,
    categoryConfidence: confidence,
    categoryReason: `this ${who} has ${evidence.count} other transaction(s) previously identified as ${evidence.category.toLowerCase()} (${evidence.reasonSample})`,
    subtype: null,
  };
}

const RECURRING_MIN_OCCURRENCES = 3;
const RECURRING_MAX_AMOUNT_VARIANCE = 0.15; // stddev/mean

function groupUnresolvedByCounterparty(
  transactions: NormalizedTransaction[],
  direction: TransactionDirection
): NormalizedTransaction[][] {
  const groups = new Map<string, NormalizedTransaction[]>();
  for (const tx of transactions) {
    if (tx.direction !== direction || tx.category !== "Uncertain" || tx.categoryConfidence >= 0.6) continue;
    const key = extractRecipientKey(tx.rawDescription, tx.merchant);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }
  return Array.from(groups.values()).filter((group) => {
    if (group.length < RECURRING_MIN_OCCURRENCES) return false;
    const amounts = group.map((t) => t.amount);
    return stddev(amounts) / (mean(amounts) || 1) <= RECURRING_MAX_AMOUNT_VARIANCE;
  });
}

function cadenceOf(group: NormalizedTransaction[]): number | null {
  const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));
  return gaps.length > 0 ? Math.round(mean(gaps)) : null;
}

/**
 * A repeating outflow to the same recipient for a near-identical amount reads as a
 * bill/subscription-like pattern even when nothing in the description is recognizable.
 */
function applyRecurringOutflow(transactions: NormalizedTransaction[]): NormalizedTransaction[] {
  const patterned = new Map<string, number | null>();
  for (const group of groupUnresolvedByCounterparty(transactions, "out")) {
    const cadenceDays = cadenceOf(group);
    for (const tx of group) patterned.set(tx.id, cadenceDays);
  }
  if (patterned.size === 0) return transactions;

  return transactions.map((tx) => {
    if (!patterned.has(tx.id)) return tx;
    const cadenceDays = patterned.get(tx.id);
    const cadenceNote = cadenceDays ? ` about every ${cadenceDays} days` : "";
    return {
      ...tx,
      category: "Bills",
      categoryConfidence: 0.6,
      categoryReason: `recurs${cadenceNote} to the same recipient for a consistent amount — looks like a repeating bill or subscription, though the exact purpose isn't confirmable from the description`,
      subtype: "recurring_pattern",
    };
  });
}

/**
 * Regular, near-identical deposits from the same sender are the one case where money from
 * a person can reasonably be read as an income source — the regularity is the evidence.
 * What it's called (earnings vs support) leans on what the person said their income is.
 */
function applyRecurringInflow(transactions: NormalizedTransaction[], profile: UserProfile | null): NormalizedTransaction[] {
  const patterned = new Map<string, number | null>();
  for (const group of groupUnresolvedByCounterparty(transactions, "in")) {
    const cadenceDays = cadenceOf(group);
    for (const tx of group) patterned.set(tx.id, cadenceDays);
  }
  if (patterned.size === 0) return transactions;

  const supportLed = profile ? ["family_support", "gifts_support"].includes(profile.primaryIncomeSource) : false;

  return transactions.map((tx) => {
    if (!patterned.has(tx.id)) return tx;
    const cadenceDays = patterned.get(tx.id);
    const cadenceNote = cadenceDays ? ` about every ${cadenceDays} days` : "";
    return {
      ...tx,
      category: supportLed ? "Gifts & support" : "Income",
      categoryConfidence: 0.6,
      categoryReason: `regular deposits${cadenceNote} of a consistent amount from the same sender — resembles ${
        supportLed ? "regular support" : "a recurring income source (salary, allowance or regular client payments)"
      }, though the statement doesn't say so directly`,
      subtype: supportLed ? "regular_support" : "recurring_income",
    };
  });
}

function unresolvedReason(tx: NormalizedTransaction): string {
  const remita = tx.paymentProcessor === "Remita" ? " It went through Remita, which is often used for government or official payments." : "";
  const hasRemark = tx.rawDescription.trim().length > 0 && tx.rawDescription !== tx.description;

  if (tx.direction === "in") {
    if (tx.paymentMethod === "cash_deposit") return "cash deposited — the statement doesn't say where the cash came from";
    return "money received from a person with no useful remark — it could be income, a gift, a loan, a reimbursement or a transfer between your own accounts, so it isn't assumed to be income";
  }
  if (tx.paymentMethod === "pos") {
    return `POS payment with no merchant we recognise — the statement doesn't say what was bought, and a POS payment is never assumed to be a cash withdrawal.${remita}`;
  }
  if (isTransferRail(tx.paymentMethod)) {
    return hasRemark
      ? `transfer to a person with a remark that doesn't clearly map to a purpose.${remita}`
      : `transfer to a person with no remark — the statement doesn't say what it was for.${remita}`;
  }
  return `no merchant or narration we recognise.${remita}`;
}

function applyContextualDefaults(tx: NormalizedTransaction): NormalizedTransaction {
  if (tx.category !== "Uncertain") return tx;

  const text = `${tx.rawDescription} ${tx.description}`;
  const ctx: SignalContext = { direction: tx.direction, amount: tx.amount, method: tx.paymentMethod };

  if (tx.direction === "out" && isCashWithdrawalDescription(text)) {
    return { ...tx, category: "Cash", categoryConfidence: 0.95, categoryReason: "ATM or explicit cash withdrawal" };
  }
  if (isLikelyBankFee(text, ctx)) {
    return { ...tx, category: "Banking fees", categoryConfidence: 0.8, categoryReason: "small amount with bank-charge wording (fee/VAT/levy/commission)" };
  }

  const hasRemark = tx.rawDescription.trim().length > 0 && tx.rawDescription !== tx.description;
  return {
    ...tx,
    category: "Uncertain",
    categoryConfidence: hasRemark ? 0.3 : 0.15,
    categoryReason: unresolvedReason(tx),
  };
}
