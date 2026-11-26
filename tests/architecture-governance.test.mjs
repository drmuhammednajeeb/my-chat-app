import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const worker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
const moduleFiles = [
  "app-updater.js", "audio-player.js", "auth-error-messages.js", "auth-light.js",
  "backup-restore.js", "message-loader.js", "message-reactions.js",
  "profile-status-and-conversation-images.js", "runtime-config.js",
  "status-workspace.js", "voice-recorder.js"
];
const cssFiles = [
  "app-updater.css", "audio-player.css", "auth-light.css", "message-reactions.css",
  "profile-status-and-conversation-images.css", "status-workspace.css", "voice-recorder.css"
];

test("feature modules are referenced by the application shell", () => {
  for (const file of moduleFiles) assert.ok(html.includes(`./modules/${file}`), `missing application-shell reference: ${file}`);
});

test("feature module scripts are included in the offline shell cache", () => {
  for (const file of moduleFiles) assert.ok(worker.includes(`./modules/${file}`), `missing service-worker shell entry: ${file}`);
});

test("module styles are linked and cached", () => {
  for (const file of cssFiles) {
    assert.ok(html.includes(`./modules/${file}`), `missing CSS link: ${file}`);
    assert.ok(worker.includes(`./modules/${file}`), `missing CSS cache entry: ${file}`);
  }
});

test("index.html does not contain duplicate id attributes", () => {
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], [], "duplicate DOM ids undermine module contracts");
});

test("index.html has no inline HTML event handler attributes", () => {
  const tags = [...html.matchAll(/<[^>]+>/g)].map((match) => match[0]);
  const attributes = tags.flatMap((tag) => [...tag.matchAll(/\s(on[a-z]+)\s*=/gi)].map((match) => match[1]));
  assert.deepEqual(attributes, [], "prefer explicit event binding over HTML event attributes");
});
