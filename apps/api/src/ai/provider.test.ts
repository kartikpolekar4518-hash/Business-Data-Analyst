import { test } from "node:test";
import assert from "node:assert/strict";
import { llmParseIntent } from "./provider.js";
import type { SchemaMap } from "../engine/schema.js";

// The privacy contract: with no OPENAI_API_KEY configured (the default, and how this
// suite runs), the AI layer is fully off — no client, no network call — and returns
// null so the caller falls back to the deterministic rule parser.
test("llmParseIntent is a no-op that returns null when no API key is set", async () => {
  assert.equal(process.env.OPENAI_API_KEY ?? "", "", "test must run with OPENAI_API_KEY unset");
  const schema: SchemaMap = { revenue: "amount", customer_name: "customer", date: "order_date" };
  const result = await llmParseIntent("top 5 customers by revenue", schema);
  assert.equal(result, null);
});
