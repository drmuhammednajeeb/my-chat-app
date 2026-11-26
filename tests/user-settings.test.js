'use strict';
const assert=require('node:assert/strict');
const {create}=require('../modules/user-settings.js');
function fixture(){
 const state={user:{id:'user-a'},userSettings:{old:true}};
 const calls=[],warnings=[],themes=[];
 const client={
  from(table){assert.equal(table,'user_settings');return {select(column){assert.equal(column,'settings');return {eq(field,id){assert.equal(field,'user_id');return {maybeSingle:async()=>({data:{settings:{theme:'dark',density:'compact'}},error:null})}}}}},
  async rpc(name,args){calls.push({name,args});return {data:{theme:'light',language:'ar'},error:null}}
 };
 const controller=create({getState:()=>state,getClient:()=>client,onThemePreference:value=>themes.push(value),logger:{warn:(...args)=>warnings.push(args)}});
 return {state,calls,warnings,themes,controller};
}
(async()=>{
 {
  const f=fixture();assert.equal(await f.controller.load(),true);
  assert.deepEqual(f.state.userSettings,{theme:'dark',density:'compact'});
  assert.deepEqual(f.themes,['dark']);
 }
 {
  const f=fixture();assert.equal(await f.controller.save('theme','light'),true);
  assert.equal(f.calls[0].name,'patch_my_user_settings');
  assert.deepEqual(f.calls[0].args,{p_patch:{theme:'light'}});
  assert.deepEqual(f.state.userSettings,{theme:'light',language:'ar'});
 }
 {
  const f=fixture();f.state.user=null;
  assert.equal(await f.controller.load(),false);
  assert.equal(await f.controller.save('theme','dark'),false);
  assert.equal(f.calls.length,0);
 }
 {
  const f=fixture();await assert.rejects(()=>f.controller.save('__proto__',{}),TypeError);
  await assert.rejects(()=>f.controller.save('bad-key',1),TypeError);
 }
 {
  let release;const f=fixture();
  const pending=f.controller.load();
  f.state.user={id:'user-b'};
  assert.equal(await pending,false);
  void release;
 }
 {
  const f=fixture();f.state.userSettings=['invalid'];
  assert.equal(await f.controller.load(),true);
  assert.deepEqual(f.state.userSettings,{theme:'dark',density:'compact'});
 }
 console.log('user-settings tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
