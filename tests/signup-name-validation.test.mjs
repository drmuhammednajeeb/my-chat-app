import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../modules/signup-name-validation.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const context={};vm.runInNewContext(source,context);
const api=context.BizmindSignupName;
test("signup-name utility is standalone and loaded before the core",()=>{
 assert.equal(typeof api.normalize,"function");
 assert.equal(typeof api.validate,"function");
 assert.doesNotMatch(source,/(?:^|\\n)\\s*import\\s|\\bexport\\s/m);
 assert.ok(html.indexOf("./modules/signup-name-validation.js")<html.indexOf("__bootMainScriptStarted"));
 assert.match(html,/BizmindSignupName\\.normalize/);
 assert.match(html,/BizmindSignupName\\.validate/);
});
test("normalization canonicalizes unicode and collapses whitespace",()=>{
 assert.equal(api.normalize("  محمد   النبهاني  "),"محمد النبهاني");
 assert.equal(api.normalize("e\\u0301"),"é");
});
test("validator retains the two-to-three-part Arabic/Latin name contract",()=>{
 assert.equal(api.validate("محمد النبهاني").valid,true);
 assert.equal(api.validate("محمد أحمد النبهاني").valid,true);
 assert.equal(api.validate("Mohammed Ahmed").valid,true);
 assert.equal(api.validate("Mohammed bin Ali Nabhani").valid,false);
 assert.equal(api.validate("محمد").valid,false);
 assert.equal(api.validate("محمد 123").valid,false);
 assert.equal(api.validate("محمد-أحمد النبهاني").valid,true);
});
