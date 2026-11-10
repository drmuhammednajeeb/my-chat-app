'use strict';
async function loadMessageReactions(conversationId,messages,requestId=null){
 const ids=(messages||[]).filter(m=>!m.deleted_at).map(m=>m.id);if(!ids.length)return true;
 try{
  const {data,error}=await supabaseClient.from('message_reactions').select('message_id,user_id,reaction_type').eq('conversation_id',conversationId).in('message_id',ids);
  if(requestId!==null&&(requestId!==state.messageLoadVersion||state.active?.id!==conversationId))return false;
  if(error)throw error;
  const next=new Map(state.reactions||[]);ids.forEach(id=>next.delete(id));
  (data||[]).forEach(r=>{const list=next.get(r.message_id)||[];list.push(r);next.set(r.message_id,list)});
  state.reactions=next;return true;
 }catch(error){console.warn('Message reactions could not be loaded:',error?.message||error);return false}
}
const CHAT_STICKERS=['❤️','😍','😂','🤣','🥰','😘','🔥','👏','👍','🙏','🎉','💯','🌹','✨','🤝','💪','🥳','😎','🤩','😭','😮','🙌','💐','⭐'];
function encodeChatSticker(emoji){return '[[bizmind-sticker:'+emoji+']]'}
function decodeChatSticker(content){const value=String(content||''),prefix='[[bizmind-sticker:',suffix=']]';if(!value.startsWith(prefix)||!value.endsWith(suffix))return null;const emoji=value.slice(prefix.length,-suffix.length);return CHAT_STICKERS.includes(emoji)?emoji:null}
function openChatStickerPicker(){
 if(!state.active||state.uploading||state.voiceRecorder)return;
 const grid=document.createElement('div');grid.className='chat-sticker-grid';
 CHAT_STICKERS.forEach(emoji=>{const button=document.createElement('button');button.type='button';button.className='chat-sticker-option';button.textContent=emoji;button.setAttribute('aria-label','إرسال ملصق '+emoji);button.onclick=()=>{document.querySelector('.message-detail-overlay')?.remove();$('messageInput').value=encodeChatSticker(emoji);sendMessage()};grid.append(button)});
 showMessageDetailModal('اختر ملصقاً',grid);
}
const MESSAGE_REACTION_OPTIONS=[
 {type:'like',emoji:'👍',label:'إعجاب'},
 {type:'heart',emoji:'❤️',label:'أحببت'},
 {type:'wow',emoji:'😮',label:'مندهش'},
 {type:'pray',emoji:'🙏',label:'تقدير'},
 {type:'fire',emoji:'🔥',label:'رائع'},
 {type:'celebrate',emoji:'🎉',label:'احتفال'}
];
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
 const anchor=row.getBoundingClientRect(),pop=bar.getBoundingClientRect(),gap=8,pad=8;
 let top=anchor.bottom+gap;if(top+pop.height>window.innerHeight-pad)top=anchor.top-pop.height-gap;
 top=Math.max(pad,Math.min(top,window.innerHeight-pop.height-pad));
 let left=row.classList.contains('mine')?anchor.right-pop.width:anchor.left;
 left=Math.max(pad,Math.min(left,window.innerWidth-pop.width-pad));
 bar.style.top=Math.round(top)+'px';bar.style.left=Math.round(left)+'px';bar.style.right='auto';
}
function openMessageReactions(row){
 if(!row||row.querySelector('.bubble.deleted'))return;
 document.querySelectorAll('.message.reactions-open').forEach(item=>{if(item!==row){item.classList.remove('reactions-open');const old=item.querySelector('.reaction-bar');if(old){old.style.top='';old.style.left='';old.style.right=''}}});
 const opening=!row.classList.contains('reactions-open');row.classList.toggle('reactions-open',opening);
 const bar=row.querySelector('.reaction-bar');if(!bar)return;
 if(!opening){bar.style.top='';bar.style.left='';bar.style.right='';return}
 positionMessageReactionBar(row);
}
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.message.reactions-open'))document.querySelectorAll('.message.reactions-open').forEach(row=>row.classList.remove('reactions-open'))},true);
function bindMessageGestures(row,message){
 const bubble=row.querySelector('.bubble');if(!bubble||message.deleted_at)return;
 let start=null,longPressTimer=null;
 const cancelLongPress=()=>{if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null}};
 bubble.addEventListener('pointerdown',event=>{
  if(event.target.closest('button,a,.reply-quote,.message-menu-wrap'))return;
  start={x:event.clientX,y:event.clientY,id:event.pointerId};
  if(event.pointerType==='touch'){cancelLongPress();longPressTimer=setTimeout(()=>{if(start)openMessageReactions(row)},520)}
 });
 bubble.addEventListener('pointermove',event=>{
  if(!start||start.id!==event.pointerId)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y;
  if(Math.hypot(dx,dy)>12)cancelLongPress();
  if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)<110)bubble.style.transform='translateX('+Math.max(-78,Math.min(78,dx*.42))+'px)';
 });
 bubble.addEventListener('pointerup',event=>{
  if(!start)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y;start=null;cancelLongPress();bubble.style.transform='';
  const rtl=getComputedStyle(document.documentElement).direction==='rtl';
  if(Math.abs(dx)>=58&&Math.abs(dx)>Math.abs(dy)*1.25&&(rtl?dx>0:dx<0))beginReply(message);
 });
 bubble.addEventListener('pointercancel',()=>{start=null;cancelLongPress();bubble.style.transform=''});
 bubble.addEventListener('click',event=>{
  if(event.pointerType==='touch'||!event.detail||event.target.closest('button,a,.reply-quote,img,.message-menu-wrap'))return;
  openMessageReactions(row);
 });
}
const pendingReactionKeys=new Set();
async function toggleMessageReaction(message,reactionType,button){
 const conversationId=message?.conversation_id||state.active?.id,userId=state.user?.id,requestVersion=state.messageLoadVersion;
 if(!conversationId||!userId||state.active?.id!==conversationId||message.deleted_at)return false;
 if(!MESSAGE_REACTION_OPTIONS.some(option=>option.type===reactionType))return false;
 state.pendingReactionKeys ||= new Set();
 const pendingKey=conversationId+':'+message.id+':'+userId;
 if(state.pendingReactionKeys.has(pendingKey))return false;
 state.pendingReactionKeys.add(pendingKey);
 const current=[...(state.reactions.get(message.id)||[])],mine=current.find(r=>r.user_id===userId);
 const removing=mine?.reaction_type===reactionType;
 const optimistic=current.filter(r=>r.user_id!==userId);
 if(!removing)optimistic.push({message_id:message.id,conversation_id:conversationId,user_id:userId,reaction_type:reactionType});
 state.reactions.set(message.id,optimistic);
 const renderCurrent=()=>{if(state.active?.id!==conversationId||state.messageLoadVersion!==requestVersion)return;const row=Array.from(document.querySelectorAll('.message')).find(x=>x.dataset.messageId===message.id);if(row)renderReactionBar(row,message)};
 renderCurrent();
 try{
  const write=removing
   ?await supabaseClient.from('message_reactions').delete().eq('conversation_id',conversationId).eq('message_id',message.id).eq('user_id',userId).eq('reaction_type',reactionType)
   :await supabaseClient.from('message_reactions').upsert({conversation_id:conversationId,message_id:message.id,user_id:userId,reaction_type:reactionType},{onConflict:'message_id,user_id'});
  if(write.error){
   if(state.active?.id!==conversationId||state.messageLoadVersion!==requestVersion)throw write.error;
   const {data:verified,error:verifyError}=await supabaseClient.from('message_reactions').select('message_id,user_id,reaction_type').eq('conversation_id',conversationId).eq('message_id',message.id).eq('user_id',userId).maybeSingle();
   if(verifyError)throw write.error;
   const committed=removing?!verified:verified?.reaction_type===reactionType;
   if(!committed){
    const reconciled=current.filter(row=>row.user_id!==userId);if(verified)reconciled.push(verified);
    state.reactions.set(message.id,reconciled);renderCurrent();
    toast('تغير التفاعل من جلسة أخرى؛ تم تحديث الحالة من الخادم');
    return false;
   }
   const reconciled=current.filter(row=>row.user_id!==userId);if(verified)reconciled.push(verified);
   state.reactions.set(message.id,reconciled);renderCurrent();
  }
  return true;
 }catch(error){
  if(state.active?.id===conversationId&&state.messageLoadVersion===requestVersion){
   state.reactions.set(message.id,current);renderCurrent();
   toast('تعذر تأكيد حفظ التفاعل. أُعيدت الحالة السابقة؛ حاول مجدداً');
  }
  console.error('Message reaction failed:',error);
  return false;
 }finally{state.pendingReactionKeys.delete(pendingKey);if(button?.isConnected)button.disabled=false}
}

