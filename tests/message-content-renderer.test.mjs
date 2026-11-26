import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source=await readFile(new URL("../modules/message-content-renderer.js",import.meta.url),"utf8");
const window={};vm.runInNewContext(source,{window,console,Object,String});const api=window.BizmindMessageContent;
function documentMock(){return {createElement(tag){return {tag,attributes:{},children:[],setAttribute(k,v){this.attributes[k]=v},append(node){this.children.push(node)}}}}}
test("content renderer rejects incomplete dependencies",()=>assert.equal(api.render({}),false));
test("plain content uses textContent and existing class",()=>{const document=documentMock(),bubble={children:[],append(n){this.children.push(n)}};const result=api.render({content:"<script>safe</script>",bubble,decodeSticker:()=>null,document});assert.equal(result,"text");assert.equal(bubble.children[0].className,"message-content");assert.equal(bubble.children[0].textContent,"<script>safe</script>")});
test("stickers retain accessibility semantics",()=>{const document=documentMock(),bubble={children:[],append(n){this.children.push(n)}};assert.equal(api.render({content:"sticker",bubble,decodeSticker:()=> "❤️",document}),"sticker");const node=bubble.children[0];assert.equal(node.className,"message-sticker");assert.equal(node.textContent,"❤️");assert.equal(node.attributes.role,"img");assert.equal(node.attributes["aria-label"],"ملصق")});
test("empty string content still creates content node",()=>{const document=documentMock(),bubble={children:[],append(n){this.children.push(n)}};assert.equal(api.render({content:"",bubble,decodeSticker:()=>null,document}),"text");assert.equal(bubble.children[0].textContent,"")});
