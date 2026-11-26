'use strict';
const assert = require('node:assert/strict');
const loader = require('../modules/message-loader.js');
function compare(a,b){const d=Date.parse(a.created_at)-Date.parse(b.created_at);return d||String(a.id).localeCompare(String(b.id))}
const row=(id,created_at,extra={})=>({id,conversation_id:'conversation-a',created_at,...extra});

class FakeNode {
 constructor(kind='message',id=''){this.kind=kind;this.dataset={messageId:id,createdAt:''};this.parent=null;this.style={};this.textContent='';this.className=kind;this.classList={contains:name=>this.className.split(/\\s+/).includes(name)}}
 get nextSibling(){if(!this.parent)return null;const i=this.parent.children.indexOf(this);return this.parent.children[i+1]||null}
 get previousElementSibling(){if(!this.parent)return null;const i=this.parent.children.indexOf(this);return this.parent.children[i-1]||null}
 getBoundingClientRect(){return {top:100,bottom:120}}
 remove(){if(this.parent){const i=this.parent.children.indexOf(this);if(i>=0)this.parent.children.splice(i,1);this.parent=null}}
}
class FakeArea {
 constructor(){this.children=[];this.style={};this.scrollTop=200;this.clientHeight=500;this.scrollHeight=900}
 get childNodes(){return this.children}
 getBoundingClientRect(){return {top:0,bottom:500}}
 querySelectorAll(selector){return selector==='.message'?this.children.filter(node=>node.classList.contains('message')):[]}
 prepend(node){node.parent=this;this.children.unshift(node)}
 appendChild(node){node.parent=this;this.children.push(node)}
 insertBefore(fragment,before){const nodes=fragment.childNodes||[];let index=before?this.children.indexOf(before):-1;if(index<0)index=this.children.length;for(const node of nodes){node.parent=this;this.children.splice(index++,0,node)}fragment.childNodes=[]}
}
function fakeDocument(){return {createElement:kind=>new FakeNode(kind),createDocumentFragment:()=>({childNodes:[],append(node){if(node.parent)node.remove();this.childNodes.push(node)}})}}

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

 // Exercise the real older-history controller with a deterministic Supabase and DOM double.
 const area=new FakeArea(),existing=new FakeNode('message','m2');existing.dataset.createdAt='2026-01-03T00:00:00Z';area.appendChild(existing);
 const historyState={
  active:{id:'conversation-a'},messageLoadVersion:12,loadingOlderMessages:false,loadingOlderRequestId:null,
  hasMoreMessages:true,messages:[row('m2','2026-01-03T00:00:00Z')],messageIds:new Set(['m2']),
  loadedHistoryIds:new Set(),replyMessages:new Map(),activeChatPreference:null,
  messageTimelineCommitVersion:12
 };
 let cursor='';
 const query={
  select(){return this},eq(){return this},or(value){cursor=value;return this},gt(){return this},
  order(){return this},limit(){return Promise.resolve({data:[
   row('m1','2026-01-02T00:00:00Z'),row('m0','2026-01-01T00:00:00Z')
  ],error:null})}
 };
 const rendered=[];
 const loaded=await loader.loadOlderMessages({
  state:historyState,$:id=>id==='messages'?area:null,document:fakeDocument(),
  supabaseClient:{from:table=>{assert.equal(table,'chat_messages');return query}},
  loadMessagePins:async()=>true,loadPrivateReplyContexts:async()=>true,loadMessageReactions:async()=>true,
  compareMessagesChronologically:compare,reconcileMessageTimeline:()=>{},
  render:undefined,
  renderMessage:async message=>{rendered.push(message.id);historyState.messageIds.add(message.id);const node=new FakeNode('message',message.id);node.dataset.createdAt=message.created_at;area.appendChild(node);return true},
  toast(){},logger:console
 });
 assert.equal(loaded,true);
 assert.deepEqual(historyState.messages.map(x=>x.id),['m0','m1','m2']);
 assert.deepEqual(rendered,['m0','m1']);
 assert.deepEqual(area.querySelectorAll('.message').map(x=>x.dataset.messageId),['m0','m1','m2']);
 assert.equal(new Set(historyState.messages.map(x=>x.id)).size,3);
 assert.match(cursor,/created_at\.lt\.2026-01-03/);
 assert.equal(historyState.hasMoreMessages,false);
 assert.equal(historyState.loadingOlderMessages,false);

 // A generation change while the page request is pending must prevent rendering/commit.
 const staleArea=new FakeArea(),staleState={
  active:{id:'conversation-a'},messageLoadVersion:20,loadingOlderMessages:false,loadingOlderRequestId:null,
  hasMoreMessages:true,messages:[row('latest','2026-01-03T00:00:00Z')],messageIds:new Set(['latest']),
  loadedHistoryIds:new Set(),replyMessages:new Map(),activeChatPreference:null,messageTimelineCommitVersion:20
 };
 let finishQuery;
 const pendingQuery={select(){return this},eq(){return this},or(){return this},gt(){return this},order(){return this},limit(){return new Promise(resolve=>{finishQuery=resolve})}};
 let staleRenderCalls=0;
 const pending=loader.loadOlderMessages({
  state:staleState,$:()=>staleArea,document:fakeDocument(),
  supabaseClient:{from:()=>pendingQuery},compareMessagesChronologically:compare,
  loadMessagePins:async()=>true,loadPrivateReplyContexts:async()=>true,loadMessageReactions:async()=>true,
  renderMessage:async()=>{staleRenderCalls++;return true},reconcileMessageTimeline:()=>{},toast(){},logger:console
 });
 await Promise.resolve();staleState.messageLoadVersion++;
 finishQuery({data:[row('too-old','2026-01-01T00:00:00Z')],error:null});
 assert.equal(await pending,false);
 assert.equal(staleRenderCalls,0);
 assert.deepEqual(staleState.messages.map(x=>x.id),['latest']);
 assert.equal(staleState.loadingOlderMessages,false);
 console.log('message loading/render controller tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
