import { z } from "zod";
import { env } from "../env.js";
import type { Row } from "../engine/parse.js";
import type { SchemaMap } from "../engine/schema.js";

// The only code that talks to the Python model service. Patterned on ai/provider.ts:
// it returns null on a timeout, an unreachable service, a non-2xx, a malformed body,
// a failed schema check, or any exception at all — and it never throws.
//
// That is the whole point of the file. Signals is an optional add-on, and a broken or
// absent Python process must not be able to affect the Dashboard, Analytics, Forecasts,
// uploads, or any deterministic calculation. The blast radius of this service failing
// is exactly one thing: the Signals pages say they could not produce a result.

export const ML_KINDS = ["segment", "churn", "basket"] as const;
export type MlKind = (typeof ML_KINDS)[number];

// Node depends on the contract, never on the algorithm behind it. Nothing here or
// downstream names an estimator; those are implementation details of the Python side,
// free to change behind a modelVersion bump.
const mlResponse = z.object({
  contractVersion: z.literal("1.0"),
  modelVersion: z.string().min(1).max(120),
  status: z.enum(["ok", "insufficient_data", "error"]),
  warnings: z.array(z.string()),
  metrics: z.record(z.union([z.number(), z.string(), z.null()])),
  predictions: z.unknown(),
  metadata: z.object({
    rowsIn: z.number(),
    entitiesOut: z.number(),
    computedAt: z.string(),
  }),
});

export type MlResponse = z.infer<typeof mlResponse>;

export const isMlEnabled = (): boolean => env.mlEnabled;

/** Is the service actually answering? Unreachable is a normal answer, not an error. */
export async function mlHealth(): Promise<{ reachable: boolean; contractVersion?: string }> {
  if (!env.mlEnabled) return { reachable: false };
  try {
    // A health check is not a training run: it uses a short timeout of its own, so a
    // hung service cannot make the Signals page spin for two minutes on page load.
    const res = await fetch(`${env.mlServiceUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { reachable: false };
    const body = (await res.json()) as { contractVersion?: unknown };
    return { reachable: true, contractVersion: typeof body.contractVersion === "string" ? body.contractVersion : undefined };
  } catch {
    return { reachable: false };
  }
}

/**
 * Run one model over rows Node has already loaded and scoped to an organization.
 *
 * Python is sent rows and column meanings and nothing else — no organization id, no
 * user, no connection string. Tenant isolation stays where it already is, in the query
 * that loaded these rows.
 */
export async function runModel(
  kind: MlKind,
  rows: Row[],
  schema: SchemaMap,
  config: Record<string, unknown> = {},
): Promise<MlResponse | null> {
  if (!env.mlEnabled) return null;
  try {
    const res = await fetch(`${env.mlServiceUrl}/${kind}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Defence in depth on top of the loopback bind, not the boundary itself.
        ...(env.mlSharedSecret ? { "X-ML-Secret": env.mlSharedSecret } : {}),
      },
      body: JSON.stringify({ rows, schema, config }),
      signal: AbortSignal.timeout(env.mlTimeoutMs),
    });
    if (!res.ok) return null;
    // Validated before anything is persisted: a service that answers with the wrong
    // shape is treated exactly like one that did not answer.
    return mlResponse.parse(await res.json());
  } catch {
    return null;
  }
}
