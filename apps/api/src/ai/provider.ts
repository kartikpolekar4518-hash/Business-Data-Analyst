import OpenAI from "openai";
import { z } from "zod";
import { env } from "../env.js";
import type { SchemaMap } from "../engine/schema.js";
import { INTENTS, type Intent } from "../engine/intent.js";

// AI question understanding — the "translate-only" layer. GPT turns a free-form
// question into a structured Intent; the deterministic engine (engine/intent.ts →
// runIntent) then computes every number. The model is sent ONLY the question and the
// schema (column names + their detected business meaning) — never a single data row —
// so the customer's actual figures never leave our servers.
//
// Any failure (no key, timeout, rate limit, malformed output) returns null and the
// caller falls back to the rule-based parser, so the chat endpoint never breaks.

// One client, only when a key is configured. No key => feature off => always null.
const client = env.openaiApiKey
  ? new OpenAI({ apiKey: env.openaiApiKey, timeout: 12_000, maxRetries: 1 })
  : null;

const METRIC_ENUM = ["revenue", "profit", "quantity", "orders"] as const;

// GPT emits this compact shape (structured output); we widen it to a full Intent below.
const Emitted = z.object({
  intent: z.enum(INTENTS),
  metric: z.enum(METRIC_ENUM),
  dimension: z.string(),
  limit: z.number().int().min(1).max(50),
});

// JSON-schema for OpenAI structured outputs (strict => guaranteed schema-valid JSON).
const intentSchema = {
  type: "object",
  properties: {
    intent: { type: "string", enum: [...INTENTS], description: "The analytics operation the question asks for." },
    metric: { type: "string", enum: [...METRIC_ENUM], description: "The measure to compute." },
    dimension: { type: "string", description: "The grouping column: a listed dimension, 'date', or 'none'." },
    limit: { type: "integer", minimum: 1, maximum: 50, description: "How many rows to return (default 10)." },
  },
  required: ["intent", "metric", "dimension", "limit"],
  additionalProperties: false,
} as const;

// A compact, row-free description of the dataset for the model.
function schemaSummary(s: SchemaMap): { text: string; dimensions: string[] } {
  const dims = (["customer_name", "product_name", "region", "state", "city", "category", "department", "plan", "medicine_name"] as const)
    .filter((d) => s[d]);
  const cols = Object.entries(s).map(([semantic, col]) => `- ${semantic} (column "${col}")`).join("\n");
  return {
    dimensions: dims,
    text: `The dataset has these business columns:\n${cols}\n\nAvailable grouping dimensions: ${dims.join(", ") || "none"}${s.date ? ", date" : ""}.`,
  };
}

const SYSTEM = `You translate a business user's natural-language question about their dataset into a single structured analytics intent. You never see the data itself, only its columns. Choose the intent that best matches the question:
- top_n: rank groups by a metric ("top 10 customers", "best products")
- trend: a metric over time ("revenue by month", "sales over time")
- max_period / min_period: the highest / lowest period ("which month had the most sales")
- forecast: predict a future period ("next month's revenue")
- explain_change: why a metric moved ("why did profit drop")
- growing_groups / declining_groups: which groups are rising / falling over the range
- inventory_risk: products low on stock
- unknown: the question cannot be answered from these columns
Pick a dimension only from the listed dimensions (or 'date' / 'none'). Prefer a specific metric named in the question; default to revenue.`;

export async function llmParseIntent(question: string, schema: SchemaMap): Promise<Intent | null> {
  if (!client) return null;
  const summary = schemaSummary(schema);
  try {
    const res = await client.chat.completions.create({
      model: env.aiModel,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `${summary.text}\n\nQuestion: ${question}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "analytics_intent", strict: true, schema: intentSchema } },
    });
    const msg = res.choices[0]?.message;
    if (!msg || msg.refusal || !msg.content) return null;
    const e = Emitted.parse(JSON.parse(msg.content));
    // Keep the dimension only if it's one the engine can actually use.
    const dim = e.dimension === "date" || summary.dimensions.includes(e.dimension) ? e.dimension : null;
    return {
      intent: e.intent,
      metrics: [e.metric],
      dimensions: dim ? [dim] : [],
      filters: {},
      limit: e.limit,
      visualization: "none", // runIntent sets the real visualization deterministically
    };
  } catch {
    return null; // any failure => caller falls back to the rule-based parser
  }
}
