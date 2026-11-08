/* Extracted from current main 66e4c2a7efd980e622768260da2eccf2baf868c7; classic-script execution retained. */
'use strict';

async function loadMessageReactions(conversationId,messages){
 const ids=(messages||[]).filter(m=>!m.deleted_at).map(m=>m.id);if(!ids.length)return true;
 try{
  const {data,error}=await supabaseClient.from('message_reactions').select('message_id,user_id,reaction_type').eq('conversation_id',conversationId).in('message_id',ids);
  if(error)throw error;
  const next=new Map(state.reactions||[]);ids.forEach(id=>next.delete(id));
  (data||[]).forEach(r=>{const list=next.get(r.message_id)||[];list.push(r);next.set(r.message_id,list)});
  state.reactions=next;return true;
 }catch(error){console.warn('Message reactions could not be loaded:',error?.message||error);return false}
}

function renderReactionBar(row,message){
 const previous=row.querySelector('.reaction-bar'),wasOpen=row.classList.contains('reactions-open');if(previous)previous.remove();
 if(message.deleted_at)return;
 const reactions=state.reactions.get(message.id)||[],bar=document.createElement('div');bar.className='reaction-bar';bar.setAttribute('aria-label','التفاعلات');
 MESSAGE_REACTION_OPTIONS.forEach(option=>{
  const matching=reactions.filter(r=>r.reaction_type===option.type),mine=matching.some(r=>r.user_id===state.user?.id);
  const button=document.createElement('button');button.type='button';button.className='reaction-btn'+(mine?' active':'');button.dataset.reaction=option.type;button.title=option.label;button.setAttribute('aria-label',option.label+' · '+matching.length);button.setAttribute('aria-pressed',String(mine));button.append(document.createTextNode(option.emoji));
  if(matching.length){const count=document.createElement('span');count.className='reaction-count';count.textContent=matching.length.toLocaleString('en-US');count.title='عرض الأعضاء الذين تفاعلوا';count.addEventListener('click',event=>{event.stopPropagation();showReactionMembers(message,option,matching)});button.append(count)}
  button.onclick=()=>toggleMessageReaction(message,option.type,button);bar.append(button);
 });
 row.append(bar);row.classList.toggle('reactions-open',wasOpen);
 if(wasOpen)positionMessageReactionBar(row);
}

function positionMessageReactionBar(row){
 const bar=row?.querySelector('.reaction-bar');if(!row||!bar||!row.classList.contains('reactions-open'))return;
 // Keep the reaction palette in the message's own positioning context.
 // CSS anchors it directly below the message; avoid viewport coordinates
 // that drift when the message list scrolls or reflows.
 bar.style.top='';bar.style.left='';bar.style.right='';
}

function openMessageReactions(row){
 if(!row||row.querySelector('.bubble.deleted'))return;
 document.querySelectorAll('.message.reactions-open').forEach(item=>{if(item!==row){item.classList.remove('reactions-open');const old=item.querySelector('.reaction-bar');if(old){old.style.top='';old.style.left='';old.style.right=''}}});
 const opening=!row.classList.contains('reactions-open');row.classList.toggle('reactions-open',opening);
 const bar=row.querySelector('.reaction-bar');if(!bar)return;
 if(!opening){bar.style.top='';bar.style.left='';bar.style.right='';return}
 positionMessageReactionBar(row);
}

async function toggleMessageReaction(message,reactionType,button){
 const conversationId=message.conversation_id||state.active?.id,userId=state.user?.id;
 if(!conversationId||!userId||state.active?.id!==conversationId||message.deleted_at)return;
 const pendingKey=message.id+':'+userId;if(pendingReactionKeys.has(pendingKey))return;
 pendingReactionKeys.add(pendingKey);
 const current=[...(state.reactions.get(message.id)||[])],mine=current.find(r=>r.user_id===userId);
 const next=current.filter(r=>r.user_id!==userId),removing=mine?.reaction_type===reactionType;
 if(!removing)next.push({message_id:message.id,conversation_id:conversationId,user_id:userId,reaction_type:reactionType});
 state.reactions.set(message.id,next);
 const row=Array.from(document.querySelectorAll('.message')).find(x=>x.dataset.messageId===message.id);
 if(row)renderReactionBar(row,message);
 try{
  let result;
  if(removing)result=await supabaseClient.from('message_reactions').delete().eq('conversation_id',conversationId).eq('message_id',message.id).eq('user_id',userId);
  else result=await supabaseClient.from('message_reactions').upsert({conversation_id:conversationId,message_id:message.id,user_id:userId,reaction_type:reactionType},{onConflict:'message_id,user_id'});
  if(result.error)throw result.error;
 }catch(error){
  state.reactions.set(message.id,current);
  const activeRow=Array.from(document.querySelectorAll('.message')).find(x=>x.dataset.messageId===message.id);
  if(activeRow)renderReactionBar(activeRow,message);
  console.error('Message reaction failed:',error);toast('تعذر حفظ التفاعل. أُعيدت الحالة السابقة؛ حاول مجدداً');
 }finally{pendingReactionKeys.delete(pendingKey);if(button?.isConnected)button.disabled=false}
}

function showMessageDetailModal(title,contentNode){
 document.querySelector('.message-detail-overlay')?.remove();
 const overlay=document.createElement('div');overlay.className='message-detail-overlay';
 const panel=document.createElement('section');panel.className='message-detail-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',title);
 const header=document.createElement('header');header.className='message-detail-header';
 const heading=document.createElement('h3');heading.textContent=title;
 const close=document.createElement('button');close.type='button';close.className='message-detail-close';close.setAttribute('aria-label','إغلاق');close.innerHTML='<i class="ph ph-x"></i>';
 const body=document.createElement('div');body.className='message-detail-body';if(contentNode)body.append(contentNode);
 const dismiss=()=>{overlay.remove();document.removeEventListener('keydown',onKey)};
 const onKey=event=>{if(event.key==='Escape')dismiss()};
 close.addEventListener('click',dismiss);overlay.addEventListener('click',event=>{if(event.target===overlay)dismiss()});
 header.append(heading,close);panel.append(header,body);overlay.append(panel);document.body.append(overlay);
 document.addEventListener('keydown',onKey);close.focus();
}

