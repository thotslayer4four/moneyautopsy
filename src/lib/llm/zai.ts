import type { FinancialAnalysis, LLMInsights, UserProfile } from "@/lib/types";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { LLM_TOOL_JSON_SCHEMA, llmInsightsSchema } from "./schema";

const TOOL_NAME = "submit_money_autopsy";
const DEFAULT_MODEL = "glm-4.6v-flash";
const ZAI_BASE_URL = "https://api.z.ai/api/paas/v4/chat/completions";

interface ZaiToolCall {
  function: { name: string; arguments: string };
}
interface ZaiResponse {
  choices?: { message?: { tool_calls?: ZaiToolCall[]; content?: string } }[];
  error?: { message?: string };
}

/**
 * Z.AI (Zhipu) GLM models via their OpenAI-compatible chat completions API. Structured
 * output is forced the same way as the Anthropic client — the model must call a single
 * tool matching our schema — so the rest of the pipeline is provider-agnostic.
 */
export async function callZaiForInsights(profile: UserProfile, analysis: FinancialAnalysis): Promise<LLMInsights> {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) throw new Error("ZAI_API_KEY is not set");

  const model = process.env.ZAI_MODEL || DEFAULT_MODEL;

  const res = await fetch(ZAI_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(profile, analysis) },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: TOOL_NAME,
            description: "Submit the structured Money Autopsy analysis.",
            parameters: LLM_TOOL_JSON_SCHEMA,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: TOOL_NAME } },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Z.AI request failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as ZaiResponse;
  if (json.error) throw new Error(`Z.AI error: ${json.error.message ?? "unknown error"}`);

  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("Z.AI did not return a structured tool call");

  const parsedArgs = JSON.parse(toolCall.function.arguments);
  return llmInsightsSchema.parse(parsedArgs);
}
