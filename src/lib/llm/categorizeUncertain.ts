import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Category, NormalizedTransaction, UserProfile } from "@/lib/types";
import { describeProfileForLlm } from "@/lib/profile/context";
import { resolveProvider } from "./provider";

const TOOL_NAME = "submit_categorizations";

// Money going OUT. Deliberately excludes categories the deterministic passes resolve on
// explicit evidence (Cash — only ever an explicit ATM/withdrawal narration — Banking fees,
// Savings, Investments, Betting when brand-matched) so this last-resort pass can't invent them.
const OUT_CATEGORIES = [
  "Food", "Groceries", "Transport", "Shopping", "Bills", "Airtime", "Data", "Housing",
  "Entertainment", "Health", "Education", "Government", "Travel", "Subscriptions", "Gifts & support",
  "Loans", "Reimbursements", "Transfers", "Other", "Uncertain",
] as const;

// Money coming IN. "Income" is intentionally absent: a transfer from a person is never
// assumed to be income by inference — that takes explicit evidence or the person's own word.
const IN_CATEGORIES = ["Gifts & support", "Loans", "Reimbursements", "Refunds", "Transfers", "Other", "Uncertain"] as const;

const ALLOWED_CATEGORIES = Array.from(new Set([...OUT_CATEGORIES, ...IN_CATEGORIES])) as [string, ...string[]];

const MAX_CANDIDATES = 40;
const MIN_CONFIDENCE_OUT = 0.45;
const MIN_CONFIDENCE_IN = 0.65;

const classificationItemSchema = z.object({
  id: z.string(),
  category: z.enum(ALLOWED_CATEGORIES),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
const classificationsSchema = z.object({ classifications: z.array(classificationItemSchema) });
type Classification = z.infer<typeof classificationItemSchema>;

const CATEGORIZATION_TOOL_JSON_SCHEMA = {
  type: "object",
  properties: {
    classifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: ALLOWED_CATEGORIES },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string", description: "Under 15 words, citing what in the description led to this." },
        },
        required: ["id", "category", "confidence", "reason"],
      },
    },
  },
  required: ["classifications"],
} as const;

const SYSTEM_PROMPT = `You are classifying ambiguous Nigerian bank transactions that a deterministic system could not
confidently categorize. For each transaction choose the single best-fit category.

- direction "out" (money leaving): choose from ${OUT_CATEGORIES.join(", ")}.
- direction "in" (money received): choose from ${IN_CATEGORIES.join(", ")}.

Rules:
- Use only the description, amount, payment method and processor given. Never invent information.
- Payment method (nip, transfer, pos, ussd, web, card…) and processor (Paystack, Flutterwave, Remita…) say HOW
  money moved, never what it was for. A processor is never the merchant or the category.
- A POS payment is NEVER a cash withdrawal. If a POS payment has no identifiable merchant, answer Uncertain.
- If the description gives no real signal (just a personal name, no remark), answer "Uncertain" with confidence
  below 0.3. Uncertain is always better than a confidently wrong category.
- A transfer from a person is not income. Only pick Gifts & support / Loans / Reimbursements for incoming
  money if the description itself supports it.
- userContext is background only; it must not override the description. Do not use gender.
- confidence must reflect how sure you genuinely are, not how plausible a story sounds.
- Return every transaction id you were given, exactly once.
Respond only by calling the provided tool.`;

function buildPrompt(transactions: NormalizedTransaction[], profile: UserProfile | null): string {
  const list = transactions.map((t) => ({
    id: t.id,
    direction: t.direction,
    amountNGN: t.amount,
    date: t.date,
    description: t.description,
    paymentMethod: t.paymentMethod,
    paymentProcessor: t.paymentProcessor,
  }));
  let context = "";
  if (profile) {
    const { gender: _gender, ...safe } = describeProfileForLlm(profile);
    void _gender;
    context = `userContext (background only): ${JSON.stringify({
      situation: safe.situation,
      incomeSources: safe.incomeSources,
      peopleTheySupport: safe.peopleTheySupport,
      borrowsMoney: safe.borrowsMoney,
      lendsMoney: safe.lendsMoney,
    })}\n\n`;
  }
  return `${context}Classify these transactions:\n${JSON.stringify(list, null, 2)}`;
}

