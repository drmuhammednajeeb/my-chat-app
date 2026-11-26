/* Older-message pagination lifecycle. Dependencies are injected from the compatibility facade. */
(function(root){
 'use strict';
 async function loadOlderMessages(deps){
 const {state,$,supabaseClient,document,loadMessagePins,loadPrivateReplyContexts,messageReactions,renderMessage,compareMessagesChronologically,rollbackCancelledOlderHistory,reconcileMessageTimeline,toast}=deps;
 const conversationId=state.active?.id,area=$('messages');
 if(!conversationId||state.loadingOlderMessages||!state.hasMoreMessages||!state.messages?.length)return false;
 const oldest=state.messages[0];if(!oldest?.created_at||!oldest?.id)return false;
 const originalMessages=state.messages.slice(),originalHasMore=state.hasMoreMessages;
 const originalMessageIdSet=new Set(originalMessages.map(message=>message.id));
  state.loadingOlderMessages=true;const requestId=state.messageLoadVersion;state.loadingOlderRequestId=requestId;
 const anchor=Array.from(area.querySelectorAll('.message')).find(node=>node.getBoundingClientRect().bottom>area.getBoundingClientRect().top);
 const anchorId=anchor?.dataset.messageId,anchorTop=anchor?.getBoundingClientRect().top??0;
 const oldTop=area.scrollTop;
 const loader=document.createElement('div');loader.className='messages-history-loader';loader.textContent='جارٍ تحميل الرسائل الأقدم…';area.prepend(loader);
 const originalFirstChild=loader.nextSibling;
 let olderIds=new Set(),renderedHistoryIds=new Set(),requestRowsById=new Map();
 state.loadedHistoryIds ||= new Set();
 const originalLoadedHistoryIds=new Set(state.loadedHistoryIds);
 try{
  const cursorFilter='created_at.lt.'+oldest.created_at+',and(created_at.eq.'+oldest.created_at+',id.lt.'+oldest.id+')';
  let olderQuery=supabaseClient.from('chat_messages').select('*').eq('conversation_id',conversationId).or(cursorFilter);
  if(state.activeChatPreference?.cleared_before)olderQuery=olderQuery.gt('created_at',state.activeChatPreference.cleared_before);
  const {data,error}=await olderQuery.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(50);
  if(error)throw error;
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  const older=(data||[]).slice().reverse();
  if(!older.length){state.hasMoreMessages=false;return false}
  olderIds=new Set(older.map(message=>message.id));
  requestRowsById=new Map(older.map(message=>[message.id,message]));
  const replyIds=[...new Set(older.map(m=>m.reply_to).filter(id=>id&&!state.messages.some(x=>x.id===id)))];
  const replyTask=replyIds.length?supabaseClient.from('chat_messages').select('id,conversation_id,sender_id,content,deleted_at,created_at').eq('conversation_id',conversationId).in('id',replyIds):Promise.resolve({data:[],error:null});
  const [, , , replyResult]=await Promise.all([
   loadMessagePins(conversationId,requestId),
   loadPrivateReplyContexts(conversationId,older,requestId),
   messageReactions.load(conversationId,older,requestId),
   replyTask
  ]);
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId){rollbackCancelledOlderHistory(state,conversationId,olderIds,renderedHistoryIds,area,requestId,originalMessageIdSet,requestRowsById,originalLoadedHistoryIds);return false;}
  if(replyResult?.error)console.warn('Older reply metadata unavailable:',replyResult.error.message);
  else (replyResult?.data||[]).forEach(parent=>state.replyMessages.set(parent.id,parent));
  // Mark the page as retained before yielding to asynchronous rendering. A concurrent
  // reconciliation must treat these in-flight rows as loaded history.
  older.forEach(message=>state.loadedHistoryIds.add(message.id));
  const merged=new Map([...older,...state.messages].map(message=>[message.id,message]));
  state.messages=Array.from(merged.values()).sort((a,b)=>compareMessagesChronologically(a,b));
  state.hasMoreMessages=older.length===50;
  state.isLoadingMessages=true;state.batchRenderingMessages=true;state.batchRenderingConversationId=conversationId;area.style.overflowAnchor='none';
  const beforeRenderNodes=new Set(Array.from(area.childNodes));
  for(const message of older){
   if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId){rollbackCancelledOlderHistory(state,conversationId,olderIds,renderedHistoryIds,area,requestId,originalMessageIdSet,requestRowsById,originalLoadedHistoryIds);return false;}
   if(state.messageIds.has(message.id))continue;
   if(!originalMessageIdSet.has(message.id))renderedHistoryIds.add(message.id);
   const rendered=await renderMessage(message,conversationId,requestId);
   if(!rendered&&!state.messageIds.has(message.id))throw new Error('Older message rendering did not complete');
  }
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId){rollbackCancelledOlderHistory(state,conversationId,olderIds,renderedHistoryIds,area,requestId,originalMessageIdSet,requestRowsById,originalLoadedHistoryIds);return false;}
  state.batchRenderingMessages=false;state.batchRenderingConversationId=null;reconcileMessageTimeline(area);
  const addedSet=new Set(Array.from(area.querySelectorAll('.message')).filter(node=>olderIds.has(node.dataset.messageId)&&!beforeRenderNodes.has(node)));
  addedSet.forEach(node=>{const previous=node.previousElementSibling;if(previous?.classList.contains('day-divider')&&!beforeRenderNodes.has(previous))addedSet.add(previous)});
  const addedNodes=Array.from(area.childNodes).filter(node=>addedSet.has(node));
  const fragment=document.createDocumentFragment();addedNodes.forEach(node=>fragment.append(node));
  if(fragment.childNodes.length)area.insertBefore(fragment,originalFirstChild);
  loader.remove();
  const restoredAnchor=anchorId?Array.from(area.querySelectorAll('.message')).find(node=>node.dataset.messageId===anchorId):null;
  if(restoredAnchor)area.scrollTop=oldTop+(restoredAnchor.getBoundingClientRect().top-anchorTop);
  else area.scrollTop=oldTop;
  state.isLoadingMessages=false;area.style.overflowAnchor='';
  return true;
 }catch(error){
  console.error('Older message loading failed:',error);
  if(requestId===state.messageLoadVersion&&state.active?.id===conversationId){
   const rollbackApplied=rollbackCancelledOlderHistory(state,conversationId,olderIds,renderedHistoryIds,area,requestId,originalMessageIdSet,requestRowsById,originalLoadedHistoryIds);
   if(rollbackApplied){
    const restored=new Map(originalMessages.map(message=>[message.id,message]));
    for(const message of state.messages||[]){
     if(!originalMessageIdSet.has(message.id))restored.set(message.id,message);
    }
    state.messages=Array.from(restored.values()).sort((a,b)=>compareMessagesChronologically(a,b));
    state.hasMoreMessages=originalHasMore;
    state.batchRenderingMessages=false;state.batchRenderingConversationId=null;
    state.isLoadingMessages=false;area.style.overflowAnchor='';
    reconcileMessageTimeline(area);
    toast('تعذر تحميل الرسائل الأقدم؛ احتفظنا بالمحادثة الحالية دون فقد الرسائل.');
   }
  }
  return false;
 }finally{
  if(state.loadingOlderRequestId===requestId){
   if(state.batchRenderingMessages&&state.batchRenderingConversationId===conversationId){state.batchRenderingMessages=false;state.batchRenderingConversationId=null;if(state.active?.id===conversationId&&Number(state.messageTimelineCommitVersion)<=requestId&&(!state.messageTimelineRenderOwner||state.messageTimelineRenderOwner===requestId))reconcileMessageTimeline(area)}
   state.loadingOlderMessages=false;state.loadingOlderRequestId=null;
   if(requestId===state.messageLoadVersion&&state.active?.id===conversationId)state.isLoadingMessages=false;
   area.style.overflowAnchor='';
  }
  loader.remove();
 }
}
 root.BizmindOlderHistory=Object.freeze({loadOlderMessages});
})(typeof window!=='undefined'?window:globalThis);
