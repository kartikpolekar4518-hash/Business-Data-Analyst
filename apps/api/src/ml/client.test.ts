// The client's contract with the rest of the product: with Signals switched off it is
// inert and silent. ML_ENABLED is unset in the unit-test environment, which is exactly
// the state every deployment that never opts in runs in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isMlEnabled, mlHealth, runModel } from "./client.js";

test("with ML_ENABLED unset the feature reports itself off", () => {
  assert.equal(isMlEnabled(), false);
});

test("a health check on a disabled service answers, it does not throw", async () => {
  assert.deepEqual(await mlHealth(), { reachable: false });
});

test("running a model while disabled returns null rather than reaching the network", async () => {
  assert.equal(await runModel("churn", [{ a: 1 }], { revenue: "a" }, {}), null);
});
