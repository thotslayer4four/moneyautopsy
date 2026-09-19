import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { resolveProvider } from "./provider";

interface StructuredCall<S extends z.ZodType> {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  jsonSchema: object;
  schema: S;
  maxTokens?: number;
}

interface OpenAiCompatibleResponse {
  choices?: { message?: { tool_calls?: { function: { arguments: string } }[] } }[];
  error?: { message?: string };
}

const OPENAI_COMPATIBLE = {
  groq: {
    label: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: "GROQ_API_KEY",
    model: () => process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    tokenField: "max_completion_tokens",
  },
  zai: {
    label: "Z.AI",
    url: "https://api.z.ai/api/paas/v4/chat/completions",
    key: "ZAI_API_KEY",
    model: () => process.env.ZAI_MODEL || "glm-4.6v-flash",
    tokenField: "max_tokens",
  },
} as const;

/**
 * One forced tool call against whichever provider is configured, validated with zod.
 * Throws on any failure — callers decide what a sensible fallback is. Returns null when no
 * provider is configured (mock mode), so callers can skip the model entirely.
 */
export async function callStructured<S extends z.ZodType>(call: StructuredCall<S>): Promise<z.infer<S> | null> {
  const provider = resolveProvider();
  if (provider === "mock") return null;
  const maxTokens = call.maxTokens ?? 4096;

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    const response = await new Anthropic({ apiKey }).messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      max_tokens: maxTokens,
      system: call.system,
      messages: [{ role: "user", content: call.user }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ name: call.toolName, description: call.toolDescription, input_schema: call.jsonSchema as any }],
      tool_choice: { type: "tool", name: call.toolName },
    });
    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") throw new Error("Model did not return a structured tool call");
    return call.schema.parse(toolUse.input);
  }

  const config = OPENAI_COMPATIBLE[provider];
  const apiKey = process.env[config.key];
  if (!apiKey) throw new Error(`${config.key} is not set`);
  const res = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model(),
      [config.tokenField]: maxTokens,
      messages: [
        { role: "system", content: call.system },
        { role: "user", content: call.user },
      ],
      tools: [{ type: "function", function: { name: call.toolName, description: call.toolDescription, parameters: call.jsonSchema } }],
      tool_choice: { type: "function", function: { name: call.toolName } },
    }),
  });
  if (!res.ok) throw new Error(`${config.label} request failed: ${res.status} ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as OpenAiCompatibleResponse;
  if (json.error) throw new Error(`${config.label} error: ${json.error.message ?? "unknown error"}`);
  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error(`${config.label} did not return a structured tool call`);
  return call.schema.parse(JSON.parse(toolCall.function.arguments));
}
