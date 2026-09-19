import Anthropic from "@anthropic-ai/sdk";
import type { FinancialAnalysis, LLMInsights, UserProfile } from "@/lib/types";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { LLM_TOOL_JSON_SCHEMA, llmInsightsSchema } from "./schema";

const TOOL_NAME = "submit_money_autopsy";
const DEFAULT_MODEL = "claude-sonnet-5";

export async function callAnthropicForInsights(
  profile: UserProfile,
  analysis: FinancialAnalysis
): Promise<LLMInsights> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(profile, analysis) }],
    tools: [
      {
        name: TOOL_NAME,
        description: "Submit the structured Money Autopsy analysis.",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input_schema: LLM_TOOL_JSON_SCHEMA as any,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return a structured tool call");
  }

  const parsed = llmInsightsSchema.parse(toolUse.input);
  return parsed;
}
