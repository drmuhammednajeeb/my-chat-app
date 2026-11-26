/* DOM/state helpers for stable message timeline reconciliation and rollback. */
(function(root){
 'use strict';
 function rollbackCancelledOlderHistory(state,conversationId,olderIds,renderedHistoryIds,area,requestId,originalMessageIdSet,requestRowsById,originalLoadedHistoryIds){
  if(state.active?.id!==conversationId)return false;
  const newerTimelineAlreadyCommitted=Number(state.messageTimelineCommitVersion)>requestId;
  const newerRenderOwnsTimeline=!!state.messageTimelineRenderOwner&&state.messageTimelineRenderOwner!==requestId;
  if(newerTimelineAlreadyCommitted||newerRenderOwnsTimeline)return false;
  const before=state.messages||[],removedIds=new Set();
  state.messages=before.filter(message=>{
   if(!olderIds.has(message.id)||originalMessageIdSet?.has(message.id))return true;
   if(requestRowsById?.get(message.id)!==message)return true;
   removedIds.add(message.id);return false;
  });
  removedIds.forEach(id=>{
   Array.from(area.querySelectorAll('.message')).filter(node=>node.dataset.messageId===id).forEach(node=>node.remove());
   state.messageIds.delete(id);
   if(!originalLoadedHistoryIds?.has(id))state.loadedHistoryIds?.delete(id);
  });
  return true;
 }
 function reconcileMessageTimeline(area){
  if(!area)return;
  const rows=Array.from(area.querySelectorAll(':scope > .message'));
  rows.sort((a,b)=>{
   const at=Date.parse(a.dataset.createdAt||''),bt=Date.parse(b.dataset.createdAt||'');
   const timeDiff=(Number.isFinite(at)?at:0)-(Number.isFinite(bt)?bt:0);
   if(timeDiff)return timeDiff;
   return String(a.dataset.messageId||'').localeCompare(String(b.dataset.messageId||''));
  });
  const existingDividers=new Map();
  Array.from(area.children).filter(node=>node.classList.contains('day-divider')).forEach(node=>{
   const day=node.dataset.day||node.textContent||'';
   if(!existingDividers.has(day))existingDividers.set(day,node);
  });
  const fixed=Array.from(area.children).filter(node=>!node.classList.contains('message')&&!node.classList.contains('day-divider'));
  const desired=[...fixed];let previousDay=null;
  for(const row of rows){
   const day=row.dataset.day||'';
   if(day!==previousDay){
    let divider=existingDividers.get(day);
    if(!divider){divider=area.ownerDocument.createElement('div');divider.className='day-divider';divider.dataset.day=day;divider.textContent=day}
    desired.push(divider);previousDay=day;
   }
   desired.push(row);
  }
  const current=Array.from(area.children);
  if(current.length===desired.length&&current.every((node,index)=>node===desired[index]))return;
  area.replaceChildren(...desired);
 }
 root.BizmindMessageTimeline=Object.freeze({rollbackCancelledOlderHistory,reconcileMessageTimeline});
})(typeof window!=='undefined'?window:globalThis);
