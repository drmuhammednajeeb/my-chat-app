import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const moduleSource=readFileSync(new URL("../modules/password-strength.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const context={};vm.runInNewContext(moduleSource,context);
const calculate=context.BizmindPasswordStrength.calculate;
test("password-strength utility is standalone and loaded before the core",()=>{
 assert.equal(typeof calculate,"function");
 assert.doesNotMatch(moduleSource,/^\s*import\s|\bexport\s/m);
 assert.ok(html.indexOf("./modules/password-strength.js")<html.indexOf("__bootMainScriptStarted"));
});
test("empty and short password behavior remains stable",()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(calculate(""))),{level:0,label:"لم تُدخل كلمة المرور بعد"});
 assert.equal(calculate("abc").level,1);assert.equal(calculate("abc").label,"ضعيفة");
});
test("representative medium, strong and very-strong cases are retained",()=>{
 assert.equal(calculate("abcdefgh").level,1);
 assert.equal(calculate("abcdefghij").level,2);
 assert.equal(calculate("Abcdefgh12").level,3);
 assert.equal(calculate("Abcdefgh12!XYZ").level,4);
});
test("UI wrapper delegates to the extracted module",()=>{
 const start=html.indexOf("function updatePasswordStrength()");
 const end=html.indexOf("\n}",start);
 assert.ok(start>=0&&end>start);
 const wrapper=html.slice(start,end+2);
 assert.match(wrapper,/window\.BizmindPasswordStrength\.calculate/);
 assert.doesNotMatch(html,/function getPasswordStrength\(/);
});
test("search UI adapter delegates to extracted query service",()=>{assert.match(html,/BizmindConversationSearch\.searchConversationMessages/);});
test("performance analytics module precedes core",()=>{assert.ok(html.indexOf("./modules/performance-analytics.js")<html.indexOf("__bootMainScriptStarted"));});
