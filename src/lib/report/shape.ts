import type { ClientReport, Report, ReportStatus } from "@/lib/types";
import { topKnownCategory } from "@/lib/analysis/helpers";

/**
 * The paywall lives here, not in the LLM and not on the client: given the full report and
 * the session's current status, decide exactly what gets sent over the wire. A free-status
 * request never receives the real numbers behind locked findings — the client can only
 * render a blurred placeholder because that's all it has.
 */
export function shapeForStatus(report: Report, status: ReportStatus): ClientReport {
  if (status === "unlocked") {
    return { ...report, status: "unlocked" };
  }

  return {
    id: report.id,
    status: "free",
    overview: {
      totalInflow: report.overview.totalInflow,
      totalOutflow: report.overview.totalOutflow,
      netCashFlow: report.overview.netCashFlow,
      transactionCount: report.overview.transactionCount,
      periodStart: report.overview.periodStart,
      periodEnd: report.overview.periodEnd,
    },
    teaserBullets: report.teaserBullets,
    freeFinding: report.freeFinding,
    moneyPersonality: report.moneyPersonality,
    lockedFindingsCount: report.lockedFindings.length,
    lockedFindingTitles: report.lockedFindings.map((f) => ({ id: f.id, title: f.title, category: f.category })),
    userBeliefComparisonLocked: true,
    categoryBreakdownLocked: true,
    topCategoryName: topKnownCategory(report.categoryBreakdown)?.category ?? null,
  };
}
