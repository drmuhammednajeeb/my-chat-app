import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function splitSelectors(selectorList) {\n  const selectors = [];\n  let depth = 0, start = 0;\n  for (let i = 0; i < selectorList.length; i++) {\n    const char = selectorList[i];\n    if (char === '(' || char === '[') depth++;\n    else if (char === ')' || char === ']') depth--;\n    else if (char === ',' && depth === 0) { selectors.push(selectorList.slice(start, i).trim()); start = i + 1; }\n  }\n  selectors.push(selectorList.slice(start).trim());\n  return selectors.filter(Boolean);\n}\n\nfunction collectRules(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '{') {
      const header = source.slice(start, i).trim();
      stack.push(header);
      depth++;
      start = i + 1;
    } else if (char === '}') {
      const body = source.slice(start, i).trim();
      const header = stack.pop() || '';
      depth--;
      if (!header.startsWith('@')) {
        const context = stack.filter((entry) => entry.startsWith('@')).join(' > ');
        const selector = header.replace(/\s+/g, ' ').trim();
        const declarations = body.replace(/\s+/g, ' ').trim();
        if (selector && declarations) {\n          for (const item of splitSelectors(selector)) rules.push({ context, selector: item, declarations });\n        }
      }
      start = i + 1;
    } else if (char === ';' && depth === 0) {
      start = i + 1;
    }
  }
  return rules;
}

test('app-overrides.css has no repeated identical rule blocks within the same context', async () => {
  const css = await readFile(new URL('../app-overrides.css', import.meta.url), 'utf8');
  const counts = new Map();
  for (const { context, selector, declarations } of collectRules(css)) {
    const key = context + '|' + selector + '{' + declarations + '}';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([key]) => key);
  assert.deepEqual(duplicates, [], 'identical CSS rules should not be repeated in the same context');
});
