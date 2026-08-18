import OpenAI from "openai";
import { z } from "zod";
import { env } from "../env.js";
import { SEMANTICS, type SchemaMap, type Semantic } from "../engine/schema.js";
import { INTENTS, type Intent } from "../engine/intent.js";
import type { ColumnProfile } from "../engine/profile.js";
import { PACKS } from "../engine/industries.js";

// AI question understanding — the "translate-only" layer. GPT turns a free-form
// question into a structured Intent; the deterministic engine (engine/intent.ts →
// runIntent) then computes every number. The model is sent ONLY the question and the
// schema (column names + their detected business meaning) — never a single data row —
// so the customer's actual figures never leave our servers.
//
// Any failure (no key, timeout, rate limit, malformed output) returns null and the
// caller falls back to the rule-based parser, so the chat endpoint never breaks.

// One client, only when a key is configured. No key => feature off => always null.
// Bounded latency: these calls sit inline in chat and ingest requests, so a slow or
// unreachable API must degrade to the rule-based path quickly rather than stall the
// request. No retry — the deterministic fallback is a better answer than a longer wait.
const client = env.openaiApiKey
  ? new OpenAI({ apiKey: env.openaiApiKey, timeout: 8_000, maxRetries: 0 })
  : null;

// Log the first failure per stage so a misconfigured key/model is diagnosable, without
// spamming a line per request once something is persistently broken.
const warned = new Set<string>();
function warnOnce(stage: string, e: unknown): void {
  if (warned.has(stage)) return;
  warned.add(stage);
  console.warn(`[ai] ${stage} failed; falling back to rule-based logic. ${e instanceof Error ? e.message : String(e)}`);
}

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
  // "none" is a sentinel for an empty list, never an offerable dimension — build the
  // list first so a date-only schema reads "date", not "none, date".
  const groupable = [...dims, ...(s.date ? ["date"] : [])];
  return {
    dimensions: dims,
    text: `The dataset has these business columns:\n${cols}\n\nAvailable grouping dimensions: ${groupable.join(", ") || "none"}.`,
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
  } catch (e) {
    warnOnce("question understanding", e);
    return null; // any failure => caller falls back to the rule-based parser
  }
}

// ── AI-assisted schema + industry detection (runs once at ingest) ──
// GPT reads each column's name, type, and (when enabled) a few sample values, then maps
// columns to business meaning and classifies the industry. The engine still computes every
// number; this only labels columns and picks a pack. Sample values — never full rows — are
// the only cell data sent, and only when AI_DETECT_SAMPLE_VALUES is on.

const PACK_KEYS = Object.keys(PACKS);

const Analyzed = z.object({
  columns: z.array(z.object({ name: z.string(), semantic: z.string() })),
  industry: z.string(),
});
const VALID_SEMANTICS = new Set<string>(SEMANTICS);

const analyzeSchemaJson = {
  type: "object",
  properties: {
    columns: {
      type: "array",
      description: "One entry per input column, mapping it to a business meaning or 'none'.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          semantic: { type: "string", enum: [...SEMANTICS, "none"] },
        },
        required: ["name", "semantic"],
        additionalProperties: false,
      },
    },
    industry: { type: "string", enum: PACK_KEYS, description: "The best-fit business type." },
  },
  required: ["columns", "industry"],
  additionalProperties: false,
} as const;

const DETECT_SYSTEM = `You classify a dataset's columns and business type. For each column you are given its name, inferred data type, and possibly a few sample values. Map every column to the single best-fitting business meaning from the allowed list, or "none" if nothing fits. Then classify the whole dataset into one business type. Base your judgement on the meaning of the columns and their sample values, not just wording — e.g. a column named "amt" holding money is revenue; "code" holding West/East is region.`;

export async function llmAnalyzeSchema(
  columns: ColumnProfile[],
): Promise<{ mappings: { name: string; semantic: Semantic }[]; industry: string } | null> {
  if (!client || !columns.length) return null;
  const lines = columns.map((c) => {
    const samples = env.aiDetectSampleValues && c.sampleValues?.length
      ? `, e.g. ${c.sampleValues.slice(0, 5).map((v) => JSON.stringify(v)).join(", ")}`
      : "";
    return `- "${c.name}" (type: ${c.type}${samples})`;
  }).join("\n");
  try {
    const res = await client.chat.completions.create({
      model: env.aiModel,
      messages: [
        { role: "system", content: DETECT_SYSTEM },
        { role: "user", content: `Columns:\n${lines}\n\nAllowed business meanings: ${SEMANTICS.join(", ")}.\nBusiness types: ${PACK_KEYS.join(", ")}.` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "schema_analysis", strict: true, schema: analyzeSchemaJson } },
    });
    const msg = res.choices[0]?.message;
    if (!msg || msg.refusal || !msg.content) return null;
    const a = Analyzed.parse(JSON.parse(msg.content));
    return {
      // Keep only recognised semantics; drop "none" and anything off-vocabulary.
      mappings: a.columns
        .filter((c) => VALID_SEMANTICS.has(c.semantic))
        .map((c) => ({ name: c.name, semantic: c.semantic as Semantic })),
      industry: PACK_KEYS.includes(a.industry) ? a.industry : "generic",
    };
  } catch (e) {
    warnOnce("schema detection", e);
    return null; // any failure => caller keeps the regex-detected schema
  }
}
