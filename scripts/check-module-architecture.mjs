#!/usr/bin/env node
/**
 * Static architecture guard for the classic-script feature modules.
 * This intentionally reports dependency cycles without failing the baseline;
 * pass --strict after the graph has been decoupled to make cycles fatal.
 */
import { readFile } from "node:fs/promises";

const modules = [
  "modules/core.js",
  "modules/auth.js",
  "modules/notifications.js",
  "modules/conversations.js",
  "modules/messages.js",
  "modules/realtime.js",
  "modules/groups.js",
  "modules/channels.js",
  "modules/admin.js",
  "modules/media.js"
];
const strict = process.argv.includes("--strict");
const indexHtml = await readFile("index.html", "utf8");
const serviceWorker = await readFile("service-worker.js", "utf8");

const sourceFiles = new Map();
for (const path of modules) sourceFiles.set(path, await readFile(path, "utf8"));

const scriptSources = [...indexHtml.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
const expectedOrder = modules.map(path => "./" + path);
const positions = expectedOrder.map(path => scriptSources.indexOf(path));
const missingScripts = expectedOrder.filter((_, index) => positions[index] < 0);
const outOfOrderScripts = expectedOrder.filter((_, index) =>
  index > 0 && positions[index] >= 0 && positions[index - 1] >= 0 && positions[index] <= positions[index - 1]
);
const missingPrecache = modules.filter(path => !serviceWorker.includes("./" + path));

const declarations = new Map();
for (const [path, source] of sourceFiles) {
  const names = [...source.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]);
  declarations.set(path, names);
}
const owners = new Map();
for (const [path, names] of declarations) {
  for (const name of names) owners.set(name, [...(owners.get(name) || []), path]);
}
const duplicateDeclarations = [...owners.entries()]
  .filter(([, paths]) => paths.length > 1)
  .map(([name, paths]) => ({ name, paths }));

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const graph = new Map(modules.map(path => [path, new Set()]));
for (const [caller, source] of sourceFiles) {
  const searchable = stripComments(source);
  for (const [callee, names] of declarations) {
    if (caller === callee) continue;
    if (names.some(name => new RegExp("\\b" + name + "\\s*\\(").test(searchable))) {
      graph.get(caller).add(callee);
    }
  }
}

let nextIndex = 0;
const stack = [];
const onStack = new Set();
const indices = new Map();
const lowLinks = new Map();
const components = [];

function visit(node) {
  indices.set(node, nextIndex);
  lowLinks.set(node, nextIndex);
  nextIndex += 1;
  stack.push(node);
  onStack.add(node);

  for (const neighbor of graph.get(node)) {
    if (!indices.has(neighbor)) {
      visit(neighbor);
      lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(neighbor)));
    } else if (onStack.has(neighbor)) {
      lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(neighbor)));
    }
  }

  if (lowLinks.get(node) === indices.get(node)) {
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1) components.push(component.sort());
  }
}

for (const path of modules) if (!indices.has(path)) visit(path);

const edges = [...graph.entries()].flatMap(([from, targets]) =>
  [...targets].map(to => ({ from, to }))
);
const report = {
  moduleCount: modules.length,
  functionDeclarationCount: [...declarations.values()].reduce((sum, names) => sum + names.length, 0),
  scriptOrder: { ok: !missingScripts.length && !outOfOrderScripts.length, missing: missingScripts, outOfOrder: outOfOrderScripts },
  serviceWorkerPrecache: { ok: !missingPrecache.length, missing: missingPrecache },
  duplicateFunctionDeclarations: duplicateDeclarations,
  crossModuleDependencyEdges: edges.length,
  cyclicComponents: components,
  strictMode: strict
};

console.log(JSON.stringify(report, null, 2));

const invariantFailures =
  missingScripts.length > 0 ||
  outOfOrderScripts.length > 0 ||
  missingPrecache.length > 0 ||
  duplicateDeclarations.length > 0;
if (invariantFailures || (strict && components.length > 0)) process.exitCode = 1;
