import type { CategoryBreakdownEntry, NormalizedTransaction, TopCounterparty } from "@/lib/types";
import { extractRecipientKey } from "@/lib/categorization/recipientKey";
import { CATEGORY_KIND } from "@/lib/categorization/categories";

export function isOutflow(tx: NormalizedTransaction): boolean {
  return tx.direction === "out";
}

export function isInflow(tx: NormalizedTransaction): boolean {
  return tx.direction === "in";
}

/**
 * Outflow that plausibly reflects behavior — spending, giving to people, or unexplained —
 * as opposed to money merely moved (savings, investments, loans, transfers between own
 * accounts, reimbursements, reversed payments). Patterns like "most expensive day" or
 * "weekend spending" are computed over this; otherwise a single ₦700k move into a savings
 * pocket would masquerade as the biggest spending day.
 */
export function isSpendLike(tx: NormalizedTransaction): boolean {
  if (tx.direction !== "out") return false;
  const kind = CATEGORY_KIND[tx.category];
  return kind === "spend" || kind === "support" || kind === "uncertain";
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const MAX_SAMPLES = 3;

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function dayOfWeek(dateIso: string): (typeof DAY_NAMES)[number] {
  const d = new Date(dateIso + "T00:00:00Z");
  return DAY_NAMES[d.getUTCDay()];
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.abs(db - da) / (1000 * 60 * 60 * 24);
}

export function dayOfMonth(dateIso: string): number {
  return new Date(dateIso + "T00:00:00Z").getUTCDate();
}

export function sortByDate(transactions: NormalizedTransaction[]): NormalizedTransaction[] {
  return [...transactions].sort((a, b) => a.date.localeCompare(b.date));
}

export function periodInMonths(periodStart: string | null, periodEnd: string | null): number {
  if (!periodStart || !periodEnd) return 1;
  const days = daysBetween(periodStart, periodEnd);
  return Math.max(days / 30, 1 / 30);
}

/**
 * "Uncertain" is an honesty signal (money we couldn't confidently trace), not a real
 * spending category like Food or Transport — it should never be presented as someone's
 * "biggest spending category." Callers that want the top *meaningful* category should
 * use this instead of indexing categoryBreakdown[0] directly.
 */
export function topKnownCategory(breakdown: CategoryBreakdownEntry[]): CategoryBreakdownEntry | null {
  return breakdown.find((c) => c.kind === "spend") ?? null;
}

/** Groups outflow transactions by counterparty (recipient/merchant), sorted by total
 * amount descending. Shared by the general "top recipients" list and the Uncertain-only
 * breakdown, which use identical grouping logic over different transaction subsets. */
export function groupByRecipient(
  txs: NormalizedTransaction[],
  limit = 8,
  direction: TopCounterparty["direction"] = "sent"
): TopCounterparty[] {
  const map = new Map<string, { label: string; txs: NormalizedTransaction[] }>();
  for (const tx of txs) {
    const key = extractRecipientKey(tx.rawDescription, tx.merchant) ?? `desc:${tx.description}`;
    const label = tx.merchant ?? key.replace(/^(phone|acct|name|desc):/, "");
    const entry = map.get(key) ?? { label, txs: [] };
    entry.txs.push(tx);
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .map(([key, { label, txs: group }]) => {
      const dates = group.map((t) => t.date).sort();
      const samples = [...group]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, MAX_SAMPLES)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((t) => ({ date: t.date, amount: Math.round(t.amount), description: t.description }));
      return {
        key,
        name: label,
        totalAmount: Math.round(group.reduce((s, t) => s + t.amount, 0)),
        transactionCount: group.length,
        direction,
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
        samples,
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, limit);
}

/** Finds the recipientKey for a transaction, matching how groupByRecipient derives it —
 * used to apply a user's category correction back to every transaction from that group. */
export function recipientKeyFor(tx: NormalizedTransaction): string {
  return extractRecipientKey(tx.rawDescription, tx.merchant) ?? `desc:${tx.description}`;
}

/** Whether the person told us what this was — an answer we never re-ask and never override. */
export function isUserAnswered(tx: NormalizedTransaction): boolean {
  return tx.categoryReason.startsWith("you ");
}

/**
 * Which other transactions follow when someone answers a question about `target`: those
 * with the same strong sender/recipient identity that were still unexplained. Credits that
 * we had guessed were gifts or "other" also follow, when that is what `target` was — so one
 * answer settles a sender instead of asking about each credit. Answers already given are never touched.
 * One definition, used by the answer itself and by the preview of what an answer would do.
 */
export function answerFollowerIds(transactions: NormalizedTransaction[], target: NormalizedTransaction): string[] {
  const key = recipientKeyFor(target);
  if (!isStrongRecipientKey(key)) return [];
  const widen = target.direction === "in" && (target.category === "Gifts & support" || target.category === "Other");
  return transactions
    .filter(
      (t) =>
        t.id !== target.id &&
        t.direction === target.direction &&
        !isUserAnswered(t) &&
        (t.category === "Uncertain" || (widen && t.category === target.category)) &&
        recipientKeyFor(t) === key
    )
    .map((t) => t.id);
}

/** A recipient identity solid enough to carry one answer over to their other transactions:
 * a phone/account number, or a full (multi-word) personal name. Merchant-ish or one-word
 * keys are not — they can stand for many unrelated things. */
export function isStrongRecipientKey(key: string): boolean {
  if (key.startsWith("phone:") || key.startsWith("acct:")) return true;
  if (key.startsWith("name:")) return key.slice(5).trim().split(/\s+/).length >= 2 && !/\b(pos|transfer|mobile|payment)\b/.test(key);
  return false;
}

// Ask only about what matters. The aim is to resolve most of the unexplained money with the
// fewest questions, not to interrogate.
const COVERAGE_TARGET = 0.65; // stop once questions would explain this much of the unexplained money
const MAX_QUESTIONS = 5; // per direction
const MIN_QUESTION_AMOUNT = 2_000; // never worth a person's time below this
const MIN_UNEXPLAINED_SHARE = 0.1; // below this share of the side's total, don't ask at all
const FLOOR_SHARE = 0.15; // above this share, always ask at least MIN_QUESTIONS
const MIN_QUESTIONS = 3;
const MAX_IMPACT_QUESTIONS = 2;
const INCOME_IMPACT_SHARE = 0.2; // an incoming sender this big vs earned income can redefine "income"

export interface QuestionContext {
  /** Total money moved on this side (out or in) — what "unexplained" is a share of. */
  sideTotal: number;
  earnedIncome: number;
  /** Gap between the biggest and second-biggest real spending categories: any unexplained
   * group larger than this could change which one is "your biggest leak". */
  topCategoryGap: number | null;
  /** Gap between what they said they overspend on and what the data shows. */
  beliefGap: number | null;
}

/**
 * Chooses which unexplained transactions are worth asking about.
 *  - Materiality is judged on the RECIPIENT's total (twenty ₦5k transfers to one person is a
 *    ₦100k question), but each question is still one specific transaction, never a merge.
 *  - Impact first: groups whose answer could flip a headline (top category, the belief
 *    comparison, or how much money in counts as income) are asked before the merely large.
 *  - Then by size and unusualness until the questions cover most of the unexplained money.
 *  - If unexplained money is a small share of the side, nothing is asked. If it's a large
 *    share, at least a few are, so the section is never empty when it matters.
 */
export function pickQuestions(
  uncertainTx: NormalizedTransaction[],
  direction: "in" | "out",
  ctx: QuestionContext
): {
  questions: import("@/lib/types").UncertainQuestion[];
  notAsked: { count: number; total: number };
  coverage: number;
} {
  const unexplained = uncertainTx.reduce((s, t) => s + t.amount, 0);
  const none = { questions: [], notAsked: { count: uncertainTx.length, total: Math.round(unexplained) }, coverage: 0 };
  if (uncertainTx.length === 0 || ctx.sideTotal <= 0) return none;
  const share = unexplained / ctx.sideTotal;
  if (share < MIN_UNEXPLAINED_SHARE) return none;

  const groups = new Map<string, NormalizedTransaction[]>();
  for (const tx of uncertainTx) {
    const key = recipientKeyFor(tx);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }
  const amounts = uncertainTx.map((t) => t.amount).sort((a, b) => a - b);
  const typical = amounts[Math.floor(amounts.length / 2)] ?? 0;

  interface Candidate {
    key: string;
    biggest: NormalizedTransaction;
    strong: boolean;
    groupTotal: number;
    resolves: number; // what answering would settle: the whole group if it follows, else one payment
    score: number;
    impact: string | null;
  }

  const candidates: Candidate[] = Array.from(groups.entries())
    .map(([key, group]) => {
      const biggest = [...group].sort((a, b) => b.amount - a.amount)[0];
      const strong = isStrongRecipientKey(key);
      const groupTotal = group.reduce((s, t) => s + t.amount, 0);
      const regularity = group.length === 1 ? 1 : group.length <= 3 ? 0.85 : 0.6;
      const outlier = typical > 0 && biggest.amount > typical * 2 ? 1.25 : 1;

      let impact: string | null = null;
      if (direction === "out") {
        if (ctx.topCategoryGap !== null && groupTotal > ctx.topCategoryGap) impact = "Could change which category is your biggest";
        else if (ctx.beliefGap !== null && groupTotal > ctx.beliefGap) impact = "Could change how your belief about your spending holds up";
      } else if (ctx.earnedIncome > 0 ? groupTotal >= ctx.earnedIncome * INCOME_IMPACT_SHARE : groupTotal / ctx.sideTotal >= 0.15) {
        impact = "Could change how much of your money in counts as income";
      }
      return { key, biggest, strong, groupTotal, resolves: strong ? groupTotal : biggest.amount, score: groupTotal * regularity * outlier, impact };
    })
    .filter((c) => c.biggest.amount >= MIN_QUESTION_AMOUNT)
    .sort((a, b) => b.score - a.score);

  const chosen: Candidate[] = [];
  const take = (c: Candidate) => {
    if (!chosen.includes(c)) chosen.push(c);
  };
  candidates.filter((c) => c.impact).slice(0, MAX_IMPACT_QUESTIONS).forEach(take);

  const covered = () => chosen.reduce((s, c) => s + c.resolves, 0) / unexplained;
  for (const c of candidates) {
    if (chosen.length >= MAX_QUESTIONS || covered() >= COVERAGE_TARGET) break;
    take(c);
  }
  // Big unexplained side, but a few huge items already cover the target: still ask a few.
  for (const c of candidates) {
    if (chosen.length >= Math.min(MIN_QUESTIONS, candidates.length) || share < FLOOR_SHARE) break;
    take(c);
  }

  chosen.sort((a, b) => b.score - a.score);
  const resolvedIds = new Set(chosen.flatMap((c) => (c.strong ? groups.get(c.key)! : [c.biggest]).map((t) => t.id)));
  const rest = uncertainTx.filter((t) => !resolvedIds.has(t.id));

  return {
    questions: chosen.map((c, i) => {
      const pct = Math.round((c.groupTotal / unexplained) * 100);
      return {
        transactionId: c.biggest.id,
        direction,
        name: c.biggest.merchant ?? c.key.replace(/^(phone|acct|name|desc):/, ""),
        date: c.biggest.date,
        amount: Math.round(c.biggest.amount),
        description: c.biggest.description,
        followers: c.strong ? groups.get(c.key)!.length - 1 : 0,
        why: c.impact ?? (i === 0 ? `The biggest unexplained ${direction === "in" ? "sender" : "recipient"} — ${pct}% of what we couldn't explain` : `${pct}% of what we couldn't explain`),
        shareOfUnexplained: pct,
      };
    }),
    notAsked: { count: rest.length, total: Math.round(rest.reduce((s, t) => s + t.amount, 0)) },
    coverage: Math.min(100, Math.round(covered() * 100)),
  };
}
