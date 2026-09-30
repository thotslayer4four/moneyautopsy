import type { Category, NormalizedTransaction } from "@/lib/types";
import { daysBetween } from "@/lib/analysis/helpers";
import { isTransferRail } from "./channels";
import { CATEGORY_KIND } from "./categories";
import { extractRecipientKey } from "./recipientKey";

const AMOUNT_TOLERANCE = 0.5; // naira — statements sometimes differ by a kobo-level rounding

function longReferenceIn(tx: NormalizedTransaction): string[] {
  return (tx.rawDescription.match(/\b\d{6,}\b/g) ?? []).filter((n) => !/^0\d{10}$/.test(n));
}

/**
 * Pairs each reversal/refund with the transaction it undoes. A ₦50,000 debit followed by a
 * ₦50,000 reversal is a net ₦0, not ₦50,000 of spending — so both sides are marked as
 * Refunds (not spending, not income) and linked. A refund with no matching debit in this
 * statement (e.g. for a purchase made before it starts) is still a Refund, never income.
 */
export function pairReversals(transactions: NormalizedTransaction[]): NormalizedTransaction[] {
  const used = new Set<string>();
  const updates = new Map<string, Partial<NormalizedTransaction>>();

  const reversals = transactions
    .filter((t) => t.category === "Refunds" && t.subtype === "reversal")
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const reversal of reversals) {
    const wantedDirection = reversal.direction === "in" ? "out" : "in";
    const refs = new Set(longReferenceIn(reversal));

    const candidates = transactions
      .filter(
        (t) =>
          t.id !== reversal.id &&
          !used.has(t.id) &&
          t.direction === wantedDirection &&
          Math.abs(t.amount - reversal.amount) <= AMOUNT_TOLERANCE &&
          // The original can't come after its own reversal (same day is fine).
          t.date <= reversal.date &&
          daysBetween(t.date, reversal.date) <= 10 &&
          !(t.category === "Refunds" && t.subtype === "reversal")
      )
      .sort((a, b) => {
        const aRef = longReferenceIn(a).some((r) => refs.has(r)) ? 0 : 1;
        const bRef = longReferenceIn(b).some((r) => refs.has(r)) ? 0 : 1;
        if (aRef !== bRef) return aRef - bRef;
        return daysBetween(a.date, reversal.date) - daysBetween(b.date, reversal.date);
      });

    const original = candidates[0];
    if (!original) continue;

    used.add(original.id);
    used.add(reversal.id);
    updates.set(original.id, {
      category: "Refunds",
      categoryConfidence: 0.9,
      categoryReason: `this ${original.direction === "out" ? "payment" : "credit"} was reversed on ${reversal.date} — the money went back, so it isn't counted as ${original.direction === "out" ? "spending" : "income"}`,
      subtype: "reversed_original",
      relatedTransactionId: reversal.id,
    });
    updates.set(reversal.id, {
      categoryConfidence: 0.92,
      categoryReason: `reverses a ₦${Math.round(original.amount).toLocaleString()} ${original.direction === "out" ? "payment" : "credit"} from ${original.date} — a net zero, not new ${reversal.direction === "in" ? "income" : "spending"}`,
      relatedTransactionId: original.id,
    });
  }

  if (updates.size === 0) return transactions;
  return transactions.map((t) => {
    const u = updates.get(t.id);
    return u ? { ...t, ...u } : t;
  });
}

const GROUP_WINDOW_DAYS = 3;
const MIN_EXPENSE_FOR_GROUP = 5_000;
const SIMILARITY_BAND = 0.25; // amounts within ±25% of each other count as "similar"

/**
 * Detects the "I paid for everyone and got paid back" pattern: a large expense followed
 * within a few days by several similar-sized transfers from different people that together
 * cover part or all of it. Those transfers are reimbursements — not income — and linking
 * them to the expense lets the analysis report what the outing actually cost the person.
 */
