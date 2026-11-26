import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../modules/message-timeline.js',import.meta.url),'utf8');
const window={};
vm.runInNewContext(source,{window,Date,Number,String,Array,Map,Set,Object});
const api=window.BizmindMessageTimeline;
test('timeline API exposes rollback and reconciliation',()=>{
 assert.equal(typeof api.rollbackCancelledOlderHistory,'function');
 assert.equal(typeof api.reconcileMessageTimeline,'function');
});
test('rollback respects newer timeline ownership',()=>{
 const state={active:{id:'c'},messageTimelineCommitVersion:9,messageTimelineRenderOwner:9,messages:[]};
 assert.equal(api.rollbackCancelledOlderHistory(state,'c',new Set(),new Set(),{querySelectorAll:()=>[]},8,new Set(),new Map(),new Set()),false);
});
test('rollback removes only request-owned rows and preserves replacements',()=>{
 const owned={id:'owned'},replacement={id:'replacement'};
 const area={querySelectorAll:()=>[]};
 const state={active:{id:'c'},messages:[owned,replacement],messageIds:new Set(['owned','replacement']),loadedHistoryIds:new Set(['owned']),messageTimelineCommitVersion:1};
 assert.equal(api.rollbackCancelledOlderHistory(state,'c',new Set(['owned']),new Set(),area,1,new Set(),new Map([['owned',owned]]),new Set()),true);
 assert.deepEqual(state.messages.map(x=>x.id),['replacement']);
 assert.equal(state.messageIds.has('owned'),false);
 assert.equal(state.loadedHistoryIds.has('owned'),false);
 assert.equal(state.messageIds.has('replacement'),true);
});
test('reconciliation orders message nodes and keeps non-message nodes',()=>{
 const fixed={className:'loader',classList:{contains(n){return n==='loader';}}};
 function node(className,day,id,time){
  return {className,dataset:{day,messageId:id,createdAt:time},textContent:day,
   classList:{contains(n){return className.split(' ').includes(n);}}};
 }
 const m1=node('message','A','1','2026-01-01'),m2=node('message','B','2','2026-01-02');
 const area={children:[m2,fixed,m1],ownerDocument:{createElement(tag){return node('day-divider','','', '');}},querySelectorAll(){return [m2,m1]},replaceChildren(...nodes){this.children=nodes}};
 api.reconcileMessageTimeline(area);
 assert.equal(area.children[0],fixed);
 assert.equal(area.children[1].className,'day-divider');
 assert.equal(area.children[2],m1);
 assert.equal(area.children[3].className,'day-divider');
 assert.equal(area.children[4],m2);
});
