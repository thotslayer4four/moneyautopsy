import { z } from "zod";
import type { MoneyPlan, PlanChange, PlanNarrative, UserProfile } from "@/lib/types";
import { describeProfileForLlm } from "@/lib/profile/context";
import { callStructured } from "@/lib/llm/structured";
import { isGrounded } from "@/lib/llm/grounding";
import { computePlanView } from "./allocate";

/**
 * The model's job here is judgement and voice: which changes matter most to THIS person, and
 * how to say them. It never produces a number. It is handed finished figures, and anything it
 * writes containing an amount that isn't one of them is thrown away in favour of the
 * deterministic wording the plan already has.
 */

const MAX_TEXT_LENGTH = 320;
const DEFAULT_SHOWN = 3;
/** Placeholders the plan fills in from the chosen options, so wording never goes stale. */
const ALLOWED_TOKENS = new Set(["{goals}", "{goalsPercent}"]);

const narrativeSchema = z.object({
  intro: z.string().optional(),
  priority: z.array(z.string()).optional(),
  texts: z.array(z.object({ key: z.string(), text: z.string() })),
});

const NARRATIVE_JSON_SCHEMA = {
  type: "object",
  properties: {
    intro: { type: "string", description: "One or two sentences on what this plan is built around, for this person." },
    priority: {
      type: "array",
      items: { type: "string" },
      description: "Change ids, most relevant to this person first. Leave out any that don't matter to them.",
    },
    texts: {
      type: "array",
      items: {
        type: "object",
        properties: { key: { type: "string" }, text: { type: "string" } },
        required: ["key", "text"],
      },
    },
  },
  required: ["texts"],
} as const;

const SYSTEM_PROMPT = `You write the wording for a personalized "Money Plan" inside Money Autopsy, a Nigerian-first product
that has just shown someone what actually happened to their money. You are NOT the calculator. Every number
in the plan was computed by code. You choose what matters and say it well.

You will get: userContext (what they told us — context, never evidence), the plan's figures, and a list of
"slots": pieces of wording, each with a key and the current default text. Rewrite the slots that you can make
better for this person and return them as {key, text}. Skip a slot if the default is already right.

HARD RULES
1. Never write a number the plan didn't give you. Every ₦ amount must appear, exactly, in the figures or
   the slot's current text. Never calculate, sum, convert, annualise or round anything yourself.
2. Keep placeholders exactly as written: {goals} and {goalsPercent}. Never replace them with a number.
3. SWAP, DON'T STOP. Never tell someone to stop spending on something. Preserve their lifestyle. Prefer
   "eat at home twice more a week", "set an allowance", "buy one bigger plan" over "cut", "stop", "quit".
4. Helping people, lending and family support are part of their real life. Give them a limit of their own;
   never treat them as a failure. Betting is theirs to decide: describe what it cost, never tell them to quit.
5. Never shame, moralise or mock. Borrowing is not a character flaw. No "you should", no scolding.
6. Savings and outcomes are possibilities, never promises. "could", "would", "if the pattern stayed similar".
7. Gender is context only and must never shape the wording.
8. Do not give regulated financial, tax or legal advice. No product or investment recommendations.
9. Keep it short: rule, reset and proposal slots are one sentence (under 130 characters); "why" is at most two.
   Sentence case, plain language, warm and direct. Format naira as ₦42,600.
10. Choose "priority" by what fits their goal, their stated worry, and their life — not only by size.

Return your answer only by calling the provided tool.`;

export function planSlots(plan: MoneyPlan): { key: string; note: string; text: string }[] {
  const slots: { key: string; note: string; text: string }[] = [];
  for (const c of plan.changes) {
    slots.push({ key: `change.${c.id}.proposal`, note: `the swap to suggest for ${c.label}`, text: c.proposal });
    slots.push({ key: `change.${c.id}.why`, note: `why ${c.label} matters for this person`, text: c.why });
    slots.push({ key: `change.${c.id}.rule`, note: `a standing rule for ${c.label}`, text: c.rule });
    slots.push({ key: `change.${c.id}.reset`, note: `a 30-day action for ${c.label}`, text: c.reset });
  }
  slots.push({ key: "rule.payday", note: "the rule about moving money toward the goal when income lands", text: plan.paydayRule });
  slots.push({ key: "reset.payday", note: "the 30-day action for the same", text: plan.paydayReset });
  for (const r of plan.extraRules) slots.push({ key: `rule.${r.id}`, note: "a standing rule", text: r.text });
  return slots;
}

function figuresFor(plan: MoneyPlan) {
  const view = computePlanView(plan, plan.defaultSelected);
  return {
    income: plan.income,
    baseline: plan.baseline,
    goal: plan.goalLabel,
    plannedMonth: Object.fromEntries(view.allocations.map((a) => [a.bucket, { amount: a.amount, percent: a.percent }])),
    changes: plan.changes.map((c) => ({
      id: c.id,
      label: c.label,
      nature: c.nature,
      optional: c.optional,
      monthlyNow: c.monthlyNow,
      monthlyTarget: c.monthlyTarget,
      monthlySaving: c.monthlySaving,
      fact: c.fact,
      stats: c.stats.length ? c.stats : undefined,
    })),
  };
}