export function linkGroupReimbursements(transactions: NormalizedTransaction[]): NormalizedTransaction[] {
  const claimed = new Set<string>();
  const updates = new Map<string, Partial<NormalizedTransaction>>();

  const expenses = transactions
    .filter(
      (t) =>
        t.direction === "out" &&
        t.amount >= MIN_EXPENSE_FOR_GROUP &&
        (CATEGORY_KIND[t.category] === "spend" || t.category === "Uncertain") &&
        t.category !== "Cash" &&
        t.category !== "Banking fees"
    )
    .sort((a, b) => b.amount - a.amount);

  const inboundPool = transactions.filter(
    (t) =>
      t.direction === "in" &&
      (t.category === "Uncertain" || (t.category === "Reimbursements" && t.categoryConfidence < 0.65)) &&
      (isTransferRail(t.paymentMethod) || t.paymentMethod === null || t.paymentMethod === "mobile")
  );

  for (const expense of expenses) {
    const window = inboundPool.filter(
      (t) =>
        !claimed.has(t.id) &&
        t.date >= expense.date &&
        daysBetween(expense.date, t.date) <= GROUP_WINDOW_DAYS &&
        t.amount < expense.amount
    );
    if (window.length < 2) continue;

    // Find the biggest cluster of similar-sized transfers whose total fits within the expense.
    let best: NormalizedTransaction[] = [];
    for (const anchor of window) {
      const cluster = window
        .filter((t) => t.amount >= anchor.amount * (1 - SIMILARITY_BAND) && t.amount <= anchor.amount * (1 + SIMILARITY_BAND))
        .sort((a, b) => a.date.localeCompare(b.date));

      const trimmed: NormalizedTransaction[] = [];
      let sum = 0;
      for (const t of cluster) {
        if (sum + t.amount > expense.amount * 1.05) break;
        trimmed.push(t);
        sum += t.amount;
      }
      const totalOk = sum >= expense.amount * 0.25;
      if (trimmed.length >= 2 && totalOk && trimmed.length > best.length) best = trimmed;
    }
    if (best.length < 2) continue;

    const reimbursed = best.reduce((s, t) => s + t.amount, 0);
    for (const t of best) {
      claimed.add(t.id);
      updates.set(t.id, {
        category: "Reimbursements",
        categoryConfidence: 0.66,
        categoryReason: `one of ${best.length} similar transfers (₦${Math.round(reimbursed).toLocaleString()} together) that arrived within ${GROUP_WINDOW_DAYS} days of a ₦${Math.round(expense.amount).toLocaleString()} payment on ${expense.date} — looks like friends paying you back their share`,
        subtype: "group_expense",
        relatedTransactionId: expense.id,
      });
    }
  }

  if (updates.size === 0) return transactions;
  return transactions.map((t) => {
    const u = updates.get(t.id);
    return u ? { ...t, ...u } : t;
  });
}

const PASS_THROUGH_WINDOW_DAYS = 3;
const PASS_THROUGH_MIN_AMOUNT = 3_000;
// The outflow can be a little less than what arrived (a small cut kept, or a fee taken
// elsewhere) but never more — you can't forward money you never received.
const PASS_THROUGH_LOWER_BAND = 0.9;
const PASS_THROUGH_UPPER_BAND = 1.01;

// Categories with a specific, strong meaning of their own — a generic amount-and-timing
// match is never enough to override these.
const PASS_THROUGH_EXCLUDED: readonly Category[] = [
  "Cash", "Banking fees", "Savings", "Investments", "Loans", "Refunds", "Reimbursements", "Transfers", "Betting", "Income",
];

const isTransferLike = (t: NormalizedTransaction) => isTransferRail(t.paymentMethod) || t.paymentMethod === null || t.paymentMethod === "mobile";
const keyOf = (t: NormalizedTransaction) => extractRecipientKey(t.rawDescription, t.merchant);
const labelOf = (t: NormalizedTransaction) => t.merchant ?? keyOf(t)?.replace(/^(phone|acct|name|desc):/, "") ?? "someone";

