(function(root){
 'use strict';
 function create(options){
  const getState=options&&options.getState;
  if(typeof getState!=='function')throw new TypeError('Conversation lifecycle requires getState');
  function state(){const value=getState();if(!value||typeof value!=='object')throw new TypeError('Conversation state is unavailable');return value}
  function begin(conversationId){
   if(!conversationId)return 0;
   const current=state();
   current.conversationOpenVersion=(Number(current.conversationOpenVersion)||0)+1;
   return current.conversationOpenVersion;
  }
  function isCurrent(token,conversationId){
   if(!conversationId||!Number.isInteger(token))return false;
   const current=state();
   return current.conversationOpenVersion===token&&current.active?.id===conversationId;
  }
  function invalidate(){
   const current=state();
   current.conversationOpenVersion=(Number(current.conversationOpenVersion)||0)+1;
   return current.conversationOpenVersion;
  }
  return Object.freeze({begin,isCurrent,invalidate,getVersion:()=>Number(state().conversationOpenVersion)||0});
 }
 const api=Object.freeze({create});
 root.BizmindConversationLifecycle=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
