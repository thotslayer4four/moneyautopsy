import type { FinancialAnalysis, Finding, LLMInsights, Recommendation, UserProfile } from "@/lib/types";
import { generateMockInsights } from "./mock";

/**
 * The model interprets; it never calculates. This is the enforcement: every ₦ amount it
 * writes must be traceable to a number the deterministic engine actually supplied. Anything
 * containing an amount we can't find is dropped rather than shown — an invented figure in a
 * financial report is worse than one missing sentence.
 */

const MIN_FINDINGS = 4;
const AMOUNT_TOLERANCE = 1; // naira — supplied figures are already rounded
const SUFFIX_TOLERANCE = 0.02; // "₦2.2m" for 2,179,917

function collectSuppliedNumbers(analysis: FinancialAnalysis): number[] {
  const numbers = new Set<number>();
  const json = JSON.stringify(analysis);
  for (const m of json.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n) && n >= 1) numbers.add(Math.round(n));
  }
  return Array.from(numbers);
}

function amountsIn(text: string): { value: number; approximate: boolean }[] {
  const found: { value: number; approximate: boolean }[] = [];
  for (const m of text.matchAll(/₦\s?(\d[\d,]*(?:\.\d+)?)([kKmM])?(?![A-Za-z])/g)) {
    const base = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    const suffix = m[2]?.toLowerCase();
    if (suffix === "k") found.push({ value: base * 1_000, approximate: true });
    else if (suffix === "m") found.push({ value: base * 1_000_000, approximate: true });
    else found.push({ value: base, approximate: false });
  }
  return found;
}

export function isGrounded(text: string, supplied: number[]): boolean {
  return amountsIn(text).every(({ value, approximate }) =>
    supplied.some((s) =>
      approximate ? Math.abs(s - value) <= value * SUFFIX_TOLERANCE : Math.abs(s - value) <= AMOUNT_TOLERANCE
    )
  );
}

const findingText = (f: Finding) => [f.title, f.summary, f.detail, ...f.dataPoints].join(" ");
const recommendationText = (r: Recommendation) => `${r.title} ${r.description}`;

export function groundInsights(insights: LLMInsights, profile: UserProfile, analysis: FinancialAnalysis): LLMInsights {
  const supplied = collectSuppliedNumbers(analysis);
  const mock = () => generateMockInsights(profile, analysis);

  const grounded = insights.findings.filter((f) => isGrounded(findingText(f), supplied));
  const dropped = insights.findings.length - grounded.length;
  if (dropped > 0) {
    console.warn(`Dropped ${dropped} LLM finding(s) containing amounts not present in the supplied data.`);
  }

  // If dropping ungrounded findings leaves too few, top up from the deterministic findings
  // (which are built only from supplied numbers) rather than discarding the good ones.
  let findings = grounded;
  if (findings.length < MIN_FINDINGS) {
    const usedCategories = new Set(findings.map((f) => f.category));
    const fillers = mock().findings.filter((f) => !usedCategories.has(f.category));
    findings = [...findings, ...fillers].slice(0, Math.max(MIN_FINDINGS, findings.length));
  }

  let recommendations = insights.recommendations.filter((r) => isGrounded(recommendationText(r), supplied));
  if (recommendations.length === 0) recommendations = mock().recommendations;

  const b = insights.userBeliefComparison;
  const beliefOk = isGrounded(`${b.whatTheyThought} ${b.whatDataShows} ${b.explanation}`, supplied);

  const resetOk = insights.thirtyDayReset.every((step) => isGrounded(step, supplied));

  return {
    ...insights,
    findings,
    recommendations,
    userBeliefComparison: beliefOk ? b : mock().userBeliefComparison,
    thirtyDayReset: resetOk ? insights.thirtyDayReset : mock().thirtyDayReset,
  };
}