/**
 * Detects money that only passed through: a transfer arrives, and within a few days a
 * near-identical amount leaves again to a DIFFERENT person. This is the common "so-and-so
 * sent me money to forward to someone else" pattern — the money was never really the
 * account holder's, so it should count as neither income nor spending, however the outflow's
 * own remark happens to read (e.g. "school fees" or "rent" for someone else's obligation,
 * not theirs). The structural match (amount + short window + a different recipient than the
 * sender) is decisive enough to override even a confident keyword-based category on the
 * outflow, the same way a matched reversal overrides one.
 */
export function linkPassThroughs(transactions: NormalizedTransaction[]): NormalizedTransaction[] {
  const claimed = new Set<string>();
  const updates = new Map<string, Partial<NormalizedTransaction>>();

  const inflowCandidates = transactions
    .filter((t) => t.direction === "in" && t.category === "Uncertain" && t.amount >= PASS_THROUGH_MIN_AMOUNT && isTransferLike(t))
    .sort((a, b) => a.date.localeCompare(b.date));

  const outflowPool = transactions.filter(
    (t) =>
      t.direction === "out" &&
      t.amount >= PASS_THROUGH_MIN_AMOUNT * PASS_THROUGH_LOWER_BAND &&
      !PASS_THROUGH_EXCLUDED.includes(t.category) &&
      t.subtype !== "own_account" &&
      isTransferLike(t)
  );

  for (const inflow of inflowCandidates) {
    if (claimed.has(inflow.id)) continue;
    const senderKey = keyOf(inflow);

    const candidates = outflowPool.filter((t) => {
      if (claimed.has(t.id) || t.id === inflow.id) return false;
      if (t.date < inflow.date || daysBetween(inflow.date, t.date) > PASS_THROUGH_WINDOW_DAYS) return false;
      if (t.amount > inflow.amount * PASS_THROUGH_UPPER_BAND || t.amount < inflow.amount * PASS_THROUGH_LOWER_BAND) return false;
      const recipientKey = keyOf(t);
      // A different person than who sent it in — a bounce back to the same sender isn't forwarding.
      return !(senderKey && recipientKey && senderKey === recipientKey);
    });
    if (candidates.length === 0) continue;

    candidates.sort((a, b) => {
      const da = Math.abs(a.amount - inflow.amount);
      const db = Math.abs(b.amount - inflow.amount);
      if (da !== db) return da - db;
      return daysBetween(inflow.date, a.date) - daysBetween(inflow.date, b.date);
    });
    const outflow = candidates[0];

    claimed.add(inflow.id);
    claimed.add(outflow.id);

    const gapDays = daysBetween(inflow.date, outflow.date);
    const gapNote = gapDays === 0 ? "the same day" : `${Math.round(gapDays)} day${gapDays === 1 ? "" : "s"} later`;
    const senderLabel = labelOf(inflow);
    const recipientLabel = labelOf(outflow);

    updates.set(inflow.id, {
      category: "Transfers",
      categoryConfidence: 0.75,
      categoryReason: `a near-identical amount left for ${recipientLabel} ${gapNote} — looks like this passed through your account rather than being yours to spend or count as income`,
      subtype: "pass_through",
      relatedTransactionId: outflow.id,
    });
    updates.set(outflow.id, {
      category: "Transfers",
      categoryConfidence: 0.75,
      categoryReason: `sends on a ₦${Math.round(inflow.amount).toLocaleString()} transfer that arrived from ${senderLabel} ${gapNote} — looks like you were forwarding this rather than spending your own money`,
      subtype: "pass_through",
      relatedTransactionId: inflow.id,
    });
  }

  if (updates.size === 0) return transactions;
  return transactions.map((t) => {
    const u = updates.get(t.id);
    return u ? { ...t, ...u } : t;
  });
}
