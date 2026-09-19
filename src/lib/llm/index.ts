import type { FinancialAnalysis, LLMInsights, UserProfile } from "@/lib/types";
import { callAnthropicForInsights } from "./client";
import { callZaiForInsights } from "./zai";
import { callGroqForInsights } from "./groq";
import { generateMockInsights } from "./mock";
import { resolveProvider, type LLMProviderId } from "./provider";
import { groundInsights } from "./grounding";

const PROVIDER_CALLS: Record<Exclude<LLMProviderId, "mock">, typeof callAnthropicForInsights> = {
  anthropic: callAnthropicForInsights,
  zai: callZaiForInsights,
  groq: callGroqForInsights,
};

export async function generateInsights(profile: UserProfile, analysis: FinancialAnalysis): Promise<LLMInsights> {
  const provider = resolveProvider();
  if (provider === "mock") return generateMockInsights(profile, analysis);

  try {
    const insights = await PROVIDER_CALLS[provider](profile, analysis);
    return groundInsights(insights, profile, analysis);
  } catch (err) {
    console.error(`LLM insight generation via ${provider} failed, falling back to mock insights:`, err);
    return generateMockInsights(profile, analysis);
  }
}

export { generateMockInsights };
export { resolveProvider } from "./provider";
