import type { LLMInsights, NormalizedTransaction, PlanNarrative, Report, ReportStatus, UserProfile } from "@/lib/types";

export interface SessionRecord {
  profile: UserProfile;
  report: Report;
  status: ReportStatus;
  createdAt: number;
  /** Kept alongside the report so a recategorization correction can recompute the
   * deterministic numbers without re-running the LLM (which produced `insights`). */
  transactions: NormalizedTransaction[];
  insights: LLMInsights;
  /** The model's wording for the Money Plan, kept so the plan can be rebuilt from corrected
   * numbers without another model call. Null when the plan runs on its deterministic wording. */
  planNarrative: PlanNarrative | null;
}

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — this is a one-time autopsy, not a saved account.

/**
 * Server-side, process-local session store. Holds the real, unmasked report data so the
 * paywall can be enforced server-side (see lib/report/shape.ts) instead of trusting the
 * client. Deliberately not a database: nothing here is meant to outlive the process or be
 * retained longer than necessary, in line with the product's "don't hoard financial data"
 * privacy stance. Swap for Redis/a real store if this needs to survive multiple instances.
 */
const store = new Map<string, SessionRecord>();

function purgeExpired() {
  const now = Date.now();
  for (const [id, record] of store.entries()) {
    if (now - record.createdAt > TTL_MS) store.delete(id);
  }
}

export function createSession(
  report: Report,
  profile: UserProfile,
  transactions: NormalizedTransaction[],
  insights: LLMInsights,
  planNarrative: PlanNarrative | null = null
): void {
  purgeExpired();
  store.set(report.id, { profile, report, status: "free", createdAt: Date.now(), transactions, insights, planNarrative });
}

export function getSession(id: string): SessionRecord | undefined {
  purgeExpired();
  return store.get(id);
}

export function unlockSession(id: string): SessionRecord | undefined {
  const record = store.get(id);
  if (!record) return undefined;
  record.status = "unlocked";
  record.report.status = "unlocked";
  return record;
}

/** Replaces the session's transactions and report (e.g. after a user-corrected
 * category), keeping the same id and status (and the previous insights unless new ones are given). */
export function updateSessionReport(
  id: string,
  transactions: NormalizedTransaction[],
  report: Report,
  insights?: LLMInsights,
  planNarrative?: PlanNarrative | null
): SessionRecord | undefined {
  const record = store.get(id);
  if (!record) return undefined;
  record.transactions = transactions;
  if (insights) record.insights = insights;
  if (planNarrative !== undefined) record.planNarrative = planNarrative;
  record.report = { ...report, status: record.status };
  return record;
}

export function deleteSession(id: string): void {
  store.delete(id);
}
