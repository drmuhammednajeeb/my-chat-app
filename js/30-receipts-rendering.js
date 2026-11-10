async function markConversationReceipt(conversationId,markRead=true,requestId=null){
 const userId=state.user?.id;
 if(!userId||state.active?.id!==conversationId||(requestId!==null&&requestId!==state.messageLoadVersion))return false;
 state.receiptQueues ||= new Map();
 const previous=state.receiptQueues.get(conversationId)||Promise.resolve(false);
 const task=previous.catch(()=>false).then(async()=>{
  if(state.user?.id!==userId||state.active?.id!==conversationId||(requestId!==null&&requestId!==state.messageLoadVersion))return false;
  const stamp=new Date().toISOString(),patch={last_delivered_at:stamp};
  if(markRead)patch.last_read_at=stamp;
  const {error}=await supabaseClient.from('conversation_members').update(patch).eq('conversation_id',conversationId).eq('user_id',userId);
  if(error){console.warn('Receipt update failed',error.message);return false}
  if(state.user?.id!==userId||state.active?.id!==conversationId||(requestId!==null&&requestId!==state.messageLoadVersion))return false;
  const me=(state.active.members||[]).find(x=>x.user_id===userId);
  if(me){me.last_delivered_at=stamp;if(markRead)me.last_read_at=stamp}
  if(markRead){state.memberReads[conversationId]=stamp;const conv=state.conversations.find(x=>x.id===conversationId);if(conv)conv.last_read_at=stamp;renderConversations()}
  document.querySelectorAll('.message.mine').forEach(row=>{const msg=state.messages.find(x=>x.id===row.dataset.messageId),bubble=row.querySelector('.bubble');if(msg&&bubble){bubble.querySelector('.message-status')?.remove();renderMessageStatus(msg,bubble)}});
  return true;
 });
 state.receiptQueues.set(conversationId,task);
 try{return await task}
 finally{if(state.receiptQueues.get(conversationId)===task)state.receiptQueues.delete(conversationId)}
}
async function publishTyping(isTyping){if(!state.typingChannel||!state.user)return;const now=Date.now();if(isTyping&&now-state.typingSent<1000)return;state.typingSent=now;try{await state.typingChannel.send({type:'broadcast',event:'typing',payload:{user_id:state.user.id,name:state.profile?.display_name||'عضو',is_typing:isTyping}})}catch(e){console.debug('Typing broadcast failed',e?.message||e)}}
async function renderMessage(m,conversationId=state.active?.id,requestId=null){
 if(!m?.id||!conversationId||state.active?.id!==conversationId||(requestId!==null&&requestId!==state.messageLoadVersion))return false;
 state.messageRenderPromises ||= new Map();
 const pending=state.messageRenderPromises.get(m.id);
 if(pending){
  const rendered=await pending;
  if(rendered||state.messageIds.has(m.id))return true;
  if(state.active?.id!==conversationId||(requestId!==null&&requestId!==state.messageLoadVersion))return false;
  const latest=(state.messages||[]).find(item=>item.id===m.id);
  if(!latest)return false;
  return renderMessage(latest,conversationId,requestId);
 }
 const task=renderMessageInternal(m,conversationId,requestId);
 state.messageRenderPromises.set(m.id,task);
 try{return await task}
 finally{if(state.messageRenderPromises.get(m.id)===task)state.messageRenderPromises.delete(m.id)}
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
   if(!divider){divider=document.createElement('div');divider.className='day-divider';divider.dataset.day=day;divider.textContent=day}
   desired.push(divider);previousDay=day;
  }
  desired.push(row);
 }
 const current=Array.from(area.children);
 if(current.length===desired.length&&current.every((node,index)=>node===desired[index]))return;
 area.replaceChildren(...desired);
}
async function renderMessageInternal(m,conversationId=state.active?.id,requestId=null){
 if(!m?.id||!conversationId||state.active?.id!==conversationId||(requestId!==null&&requestId!==state.messageLoadVersion)||state.messageIds.has(m.id)||state.renderingMessageIds.has(m.id))return false;
 const isCurrent=()=>state.active?.id===conversationId&&(requestId===null||requestId===state.messageLoadVersion);
 const messageRenderStarted=performance.now();state.renderingMessageIds.add(m.id);
 try{
  const area=$('messages'),near=state.isLoadingMessages?true:isMessagesNearBottom(area,120);
  const d=new Date(m.created_at),day=d.toLocaleDateString('ar-SA',{weekday:'long',day:'numeric',month:'long'});
  const activeConversation=state.active;
  const member=(activeConversation?.members||[]).find(x=>x.user_id===m.sender_id),sender=member?.profile?.display_name||'عضو';
  const row=document.createElement('article');row.className='message'+(m.sender_id===state.user?.id?' mine':'');row.dataset.day=day;row.dataset.messageId=m.id;row.dataset.createdAt=m.created_at;
  const bubble=document.createElement('div');bubble.className='bubble'+(m.deleted_at?' deleted':'');
  if(m.sender_id!==state.user?.id&&(activeConversation?.type==='group'||activeConversation?.type==='channel')){const label=document.createElement('div');label.className='sender';label.textContent=sender;row.append(label)}
  if(state.active?.type==='direct'&&state.privateReplyContexts.has(m.id)&&!m.deleted_at){const ctx=state.privateReplyContexts.get(m.id),q=document.createElement('div');q.className='reply-quote private-reply-quote';const who=document.createElement('strong'),preview=document.createElement('span');who.textContent='رد خاص من مجموعة';preview.textContent=ctx.quoted_content;q.append(who,preview);bubble.append(q)}
  if(m.reply_to&&!m.deleted_at){let parent=state.messages.find(x=>x.id===m.reply_to)||state.replyMessages.get(m.reply_to);if(!parent){const {data:parentRow,error:parentError}=await supabaseClient.from('chat_messages').select('id,conversation_id,sender_id,content,deleted_at,created_at').eq('conversation_id',conversationId).eq('id',m.reply_to).maybeSingle();if(!isCurrent())return false;if(!parentError&&parentRow){parent=parentRow;state.replyMessages.set(parent.id,parent)}}const quote=document.createElement('div');quote.className='reply-quote';const who=document.createElement('strong');who.textContent=parent?.sender_id===state.user?.id?'أنت':((activeConversation?.members||[]).find(x=>x.user_id===parent?.sender_id)?.profile?.display_name||'رد على رسالة');const preview=document.createElement('span');preview.textContent=messagePreview(parent);quote.append(who,preview);quote.onclick=()=>jumpToMessage(m.reply_to);bubble.append(quote)}
  if(m.deleted_at){bubble.textContent='تم حذف هذه الرسالة'}else{
   if(m.attachment_path){
    const {data:signed,error:signedError}=await supabaseClient.storage.from('chat-media').createSignedUrl(m.attachment_path,3600);
    if(!isCurrent())return false;
    if(signedError){const failed=document.createElement('span');failed.textContent='تعذر فتح المرفق';bubble.append(failed)}
    else if(m.attachment_type?.startsWith('image/')){const img=document.createElement('img');img.src=signed.signedUrl;img.alt='مرفق';img.loading='lazy';img.onclick=()=>{$('lightboxImage').src=img.src;$('lightbox').classList.remove('hidden')};bubble.append(img)}
    else if(m.attachment_type?.startsWith('video/')){const video=document.createElement('video');video.className='message-video';video.controls=true;video.preload='metadata';video.playsInline=true;video.src=signed.signedUrl;video.setAttribute('aria-label','مرفق فيديو');bubble.append(video)}
    else if(m.attachment_type?.startsWith('audio/')){const audio=document.createElement('audio');audio.className='message-audio';audio.controls=true;audio.preload='metadata';audio.src=signed.signedUrl;audio.setAttribute('aria-label','رسالة صوتية');let signedAt=Date.now(),refreshing=false,retried=false;const refreshAudioUrl=async(resume=false)=>{if(refreshing)return;refreshing=true;try{const {data:renewed,error}=await supabaseClient.storage.from('chat-media').createSignedUrl(m.attachment_path,3600);if(error)throw error;if(!isCurrent()||!audio.isConnected)return;audio.src=renewed.signedUrl;signedAt=Date.now();audio.load();if(resume)await audio.play().catch(()=>{})}catch(error){console.warn('Audio URL refresh failed:',error?.message||error);toast('تعذر فتح الرسالة الصوتية. أعد تحميل المحادثة وحاول مجدداً')}finally{refreshing=false}};audio.addEventListener('play',()=>{if(Date.now()-signedAt>50*60*1000){audio.pause();refreshAudioUrl(true)}});audio.addEventListener('error',()=>{if(!retried){retried=true;refreshAudioUrl(false)}});audio.setAttribute('playsinline','');bubble.append(audio)}
    else{const a=document.createElement('a');a.href=signed.signedUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent='فتح المرفق';a.style.color='var(--accent)';bubble.append(a)}
   }
   if(m.content){
    const sticker=decodeChatSticker(m.content);
    if(sticker){const visual=document.createElement('div');visual.className='message-sticker';visual.textContent=sticker;visual.setAttribute('role','img');visual.setAttribute('aria-label','ملصق');bubble.append(visual)}
    else{const t=document.createElement('div');t.className='message-content';t.textContent=m.content;bubble.append(t)}
   }
  }
  const meta=document.createElement('div');meta.className='meta';meta.textContent=time(m.created_at)+(m.edited_at?' · تم تعديلها':'');bubble.append(meta);renderMessageStatus(m,bubble);
  if(!m.deleted_at){const actions=document.createElement('div');actions.className='message-menu-wrap';const trigger=document.createElement('button');trigger.type='button';trigger.className='message-menu-trigger';trigger.innerHTML='<i class="ph ph-dots-three-vertical"></i>';trigger.setAttribute('aria-label','خيارات الرسالة');trigger.setAttribute('aria-haspopup','true');trigger.setAttribute('aria-expanded','false');const menu=document.createElement('div');menu.className='message-options-menu hidden';menu.setAttribute('role','menu');const closeMenu=()=>{menu.classList.add('hidden');trigger.setAttribute('aria-expanded','false');if(menu.parentElement===document.body)actions.append(menu);menu.style.position='';menu.style.left='';menu.style.top='';menu.style.maxHeight='';menu._closeMenu=null};menu._closeMenu=closeMenu;const addOption=(label,icon,handler,disabled=false)=>{const option=document.createElement('button');option.type='button';option.className='message-menu-option';option.setAttribute('role','menuitem');option.innerHTML='<i class="ph '+icon+'"></i><span></span>';option.querySelector('span').textContent=label;option.disabled=disabled;if(label==='تعديل')option.dataset.editOption='true';option.onclick=event=>{event.stopPropagation();closeMenu();if(!option.disabled)handler()};menu.append(option);return option};addOption('إضافة تفاعل','ph-smiley',()=>openMessageReactions(row));addOption(state.starredMessageIds?.has(m.id)?'إزالة من المميزة':'تمييز بنجمة','ph-star',async()=>{const next=!state.starredMessageIds.has(m.id);if(await toggleMessageStar(m.id,next))toast(next?'تم تمييز الرسالة بنجمة':'تمت إزالة التمييز')});addOption('رد','ph-arrow-bend-up-right',()=>beginReply(m));const pinRecord=state.pinnedMessages.get(m.id),myRole=(activeConversation?.members||[]).find(x=>x.user_id===state.user?.id)?.role,canUnpin=!pinRecord||pinRecord.pinned_by===state.user?.id||['owner','admin'].includes(myRole)||state.isTeamAdmin;addOption(pinRecord?'إلغاء التثبيت':'تثبيت','ph-push-pin',()=>toggleMessagePin(m),!!pinRecord&&!canUnpin);if(m.sender_id===state.user?.id){const editOption=addOption('تعديل','ph-pencil-simple',()=>beginEditMessage(m),!canEditMessage(m));if(editOption.disabled)editOption.title='انتهت مهلة التعديل أو الرسالة غير نصية';addOption('حذف','ph-trash',()=>deleteMessage(m))}
  if(activeConversation?.type==='group'&&m.sender_id!==state.user?.id)addOption('رد خاص','ph-chat-circle-dots',()=>replyPrivatelyToGroupMessage(m));if(m.edited_at&&(m.sender_id===state.user?.id||state.isTeamAdmin))addOption('سجل التعديلات','ph-clock-counter-clockwise',()=>openMessageEditHistory(m));trigger.onclick=event=>{
 event.stopPropagation();const opening=menu.classList.contains('hidden');
 document.querySelectorAll('.message-options-menu').forEach(other=>{if(other!==menu){if(other._closeMenu)other._closeMenu();else other.classList.add('hidden')}});
 document.querySelectorAll('.message-menu-trigger').forEach(other=>{if(other!==trigger)other.setAttribute('aria-expanded','false')});
 const editOption=menu.querySelector('[data-edit-option]');if(editOption){editOption.disabled=!canEditMessage(m);editOption.querySelector('span').textContent=editOption.disabled?'انتهت مهلة التعديل':'تعديل'}
 if(!opening){closeMenu();return}
 menu.classList.remove('hidden');document.body.append(menu);menu.style.position='fixed';menu.style.zIndex='1200';menu.style.maxHeight='min(70dvh,520px)';menu.style.overflowY='auto';
 const anchor=trigger.getBoundingClientRect(),box=menu.getBoundingClientRect(),pad=8;
 let left=anchor.right-box.width;if(getComputedStyle(document.documentElement).direction!=='rtl')left=anchor.left;
 left=Math.max(pad,Math.min(left,window.innerWidth-box.width-pad));
 let top=anchor.bottom+4;if(top+box.height>window.innerHeight-pad)top=anchor.top-box.height-4;
 top=Math.max(pad,Math.min(top,window.innerHeight-box.height-pad));
 menu.style.left=Math.round(left)+'px';menu.style.top=Math.round(top)+'px';trigger.setAttribute('aria-expanded','true');
};menu.onclick=event=>event.stopPropagation();actions.append(trigger,menu);bubble.append(actions)}
  row.append(bubble);renderReactionBar(row,m);renderMessagePinMark(row,m);bindMessageGestures(row,m);
  if(!isCurrent())return false;
  const latestMessage=(state.messages||[]).find(item=>item.id===m.id);if(!latestMessage||latestMessage!==m)return false;
  const empty=area.querySelector('.welcome');if(empty)area.replaceChildren();
  const last=area.lastElementChild;if(!last||last.dataset.day!==day){const sep=document.createElement('div');sep.className='day-divider';sep.textContent=day;sep.dataset.day=day;area.append(sep)}
  area.append(row);state.messageIds.add(m.id);reconcileMessageTimeline(area);state.diagnostics.lastRenderAt=new Date().toLocaleTimeString('en-GB');
  if(!state.isLoadingMessages){if(m.sender_id===state.user?.id){clearNewMessages(false);scheduleMessagesBottom(area,'auto')}else if(near){scheduleMessagesBottom(area,'auto')}else{state.newMessageCount=(state.newMessageCount||0)+1;updateNewMessagesIndicator()}}
  updateDiagnostics();
  return true;
 }catch(error){
  state.messageIds.delete(m.id);state.diagnostics.lastRenderError=String(error?.message||error);console.error('Message rendering failed:',error);diagLog('render-error',{id:m.id,error:state.diagnostics.lastRenderError});
  if(isCurrent())toast('تعذر عرض أحد المرفقات، لكن يمكنك متابعة الكتابة والإرسال');
  return false;
 }finally{state.renderingMessageIds.delete(m.id);recordPerf('message_render_item',performance.now()-messageRenderStarted)}
}
