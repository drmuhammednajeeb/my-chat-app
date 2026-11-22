import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const tokens = readFileSync(new URL('../styles/theme-tokens.css', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../app.css', import.meta.url), 'utf8');
const overrides = readFileSync(new URL('../app-overrides.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function varsFor(selector) {
  const match = tokens.match(selector === ':root' ? /:root\s*\{([^}]*)\}/ : /html\.dark\s*\{([^}]*)\}/);
  assert.ok(match, 'Missing theme scope ' + selector);
  return Object.fromEntries([...match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([,k,v])=>[k,v.trim()]));
}
function rgb(value) {
  const m=value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i); assert.ok(m,'Invalid color '+value);
  let h=m[1]; if(h.length===3)h=[...h].map(c=>c+c).join('');
  return [0,2,4].map(i=>{const c=parseInt(h.slice(i,i+2),16)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});
}
function ratio(fg,bg) {
  const lum=c=>.2126*c[0]+.7152*c[1]+.0722*c[2],a=lum(rgb(fg)),b=lum(rgb(bg));
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
test('light and dark theme semantic tokens exist',()=>{
 const required=['--bg','--panel','--panel2','--text','--muted','--mine','--surface-row-active','--surface-row-active-text','--bubble-outgoing-text','--button-primary-bg','--button-primary-text','--menu-bg','--overlay-scrim','--focus-ring'];
 for(const scope of [':root','html.dark']){const v=varsFor(scope);for(const k of required)assert.ok(v[k],scope+' missing '+k);}
});
test('WCAG AA contrast >= 4.5:1 for shared text and controls',()=>{
 for(const scope of [':root','html.dark']){
  const v=varsFor(scope),checks=[
   ['--text','--bg','body'],['--text','--panel','panel'],['--muted','--panel2','secondary'],
   ['--bubble-outgoing-text','--mine','outgoing bubble'],['--surface-row-active-text','--surface-row-active','selected row'],
   ['--button-primary-text','--button-primary-bg','primary button']];
  for(const [fg,bg,label] of checks)assert.ok(ratio(v[fg],v[bg])>=4.5,scope+' '+label+' contrast below AA');
 }
});
test('global palette is not redefined in legacy stylesheets',()=>{
 for(const css of [appCss,overrides]){
  assert.doesNotMatch(css,/^:root\s*\{[^}]*--(?:bg|panel|text|muted|accent):/m);
  assert.doesNotMatch(css,/^html\.(?:light|dark)\s*\{[^}]*--(?:bg|panel|text|muted|accent):/m);
 }
});
test('central theme stylesheet is loaded once and in the intended order',()=>{
 const links=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(m=>m[0]),index=n=>links.findIndex(x=>x.includes('href="'+n+'"'));
 assert.equal(links.filter(x=>x.includes('href="./styles/theme-tokens.css"')).length,1);
 assert.ok(index('./styles/theme-tokens.css')>index('./app.css'));
 assert.ok(index('./modules/voice-recorder.css')>index('./styles/theme-tokens.css'));
 assert.ok(index('./app-overrides.css')>index('./styles/theme-tokens.css'));
 assert.ok(!html.includes(String.fromCharCode(92)+'n<link'));
});
test('shared component colors use semantic tokens',()=>{
 assert.match(overrides,/\.chat-header-menu\{[^}]*background:var\(--menu-bg\)/s);
 assert.match(overrides,/\.message-options-menu\{[^}]*background:var\(--menu-bg\)/s);
 assert.match(overrides,/\.custom-list-chip\.active\{[^}]*var\(--surface-selected\)/s);
 assert.match(overrides,/\.group-management-modal[^}]*background:var\(--overlay-scrim\)/s);
 assert.match(appCss,/\.mine \.bubble\{[^}]*var\(--bubble-outgoing-text\)/s);
});
test('focus visibility and reduced motion protections remain',()=>{
 assert.match(overrides,/:focus-visible/);assert.match(appCss,/prefers-reduced-motion:reduce/);assert.match(overrides,/prefers-reduced-motion:reduce/);
});
