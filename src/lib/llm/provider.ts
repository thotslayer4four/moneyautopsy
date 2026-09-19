export type LLMProviderId = "anthropic" | "zai" | "groq" | "mock";
const PROVIDER_IDS: LLMProviderId[] = ["anthropic", "zai", "groq", "mock"];

/**
 * Which provider actually answers is an environment decision, never something baked into
 * the pipeline: set LLM_PROVIDER explicitly, or let it fall back to whichever API key is
 * configured. Shared by both insight generation and the smaller categorization calls so
 * they always agree on which provider is active.
 */
export function resolveProvider(): LLMProviderId {
  const configured = process.env.LLM_PROVIDER;
  if (PROVIDER_IDS.includes(configured as LLMProviderId)) return configured as LLMProviderId;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.ZAI_API_KEY) return "zai";
  return "mock";
}
