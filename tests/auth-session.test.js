'use strict';
const assert=require('node:assert/strict');
const {create}=require('../modules/auth-session.js');
(async()=>{
 {
  const lifecycle=create();let calls=0,versions=[];
  const run=async(user,version)=>{calls++;versions.push(version);return user.id};
  const [a,b]=await Promise.all([lifecycle.enter({id:'a'},run),lifecycle.enter({id:'a'},run)]);
  assert.equal(a,'a');assert.equal(b,'a');assert.equal(calls,1);assert.deepEqual(versions,[0]);
 }
 {
  const lifecycle=create();let release;
  const first=lifecycle.enter({id:'a'},()=>new Promise(resolve=>{release=resolve}));
  await Promise.resolve();lifecycle.invalidate();
  assert.equal(lifecycle.isCurrent(0),false);
  release('done');assert.equal(await first,'done');
  assert.equal(lifecycle.isCurrent(1),true);
 }
 {
  const lifecycle=create();let releaseFirst,secondStarted=false;
  const first=lifecycle.enter({id:'a'},()=>new Promise(resolve=>{releaseFirst=resolve}));
  await Promise.resolve();
  const second=lifecycle.enter({id:'b'},()=>{secondStarted=true;return 'b'});
  await Promise.resolve();assert.equal(secondStarted,false);
  releaseFirst('a');assert.equal(await first,'a');assert.equal(await second,'b');assert.equal(secondStarted,true);
 }
 {
  const lifecycle=create();assert.equal(await lifecycle.enter(null,()=>true),false);
  assert.equal(await lifecycle.enter({id:'x'},null),false);
  assert.equal(lifecycle.isCurrent(lifecycle.getVersion()),true);
  lifecycle.invalidate();assert.equal(lifecycle.getVersion(),1);
 }
 console.log('auth-session lifecycle tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