function handleReactionRealtime(payload,conversationId){
 if(state.active?.id!==conversationId)return;
 const incoming=payload.new,old=payload.old,event=payload.eventType;
 const messageId=(event==='DELETE'?old?.message_id:incoming?.message_id);if(!messageId)return;
 const message=(state.messages||[]).find(m=>m.id===messageId);
 const eventConversation=event==='DELETE'?(old?.conversation_id||message?.conversation_id):incoming?.conversation_id;
 if(eventConversation!==conversationId)return;
 const current=[...(state.reactions.get(messageId)||[])],actorId=(event==='DELETE'?old?.user_id:incoming?.user_id);
 const next=current.filter(r=>r.user_id!==actorId);
 if(event!=='DELETE'&&incoming)next.push(incoming);
 state.reactions.set(messageId,next);
 const row=Array.from(document.querySelectorAll('.message')).find(x=>x.dataset.messageId===messageId);
 if(row&&message)renderReactionBar(row,message);
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
function messagePreview(m){if(!m)return 'رسالة غير متاحة';if(m.deleted_at)return 'تم حذف هذه الرسالة';const sticker=decodeChatSticker(m.content);if(sticker)return 'ملصق '+sticker;return String(m.content||(m.attachment_path?'مرفق':'رسالة')).slice(0,180)}
function renderComposerContext(){const privateReply=state.privateReplyPending,target=state.editTarget||state.replyTarget||privateReply,box=$('composerContext');if(!box)return;if(!target){box.classList.add('hidden');$('composerContextText').textContent='';$('attachBtn').disabled=false;$('sendBtn').title='إرسال';$('sendBtn').innerHTML='<i class="ph ph-paper-plane-tilt"></i>';return}box.classList.remove('hidden');$('composerContextLabel').textContent=state.editTarget?'تعديل الرسالة':privateReply?'رد خاص من المجموعة':'الرد على الرسالة';$('composerContextText').textContent=privateReply?privateReply.quotedContent:messagePreview(target);$('sendBtn').title=state.editTarget?'حفظ التعديل':'إرسال الرد';$('sendBtn').innerHTML=state.editTarget?'<i class="ph ph-check"></i>':'<i class="ph ph-paper-plane-tilt"></i>'}
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
 const requestId=++state.messageLoadVersion,initialMessageIds=new Set((state.messages||[]).filter(m=>m.conversation_id===conversationId).map(m=>m.id));
 const isCurrent=()=>requestId===state.messageLoadVersion&&state.active?.id===conversationId;
 state.isLoadingMessages=true;
 try{
  let targetQuery=supabaseClient.from('chat_messages').select('*').eq('conversation_id',conversationId).eq('id',id);
  if(state.activeChatPreference?.cleared_before)targetQuery=targetQuery.gt('created_at',state.activeChatPreference.cleared_before);
  const {data:target,error}=await targetQuery.maybeSingle();
  if(!isCurrent())return;
  if(error||!target){state.isLoadingMessages=false;toast('تعذر العثور على الرسالة المطلوبة');return}
  if(!target.created_at||!target.id)throw new Error('Target message is missing its chronological cursor');
  const beforeFilter='created_at.lt.'+target.created_at+',and(created_at.eq.'+target.created_at+',id.lt.'+target.id+')';
  const afterFilter='created_at.gt.'+target.created_at+',and(created_at.eq.'+target.created_at+',id.gt.'+target.id+')';
  let beforeQuery=supabaseClient.from('chat_messages').select('*').eq('conversation_id',conversationId).or(beforeFilter).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(40);
  let afterQuery=supabaseClient.from('chat_messages').select('*').eq('conversation_id',conversationId).or(afterFilter).order('created_at',{ascending:true}).order('id',{ascending:true}).limit(40);
  if(state.activeChatPreference?.cleared_before)beforeQuery=beforeQuery.gt('created_at',state.activeChatPreference.cleared_before);
  const [beforeResult,afterResult]=await Promise.all([beforeQuery,afterQuery]);
  if(!isCurrent())return;
  if(beforeResult.error||afterResult.error)throw beforeResult.error||afterResult.error;
  const merged=new Map([...(beforeResult.data||[]),target,...(afterResult.data||[])].map(message=>[message.id,message]));
  // Preserve Realtime INSERTs received while the target window was being fetched.
  (state.messages||[]).filter(m=>m.conversation_id===conversationId&&!initialMessageIds.has(m.id)).forEach(m=>merged.set(m.id,m));
  const rows=Array.from(merged.values()).sort(compareMessagesChronologically);
  state.messages=rows;state.replyMessages=new Map();
  const replyIds=[...new Set(rows.map(m=>m.reply_to).filter(x=>x&&!rows.some(m=>m.id===x)))];
  if(replyIds.length){
   const {data:parents,error:parentError}=await supabaseClient.from('chat_messages').select('id,conversation_id,sender_id,content,deleted_at,created_at').eq('conversation_id',conversationId).in('id',replyIds);
   if(!isCurrent())return;
   if(parentError)throw parentError;
   (parents||[]).forEach(m=>state.replyMessages.set(m.id,m));
  }
  await Promise.all([
   loadMessageReactions(conversationId,rows,requestId),
   loadMessagePins(conversationId,requestId),
   loadPrivateReplyContexts(conversationId,rows,requestId)
  ]);
  if(!isCurrent())return;
  const area=$('messages');area.replaceChildren();state.messageIds.clear();state.renderingMessageIds.clear();
  for(const message of rows){
   if(!isCurrent()){state.isLoadingMessages=false;return}
   await renderMessage(message,conversationId,requestId);
  }
  if(!isCurrent())return;
  state.isLoadingMessages=false;
  row=Array.from(document.querySelectorAll('.message')).find(x=>x.dataset.messageId===id);
  if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.classList.add('flash');setTimeout(()=>row.classList.remove('flash'),1500)}
 }catch(error){
  if(isCurrent())state.isLoadingMessages=false;
  console.error('Jump to message failed:',error);
  if(isCurrent())toast('تعذر تحميل الرسائل المحيطة بالرسالة المطلوبة');
 }
}
async function loadMessagePins(id,requestId=null){
 const isCurrent=()=>requestId===null||(requestId===state.messageLoadVersion&&state.active?.id===id);
 const {data,error}=await supabaseClient.from('message_pins').select('id,conversation_id,message_id,pinned_by,pinned_at').eq('conversation_id',id).order('pinned_at',{ascending:false});
 if(!isCurrent())return false;
 if(error){console.warn('Pinned messages load failed',error.message);state.pinnedMessages=new Map();renderPinnedBanner();return false}
 const nextPins=new Map((data||[]).map(x=>[x.message_id,x]));
 const missing=[...nextPins.keys()].filter(mid=>!state.messages.some(m=>m.id===mid)&&!state.replyMessages.has(mid));
 if(missing.length){
  const {data:rows,error:messageError}=await supabaseClient.from('chat_messages').select('id,conversation_id,sender_id,content,deleted_at,created_at,attachment_path').eq('conversation_id',id).in('id',missing);
  if(!isCurrent())return false;
  if(!messageError)(rows||[]).forEach(m=>state.replyMessages.set(m.id,m));
 }
 if(!isCurrent())return false;
 state.pinnedMessages=nextPins;renderPinnedBanner();return true
}
async function toggleMessagePin(m){if(!m?.id||!state.active?.id)return;const id=state.active.id,existing=state.pinnedMessages.get(m.id);try{if(existing){const {error}=await supabaseClient.from('message_pins').delete().eq('conversation_id',id).eq('message_id',m.id);if(error)throw error;state.pinnedMessages.delete(m.id);toast('تم إلغاء تثبيت الرسالة')}else{const {data,error}=await supabaseClient.from('message_pins').insert({conversation_id:id,message_id:m.id,pinned_by:state.user.id}).select().single();if(error)throw error;state.pinnedMessages.set(m.id,data);toast('تم تثبيت الرسالة')}renderPinnedBanner();const row=Array.from(document.querySelectorAll('.message')).find(x=>x.dataset.messageId===m.id);if(row)renderMessagePinMark(row,m)}catch(error){console.error('Pin action failed',error);toast('تعذر تغيير تثبيت الرسالة. تحقق من صلاحياتك')}}
function renderMessagePinMark(row,m){row.querySelector('.message-pinned-mark')?.remove();if(!state.pinnedMessages.has(m.id)||m.deleted_at)return;const mark=document.createElement('div');mark.className='message-pinned-mark';mark.textContent='📌 رسالة مثبتة';row.querySelector('.bubble')?.prepend(mark)}
function renderMessageStatus(m,bubble){if(m.sender_id!==state.user?.id||m.deleted_at)return;const others=(state.active?.members||[]).filter(x=>x.user_id!==state.user.id),delivered=others.filter(x=>x.last_delivered_at&&new Date(x.last_delivered_at)>=new Date(m.created_at)).length,read=others.filter(x=>x.last_read_at&&new Date(x.last_read_at)>=new Date(m.created_at)).length,status=document.createElement('span');status.className='message-status';if(others.length===1){if(read){status.classList.add('read');status.innerHTML='<span class="ticks">✓✓</span><span>مقروءة</span>'}else if(delivered){status.classList.add('delivered');status.innerHTML='<span class="ticks">✓✓</span><span>تم التسليم</span>'}else status.innerHTML='<span class="ticks">✓</span><span>تم الإرسال</span>'}else if(others.length>1){if(read){status.classList.add('read','group-status');status.textContent='قُرئت '+read+'/'+others.length}else if(delivered){status.classList.add('delivered','group-status');status.textContent='وصلت '+delivered+'/'+others.length}else status.textContent='تم الإرسال'}else status.innerHTML='<span class="ticks">✓</span><span>تم الإرسال</span>';bubble.append(status)}
function handlePinRealtime(p,id){const r=p.eventType==='DELETE'?p.old:p.new;if(r?.conversation_id!==id)return;if(p.eventType==='DELETE')state.pinnedMessages.delete(r.message_id);else state.pinnedMessages.set(r.message_id,r);renderPinnedBanner();const row=Array.from(document.querySelectorAll('.message')).find(x=>x.dataset.messageId===r.message_id),m=state.messages.find(x=>x.id===r.message_id);if(row&&m)renderMessagePinMark(row,m)}
function handleMembershipRealtime(p,id){const m=p.new;if(m?.conversation_id!==id||state.active?.id!==id)return;const current=(state.active.members||[]).find(x=>x.user_id===m.user_id);if(current)Object.assign(current,m);document.querySelectorAll('.message.mine').forEach(row=>{const msg=state.messages.find(x=>x.id===row.dataset.messageId),bubble=row.querySelector('.bubble');if(msg&&bubble){bubble.querySelector('.message-status')?.remove();renderMessageStatus(msg,bubble)}})}