async function showReactionMembers(message,option,matching){
 const ids=[...new Set((matching||[]).map(item=>item.user_id).filter(Boolean))];if(!ids.length)return;
 try{
  const {data,error}=await supabaseClient.from('profiles').select('id,display_name,username').in('id',ids);if(error)throw error;
  const list=document.createElement('div');list.className='message-detail-list';
  (data||[]).forEach(profile=>{const item=document.createElement('div');item.className='message-detail-person';const name=document.createElement('strong');name.textContent=profile.display_name||profile.username||'عضو';const handle=document.createElement('span');handle.textContent=profile.username?'@'+profile.username:'';item.append(name,handle);list.append(item)});
  showMessageDetailModal(option.emoji+' '+option.label+' · '+ids.length,list);
 }catch(error){console.error('Reaction members load failed:',error);toast('تعذر تحميل قائمة المتفاعلين')}
}

async function openMessageEditHistory(message){
 if(!message?.edited_at||!(message.sender_id===state.user?.id||state.isTeamAdmin)){toast('لا تملك صلاحية الاطلاع على سجل التعديلات');return}
 try{
  const {data,error}=await supabaseClient.from('message_edit_history').select('revision_number,editor_id,old_content,new_content,edited_at').eq('message_id',message.id).order('revision_number',{ascending:true});if(error)throw error;
  const list=document.createElement('div');list.className='message-history-list';
  if(!data?.length){const empty=document.createElement('p');empty.className='message-detail-empty';empty.textContent='لا يتوفر سجل سابق لهذه الرسالة. قد يكون تعديلها قد تم قبل تفعيل سجل المراجعة.';list.append(empty)}
  const editorIds=[...new Set((data||[]).map(row=>row.editor_id))];
  const profilesResult=editorIds.length?await supabaseClient.from('profiles').select('id,display_name,username').in('id',editorIds):{data:[],error:null};if(profilesResult.error)throw profilesResult.error;
  const names=new Map((profilesResult.data||[]).map(profile=>[profile.id,profile.display_name||profile.username||'عضو']));
  (data||[]).forEach(entry=>{
   const card=document.createElement('article');card.className='message-history-entry';
   const top=document.createElement('div');top.className='message-history-top';
   const revision=document.createElement('strong');revision.textContent='التعديل رقم '+entry.revision_number;
   const when=document.createElement('time');when.textContent=new Date(entry.edited_at).toLocaleString('ar-SA');
   const editor=document.createElement('span');editor.textContent=names.get(entry.editor_id)||'مسؤول/صاحب الرسالة';
   top.append(revision,when,editor);
   const oldLabel=document.createElement('small');oldLabel.textContent='النص السابق';const oldText=document.createElement('p');oldText.textContent=entry.old_content;
   const newLabel=document.createElement('small');newLabel.textContent='النص بعد التعديل';const newText=document.createElement('p');newText.textContent=entry.new_content;
   card.append(top,oldLabel,oldText,newLabel,newText);list.append(card);
  });
  showMessageDetailModal('سجل تعديلات الرسالة',list);
 }catch(error){console.error('Message edit history load failed:',error);toast('تعذر تحميل سجل التعديلات أو لا تملك صلاحية الاطلاع عليه')}
}

function messagePreview(m){if(!m)return 'رسالة غير متاحة';if(m.deleted_at)return 'تم حذف هذه الرسالة';return String(m.content||(m.attachment_path?'مرفق':'رسالة')).slice(0,180)}

function renderComposerContext(){const privateReply=state.privateReplyPending,target=state.editTarget||state.replyTarget||privateReply,box=$('composerContext');if(!box)return;if(!target){box.classList.add('hidden');$('composerContextText').textContent='';$('attachBtn').disabled=false;$('sendBtn').title='إرسال';$('sendBtn').innerHTML='<i class="ph ph-paper-plane-tilt"></i>';return}box.classList.remove('hidden');$('composerContextLabel').textContent=state.editTarget?'تعديل الرسالة':privateReply?'رد خاص من المجموعة':'الرد على الرسالة';$('composerContextText').textContent=privateReply?privateReply.quotedContent:messagePreview(target);$('sendBtn').title=state.editTarget?'حفظ التعديل':'إرسال الرد';$('sendBtn').innerHTML=state.editTarget?'<i class="ph ph-check"></i>':'<i class="ph ph-paper-plane-tilt"></i>'}