async function callAnthropic(transactions: NormalizedTransaction[], profile: UserProfile | null): Promise<Classification[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPrompt(transactions, profile) }],
    tools: [
      {
        name: TOOL_NAME,
        description: "Submit the category classification for each transaction.",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input_schema: CATEGORIZATION_TOOL_JSON_SCHEMA as any,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Model did not return a structured tool call");
  return classificationsSchema.parse(toolUse.input).classifications;
}

interface OpenAiCompatibleToolCall {
  function: { name: string; arguments: string };
}
interface OpenAiCompatibleResponse {
  choices?: { message?: { tool_calls?: OpenAiCompatibleToolCall[] } }[];
  error?: { message?: string };
}

async function callOpenAiCompatible(
  label: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  tokenField: "max_tokens" | "max_completion_tokens",
  transactions: NormalizedTransaction[],
  profile: UserProfile | null
): Promise<Classification[]> {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      [tokenField]: 4096,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(transactions, profile) },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: TOOL_NAME,
            description: "Submit the category classification for each transaction.",
            parameters: CATEGORIZATION_TOOL_JSON_SCHEMA,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: TOOL_NAME } },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${label} categorization request failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as OpenAiCompatibleResponse;
  if (json.error) throw new Error(`${label} error: ${json.error.message ?? "unknown error"}`);

  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error(`${label} did not return a structured tool call`);
  return classificationsSchema.parse(JSON.parse(toolCall.function.arguments)).classifications;
}

/**
 * Last tier of the categorization hierarchy: batches whatever is still Uncertain after
 * every deterministic pass (known merchants, keywords, recipient memory, self-transfer
 * detection, recurring-pattern inference) into one LLM call. Capped and best-effort — on
 * any failure (including no provider configured) it returns an empty map and the pipeline
 * just leaves those transactions honestly Uncertain, exactly as before this pass existed.
 */
export async function classifyUncertainTransactions(
  transactions: NormalizedTransaction[],
  profile: UserProfile | null = null
): Promise<Map<string, { category: Category; confidence: number; reason: string }>> {
  const candidates = transactions
    .filter((t) => t.category === "Uncertain" && t.categoryConfidence < 0.5)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, MAX_CANDIDATES);

  if (candidates.length === 0) return new Map();

  const provider = resolveProvider();
  if (provider === "mock") return new Map();

  try {
    let results: Classification[];
    if (provider === "anthropic") {
      results = await callAnthropic(candidates, profile);
    } else if (provider === "groq") {
      results = await callOpenAiCompatible(
        "Groq",
        "https://api.groq.com/openai/v1/chat/completions",
        process.env.GROQ_API_KEY!,
        process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        "max_completion_tokens",
        candidates,
        profile
      );
    } else {
      results = await callOpenAiCompatible(
        "Z.AI",
        "https://api.z.ai/api/paas/v4/chat/completions",
        process.env.ZAI_API_KEY!,
        process.env.ZAI_MODEL || "glm-4.6v-flash",
        "max_tokens",
        candidates,
        profile
      );
    }

    const byId = new Map(candidates.map((t) => [t.id, t]));
    const map = new Map<string, { category: Category; confidence: number; reason: string }>();
    for (const r of results) {
      const tx = byId.get(r.id);
      if (!tx || r.category === "Uncertain") continue;
      const isIn = tx.direction === "in";
      const allowed: readonly string[] = isIn ? IN_CATEGORIES : OUT_CATEGORIES;
      if (!allowed.includes(r.category)) continue;
      if (r.confidence < (isIn ? MIN_CONFIDENCE_IN : MIN_CONFIDENCE_OUT)) continue;
      map.set(r.id, { category: r.category as Category, confidence: r.confidence, reason: r.reason });
    }
    return map;
  } catch (err) {
    console.error(`LLM categorization via ${provider} failed:`, err);
    return new Map();
  }
}
