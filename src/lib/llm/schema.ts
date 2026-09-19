import { z } from "zod";

export const findingSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  detail: z.string(),
  category: z.string(),
  importance: z.number().min(1).max(5),
  dataPoints: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const recommendationSchema = z.object({
  title: z.string(),
  description: z.string(),
  estimatedMonthlyImpact: z.number(),
});

export const llmInsightsSchema = z.object({
  financialPersonality: z.object({
    name: z.string(),
    description: z.string(),
  }),
  findings: z.array(findingSchema).min(3).max(10),
  recommendations: z.array(recommendationSchema).min(1).max(6),
  userBeliefComparison: z.object({
    whatTheyThought: z.string(),
    whatDataShows: z.string(),
    explanation: z.string(),
  }),
  thirtyDayReset: z.array(z.string()).min(3).max(10),
});

export type LLMInsightsParsed = z.infer<typeof llmInsightsSchema>;

/** JSON Schema handed to the model as a tool input schema, forcing structured output. */
export const LLM_TOOL_JSON_SCHEMA = {
  type: "object",
  properties: {
    financialPersonality: {
      type: "object",
      properties: {
        name: { type: "string", description: "A short, entertaining product-style label, e.g. 'The Quiet Leaker'." },
        description: { type: "string", description: "1-2 sentence explanation grounded in the supplied data." },
      },
      required: ["name", "description"],
    },
    findings: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string", description: "One sentence, no jargon." },
          detail: { type: "string", description: "2-4 sentences of explanation using only supplied numbers." },
          category: { type: "string" },
          importance: { type: "integer", minimum: 1, maximum: 5 },
          dataPoints: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["id", "title", "summary", "detail", "category", "importance", "dataPoints", "confidence"],
      },
    },
    recommendations: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          estimatedMonthlyImpact: { type: "number" },
        },
        required: ["title", "description", "estimatedMonthlyImpact"],
      },
    },
    userBeliefComparison: {
      type: "object",
      properties: {
        whatTheyThought: { type: "string" },
        whatDataShows: { type: "string" },
        explanation: { type: "string" },
      },
      required: ["whatTheyThought", "whatDataShows", "explanation"],
    },
    thirtyDayReset: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: { type: "string" },
    },
  },
  required: ["financialPersonality", "findings", "recommendations", "userBeliefComparison", "thirtyDayReset"],
} as const;