function bindMessageGestures(bubble,row,message){
 if(!bubble||!row||!message||message.deleted_at)return;
 let gesture=null;
 const clear=()=>{
  if(!gesture)return;
  bubble.style.transform='';
  bubble.style.transition='';
  bubble.style.userSelect='';
  bubble.style.webkitUserSelect='';
  row.classList.remove('swipe-ready');
  row.querySelector('.swipe-reply-indicator')?.remove();
  gesture=null;
 };
 bubble.addEventListener('pointerdown',event=>{
  if(!event.isPrimary||!['touch','pen','mouse'].includes(event.pointerType)||event.button!==0)return;
  if(event.target.closest('button,a,audio,video,input,textarea,.reply-quote,.message-menu-wrap'))return;
  clear();
  gesture={pointerId:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0,locked:false};
 },{passive:true});
 bubble.addEventListener('pointermove',event=>{
  if(!gesture||event.pointerId!==gesture.pointerId)return;
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
  gesture.dx=dx;gesture.dy=dy;
  if(!gesture.locked){
   if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)*1.1){clear();return}
   if(Math.abs(dx)<8||Math.abs(dx)<Math.abs(dy)*1.15)return;
   gesture.locked=true;
   if(event.cancelable)event.preventDefault();
   bubble.style.userSelect='none';bubble.style.webkitUserSelect='none';
   try{bubble.setPointerCapture(event.pointerId)}catch(_){}
   const indicator=document.createElement('span');
   indicator.className='swipe-reply-indicator';
   indicator.innerHTML='<i class="ph ph-arrow-bend-up-left"></i>';
   row.append(indicator);
  }
  if(event.cancelable)event.preventDefault();
  bubble.style.transition='none';
  bubble.style.transform='translateX('+Math.max(-72,Math.min(72,dx))+'px)';
  row.classList.toggle('swipe-ready',Math.abs(dx)>=28);
 },{passive:false});
 const finish=event=>{
  if(!gesture||event.pointerId!==gesture.pointerId)return;
  const shouldReply=gesture.locked&&Math.abs(gesture.dx)>=46&&Math.abs(gesture.dx)>Math.abs(gesture.dy)*1.2;
  clear();
  if(shouldReply)beginReply(message);
 };
 bubble.addEventListener('pointerup',finish);
 bubble.addEventListener('pointercancel',clear);
 bubble.addEventListener('lostpointercapture',()=>{if(gesture)clear()});
}
 
function beginReply(m){if(!m||m.deleted_at)return;if(state.editTarget)$('messageInput').value='';state.editTarget=null;$('attachBtn').disabled=false;state.replyTarget=m;renderComposerContext();resizeComposer();$('messageInput').focus()}

function canEditMessage(m){
 if(!m||m.deleted_at||m.sender_id!==state.user?.id||!state.active||!['direct','group'].includes(state.active.type))return false;
 if(m.attachment_path||m.attachment_type)return false;
 const createdAt=Date.parse(m.created_at);return Number.isFinite(createdAt)&&Date.now()<=createdAt+15*60*1000;
}

function beginEditMessage(m){
 if(!m||m.sender_id!==state.user?.id||m.deleted_at){toast('يمكنك تعديل رسائلك أنت فقط');return}
 if(!canEditMessage(m)){toast('انتهت مهلة تعديل الرسالة أو أن نوعها غير قابل للتعديل');return}
 state.editTarget=m;state.replyTarget=null;$('attachBtn').disabled=true;$('messageInput').value=m.content||'';state.attachment=null;$('fileInput').value='';$('attachmentPreview').classList.add('hidden');renderComposerContext();resizeComposer();$('messageInput').focus();$('messageInput').setSelectionRange($('messageInput').value.length,$('messageInput').value.length)
}

function cancelComposerContext(){state.replyTarget=null;state.editTarget=null;state.privateReplyPending=null;renderComposerContext()}

function renderPinnedBanner(){const box=$('pinnedBanner');if(!box)return;const cutoff=state.activeChatPreference?.cleared_before,pins=[...state.pinnedMessages.values()].filter(pin=>{const message=state.messages.find(m=>m.id===pin.message_id)||state.replyMessages.get(pin.message_id);return !cutoff||(message?.created_at&&new Date(message.created_at)>new Date(cutoff))}).sort((a,b)=>new Date(b.pinned_at)-new Date(a.pinned_at)),latest=pins[0];if(!latest){box.classList.add('hidden');return}const message=state.messages.find(m=>m.id===latest.message_id)||state.replyMessages.get(latest.message_id);box.classList.remove('hidden');$('pinnedText').textContent=messagePreview(message);const role=(state.active?.members||[]).find(m=>m.user_id===state.user?.id)?.role;$('pinnedUnpin').classList.toggle('hidden',latest.pinned_by!==state.user?.id&&!['owner','admin'].includes(role)&&!state.isTeamAdmin);$('pinnedJump').onclick=()=>jumpToMessage(latest.message_id);$('pinnedUnpin').onclick=()=>toggleMessagePin(message||{id:latest.message_id,conversation_id:state.active?.id})}

async function searchActiveConversation(term){
 const panel=$('chatSearchResults'),conversationId=state.active?.id,query=String(term||'').trim();
 const request=++state.chatSearchRequest;if(!panel)return;
 panel.replaceChildren();
 if(!query){const p=document.createElement('p');p.textContent='اكتب كلمة للبحث داخل المحادثة الحالية.';panel.append(p);return}
 if(!conversationId){const p=document.createElement('p');p.textContent='افتح محادثة أولاً.';panel.append(p);return}
 if(query.length<2){const p=document.createElement('p');p.textContent='اكتب حرفين على الأقل.';panel.append(p);return}
 const loading=document.createElement('p');loading.textContent='جارٍ البحث…';panel.append(loading);
 try{
  const pattern='%'+query+'%';
  let searchQuery=supabaseClient.from('chat_messages').select('id,conversation_id,sender_id,content,created_at,deleted_at').eq('conversation_id',conversationId).ilike('content',pattern);if(state.activeChatPreference?.cleared_before)searchQuery=searchQuery.gt('created_at',state.activeChatPreference.cleared_before);const {data,error}=await searchQuery.order('created_at',{ascending:false}).limit(30);
  if(error)throw error;if(request!==state.chatSearchRequest||state.active?.id!==conversationId)return;
  panel.replaceChildren();
  if(!data?.length){const p=document.createElement('p');p.textContent='لا توجد رسائل مطابقة في هذه المحادثة.';panel.append(p);return}
  data.forEach(message=>{const button=document.createElement('button');button.type='button';button.className='chat-search-result';const member=(state.active?.members||[]).find(m=>m.user_id===message.sender_id);const name=document.createElement('strong');name.textContent=member?.profile?.display_name||(message.sender_id===state.user?.id?'أنت':'عضو');const body=document.createElement('span');body.textContent=message.deleted_at?'تم حذف هذه الرسالة':message.content||'مرفق';const date=document.createElement('small');date.textContent=new Date(message.created_at).toLocaleString('ar-SA');button.append(name,body,date);button.onclick=()=>{$('chatSearchPanel').classList.add('hidden');jumpToMessage(message.id)};panel.append(button)});
 }catch(error){console.error('Conversation search failed:',error);panel.replaceChildren();const p=document.createElement('p');p.textContent='تعذر البحث. حاول مرة أخرى.';panel.append(p)}
}