export function buildNarrativePrompt(profile: UserProfile, plan: MoneyPlan): string {
  const { gender: _gender, ...context } = describeProfileForLlm(profile);
  void _gender;
  const payload = { userContext: context, figures: figuresFor(plan), slots: planSlots(plan) };
  return `Here is this person's plan. Use only what's here.\n\n${JSON.stringify(payload, (_k, v) => (v === null ? undefined : v))}`;
}

/** The best-effort model call. Returns null when there's no model configured or it fails. */
export async function generatePlanNarrative(profile: UserProfile, plan: MoneyPlan): Promise<PlanNarrative | null> {
  if (plan.changes.length === 0 && plan.extraRules.length === 0) return null;
  try {
    const result = await callStructured({
      system: SYSTEM_PROMPT,
      user: buildNarrativePrompt(profile, plan),
      toolName: "submit_money_plan_wording",
      toolDescription: "Submit the wording for the Money Plan.",
      jsonSchema: NARRATIVE_JSON_SCHEMA,
      schema: narrativeSchema,
    });
    if (!result) return null;
    return {
      intro: result.intro,
      priority: result.priority,
      texts: Object.fromEntries(result.texts.map((t) => [t.key, t.text])),
    };
  } catch (err) {
    console.error("LLM plan wording failed, using the deterministic wording:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------

function collectNumbers(value: unknown, into: Set<number>) {
  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) >= 1) into.add(Math.round(Math.abs(value)));
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, into));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectNumbers(v, into));
}

/** Every amount the plan itself holds, plus the yearly version of each saving. */
function suppliedNumbers(plan: MoneyPlan): number[] {
  const numbers = new Set<number>();
  collectNumbers(plan, numbers);
  collectNumbers(computePlanView(plan, plan.defaultSelected).allocations, numbers);
  for (const c of plan.changes) numbers.add(c.monthlySaving * 12);
  // The wording the model was given is also fair game: it contains figures like a weekly cap.
  for (const slot of planSlots(plan)) for (const m of slot.text.matchAll(/₦([\d,]+)/g)) numbers.add(Number(m[1].replace(/,/g, "")));
  for (const c of plan.changes) for (const m of c.fact.matchAll(/₦([\d,]+)/g)) numbers.add(Number(m[1].replace(/,/g, "")));
  return Array.from(numbers);
}

function acceptable(text: unknown, supplied: number[]): text is string {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) return false;
  const tokens = trimmed.match(/\{[^}]*\}/g) ?? [];
  if (tokens.some((t) => !ALLOWED_TOKENS.has(t))) return false;
  return isGrounded(trimmed, supplied);
}

/**
 * Lays the model's wording over the plan, slot by slot, keeping only what passes: known
 * slots, no stray placeholders, and no amount the plan didn't supply. Everything else stays
 * as the deterministic default. Safe to call again whenever the numbers change.
 */
export function applyNarrative(plan: MoneyPlan, narrative: PlanNarrative | null | undefined): MoneyPlan {
  if (!narrative) return plan;
  const supplied = suppliedNumbers(plan);
  const pick = (key: string, fallback: string) => {
    const text = narrative.texts[key];
    return acceptable(text, supplied) ? text.trim() : fallback;
  };

  const changes: PlanChange[] = plan.changes.map((c) => ({
    ...c,
    proposal: pick(`change.${c.id}.proposal`, c.proposal),
    why: pick(`change.${c.id}.why`, c.why),
    rule: pick(`change.${c.id}.rule`, c.rule),
    reset: pick(`change.${c.id}.reset`, c.reset),
  }));

  // Relevance order from the model, when it names real changes; the rest keep their order.
  const known = new Set(changes.map((c) => c.id));
  const preferred = [...new Set((narrative.priority ?? []).filter((id) => known.has(id)))];
  const rank = new Map(preferred.map((id, i) => [id, i]));
  const ordered = preferred.length
    ? [...changes].sort((a, b) => Number(a.optional) - Number(b.optional) || (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99))
    : changes;
  // Rank ties (both unnamed) fall back to the original order because sort is stable.

  const intro = acceptable(narrative.intro, supplied) ? narrative.intro!.trim() : plan.intro;
  const defaultSelected = ordered.filter((c) => !c.optional).slice(0, DEFAULT_SHOWN).map((c) => c.id);
  const scenarioIds = ordered.filter((c) => c.scenario && !c.optional).slice(0, plan.scenarioIds.length || 2).map((c) => c.id);

  return {
    ...plan,
    changes: ordered,
    defaultSelected,
    scenarioIds,
    intro,
    paydayRule: pick("rule.payday", plan.paydayRule),
    paydayReset: pick("reset.payday", plan.paydayReset),
    extraRules: plan.extraRules.map((r) => ({ ...r, text: pick(`rule.${r.id}`, r.text) })),
  };
}
