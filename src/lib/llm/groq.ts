import type { FinancialAnalysis, LLMInsights, UserProfile } from "@/lib/types";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { LLM_TOOL_JSON_SCHEMA, llmInsightsSchema } from "./schema";

const TOOL_NAME = "submit_money_autopsy";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_RETRY_WAIT_SECONDS = 25;

interface GroqToolCall {
  function: { name: string; arguments: string };
}
interface GroqResponse {
  choices?: { message?: { tool_calls?: GroqToolCall[]; content?: string } }[];
  error?: { message?: string };
}

/**
 * Groq's OpenAI-compatible chat completions API. Same forced-tool-call approach as the
 * Anthropic and Z.AI clients, so the rest of the pipeline never knows which provider ran.
 */
export async function callGroqForInsights(profile: UserProfile, analysis: FinancialAnalysis): Promise<LLMInsights> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");

  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;

  const request = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: 8192,
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
  };

  let res = await fetch(GROQ_BASE_URL, request);

  // Groq's on-demand tier limits tokens per minute; the error says how long to wait. One
  // short wait-and-retry beats silently downgrading a paying customer's report.
  if (res.status === 429) {
    const body = await res.text().catch(() => "");
    const waitSeconds = Number(body.match(/try again in ([\d.]+)s/i)?.[1]);
    if (Number.isFinite(waitSeconds) && waitSeconds <= MAX_RETRY_WAIT_SECONDS) {
      await new Promise((resolve) => setTimeout(resolve, Math.ceil(waitSeconds * 1000) + 500));
      res = await fetch(GROQ_BASE_URL, request);
    } else {
      throw new Error(`Groq request failed: 429 ${body}`);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq request failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as GroqResponse;
  if (json.error) throw new Error(`Groq error: ${json.error.message ?? "unknown error"}`);

  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("Groq did not return a structured tool call");

  const parsedArgs = JSON.parse(toolCall.function.arguments);
  return llmInsightsSchema.parse(parsedArgs);
}
