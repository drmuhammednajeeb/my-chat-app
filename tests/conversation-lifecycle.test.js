'use strict';
const assert=require('node:assert/strict');
const {create}=require('../modules/conversation-lifecycle.js');
{
 const state={active:null};
 const lifecycle=create({getState:()=>state});
 const first=lifecycle.begin('conversation-a');
 state.active={id:'conversation-a'};
 assert.equal(lifecycle.isCurrent(first,'conversation-a'),true);
 const second=lifecycle.begin('conversation-b');
 assert.equal(lifecycle.isCurrent(first,'conversation-a'),false);
 state.active={id:'conversation-b'};
 assert.equal(lifecycle.isCurrent(second,'conversation-b'),true);
 assert.equal(lifecycle.isCurrent(second,'conversation-a'),false);
}
{
 const state={active:{id:'conversation-a'}};
 const lifecycle=create({getState:()=>state});
 const token=lifecycle.begin('conversation-a');
 assert.equal(lifecycle.isCurrent(token,'conversation-a'),true);
 const invalidated=lifecycle.invalidate();
 assert.equal(invalidated,token+1);
 assert.equal(lifecycle.isCurrent(token,'conversation-a'),false);
 assert.equal(lifecycle.isCurrent(invalidated,'conversation-a'),true);
}
{
 const state={};
 const lifecycle=create({getState:()=>state});
 assert.equal(lifecycle.begin(null),0);
 assert.equal(lifecycle.isCurrent(0,'x'),false);
 assert.throws(()=>create({}),/getState/);
}
console.log('conversation lifecycle tests passed');
