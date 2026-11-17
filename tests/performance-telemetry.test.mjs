import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function extract(name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " must exist in index.html");
  let depth = 0, opened = false, quote = null, escaped = false;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") { depth++; opened = true; }
    else if (ch === "}" && opened && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("Unclosed function: " + name);
}

const percentileFunction = extract("performancePercentile");

test("performance percentiles use nearest-rank P50, P95 and P99", () => {
  const percentile = vm.runInNewContext("(" + percentileFunction + ")", {});
  const values = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.equal(percentile(values, 50), 50);
  assert.equal(percentile(values, 95), 95);
  assert.equal(percentile(values, 99), 99);
  assert.equal(percentile([9, 1, 5, 3], 50), 3);
});

test("performance percentile handles empty and single-sample windows", () => {
  const percentile = vm.runInNewContext("(" + percentileFunction + ")", {});
  assert.equal(percentile([], 99), null);
  assert.equal(percentile([42], 50), 42);
  assert.equal(percentile([42], 95), 42);
  assert.equal(percentile([42], 99), 42);
});

test("performance summary exposes P99 for tracked application and realtime metrics", () => {
  const summaryFunction = extract("performanceSummary");
  const perfSamples = Array.from({ length: 100 }, (_, index) => ({
    metric: "message_fetch",
    ms: index + 1
  }));
  const summary = vm.runInNewContext(
    "(" + percentileFunction + ");(" + summaryFunction + ")",
    {
      perfSamples,
      performance: { getEntriesByType: () => [] },
      navigator: {}
    }
  );
  assert.equal(summary.metrics.message_fetch.p50_ms, 50);
  assert.equal(summary.metrics.message_fetch.p95_ms, 95);
  assert.equal(summary.metrics.message_fetch.p99_ms, 99);
  assert.ok(source.includes("'realtime_subscribe'"));
  assert.ok(source.includes("'realtime_message_render'"));
  assert.ok(source.includes("'conversations_load'"));
});

test("performance telemetry retains a bounded local sample window", () => {
  assert.match(source, /perfSamples\.push\(sample\);if\(perfSamples\.length>500\)perfSamples\.splice\(0,perfSamples\.length-500\)/);
  assert.match(source, /storage:'local browser only'/);
});
