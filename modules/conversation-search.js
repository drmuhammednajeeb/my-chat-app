(function(root){
 'use strict';
 async function searchConversationMessages(options){
  const {client,conversationId,query,clearedBefore,hiddenIds,isCurrent}=options||{};
  const term=String(query||'').trim();
  if(!client||!conversationId||term.length<2)return {status:'invalid',messages:[]};
  let request=client.from('chat_messages').select('id,conversation_id,sender_id,content,created_at,deleted_at').eq('conversation_id',conversationId).ilike('content','%'+term+'%');
  if(clearedBefore)request=request.gt('created_at',clearedBefore);
  const {data,error}=await request.order('created_at',{ascending:false}).limit(30);
  if(error)throw error;
  if(typeof isCurrent==='function'&&!isCurrent())return {status:'stale',messages:[]};
  const hidden=hiddenIds instanceof Set?hiddenIds:new Set();
  return {status:'ok',messages:(data||[]).filter(message=>!hidden.has(message.id))};
 }
 root.BizmindConversationSearch=Object.freeze({searchConversationMessages});
})(typeof window!=='undefined'?window:globalThis);
