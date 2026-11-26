#!/usr/bin/env node
import { readFileSync } from "node:fs";
const html=readFileSync(process.argv[2]||"index.html","utf8");
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(([tag,attrs,body])=>({attrs,body,tag}));
const inline=scripts.filter(s=>!/\bsrc\s*=/.test(s.attrs)&&s.body.trim());
const main=inline.find(s=>s.body.includes("__bootMainScriptStarted"));
const checks=[];const add=(name,pass,detail)=>checks.push({name,pass:Boolean(pass),detail});
add("Arabic RTL contract",/<html[^>]*lang="ar"[^>]*dir="rtl"/i.test(html),"Arabic RTL remains declared.");
add("Main inline script identified",!!main,"Main inline application script identified.");
add("Main inline script within interim ceiling",!!main&&main.body.length<=260000,main?main.body.length+" chars; ceiling 260000":"not identified");
add("No duplicate static IDs",(()=>{const ids=[...html.matchAll(/\sid=["']([^"']+)["']/g)].map(m=>m[1]);return new Set(ids).size===ids.length})(),"Static IDs are unique.");
add("No inline event-handler attributes",! /\son(?:click|input|change|submit|keydown|keyup|load)\s*=/.test(html),"Inline HTML handlers absent.");
add("At least 12 module script references",scripts.filter(s=>/\bsrc\s*=/.test(s.attrs)&&/\.\/modules\//.test(s.attrs)).length>=12,"Module references detected.");
add("Password module precedes core",html.indexOf("./modules/password-strength.js")>=0&&html.indexOf("./modules/password-strength.js")<html.indexOf("__bootMainScriptStarted"),"Extracted utility loads before consumer.");
add("Runtime config precedes core",html.indexOf("__bootMainScriptStarted")>html.indexOf("./modules/runtime-config.js"),"Config script precedes core.");
const report={checks,summary:{total:checks.length,passed:checks.filter(x=>x.pass).length,failed:checks.filter(x=>!x.pass).length}};
console.log(JSON.stringify(report,null,2));if(report.summary.failed)process.exitCode=1;
