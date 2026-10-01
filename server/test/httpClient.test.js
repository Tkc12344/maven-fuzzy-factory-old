import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedNumbers, numbersInText, rejectUnknownNumbers } from "../src/engines/aiEngine.js";
import { createCircuitBreaker } from "../src/lib/httpClient.js";

test("circuit breaker opens after repeated failures and recovers", async () => {
  const breaker = createCircuitBreaker({ name: "test", failureThreshold: 2, resetMs: 20 });
  const fail = () => Promise.reject(new Error("boom"));
  await assert.rejects(() => breaker.exec(fail));
  await assert.rejects(() => breaker.exec(fail));
  assert.equal(breaker.state, "open");
  await assert.rejects(() => breaker.exec(() => Promise.resolve("ok")));
  await new Promise((r) => setTimeout(r, 25));
  const value = await breaker.exec(() => Promise.resolve("ok"));
  assert.equal(value, "ok");
  assert.equal(breaker.state, "closed");
});

test("LLM number guard rejects values that are not in the facts payload", () => {
  const facts = { kpis: { revenue: 1938510, orders: 32313 } };
  assert.ok(allowedNumbers(facts).has("1938510"));
  assert.deepEqual(numbersInText("Revenue was $1,938,510"), ["1938510"]);
  assert.throws(
    () =>
      rejectUnknownNumbers(
        { summary: "Revenue will be $9999999 next year", insights: [], recommendations: [] },
        facts
      ),
    /invented number/
  );
  const ok = rejectUnknownNumbers(
    {
      summary: "Revenue was 1938510 from 32313 orders",
      insights: [{ title: "Stable", body: "Keep 32313 orders", confidence: "high", tags: [] }],
      recommendations: ["Hold"],
    },
    facts
  );
  assert.equal(ok.summary.includes("1938510"), true);
});
