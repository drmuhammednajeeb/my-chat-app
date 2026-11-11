import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../index.html");
const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];

test("only the pre-paint theme bootstrap remains inline", () => {
  const inline = tags.filter(([, attrs]) => !/\bsrc\s*=/.test(attrs));
  assert.equal(inline.length, 1);
  assert.match(inline[0][2], /__BIZMIND_THEME_PREFERENCE__/);
  assert.doesNotMatch(inline[0][2], /createClient|loadMessages|renderMessage/);
});

test("classic scripts preserve their dependency order", () => {
  const sources = tags
    .map(([, attrs]) => (attrs.match(/\bsrc\s*=\s*["']([^"']+)/i) || [])[1])
    .filter(Boolean);
  assert.deepEqual(sources, [
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/dist/umd/supabase.min.js",
    "./app.js",
    "./workspace.js",
    "./membership.js"
  ]);
});

test("every inline and extracted JavaScript file parses", () => {
  tags.forEach(([, attrs, body], index) => {
    if (!/\bsrc\s*=/.test(attrs)) {
      new vm.Script(body, { filename: "index.html:inline-script-" + index });
    }
  });
  for (const file of ["../app.js", "../workspace.js", "../membership.js", "../service-worker.js"]) {
    new vm.Script(read(file), { filename: file });
  }
});

test("service worker precaches extracted scripts and rotates its cache", () => {
  const worker = read("../service-worker.js");
  assert.ok(worker.includes('const CACHE_VERSION = "v20";'));
  assert.ok(worker.includes('new URL("./app.js", base).href'));
  assert.ok(worker.includes('new URL("./workspace.js", base).href'));
});

test("membership expiry label includes the formatted expiry date", () => {
  const membership = read("../membership.js");
  assert.ok(membership.includes('" · تنتهي: " + dateLabel(item.expires_at)'));
  assert.ok(!membership.includes('" · تنتهي  + dateLabel(item.expires_at)'));
});
