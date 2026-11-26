(function(root){
 'use strict';
 function create(){
  let generation=0,activePromise=null,activeUserId=null;
  function isCurrent(version){return version===generation}
  function invalidate(){generation+=1;return generation}
  async function enter(user,run){
   if(!user||!user.id||typeof run!=='function')return false;
   if(activePromise){
    if(activeUserId===user.id)return activePromise;
    try{await activePromise}catch(_error){}
   }
   const version=generation;
   activeUserId=user.id;
   const pending=Promise.resolve().then(()=>run(user,version));
   activePromise=pending;
   try{return await pending}
   finally{
    if(activePromise===pending){activePromise=null;activeUserId=null}
   }
  }
  return Object.freeze({enter,invalidate,isCurrent,getVersion:()=>generation});
 }
 const api=Object.freeze({create});
 root.BizmindAuthSession=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