async function jumpToMessage(id){
 let row=Array.from(document.querySelectorAll('.message')).find(x=>x.dataset.messageId===id);
 if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.classList.add('flash');setTimeout(()=>row.classList.remove('flash'),1500);return}
 const conversationId=state.active?.id;if(!conversationId)return;
 try{
  let targetQuery=supabaseClient.from('chat_messages').select('*').eq('conversation_id',conversationId).eq('id',id);if(state.activeChatPreference?.cleared_before)targetQuery=targetQuery.gt('created_at',state.activeChatPreference.cleared_before);const {data:target,error}=await targetQuery.maybeSingle();
  if(error||!target){toast('تعذر العثور على الرسالة المثبتة');return}
  const [beforeResult,afterResult]=await Promise.all([
   supabaseClient.from('chat_messages').select('*').eq('conversation_id',conversationId).lt('created_at',target.created_at).gt('created_at',state.activeChatPreference?.cleared_before||'1970-01-01T00:00:00.000Z').order('created_at',{ascending:false}).limit(40),
   supabaseClient.from('chat_messages').select('*').eq('conversation_id',conversationId).gt('created_at',target.created_at).order('created_at',{ascending:true}).limit(40)
  ]);
  if(beforeResult.error||afterResult.error)throw beforeResult.error||afterResult.error;
  const rows=[...(beforeResult.data||[]).reverse(),target,...(afterResult.data||[])].sort(compareMessagesChronologically);
  const requestId=++state.messageLoadVersion;state.isLoadingMessages=true;state.messages=rows;state.replyMessages=new Map();
  const replyIds=[...new Set(rows.map(m=>m.reply_to).filter(x=>x&&!rows.some(m=>m.id===x)))];
  if(replyIds.length){const {data:parents,error:parentError}=await supabaseClient.from('chat_messages').select('id,conversation_id,sender_id,content,deleted_at,created_at').eq('conversation_id',conversationId).in('id',replyIds);if(!parentError)(parents||[]).forEach(m=>state.replyMessages.set(m.id,m))}
  await loadMessageReactions(conversationId,rows);await loadMessagePins(conversationId);
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return;
  const area=$('messages');area.replaceChildren();state.messageIds.clear();state.renderingMessageIds.clear();
  for(const message of rows){if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId){state.isLoadingMessages=false;return}await renderMessage(message,conversationId,requestId)}
  state.isLoadingMessages=false;
  row=Array.from(document.querySelectorAll('.message')).find(x=>x.dataset.messageId===id);
  if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.classList.add('flash');setTimeout(()=>row.classList.remove('flash'),1500)}
 }catch(error){state.isLoadingMessages=false;console.error('Jump to message failed:',error);toast('تعذر تحميل الرسائل المحيطة بالرسالة المطلوبة')}
}

async function loadMessagePins(id){const {data,error}=await supabaseClient.from('message_pins').select('id,conversation_id,message_id,pinned_by,pinned_at').eq('conversation_id',id).order('pinned_at',{ascending:false});if(error){console.warn('Pinned messages load failed',error.message);state.pinnedMessages=new Map();renderPinnedBanner();return false}state.pinnedMessages=new Map((data||[]).map(x=>[x.message_id,x]));const missing=[...state.pinnedMessages.keys()].filter(mid=>!state.messages.some(m=>m.id===mid)&&!state.replyMessages.has(mid));if(missing.length){const {data:rows,error:messageError}=await supabaseClient.from('chat_messages').select('id,conversation_id,sender_id,content,deleted_at,created_at,attachment_path').eq('conversation_id',id).in('id',missing);if(!messageError)(rows||[]).forEach(m=>state.replyMessages.set(m.id,m))}renderPinnedBanner();return true}

async function toggleMessagePin(m){if(!m?.id||!state.active?.id)return;const id=state.active.id,existing=state.pinnedMessages.get(m.id);try{if(existing){const {error}=await supabaseClient.from('message_pins').delete().eq('conversation_id',id).eq('message_id',m.id);if(error)throw error;state.pinnedMessages.delete(m.id);toast('تم إلغاء تثبيت الرسالة')}else{const {data,error}=await supabaseClient.from('message_pins').insert({conversation_id:id,message_id:m.id,pinned_by:state.user.id}).select().single();if(error)throw error;state.pinnedMessages.set(m.id,data);toast('تم تثبيت الرسالة')}renderPinnedBanner();const row=Array.from(document.querySelectorAll('.message')).find(x=>x.dataset.messageId===m.id);if(row)renderMessagePinMark(row,m)}catch(error){console.error('Pin action failed',error);toast('تعذر تغيير تثبيت الرسالة. تحقق من صلاحياتك')}}

function renderMessagePinMark(row,m){row.querySelector('.message-pinned-mark')?.remove();if(!state.pinnedMessages.has(m.id)||m.deleted_at)return;const mark=document.createElement('div');mark.className='message-pinned-mark';mark.textContent='📌 رسالة مثبتة';row.querySelector('.bubble')?.prepend(mark)}

