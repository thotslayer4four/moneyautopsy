import type { NormalizedTransaction } from "@/lib/types";
import { daysBetween } from "@/lib/analysis/helpers";
import { isTransferRail } from "./channels";
import { CATEGORY_KIND } from "./categories";

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
