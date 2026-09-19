import { NextResponse } from "next/server";
import { getSession, updateSessionReport } from "@/lib/session";
import { computeFinancialAnalysis } from "@/lib/analysis";
import { generateInsights } from "@/lib/llm";
import { computeIncomeCheck, generateMoneyPlan } from "@/lib/plan";
import { buildReport, shapeForStatus } from "@/lib/report";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Re-writes the findings, belief comparison, personality, recommendations and money plan from the
 * current (possibly user-corrected) transactions. Recategorizing updates the deterministic
 * numbers instantly; this catches the narrative up so the whole autopsy — not just the
 * totals — reflects what the person told us. Like recategorizing, it's unlocked-only.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Report not found or has expired." }, { status: 404 });
  }
  if (session.status !== "unlocked") {
    return NextResponse.json({ error: "Unlock the full autopsy first." }, { status: 403 });
  }

  const analysis = computeFinancialAnalysis(session.transactions, session.profile);
  const [insights, { plan: moneyPlan, narrative }] = await Promise.all([
    generateInsights(session.profile, analysis),
    generateMoneyPlan(session.transactions, session.profile, analysis),
  ]);
  const rebuilt = buildReport(analysis, insights, moneyPlan, computeIncomeCheck(session.transactions, session.profile, analysis));
  rebuilt.id = id;

  const updated = updateSessionReport(id, session.transactions, rebuilt, insights, narrative);
  if (!updated) {
    return NextResponse.json({ error: "Could not refresh the report." }, { status: 500 });
  }
  return NextResponse.json({ report: shapeForStatus(updated.report, updated.status) });
}