function renderMessageStatus(m,bubble){if(m.sender_id!==state.user?.id||m.deleted_at)return;const others=(state.active?.members||[]).filter(x=>x.user_id!==state.user.id),delivered=others.filter(x=>x.last_delivered_at&&new Date(x.last_delivered_at)>=new Date(m.created_at)).length,read=others.filter(x=>x.last_read_at&&new Date(x.last_read_at)>=new Date(m.created_at)).length,status=document.createElement('span');status.className='message-status';if(others.length===1){if(read){status.classList.add('read');status.innerHTML='<span class="ticks">✓✓</span><span>مقروءة</span>'}else if(delivered){status.classList.add('delivered');status.innerHTML='<span class="ticks">✓✓</span><span>تم التسليم</span>'}else status.innerHTML='<span class="ticks">✓</span><span>تم الإرسال</span>'}else if(others.length>1){if(read){status.classList.add('read','group-status');status.textContent='قُرئت '+read+'/'+others.length}else if(delivered){status.classList.add('delivered','group-status');status.textContent='وصلت '+delivered+'/'+others.length}else status.textContent='تم الإرسال'}else status.innerHTML='<span class="ticks">✓</span><span>تم الإرسال</span>';bubble.append(status)}

async function markConversationReceipt(conversationId,markRead=true){const stamp=new Date().toISOString(),patch={last_delivered_at:stamp};if(markRead)patch.last_read_at=stamp;const {error}=await supabaseClient.from('conversation_members').update(patch).eq('conversation_id',conversationId).eq('user_id',state.user.id);if(error){console.warn('Receipt update failed',error.message);return false}if(state.active?.id===conversationId){const me=(state.active.members||[]).find(x=>x.user_id===state.user.id);if(me){me.last_delivered_at=stamp;if(markRead)me.last_read_at=stamp}if(markRead){state.memberReads[conversationId]=stamp;const conv=state.conversations.find(x=>x.id===conversationId);if(conv)conv.last_read_at=stamp;renderConversations()}document.querySelectorAll('.message.mine').forEach(row=>{const msg=state.messages.find(x=>x.id===row.dataset.messageId),bubble=row.querySelector('.bubble');if(msg&&bubble){bubble.querySelector('.message-status')?.remove();renderMessageStatus(msg,bubble)}})}return true}

function compareMessagesChronologically(a,b){
 const aTime=Date.parse(a?.created_at),bTime=Date.parse(b?.created_at);
 if(Number.isFinite(aTime)&&Number.isFinite(bTime)&&aTime!==bTime)return aTime-bTime;
 const aStamp=String(a?.created_at||''),bStamp=String(b?.created_at||'');
 if(aStamp!==bStamp)return aStamp.localeCompare(bStamp);
 return String(a?.id||'').localeCompare(String(b?.id||''));
}

function insertMessageChronologically(area,row,message){
 const rows=Array.from(area.querySelectorAll('.message'));
 const nextIndex=rows.findIndex(existing=>
  compareMessagesChronologically(
   {created_at:existing.dataset.createdAt,id:existing.dataset.messageId},
   message
  )>0
 );
 const next=nextIndex>=0?rows[nextIndex]:null;
 const previous=nextIndex>=0?rows[nextIndex-1]:rows[rows.length-1]||null;
 const day=row.dataset.day||'';
 area.insertBefore(row,next||null);
 // Existing divider before a same-day next row already covers this insertion.
 // Create a divider only when the new row starts a genuinely new day group.
 if((previous?.dataset.day||null)!==day&&(next?.dataset.day||null)!==day){
  const divider=document.createElement('div');
  divider.className='day-divider';divider.textContent=day;divider.dataset.day=day;
  area.insertBefore(divider,row);
 }
}

