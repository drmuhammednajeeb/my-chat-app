'use strict';
const assert = require('node:assert/strict');
const loader = require('../modules/message-loader.js');
function compare(a,b){const d=Date.parse(a.created_at)-Date.parse(b.created_at);return d||String(a.id).localeCompare(String(b.id))}
const row=(id,created_at,extra={})=>({id,conversation_id:'conversation-a',created_at,...extra});
{
 const merged=loader.mergeTimeline(
  [row('m2','2026-01-02T00:00:00Z'),row('m1','2026-01-01T00:00:00Z')],
  [row('m2','2026-01-02T00:00:00Z',{content:'newer',updated_at:'2026-01-03T00:00:00Z'}),row('m3','2026-01-03T00:00:00Z'),row('m3','2026-01-03T00:00:00Z')],
  compare);
 assert.deepEqual(merged.map(x=>x.id),['m1','m2','m3']);
 assert.equal(merged[1].content,'newer');
 assert.equal(new Set(merged.map(x=>x.id)).size,merged.length);
}
{
 const state={active:{id:'conversation-a'},messageLoadVersion:9,messages:[row('old','2026-01-01T00:00:00Z')],loadedHistoryIds:new Set(['old'])};
 assert.equal(loader.isCurrentRequest(state,9,'conversation-a'),true);
 assert.equal(loader.isCurrentRequest(state,8,'conversation-a'),false);
 assert.equal(loader.isCurrentRequest(state,9,'conversation-b'),false);
 assert.equal(loader.isCurrentRequest(state,9,null),false);
}
(async()=>{
 const state={active:{id:'conversation-a'},messageLoadVersion:4,messageIds:new Set(),messages:[row('m1','2026-01-01T00:00:00Z')]};
 let calls=0,release;const gate=new Promise(resolve=>{release=resolve});
 const render=async()=>{calls++;await gate;state.messageIds.add('m1');return true};
 const first=loader.renderMessage({state,message:state.messages[0],requestId:4,render});
 const second=loader.renderMessage({state,message:state.messages[0],requestId:4,render});
 await Promise.resolve();assert.equal(calls,1);
 release();assert.deepEqual(await Promise.all([first,second]),[true,true]);
 assert.equal(state.messageRenderPromises.size,0);
 let staleCalls=0;
 assert.equal(await loader.renderMessage({state,message:row('stale','2026-01-02T00:00:00Z'),requestId:3,render:async()=>{staleCalls++;return true}}),false);
 assert.equal(staleCalls,0);
 console.log('message loading/render controller tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
