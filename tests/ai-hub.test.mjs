import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const aiHub = require("../modules/ai-hub.js");
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../index.html");
const css = read("../modules/ai-hub.css");
const worker = read("../service-worker.js");
const source = read("../modules/ai-hub.js");

test("Poe bot URLs accept only HTTPS links on the exact Poe origin", () => {
  assert.equal(aiHub.validatePoeUrl("https://poe.com/MyForeverBot")?.href, "https://poe.com/MyForeverBot");
  for (const value of [
    "http://poe.com/MyBot",
    "https://poe.com.evil.example/MyBot",
    "https://evil.example/poe.com/MyBot",
    "javascript:alert(1)",
    "https://user:pass@poe.com/MyBot",
    "https://poe.com/",
    "https://poe.com/MyBot?token=secret",
    "https://poe.com/MyBot#secret"
  ]) assert.equal(aiHub.validatePoeUrl(value), null, value);
});

test("account storage keys are isolated and do not include shared credentials", () => {
  assert.notEqual(aiHub.storageKey("user-a"), aiHub.storageKey("user-b"));
  assert.match(aiHub.storageKey("user-a"), /user-a/);
});

test("configuration persists only enabled state and a validated Poe bot URL", () => {
  const values = new Map();
  const win = { localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) } };
  assert.equal(aiHub.writeConfig(win, "user-a", { enabled: true, botUrl: "https://poe.com/MyBot" }), true);
  assert.deepEqual(aiHub.readConfig(win, "user-a"), { enabled: true, botUrl: "https://poe.com/MyBot" });
  assert.equal(aiHub.writeConfig(win, "user-a", { enabled: true, botUrl: "https://evil.example/MyBot" }), false);
  assert.deepEqual(aiHub.readConfig(win, "user-b"), { enabled: false, botUrl: "" });
  assert.equal(aiHub.writeConfig(win, "user-a", { enabled: false, botUrl: "" }), true);
  assert.deepEqual(aiHub.readConfig(win, "user-a"), { enabled: false, botUrl: "" });
});

test("prompt actions are explicit and never infer or fetch conversation history", () => {
  const prompt = aiHub.buildPrompt("polish", "نص تجريبي");
  assert.match(prompt, /أعد صياغة النص/);
  assert.match(prompt, /نص تجريبي/);
  assert.equal(aiHub.buildPrompt("translate", "  "), "");
  assert.match(aiHub.buildPrompt("translate", "Hello"), /ترجم النص التالي/);
  assert.match(source, /لا يرسل التطبيق رسائلك أو بيانات محادثاتك إلى Poe تلقائياً/);
  assert.doesNotMatch(source, /from\(["']chat_messages["']\)/);
  assert.doesNotMatch(source, /service.role|sb_secret|api[_-]?key/i);
});

test("AI Hub is mounted as an isolated optional module and included in the PWA shell", () => {
  assert.match(html, /id="aiHubOpenBtn"/);
  assert.match(html, /modules\/ai-hub\.css/);
  assert.match(html, /modules\/ai-hub\.js/);
  assert.match(css, /\.ai-hub-overlay/);
  assert.match(worker, /CACHE_VERSION = "v43"/);
  assert.match(worker, /modules\/ai-hub\.js/);
  assert.match(worker, /modules\/ai-hub\.css/);
});