async function renderMessage(m,conversationId=state.active?.id,requestId=null){
 if(!m?.id||!conversationId||state.active?.id!==conversationId||state.messageIds.has(m.id)||state.renderingMessageIds.has(m.id))return false;
 const messageRenderStarted=performance.now();state.renderingMessageIds.add(m.id);
 try{
  const area=$('messages'),near=state.isLoadingMessages?true:isMessagesNearBottom(area,120);
  const d=new Date(m.created_at),day=d.toLocaleDateString('ar-SA',{weekday:'long',day:'numeric',month:'long'});
  const activeConversation=state.active;
  const member=(activeConversation?.members||[]).find(x=>x.user_id===m.sender_id),sender=member?.profile?.display_name||'عضو';
  const row=document.createElement('article');row.className='message'+(m.sender_id===state.user?.id?' mine':'');if(state.loadingOlderMessages)row.style.animation='none';row.dataset.day=day;row.dataset.createdAt=m.created_at;row.dataset.messageId=m.id;
  const bubble=document.createElement('div');bubble.className='bubble'+(m.deleted_at?' deleted':'');
  if(m.sender_id!==state.user?.id&&(activeConversation?.type==='group'||activeConversation?.type==='channel')){const label=document.createElement('div');label.className='sender';label.textContent=sender;row.append(label)}
  if(state.active?.type==='direct'&&state.privateReplyContexts.has(m.id)&&!m.deleted_at){const ctx=state.privateReplyContexts.get(m.id),q=document.createElement('div');q.className='reply-quote private-reply-quote';const who=document.createElement('strong'),preview=document.createElement('span');who.textContent='رد خاص من مجموعة';preview.textContent=ctx.quoted_content;q.append(who,preview);bubble.append(q)}
  if(m.reply_to&&!m.deleted_at){let parent=state.messages.find(x=>x.id===m.reply_to)||state.replyMessages.get(m.reply_to);if(!parent){const {data:parentRow}=await supabaseClient.from('chat_messages').select('id,conversation_id,sender_id,content,deleted_at,created_at').eq('conversation_id',conversationId).eq('id',m.reply_to).maybeSingle();if(parentRow){parent=parentRow;state.replyMessages.set(parent.id,parent)}}const quote=document.createElement('div');quote.className='reply-quote';const who=document.createElement('strong');who.textContent=parent?.sender_id===state.user?.id?'أنت':((activeConversation?.members||[]).find(x=>x.user_id===parent?.sender_id)?.profile?.display_name||'رد على رسالة');const preview=document.createElement('span');preview.textContent=messagePreview(parent);quote.append(who,preview);quote.onclick=()=>jumpToMessage(m.reply_to);bubble.append(quote)}
  if(m.deleted_at){bubble.textContent='تم حذف هذه الرسالة'}else{
   if(m.attachment_path){
    const {data:signed,error:signedError}=await supabaseClient.storage.from('chat-media').createSignedUrl(m.attachment_path,3600);
    if(state.active?.id!==conversationId){state.messageIds.delete(m.id);return false;}
    if(signedError){const failed=document.createElement('span');failed.textContent='تعذر فتح المرفق';bubble.append(failed)}
    else if(m.attachment_type?.startsWith('image/')){const img=document.createElement('img');img.src=signed.signedUrl;img.alt='مرفق';img.loading='lazy';img.onclick=()=>{$('lightboxImage').src=img.src;$('lightbox').classList.remove('hidden')};bubble.append(img)}
    else if(m.attachment_type?.startsWith('audio/')){const audio=document.createElement('audio');audio.className='message-audio';audio.controls=true;audio.preload='metadata';audio.src=signed.signedUrl;audio.setAttribute('aria-label','رسالة صوتية');let signedAt=Date.now(),refreshing=false,retried=false;const refreshAudioUrl=async(resume=false)=>{if(refreshing)return;refreshing=true;try{const {data:renewed,error}=await supabaseClient.storage.from('chat-media').createSignedUrl(m.attachment_path,3600);if(error)throw error;audio.src=renewed.signedUrl;signedAt=Date.now();audio.load();if(resume)await audio.play().catch(()=>{})}catch(error){console.warn('Audio URL refresh failed:',error?.message||error);toast('تعذر فتح الرسالة الصوتية. أعد تحميل المحادثة وحاول مجدداً')}finally{refreshing=false}};audio.addEventListener('play',()=>{if(Date.now()-signedAt>50*60*1000){audio.pause();refreshAudioUrl(true)}});audio.addEventListener('error',()=>{if(!retried){retried=true;refreshAudioUrl(false)}});audio.setAttribute('playsinline','');bubble.append(audio)}
    else{const a=document.createElement('a');a.href=signed.signedUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent='فتح المرفق';a.style.color='var(--accent)';bubble.append(a)}
   }
   if(m.content){const t=document.createElement('div');t.className='message-content';t.textContent=m.content;bubble.append(t)}
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
  row.append(bubble);bindMessageGestures(bubble,row,m);renderReactionBar(row,m);renderMessagePinMark(row,m);
  if(state.active?.id!==conversationId||(requestId!==null&&requestId!==state.messageLoadVersion)){state.messageIds.delete(m.id);return false;}
  const empty=area.querySelector('.welcome');if(empty)area.replaceChildren();
  insertMessageChronologically(area,row,m);state.messageIds.add(m.id);state.diagnostics.lastRenderAt=new Date().toLocaleTimeString('en-GB');
  if(!state.isLoadingMessages){if(m.sender_id===state.user?.id){clearNewMessages(false);scheduleMessagesBottom(area,'auto')}else if(near){scheduleMessagesBottom(area,'auto')}else{state.newMessageCount=(state.newMessageCount||0)+1;updateNewMessagesIndicator()}}
  updateDiagnostics();
  return true;
 }catch(error){
  state.messageIds.delete(m.id);state.diagnostics.lastRenderError=String(error?.message||error);console.error('Message rendering failed:',error);diagLog('render-error',{id:m.id,error:state.diagnostics.lastRenderError});
  if(state.active?.id===conversationId)toast('تعذر عرض أحد المرفقات، لكن يمكنك متابعة الكتابة والإرسال');
  return false;
 }finally{state.renderingMessageIds.delete(m.id);recordPerf('message_render_item',performance.now()-messageRenderStarted)}
}

async function renderMessageBatch(messages,conversationId,requestId,batchSize=6){
 for(let index=0;index<messages.length;index+=batchSize){
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  const batch=messages.slice(index,index+batchSize);
  await Promise.all(batch.map(message=>renderMessage(message,conversationId,requestId)));
 }
 return requestId===state.messageLoadVersion&&state.active?.id===conversationId;
}

async function loadMessages(){
 const conversationId=state.active?.id;if(!conversationId)return false;
 const messageLoadStarted=performance.now();const requestId=++state.messageLoadVersion,area=$('messages');state.isLoadingMessages=true;state.hasMoreMessages=false;state.newMessageCount=0;updateNewMessagesIndicator();diagLog('fetch-start',{conversationId,requestId});
 area.innerHTML='<div class="welcome"><div class="welcome-icon"><i class="ph ph-spinner-gap"></i></div><p>جارٍ تحميل الرسائل…</p></div>';
 try{
  const messageFetchStarted=performance.now();let messageQuery=supabaseClient.from('chat_messages').select('*').eq('conversation_id',conversationId);if(state.activeChatPreference?.cleared_before)messageQuery=messageQuery.gt('created_at',state.activeChatPreference.cleared_before);const {data,error}=await messageQuery.order('created_at',{ascending:false}).limit(50);
  recordPerf('message_fetch',performance.now()-messageFetchStarted,{success:!error,rows:data?.length||0});if(error)throw error;
  state.hasMoreMessages=(data||[]).length===50;
  state.diagnostics.lastFetchAt=new Date().toLocaleTimeString('en-GB');state.diagnostics.lastFetchCount=(data||[]).length;state.diagnostics.lastFetchError=null;diagLog('fetch-success',{count:(data||[]).length,requestId});
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  // Merge fetched rows with Realtime INSERTs received while this request was in flight.
  const merged=new Map((state.messages||[]).filter(m=>m.conversation_id===conversationId).map(m=>[m.id,m]));
  (data||[]).forEach(m=>merged.set(m.id,m));
  const messages=Array.from(merged.values()).sort(compareMessagesChronologically).slice(-100);
  state.messages=messages;
  const replyIds=[...new Set(messages.map(m=>m.reply_to).filter(id=>id&&!messages.some(x=>x.id===id)))];state.replyMessages=new Map();if(replyIds.length){const {data:parents,error:replyError}=await supabaseClient.from('chat_messages').select('id,conversation_id,sender_id,content,deleted_at,created_at').eq('conversation_id',conversationId).in('id',replyIds);if(!replyError)(parents||[]).forEach(x=>state.replyMessages.set(x.id,x))}
  await loadMessageReactions(conversationId,messages);await loadMessagePins(conversationId);await loadPrivateReplyContexts(conversationId,messages);
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  area.replaceChildren();state.messageIds.clear();
  if(!messages.length){area.innerHTML='<div class="welcome"><div class="welcome-icon"><i class="ph ph-chat-teardrop-text"></i></div><h2>بداية محادثة جديدة</h2><p>أرسل أول رسالة لبدء التواصل.</p></div>'}
  else{
   const messageRenderBatchStarted=performance.now();
   if(!await renderMessageBatch(messages,conversationId,requestId,6))return false;
   area.scrollTop=area.scrollHeight;
   recordPerf('message_render_batch',performance.now()-messageRenderBatchStarted,{rows:messages.length});
  }
  state.isLoadingMessages=false;
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  if(requestId===state.messageLoadVersion&&state.active?.id===conversationId)await markConversationReceipt(conversationId,document.visibilityState==='visible');
  recordPerf('message_load_total',performance.now()-messageLoadStarted,{success:true,rows:messages.length});return true;
 }catch(error){
  recordPerf('message_load_total',performance.now()-messageLoadStarted,{success:false});state.diagnostics.lastFetchError=String(error?.message||error);diagLog('fetch-error',{error:state.diagnostics.lastFetchError});console.error('Message loading failed:',error);
  state.isLoadingMessages=false;
  if(requestId===state.messageLoadVersion&&state.active?.id===conversationId){area.innerHTML='<div class="welcome"><h2>تعذر تحميل الرسائل</h2><p>تم إبقاء المحادثة مفتوحة. اضغط تحديث لإعادة المحاولة.</p></div>';toast('تعذر استرجاع الرسائل من قاعدة البيانات')}
  return false;
 }
}

async function loadOlderMessages(){
 const conversationId=state.active?.id,area=$('messages');
 if(!conversationId||state.loadingOlderMessages||!state.hasMoreMessages||!state.messages?.length)return false;
 const oldest=state.messages[0];if(!oldest?.created_at)return false;
 state.loadingOlderMessages=true;
 const requestId=state.messageLoadVersion;
 try{
  let olderQuery=supabaseClient.from('chat_messages').select('*').eq('conversation_id',conversationId).lt('created_at',oldest.created_at);if(state.activeChatPreference?.cleared_before)olderQuery=olderQuery.gt('created_at',state.activeChatPreference.cleared_before);const {data,error}=await olderQuery.order('created_at',{ascending:false}).limit(50);
  if(error)throw error;
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  const older=(data||[]).slice().reverse();
  state.hasMoreMessages=older.length===50;
  if(!older.length){state.hasMoreMessages=false;return false}
  const merged=new Map([...older,...state.messages].map(message=>[message.id,message]));
  state.messages=Array.from(merged.values()).sort(compareMessagesChronologically);
  const replyIds=[...new Set(state.messages.map(m=>m.reply_to).filter(id=>id&&!merged.has(id)))];
  if(replyIds.length){const {data:parents,error:parentError}=await supabaseClient.from('chat_messages').select('id,conversation_id,sender_id,content,deleted_at,created_at').eq('conversation_id',conversationId).in('id',replyIds);if(parentError)throw parentError;(parents||[]).forEach(parent=>state.replyMessages.set(parent.id,parent))}
  await loadMessageReactions(conversationId,older);await loadMessagePins(conversationId);
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  // Capture the live viewport immediately before insertion, not before the network
  // request, so continued user scrolling during fetch is preserved.
  const anchor=Array.from(area.querySelectorAll('.message')).find(node=>node.getBoundingClientRect().bottom>area.getBoundingClientRect().top);
  const anchorId=anchor?.dataset.messageId,anchorViewportTop=anchor?.getBoundingClientRect().top??0;
  const oldScrollTop=area.scrollTop;
  state.isLoadingMessages=true;area.style.overflowAnchor='none';
  // Add only newly fetched history rows; preserve existing DOM, media and gesture bindings.
  if(!await renderMessageBatch(older,conversationId,requestId,6))return false;
  const restoredAnchor=anchorId?Array.from(area.querySelectorAll('.message')).find(node=>node.dataset.messageId===anchorId):null;
  if(restoredAnchor)area.scrollTop=oldScrollTop+(restoredAnchor.getBoundingClientRect().top-anchorViewportTop);
  state.isLoadingMessages=false;area.style.overflowAnchor='';return true;
 }catch(error){
  console.error('Older message loading failed:',error);toast('تعذر تحميل الرسائل الأقدم');
  if(requestId===state.messageLoadVersion&&state.active?.id===conversationId){state.isLoadingMessages=false;area.style.overflowAnchor=''}
  return false;
 }finally{state.loadingOlderMessages=false}
}

async function editMessage(m){beginEditMessage(m)}

async function deleteMessage(m){if(m.sender_id!==state.user?.id||m.deleted_at)return;if(!confirm('هل تريد حذف هذه الرسالة؟'))return;const {error}=await supabaseClient.from('chat_messages').update({deleted_at:new Date().toISOString(),content:'تم حذف الرسالة',attachment_path:null,attachment_type:null}).eq('id',m.id).eq('sender_id',state.user.id);if(error){toast('تعذر حذف الرسالة');return}if(state.replyTarget?.id===m.id)cancelComposerContext();await loadMessages()}

function clearNewMessages(markRead=false){const hadUnread=(state.newMessageCount||0)>0;state.newMessageCount=0;updateNewMessagesIndicator();if(hadUnread&&markRead&&state.active?.id&&document.visibilityState==='visible')markConversationReceipt(state.active.id,true).catch(error=>console.warn('Read receipt after jump failed:',error?.message||error))}
function jumpToLatestMessages(){const area=$('messages');if(!area)return;const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;area.scrollTo({top:area.scrollHeight,behavior:reduced?'auto':'smooth'});clearNewMessages(true)}

function resizeComposer(){const n=$('messageInput');n.style.height='auto';n.style.height=Math.min(n.scrollHeight,130)+'px';const role=(state.active?.members||[]).find(m=>m.user_id===state.user?.id)?.role,channelBlocked=state.active?.type==='channel'&&!['owner','admin'].includes(role);$('sendBtn').disabled=state.uploading||!state.active||channelBlocked||(!n.value.trim()&&!state.attachment);updateDiagnostics()}

async function openStarredMessages(){
 ensureGroupModal();const body=$('starredBody');body.replaceChildren();
 const {data,error}=await supabaseClient.from('user_message_stars').select('message_id,conversation_id,created_at,chat_messages(id,content,created_at,sender_id,deleted_at)').eq('user_id',state.user.id).eq('conversation_id',state.active.id).order('created_at',{ascending:false}).limit(100);
 if(error){toast('تعذر تحميل الرسائل المميزة');return}
 if(!data?.length){const p=document.createElement('p');p.className='group-management-muted';p.textContent='لا توجد رسائل مميزة بنجمة في هذه المحادثة.';body.append(p)}
 (data||[]).forEach(item=>{const b=document.createElement('button');b.className='starred-message-row';b.type='button';const m=item.chat_messages;b.innerHTML='<strong>★ '+esc(m?.sender_id===state.user.id?'أنت':'عضو')+'</strong><span></span><small></small>';b.querySelector('span').textContent=m?.deleted_at?'تم حذف الرسالة':m?.content||'مرفق';b.querySelector('small').textContent=m?.created_at?new Date(m.created_at).toLocaleString('ar-SA'):'';b.onclick=()=>{$('starredModal').classList.remove('open');jumpToMessage(item.message_id)};body.append(b)});
 $('starredModal').classList.add('open');$('starredModal').setAttribute('aria-hidden','false');
}

async function toggleMessageStar(messageId,star=true){
 const m=state.messages.find(x=>x.id===messageId);if(!m)return;
 const query=supabaseClient.from('user_message_stars');
 const result=star?await query.upsert({user_id:state.user.id,conversation_id:m.conversation_id,message_id:m.id},{onConflict:'user_id,message_id'}):await query.delete().eq('user_id',state.user.id).eq('message_id',m.id);
 if(result.error){toast('تعذر تحديث تمييز الرسالة');console.error(result.error);return false}
 if(star)state.starredMessageIds.add(messageId);else state.starredMessageIds.delete(messageId);return true;
}

function setMessageSelectionMode(enabled){
 state.selectionMode=!!enabled;state.selectedMessageIds.clear();
 const bar=$('messageSelectionToolbar');bar?.classList.toggle('active',state.selectionMode);
 document.querySelectorAll('.message').forEach(row=>decorateMessageSelection(row,state.messages.find(m=>m.id===row.dataset.messageId)));
 updateMessageSelectionToolbar();if(state.selectionMode)closeChatHeaderMenu();
}

function decorateMessageSelection(row,message){
 if(!row||!message)return;row.querySelector('.message-select-check')?.remove();row.classList.remove('selected-for-action');
 if(!state.selectionMode)return;
 const check=document.createElement('input');check.type='checkbox';check.className='message-select-check';check.checked=state.selectedMessageIds.has(message.id);check.setAttribute('aria-label','تحديد الرسالة');
 check.onchange=()=>{if(check.checked)state.selectedMessageIds.add(message.id);else state.selectedMessageIds.delete(message.id);row.classList.toggle('selected-for-action',check.checked);updateMessageSelectionToolbar()};
 row.prepend(check);
 row.addEventListener('click',function selectionClick(e){if(!state.selectionMode||e.target.closest('button,input,a,audio'))return;if(!e.target.closest('.bubble'))return;check.checked=!check.checked;check.dispatchEvent(new Event('change'))});
}

function updateMessageSelectionToolbar(){const count=state.selectedMessageIds.size;$('messageSelectionCount').textContent=count.toLocaleString('ar-SA')+' محددة'}

async function starSelectedMessages(){const ids=[...state.selectedMessageIds];for(const id of ids)await toggleMessageStar(id,true);toast('تم تمييز '+ids.length+' رسالة');setMessageSelectionMode(false)}

function exportSelectedMessages(){const ids=state.selectedMessageIds,items=state.messages.filter(m=>ids.has(m.id));downloadMessages(items,'messages-selected.txt');setMessageSelectionMode(false)}

function downloadMessages(messages,filename){
 const content=(messages||[]).map(m=>{const member=(state.active?.members||[]).find(x=>x.user_id===m.sender_id);return '['+new Date(m.created_at).toLocaleString('ar-SA')+'] '+(member?.profile?.display_name||(m.sender_id===state.user.id?'أنت':'عضو'))+': '+(m.deleted_at?'[رسالة محذوفة]':m.content||'[مرفق]')}).join('\n');
 const blob=new Blob(['\ufeff'+content],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function exportActiveConversation(){
 const c=state.active;if(!c)return;
 const {data,error}=await supabaseClient.from('chat_messages').select('id,conversation_id,sender_id,content,created_at,deleted_at').eq('conversation_id',c.id).order('created_at').limit(5000);
 if(error){toast('تعذر تصدير الدردشة');return}
 downloadMessages(data||[],(c.title||convName(c)).replace(/[\\/:*?"<>|]/g,'_')+'.txt');toast('تم تجهيز ملف تصدير الدردشة');
}
