import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("all inline application scripts parse as valid JavaScript", () => {
  const scripts = [...html.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/gi)]
    .filter(([, attributes, body]) => !/\\bsrc\\s*=/.test(attributes) && body.trim());
  assert.ok(scripts.length > 0, "index.html must contain inline application scripts");
  for (const [, attributes, body] of scripts) {
    assert.doesNotThrow(
      () => new vm.Script(body, { filename: "index.html inline script" }),
      "inline script must parse: " + attributes
    );
  }
});
