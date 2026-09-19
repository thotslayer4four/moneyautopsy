import type { ExtractionResult } from "@/lib/types";

const MIN_USABLE_TRANSACTIONS = 3;
const BALANCE_TOLERANCE = 1; // naira, to absorb rounding

/**
 * Runs sanity checks over an already-extracted set of transactions and decides whether
 * the statement is trustworthy enough to analyze, or should be flagged for review.
 * This never silently "fixes" bad data — it only annotates and, if severe enough,
 * marks the result as needing review.
 */
export function validateExtraction(result: ExtractionResult): ExtractionResult {
  const issues = [...result.issues];
  const { transactions } = result;

  if (transactions.length < MIN_USABLE_TRANSACTIONS) {
    issues.push({
      level: "error",
      message: `Only ${transactions.length} transaction(s) found — too few for a reliable analysis.`,
    });
  }

  // Duplicate detection: identical date + amount + description appearing more than twice
  // is worth flagging (could be genuine repeats, could be a parsing artifact).
  const seen = new Map<string, number>();
  for (const tx of transactions) {
    const key = `${tx.date}|${tx.amount}|${tx.description}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const suspiciousDuplicates = Array.from(seen.values()).filter((count) => count > 3).length;
  if (suspiciousDuplicates > 0) {
    issues.push({
      level: "info",
      message: `${suspiciousDuplicates} transaction pattern(s) repeat more than 3 times — worth a manual glance.`,
    });
  }

  // Balance plausibility: where consecutive known balances exist, check the delta roughly
  // matches the transaction amount in the expected direction.
  let balanceMismatches = 0;
  let balancePairsChecked = 0;
  const withBalance = transactions.filter((t) => t.balance !== null);
  for (let i = 1; i < withBalance.length; i++) {
    const prev = withBalance[i - 1];
    const curr = withBalance[i];
    if (prev.balance === null || curr.balance === null) continue;
    balancePairsChecked++;
    const expectedDelta = curr.direction === "in" ? curr.amount : -curr.amount;
    const actualDelta = curr.balance - prev.balance;
    if (Math.abs(actualDelta - expectedDelta) > Math.max(BALANCE_TOLERANCE, curr.amount * 0.02)) {
      balanceMismatches++;
    }
  }
  if (balancePairsChecked > 0) {
    const mismatchRate = balanceMismatches / balancePairsChecked;
    if (mismatchRate > 0.3) {
      issues.push({
        level: "warning",
        message: `Running balances didn't line up with transaction amounts for ${Math.round(mismatchRate * 100)}% of rows — extraction may be imperfect.`,
      });
    }
  }

  const errorCount = issues.filter((i) => i.level === "error").length;
  const needsReview = result.needsReview || errorCount > 0 || transactions.length < MIN_USABLE_TRANSACTIONS;

  return { ...result, issues, needsReview };
}
