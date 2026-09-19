import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSessionReport } from "@/lib/session";
import { computeFinancialAnalysis } from "@/lib/analysis";
import { answerFollowerIds } from "@/lib/analysis/helpers";
import { assembleMoneyPlan, computeIncomeCheck } from "@/lib/plan";
import { buildReport, shapeForStatus } from "@/lib/report";
import { deriveType } from "@/lib/categorization";
import { INFLOW_EDITABLE_CATEGORIES, OUTFLOW_EDITABLE_CATEGORIES } from "@/lib/categorization/categories";
import type { Category, NormalizedTransaction, TransactionDirection } from "@/lib/types";

function subtypeFor(category: Category, direction: TransactionDirection): string | null {
  if (category === "Betting") return direction === "in" ? "withdrawal" : "deposit";
  if (category === "Loans") return direction === "in" ? "borrowed" : "lent";
  return null;
}

/**
 * Lets someone say what one specific transaction was — ground truth beats any inference.
 * Only available once the report is unlocked: the numbers this recomputes (category
 * breakdown, overview) are exactly what's paywalled, so a free-status session shouldn't be
 * able to reveal them through this side door.
 *
 * The answer applies to that transaction. Other unexplained transactions with the same
 * strong recipient identity (phone/account number or full name) follow it at lower
 * confidence — they are never locked in, and only fill in what was otherwise unexplained.
 * The LLM narrative is refreshed separately (see the refresh route), so this stays fast.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Report not found or has expired." }, { status: 404 });
  }
  if (session.status !== "unlocked") {
    return NextResponse.json({ error: "Unlock the full autopsy first." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const transactionId = typeof body?.transactionId === "string" ? body.transactionId : null;
  const category = body?.category as Category | undefined;

  const target = session.transactions.find((t) => t.id === transactionId);
  if (!target || !category) {
    return NextResponse.json({ error: "transactionId and a category are required." }, { status: 400 });
  }
  const direction: TransactionDirection = target.direction;
  const allowed = direction === "in" ? INFLOW_EDITABLE_CATEGORIES : OUTFLOW_EDITABLE_CATEGORIES;
  if (!allowed.includes(category)) {
    return NextResponse.json({ error: "That category isn't valid for this kind of transaction." }, { status: 400 });
  }

  const followerIds = new Set(answerFollowerIds(session.transactions, target));
  const followsAnswer = (t: NormalizedTransaction) => followerIds.has(t.id);

  let followers = 0;
  const updatedTransactions = session.transactions.map((tx) => {
    const isTarget = tx.id === target.id;
    if (!isTarget && !followsAnswer(tx)) return tx;
    if (!isTarget) followers++;
    const relabelled = {
      ...tx,
      category,
      categoryConfidence: isTarget ? 1 : 0.7,
      categoryReason: isTarget
        ? direction === "in"
          ? "you told us what this money was"
          : "you told us what this payment was for"
        : "you identified another transaction with this same recipient",
      subtype: subtypeFor(category, direction),
      relatedTransactionId: null,
    };
    return { ...relabelled, type: deriveType(relabelled) };
  });

  const analysis = computeFinancialAnalysis(updatedTransactions, session.profile);
  // The plan's numbers follow the correction at once; its wording is re-checked against them
  // and only kept where it still holds (a full rewrite waits for the refresh).
  const moneyPlan = assembleMoneyPlan(updatedTransactions, session.profile, analysis, session.planNarrative);
  const rebuilt = buildReport(analysis, session.insights, moneyPlan, computeIncomeCheck(updatedTransactions, session.profile, analysis));
  rebuilt.id = id;

  const updated = updateSessionReport(id, updatedTransactions, rebuilt);
  if (!updated) {
    return NextResponse.json({ error: "Could not save the correction." }, { status: 500 });
  }

  return NextResponse.json({ report: shapeForStatus(updated.report, updated.status), followers });
}
