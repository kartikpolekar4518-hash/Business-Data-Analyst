import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";
import { answer, type ChatResult } from "./intent.js";
import { env } from "../env.js";

// AI provider abstraction. Today only the deterministic analyst is wired up
// (no API key needed). To add an LLM later, implement AiProvider and select it
// here based on env.aiEnabled — callers (ai module) don't change.
export interface AiProvider {
  name: string;
  answer(question: string, rows: Row[], schema: SchemaMap): Promise<ChatResult> | ChatResult;
}

const deterministic: AiProvider = {
  name: "deterministic",
  answer: (q, rows, schema) => answer(q, rows, schema),
};

export function getProvider(): AiProvider {
  // ponytail: only the deterministic provider exists; branch here when an LLM provider is added.
  return deterministic;
}

export const aiConfigMessage = env.aiEnabled
  ? null
  : "Running on the built-in deterministic analyst (no LLM API key configured). Answers are computed directly from your data.";
