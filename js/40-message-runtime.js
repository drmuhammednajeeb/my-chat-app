'use strict';
async function loadMessages(){
 const conversationId=state.active?.id;if(!conversationId)return false;
 const messageLoadStarted=performance.now(),syncStartedAt=new Date(Date.now()-60000).toISOString();const requestId=++state.messageLoadVersion,area=$('messages');state.isLoadingMessages=true;state.hasMoreMessages=false;state.newMessageCount=0;updateNewMessagesIndicator();diagLog('fetch-start',{conversationId,requestId});
 area.innerHTML='<div class="welcome"><div class="welcome-icon"><i class="ph ph-spinner-gap"></i></div><p>جارٍ تحميل الرسائل…</p></div>';
 try{
  const messageFetchStarted=performance.now();let messageQuery=supabaseClient.from('chat_messages').select('*').eq('conversation_id',conversationId);if(state.activeChatPreference?.cleared_before)messageQuery=messageQuery.gt('created_at',state.activeChatPreference.cleared_before);const {data,error}=await messageQuery.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(50);
  recordPerf('message_fetch',performance.now()-messageFetchStarted,{success:!error,rows:data?.length||0});if(error)throw error;
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  state.hasMoreMessages=(data||[]).length===50;
  state.messagePollLastCheckedAt=syncStartedAt;state.messagePollCursor=(data||[])[0]?{conversationId,created_at:data[0].created_at,id:data[0].id}:null;
  state.diagnostics.lastFetchAt=new Date().toLocaleTimeString('en-GB');state.diagnostics.lastFetchCount=(data||[]).length;state.diagnostics.lastFetchError=null;diagLog('fetch-success',{count:(data||[]).length,requestId});
  // Treat the database result as authoritative inside the fetched window.
  // Preserve only newer Realtime inserts and older rows loaded by history pagination.
  const fetchedRows=data||[],fetchedIds=new Set(fetchedRows.map(m=>m.id));
  const newestFetched=fetchedRows[0]||null,oldestFetched=fetchedRows[fetchedRows.length-1]||null;
  const merged=new Map();
  (state.messages||[]).filter(m=>m.conversation_id===conversationId).forEach(m=>{
   const afterPersonalClear=!state.activeChatPreference?.cleared_before||new Date(m.created_at)>new Date(state.activeChatPreference.cleared_before);
   const isNewerRealtime=newestFetched&&compareMessagesChronologically(m,newestFetched)>0;
   const isOlderHistory=fetchedRows.length===50&&oldestFetched&&compareMessagesChronologically(m,oldestFetched)<0;
   const arrivedDuringEmptyFetch=!newestFetched&&m.created_at>=syncStartedAt;
   if(afterPersonalClear&&(fetchedIds.has(m.id)||isNewerRealtime||isOlderHistory||arrivedDuringEmptyFetch))merged.set(m.id,m);
  });
  fetchedRows.forEach(m=>merged.set(m.id,m));
  let messages=Array.from(merged.values()).sort((a,b)=>compareMessagesChronologically(a,b)).slice(-100);
  state.messages=messages;
  const replyIds=[...new Set(messages.map(m=>m.reply_to).filter(id=>id&&!messages.some(x=>x.id===id)))];const nextReplyMessages=new Map();if(replyIds.length){const {data:parents,error:replyError}=await supabaseClient.from('chat_messages').select('id,conversation_id,sender_id,content,deleted_at,created_at').eq('conversation_id',conversationId).in('id',replyIds);if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;if(!replyError)(parents||[]).forEach(x=>nextReplyMessages.set(x.id,x))}
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;state.replyMessages=nextReplyMessages;
  await loadMessageReactions(conversationId,messages,requestId);
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  await loadMessagePins(conversationId,requestId);
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  await loadPrivateReplyContexts(conversationId,messages,requestId);
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  // Reconcile again after auxiliary queries: Realtime INSERTs may arrive while those queries are in flight.
  const latest=new Map(messages.map(m=>[m.id,m]));
  (state.messages||[]).filter(m=>m.conversation_id===conversationId).forEach(m=>latest.set(m.id,m));
  messages=Array.from(latest.values()).sort((a,b)=>compareMessagesChronologically(a,b)).slice(-100);
  state.messages=messages;
  area.replaceChildren();state.messageIds.clear();
  let allMessagesRendered=true;
  if(!messages.length){area.innerHTML='<div class="welcome"><div class="welcome-icon"><i class="ph ph-chat-teardrop-text"></i></div><h2>بداية محادثة جديدة</h2><p>أرسل أول رسالة لبدء التواصل.</p></div>'}
  else{
   const messageRenderBatchStarted=performance.now();for(const message of messages){
    if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
    const rendered=await renderMessage(message,conversationId,requestId);if(!rendered&&!state.messageIds.has(message.id))allMessagesRendered=false;
   }
   if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
   area.scrollTop=area.scrollHeight;
   recordPerf('message_render_batch',performance.now()-messageRenderBatchStarted,{rows:messages.length});
  }
  state.isLoadingMessages=false;
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  if(allMessagesRendered&&requestId===state.messageLoadVersion&&state.active?.id===conversationId)await markConversationReceipt(conversationId,document.visibilityState==='visible',requestId);
  recordPerf('message_load_total',performance.now()-messageLoadStarted,{success:true,rows:messages.length});return true;
 }catch(error){
  recordPerf('message_load_total',performance.now()-messageLoadStarted,{success:false});console.error('Message loading failed:',error);
  if(requestId===state.messageLoadVersion&&state.active?.id===conversationId){state.diagnostics.lastFetchError=String(error?.message||error);diagLog('fetch-error',{error:state.diagnostics.lastFetchError});state.isLoadingMessages=false;area.innerHTML='<div class="welcome"><h2>تعذر تحميل الرسائل</h2><p>تم إبقاء المحادثة مفتوحة. اضغط تحديث لإعادة المحاولة.</p></div>';toast('تعذر استرجاع الرسائل من قاعدة البيانات')}
  return false;
 }
}
function compareMessagesChronologically(a,b){const timeDiff=new Date(a.created_at)-new Date(b.created_at);if(timeDiff)return timeDiff;const aid=String(a.id||''),bid=String(b.id||'');return aid<bid?-1:aid>bid?1:0}
async function loadOlderMessages(){
 const conversationId=state.active?.id,area=$('messages');
 if(!conversationId||state.loadingOlderMessages||!state.hasMoreMessages||!state.messages?.length)return false;
 const oldest=state.messages[0];if(!oldest?.created_at||!oldest?.id)return false;
 state.loadingOlderMessages=true;
 const anchor=Array.from(area.querySelectorAll('.message')).find(node=>node.getBoundingClientRect().bottom>area.getBoundingClientRect().top);
 const anchorId=anchor?.dataset.messageId,anchorTop=anchor?.getBoundingClientRect().top??0;
 const oldHeight=area.scrollHeight,oldTop=area.scrollTop,requestId=state.messageLoadVersion;
 const loader=document.createElement('div');loader.className='messages-history-loader';loader.textContent='جارٍ تحميل الرسائل الأقدم…';area.prepend(loader);
 try{
  const cursorFilter='created_at.lt.'+oldest.created_at+',and(created_at.eq.'+oldest.created_at+',id.lt.'+oldest.id+')';let olderQuery=supabaseClient.from('chat_messages').select('*').eq('conversation_id',conversationId).or(cursorFilter);if(state.activeChatPreference?.cleared_before)olderQuery=olderQuery.gt('created_at',state.activeChatPreference.cleared_before);const {data,error}=await olderQuery.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(50);
  if(error)throw error;
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  const older=(data||[]).slice().reverse();
  state.hasMoreMessages=older.length===50;
  if(!older.length){state.hasMoreMessages=false;return false}
  const merged=new Map([...older,...state.messages].map(message=>[message.id,message]));
  state.messages=Array.from(merged.values()).sort((a,b)=>compareMessagesChronologically(a,b));
  const replyIds=[...new Set(state.messages.map(m=>m.reply_to).filter(id=>id&&!merged.has(id)))];
  if(replyIds.length){const {data:parents,error:parentError}=await supabaseClient.from('chat_messages').select('id,conversation_id,sender_id,content,deleted_at,created_at').eq('conversation_id',conversationId).in('id',replyIds);if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;if(parentError)throw parentError;(parents||[]).forEach(parent=>state.replyMessages.set(parent.id,parent))}
  await loadMessageReactions(conversationId,older,requestId);
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  await loadMessagePins(conversationId,requestId);
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  state.isLoadingMessages=true;area.style.overflowAnchor='none';area.replaceChildren();state.messageIds.clear();state.renderingMessageIds.clear();
  for(const message of state.messages){if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;await renderMessage(message,conversationId,requestId)}
  if(requestId!==state.messageLoadVersion||state.active?.id!==conversationId)return false;
  const restoredAnchor=anchorId?Array.from(area.querySelectorAll('.message')).find(node=>node.dataset.messageId===anchorId):null;
  if(restoredAnchor)area.scrollTop=oldTop+(restoredAnchor.getBoundingClientRect().top-anchorTop);
  else area.scrollTop=oldTop+(area.scrollHeight-oldHeight);
  state.isLoadingMessages=false;area.style.overflowAnchor='';return true;
 }catch(error){
  console.error('Older message loading failed:',error);
  if(requestId===state.messageLoadVersion&&state.active?.id===conversationId){toast('تعذر تحميل الرسائل الأقدم');state.isLoadingMessages=false;area.style.overflowAnchor=''}
  return false;
 }finally{state.loadingOlderMessages=false;area.querySelector('.messages-history-loader')?.remove()}
}
function messagePollingDelay(){
 if(document.visibilityState!=='visible')return 60000;
 return state.realtimeStatus==='SUBSCRIBED'?30000:8000;
}
function scheduleMessagePolling(conversationId,generation,delay=messagePollingDelay()){
 if(generation!==state.messagePollGeneration||state.active?.id!==conversationId)return;
 if(state.messagePollTimer)clearTimeout(state.messagePollTimer);
 state.messagePollTimer=setTimeout(()=>{
  state.messagePollTimer=null;
  pollMessagesFallback(conversationId,generation);
 },delay);
}
document.addEventListener('visibilitychange',()=>{if(state.active?.id&&state.messagePollTimer)scheduleMessagePolling(state.active.id,state.messagePollGeneration)});
function stopMessagePolling(){state.isLoadingMessages=false;state.loadingOlderMessages=false;state.hasMoreMessages=false;state.messagePollGeneration++;if(state.messagePollTimer){clearTimeout(state.messagePollTimer);state.messagePollTimer=null}state.messagePollBusy=false;diagLog('poll-stopped',{generation:state.messagePollGeneration})}
function startMessagePolling(conversationId){
 stopMessagePolling();const generation=state.messagePollGeneration;
 scheduleMessagePolling(conversationId,generation);diagLog('poll-started',{conversationId,generation,delay:messagePollingDelay()});
}
async function pollMessagesFallback(conversationId,generation=state.messagePollGeneration){
 if(state.messagePollBusy||generation!==state.messagePollGeneration||state.active?.id!==conversationId||!state.user)return;
 const messageRequestId=state.messageLoadVersion,pollStartedAt=state.messagePollLastCheckedAt||new Date(Date.now()-60000).toISOString(),pollCutoffAt=new Date().toISOString();
 const cursor=state.messagePollCursor?.conversationId===conversationId?state.messagePollCursor:null;
 state.messagePollBusy=true;state.diagnostics.lastPollAt=new Date().toLocaleTimeString('en-GB');
 try{
  const syncFilter=cursor
   ?'created_at.gt.'+cursor.created_at+',and(created_at.eq.'+cursor.created_at+',id.gt.'+cursor.id+'),edited_at.gt.'+pollStartedAt+',deleted_at.gt.'+pollStartedAt
   :'created_at.gt.'+pollStartedAt+',edited_at.gt.'+pollStartedAt+',deleted_at.gt.'+pollStartedAt;
  let pollQuery=supabaseClient.from('chat_messages').select('*').eq('conversation_id',conversationId).or(syncFilter);
  if(state.activeChatPreference?.cleared_before)pollQuery=pollQuery.gt('created_at',state.activeChatPreference.cleared_before);
  const {data,error}=await pollQuery.order('created_at',{ascending:true}).order('id',{ascending:true}).limit(200);
  if(error)throw error;
  if(generation!==state.messagePollGeneration||state.active?.id!==conversationId||messageRequestId!==state.messageLoadVersion)return;
  const current=new Map((state.messages||[]).filter(m=>m.conversation_id===conversationId).map(m=>[m.id,m]));
  let nextCursor=cursor?{...cursor}:null,added=0,needsRetry=false;
  const fetched=(data||[]).slice().sort((a,b)=>compareMessagesChronologically(a,b));
  for(const message of fetched){
   if(generation!==state.messagePollGeneration||state.active?.id!==conversationId||messageRequestId!==state.messageLoadVersion)return;
   const existing=current.get(message.id);
   if(existing){
    const changed=existing.content!==message.content||existing.edited_at!==message.edited_at||existing.deleted_at!==message.deleted_at||existing.attachment_path!==message.attachment_path||existing.attachment_type!==message.attachment_type;
    current.set(message.id,message);
    if(changed){handleMessageUpdateRealtime({new:message},conversationId);if(generation!==state.messagePollGeneration||state.active?.id!==conversationId||messageRequestId!==state.messageLoadVersion)return}
    if(!state.messageIds.has(message.id)){
     const rendered=await renderMessage(message,conversationId,messageRequestId);
     if(generation!==state.messagePollGeneration||state.active?.id!==conversationId||messageRequestId!==state.messageLoadVersion)return;
     if(!rendered){needsRetry=true;break}
     added++;
    }
   }else{
    current.set(message.id,message);
    state.messages=Array.from(current.values()).sort((a,b)=>compareMessagesChronologically(a,b));
    const rendered=await renderMessage(message,conversationId,messageRequestId);
    if(generation!==state.messagePollGeneration||state.active?.id!==conversationId||messageRequestId!==state.messageLoadVersion)return;
    if(!rendered){needsRetry=true;break}
    added++;
   }
   if(!nextCursor||compareMessagesChronologically(message,nextCursor)>0)nextCursor={conversationId,created_at:message.created_at,id:message.id};
  }
  if(generation!==state.messagePollGeneration||state.active?.id!==conversationId||messageRequestId!==state.messageLoadVersion)return;
  state.messages=Array.from(current.values()).sort((a,b)=>compareMessagesChronologically(a,b)).slice(-100);
  if(nextCursor)state.messagePollCursor=nextCursor;
  if(added)await markConversationReceipt(conversationId,document.visibilityState==='visible'&&isMessagesNearBottom(),messageRequestId);
  if(generation!==state.messagePollGeneration||state.active?.id!==conversationId||messageRequestId!==state.messageLoadVersion)return;
  if(!needsRetry)state.messagePollLastCheckedAt=pollCutoffAt;
  const activeRole=(state.active?.members||[]).find(m=>m.user_id===state.user?.id)?.role;
  const channelReadOnly=state.active?.type==='channel'&&!['owner','admin'].includes(activeRole);
  const groupReadOnly=state.active?.type==='group'&&!!state.groupSettings?.only_admins_can_send&&!['owner','admin'].includes(activeRole);
  if($('messageInput').disabled&&!channelReadOnly&&!groupReadOnly){$('messageInput').disabled=false;diagLog('composer-reenabled-by-poll')}
  resizeComposer();diagLog('poll-success',{fetched:fetched.length,added,rendered:$('messages').querySelectorAll('.message').length,needsRetry});
 }catch(error){diagLog('poll-error',{error:String(error?.message||error)});console.warn('Fallback message sync failed:',error)}
 finally{
  if(generation===state.messagePollGeneration){
   state.messagePollBusy=false;
   scheduleMessagePolling(conversationId,generation);
  }
  updateDiagnostics();
 }
}
function subscribeProfileUpdates(conversation){
 if(state.profileChannel)supabaseClient.removeChannel(state.profileChannel);
 let channel=supabaseClient.channel('profile-updates:'+state.user.id,{config:{postgres_changes_options:{wait:true,timeout:15000}}});
 channel=channel.on('postgres_changes',{event:'UPDATE',schema:'public',table:'profiles'},payload=>{
  const updated=payload.new;if(!updated?.id)return;
  if(updated.id===state.user?.id){state.profile={...(state.profile||{}),...updated};$('myName').textContent=updated.display_name||updated.username;$('myHandle').textContent='@'+updated.username+' · '+(updated.membership_number||state.profile?.membership_number||'');renderAvatar($('myAvatar'),state.profile,'avatar profile-avatar-edit')}
  state.conversations.forEach(conv=>(conv.members||[]).forEach(member=>{if(member.user_id===updated.id)member.profile={...(member.profile||{}),...updated}}));
  state.directoryUsers=state.directoryUsers.map(profile=>profile.id===updated.id?{...profile,...updated}:profile);
  if(state.active?.type==='direct'&&otherMember(state.active)?.id===updated.id){$('chatTitle').textContent=convName(state.active);renderChatAvatar(state.active)}
  if(state.sidebarView==='users')renderDirectory();renderConversations();
 });
 state.profileChannel=channel.subscribe(status=>{if(status!=='SUBSCRIBED')console.warn('Profile realtime status:',status)});
}
function handleMessageUpdateRealtime(payload,conversationId){
 const incoming=payload?.new;if(!incoming?.id||incoming.conversation_id!==conversationId||state.active?.id!==conversationId)return;
 const index=state.messages.findIndex(message=>message.id===incoming.id);
 const existingRow=Array.from(document.querySelectorAll('.message')).find(item=>item.dataset.messageId===incoming.id);
 if(incoming.deleted_at&&index>=0&&state.messages[index].deleted_at===incoming.deleted_at&&existingRow?.querySelector('.bubble.deleted'))return;
 if(index>=0)state.messages[index]=incoming;else state.messages.push(incoming);
 if(incoming.deleted_at){
  state.reactions?.delete(incoming.id);state.pinnedMessages?.delete(incoming.id);
  const deletedRow=existingRow;
  if(deletedRow)deletedRow.remove();
  state.messageIds.delete(incoming.id);
  reconcileMessageTimeline($('messages'));
  renderMessage(incoming,conversationId,state.messageLoadVersion).catch(error=>console.error('Deleted message render failed:',error));
  const conversation=state.conversations.find(item=>item.id===conversationId);
  if(conversation?.last_message?.id===incoming.id)loadConversations().catch(error=>console.warn('Conversation preview refresh failed:',error));
  return;
 }
 const row=Array.from(document.querySelectorAll('.message')).find(item=>item.dataset.messageId===incoming.id);
 if(row){
  const bubble=row.querySelector('.bubble');let content=bubble?.querySelector('.message-content');
  if(bubble&&incoming.content){
   if(!content){content=document.createElement('div');content.className='message-content';const meta=bubble.querySelector('.meta');bubble.insertBefore(content,meta||null)}
   content.textContent=incoming.content;
  }
  const meta=row.querySelector('.meta');if(meta)meta.textContent=time(incoming.created_at)+(incoming.edited_at?' · تم تعديلها':'');
 }
 state.messages.filter(message=>message.reply_to===incoming.id).forEach(reply=>{
  const replyRow=Array.from(document.querySelectorAll('.message')).find(item=>item.dataset.messageId===reply.id);
  const preview=replyRow?.querySelector('.reply-quote span');if(preview)preview.textContent=messagePreview(incoming);
 });
 const conversation=state.conversations.find(item=>item.id===conversationId);
 if(conversation?.last_message?.id===incoming.id){conversation.last_message=incoming;conversation.last_message_at=incoming.created_at;renderConversations()}
}
function handleMessageDeleteRealtime(payload,conversationId){
 const deletedId=payload?.old?.id;
 if(!deletedId||state.active?.id!==conversationId)return false;
 const existing=(state.messages||[]).find(message=>message.id===deletedId);
 if(existing&&existing.conversation_id!==conversationId)return false;
 state.messages=(state.messages||[]).filter(message=>message.id!==deletedId);
 state.messageIds?.delete(deletedId);
 state.reactions?.delete(deletedId);
 state.pinnedMessages?.delete(deletedId);
 state.replyMessages?.delete(deletedId);
 const row=Array.from(document.querySelectorAll('.message')).find(item=>item.dataset.messageId===deletedId);
 if(row)row.remove();
 const area=$('messages');reconcileMessageTimeline(area);
 if(!state.messages.length)area.innerHTML='<div class="welcome"><div class="welcome-icon"><i class="ph ph-chat-teardrop-text"></i></div><h2>بداية محادثة جديدة</h2><p>أرسل أول رسالة لبدء التواصل.</p></div>';
 const conversation=state.conversations.find(item=>item.id===conversationId);
 if(conversation?.last_message?.id===deletedId)loadConversations().catch(error=>console.warn('Conversation preview refresh failed:',error));
 return true;
}
async function handleConversationMemberDeletion(payload,conversationId){
 if(payload?.old?.conversation_id!==conversationId||state.active?.id!==conversationId)return;
 const removedUserId=payload.old.user_id;
 await loadConversations();
 if(removedUserId===state.user?.id&&state.active?.id===conversationId){
  state.conversationOpenVersion=(state.conversationOpenVersion||0)+1;
  state.messageLoadVersion++;
  stopMessagePolling();
  const activeChannel=state.channel;state.channel=null;
  const typingChannel=state.typingChannel;state.typingChannel=null;
  if(activeChannel)void supabaseClient.removeChannel(activeChannel).catch(error=>console.warn('Revoked chat channel cleanup failed:',error));
  if(typingChannel)void supabaseClient.removeChannel(typingChannel).catch(error=>console.warn('Revoked typing channel cleanup failed:',error));
  state.active=null;state.activeChatPreference=null;state.messages=[];state.messageIds.clear();state.renderingMessageIds.clear();
  state.reactions=new Map();state.pinnedMessages=new Map();state.replyMessages=new Map();state.replyTarget=null;state.editTarget=null;state.privateReplyPending=null;state.groupSettings=null;
  renderComposerContext();
  state.attachment=null;$('fileInput').value='';$('attachmentPreview').classList.add('hidden');
  $('messageInput').value='';$('messageInput').disabled=true;$('sendBtn').disabled=true;
  $('chatTitle').textContent='تم سحب عضويتك من المحادثة';
  $('chatSub').textContent='لم يعد لديك إذن الوصول إلى هذه المحادثة';
  $('messages').innerHTML='<div class="welcome"><div class="welcome-icon"><i class="ph ph-lock"></i></div><h2>انتهى الوصول إلى المحادثة</h2><p>تم سحب عضويتك، وأُغلق عرض الرسائل وأُوقفت إمكانية الإرسال.</p></div>';
  applyDirectChatTheme();renderPinnedBanner();$('sidebar').classList.remove('closed');
  toast('تم سحب عضويتك من هذه المحادثة. لم يعد بإمكانك الوصول إلى رسائلها.');
 }
 if($('groupManagementModal')?.classList.contains('open'))await openGroupManagement();
}
function subscribeConversation(){
 if(state.channel)supabaseClient.removeChannel(state.channel);
 if(state.typingChannel)supabaseClient.removeChannel(state.typingChannel);
 const id=state.active.id;diagLog('realtime-subscribe',{conversationId:id});
 let channelHasSubscribed=false;
 state.channel=supabaseClient.channel('chat:'+id,{config:{postgres_changes_options:{wait:true,timeout:15000}}})
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages',filter:'conversation_id=eq.'+id},p=>{if(state.active?.id!==id)return;state.diagnostics.lastRealtimeAt=new Date().toLocaleTimeString('en-GB');state.diagnostics.lastRealtimeEvent='INSERT';diagLog('realtime-insert',{id:p.new?.id});const incoming=p.new;if(state.activeChatPreference?.cleared_before&&new Date(incoming.created_at)<=new Date(state.activeChatPreference.cleared_before))return;const index=state.messages.findIndex(m=>m.id===incoming.id);if(index>=0)state.messages[index]=incoming;else state.messages.push(incoming);renderMessage(incoming,id,state.messageLoadVersion).catch(error=>console.error('Realtime message failed:',error));if(incoming.sender_id!==state.user.id)markConversationReceipt(id,document.visibilityState==='visible'&&isMessagesNearBottom(),state.messageLoadVersion)})
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'chat_messages',filter:'conversation_id=eq.'+id},p=>handleMessageUpdateRealtime(p,id))
  .on('postgres_changes',{event:'DELETE',schema:'public',table:'chat_messages'},p=>handleMessageDeleteRealtime(p,id))
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'message_reactions',filter:'conversation_id=eq.'+id},p=>handleReactionRealtime(p,id))
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'message_reactions',filter:'conversation_id=eq.'+id},p=>handleReactionRealtime(p,id))
  .on('postgres_changes',{event:'DELETE',schema:'public',table:'message_reactions'},p=>handleReactionRealtime(p,id))
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'message_pins',filter:'conversation_id=eq.'+id},p=>handlePinRealtime(p,id))
  .on('postgres_changes',{event:'DELETE',schema:'public',table:'message_pins'},p=>handlePinRealtime(p,id))
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'conversation_members',filter:'conversation_id=eq.'+id},p=>handleMembershipRealtime(p,id))
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'conversation_members',filter:'conversation_id=eq.'+id},async()=>{if(state.active?.id!==id)return;await loadConversations();if($('groupManagementModal')?.classList.contains('open'))await openGroupManagement()})
  .on('postgres_changes',{event:'DELETE',schema:'public',table:'conversation_members'},p=>handleConversationMemberDeletion(p,id))
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'conversation_group_settings',filter:'conversation_id=eq.'+id},p=>{if(state.active?.id!==id)return;state.groupSettings=p.new;applyGroupTheme();updateGroupComposerPermission()})
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'conversations',filter:'id=eq.'+id},p=>{if(state.active?.id!==id)return;Object.assign(state.active,p.new);$('chatTitle').textContent=convName(state.active);renderConversations()})
  .on('postgres_changes',{event:'*',schema:'public',table:'conversation_documents',filter:'conversation_id=eq.'+id},()=>{if(state.active?.id===id&&$('conversationWorkspaceModal')?.classList.contains('open'))loadConversationDocuments(id)})
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'private_reply_contexts',filter:'direct_conversation_id=eq.'+id},p=>{if(state.active?.id!==id)return;state.privateReplyContexts.set(p.new.direct_message_id,p.new);renderPrivateReplyQuote(p.new.direct_message_id,p.new)})
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'conversation_member_events',filter:'conversation_id=eq.'+id},()=>{if(state.active?.id===id&&$('groupManagementModal')?.classList.contains('open'))openGroupManagement()})
  .subscribe((s,error)=>{
   const reconnected=channelHasSubscribed&&s==='SUBSCRIBED';
   if(s==='SUBSCRIBED')channelHasSubscribed=true;
   state.realtimeStatus=s;diagLog('realtime-status',{status:s,reconnected,error:error?.message||null});
   if(s==='CHANNEL_ERROR'||s==='TIMED_OUT')console.warn('Chat realtime subscription:',s,error?.message||error);
   if(state.messagePollTimer)scheduleMessagePolling(id,state.messagePollGeneration);
   if(reconnected&&state.active?.id===id)loadMessages().catch(error=>console.warn('Reconnect message reconciliation failed:',error));
   $('connectionState').textContent=s==='SUBSCRIBED'?'متصل':s==='CHANNEL_ERROR'?'مشكلة اتصال — إعادة المحاولة':'إعادة الاتصال…';
  });
 state.typingChannel=supabaseClient.channel('typing:'+id).on('broadcast',{event:'typing'},({payload})=>{if(payload?.user_id!==state.user.id){$('typing').textContent=payload?.is_typing?(payload?.name||'عضو')+' يكتب الآن…':'';clearTimeout(state.typingTimer);if(payload?.is_typing)state.typingTimer=setTimeout(()=>$('typing').textContent='',2200)}}).subscribe();
}
async function editMessage(m){beginEditMessage(m)}
async function deleteMessage(m){
 if(m.sender_id!==state.user?.id||m.deleted_at)return;
 if(!confirm('هل تريد حذف هذه الرسالة؟'))return;
 try{
  const {data,error}=await supabaseClient.from('chat_messages')
   .update({deleted_at:new Date().toISOString(),content:'تم حذف الرسالة',attachment_path:null,attachment_type:null})
   .eq('id',m.id).eq('sender_id',state.user.id).select('*').single();
  if(error)throw error;
  if(!data?.id)throw new Error('لم يتم تأكيد حذف الرسالة');
  if(state.replyTarget?.id===m.id)cancelComposerContext();
  handleMessageUpdateRealtime({new:data},data.conversation_id);
 }catch(error){console.error('Message delete failed:',error);toast(error?.message||'تعذر حذف الرسالة')}
}
function formatVoiceDuration(seconds){
 const total=Math.max(0,Math.floor(seconds||0)),minutes=String(Math.floor(total/60)).padStart(2,'0'),secs=String(total%60).padStart(2,'0');
 return (minutes+':'+secs).replace(/\d/g,d=>'٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}
function currentVoiceElapsedMs(){
 return Math.max(0,state.voiceElapsedMs+(state.voicePaused||!state.voiceSegmentStartedAt?0:Date.now()-state.voiceSegmentStartedAt));
}
function updateVoiceRecordingUI(){
 const controls=$('voiceRecordingControls'),time=$('voiceRecordingTime'),pause=$('voicePauseBtn'),status=$('voiceRecordingStatus');
 if(!controls||!state.voiceRecorder)return;
 const elapsed=Math.floor(currentVoiceElapsedMs()/1000);
 if(time)time.textContent=formatVoiceDuration(elapsed);
 controls.classList.toggle('is-paused',!!state.voicePaused);
 if(status)status.textContent=state.voicePaused?'متوقف مؤقتاً':'جارٍ التسجيل';
 if(pause){pause.innerHTML=state.voicePaused?'<i class="ph ph-play"></i>':'<i class="ph ph-pause"></i>';pause.setAttribute('aria-label',state.voicePaused?'استئناف التسجيل':'إيقاف مؤقت');pause.title=state.voicePaused?'استئناف التسجيل':'إيقاف مؤقت'}
}
function clearVoiceTimer(){if(state.voiceTimer){clearInterval(state.voiceTimer);state.voiceTimer=null}}
function setVoiceComposerActive(active){
 const composer=$('voiceRecordBtn')?.closest('.composer');
 composer?.classList.toggle('voice-recording-active',!!active);
 $('voiceRecordingControls')?.classList.toggle('hidden',!active);
 if(!active){
  const send=$('sendBtn');if(send){send.innerHTML='<i class="ph ph-paper-plane-tilt"></i>';send.title='إرسال';send.setAttribute('aria-label','إرسال')}
 }
}
function cleanupVoiceCapture(){
 clearVoiceTimer();
 if(state.voiceAudioProcessor){try{state.voiceAudioProcessor.disconnect()}catch(_e){}state.voiceAudioProcessor=null}
 if(state.voiceAudioSource){try{state.voiceAudioSource.disconnect()}catch(_e){}state.voiceAudioSource=null}
 if(state.voiceAudioContext){const context=state.voiceAudioContext;state.voiceAudioContext=null;if(context.state!=='closed')context.close().catch(()=>{})}
 if(state.voiceStream){state.voiceStream.getTracks().forEach(track=>track.stop());state.voiceStream=null}
 state.voiceRecorder=null;state.voiceChunks=[];state.voiceStartedAt=null;state.voiceElapsedMs=0;state.voiceSegmentStartedAt=null;state.voicePaused=false;
 $('voiceRecordBtn').classList.remove('recording');$('voiceRecordBtn').innerHTML='<i class="ph ph-microphone"></i>';$('voiceRecordBtn').title='تسجيل رسالة صوتية';$('voiceCancelBtn').classList.add('hidden');
 setVoiceComposerActive(false);
}
function pauseVoiceRecording(){
 const recorder=state.voiceRecorder;if(!recorder||state.voicePaused||recorder.state!=='recording'||typeof recorder.pause!=='function')return;
 try{recorder.pause();if(state.voiceSegmentStartedAt)state.voiceElapsedMs+=Date.now()-state.voiceSegmentStartedAt;state.voiceSegmentStartedAt=null;state.voicePaused=true;updateVoiceRecordingUI()}catch(error){console.warn('Voice pause failed:',error);toast('تعذر إيقاف التسجيل مؤقتاً في هذا المتصفح')}
}
function resumeVoiceRecording(){
 const recorder=state.voiceRecorder;if(!recorder||!state.voicePaused||recorder.state!=='paused'||typeof recorder.resume!=='function')return;
 try{recorder.resume();state.voicePaused=false;state.voiceSegmentStartedAt=Date.now();updateVoiceRecordingUI()}catch(error){console.warn('Voice resume failed:',error);toast('تعذر استئناف التسجيل')}
}
function toggleVoicePause(){if(state.voicePaused)resumeVoiceRecording();else pauseVoiceRecording()}
function sendVoiceRecording(){
 if(!state.voiceRecorder)return;
 state.voiceSendOnStop=true;
 const send=$('sendBtn');if(send)send.disabled=true;
 if(state.voicePaused){state.voicePaused=false;state.voiceSegmentStartedAt=null}
 stopVoiceRecording();
}
function encodeVoiceWav(chunks,sampleRate){
 const total=chunks.reduce((sum,chunk)=>sum+chunk.length,0),input=new Float32Array(total);let offset=0;
 chunks.forEach(chunk=>{input.set(chunk,offset);offset+=chunk.length});
 const targetRate=16000,ratio=sampleRate/targetRate,outLength=Math.max(1,Math.floor(input.length/ratio)),buffer=new ArrayBuffer(44+outLength*2),view=new DataView(buffer);
 const write=(pos,value)=>{for(let i=0;i<value.length;i++)view.setUint8(pos+i,value.charCodeAt(i))};
 write(0,'RIFF');view.setUint32(4,36+outLength*2,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,targetRate,true);view.setUint32(28,targetRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,outLength*2,true);
 for(let i=0;i<outLength;i++){const sourceIndex=Math.min(input.length-1,Math.floor(i*ratio)),sample=Math.max(-1,Math.min(1,input[sourceIndex]));view.setInt16(44+i*2,sample<0?sample*0x8000:sample*0x7fff,true)}
 return new Blob([buffer],{type:'audio/wav'});
}
async function createFallbackVoiceRecorder(stream){
 const AudioContextClass=window.AudioContext||window.webkitAudioContext;
 if(!AudioContextClass)throw new Error('هذا المتصفح لا يدعم التسجيل الصوتي. حدّث المتصفح أو استخدم Chrome أو Safari.');
 const context=new AudioContextClass();state.voiceAudioContext=context;
 if(context.state==='suspended')await context.resume();
 if(context.state!=='running')throw new Error('تعذر تشغيل محرك الصوت. اضغط تسجيل مرة أخرى واسمح باستخدام الميكروفون.');
 const source=context.createMediaStreamSource(stream),processor=context.createScriptProcessor(4096,1,1),chunks=[];
 processor.onaudioprocess=event=>{if(!state.voiceRecorder||state.voiceRecorder.state!=='recording')return;chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));event.outputBuffer.getChannelData(0).fill(0)};
 source.connect(processor);processor.connect(context.destination);state.voiceAudioSource=source;state.voiceAudioProcessor=processor;
 return {state:'recording',mimeType:'audio/wav',onstop:null,pause(){if(this.state==='recording')this.state='paused'},resume(){if(this.state==='paused')this.state='recording'},stop(){if(this.state==='inactive')return;this.state='inactive';state.voiceChunks=[encodeVoiceWav(chunks,context.sampleRate)];if(typeof this.onstop==='function')this.onstop()}};
}
function showAttachmentPreview(file,label){const preview=$('attachmentPreview');preview.replaceChildren();const text=document.createElement('span');text.textContent=label||('المرفق المحدد: '+file.name+' ('+Math.ceil(file.size/1024)+' كيلوبايت)');preview.append(text);const clear=document.createElement('button');clear.type='button';clear.textContent='إزالة';clear.style.cssText='margin-inline-start:12px;border:0;background:transparent;color:#dc5555;cursor:pointer;font:inherit';clear.onclick=()=>{state.attachment=null;state.voiceDuration=0;$('fileInput').value='';preview.classList.add('hidden');preview.replaceChildren();resizeComposer()};preview.append(clear);preview.classList.remove('hidden')}
async function startVoiceRecording(){
 if(!state.active||state.uploading||state.attachment||state.voiceRecorder)return;
 const recordingConversationId=state.active.id,recordingUserId=state.user?.id;
 const role=(state.active.members||[]).find(m=>m.user_id===state.user?.id)?.role;
 if(state.active.type==='channel'&&!['owner','admin'].includes(role)){toast('التسجيل في هذه القناة مخصص للمشرفين');return}
 if(state.active.type==='group'&&state.groupSettings?.only_admins_can_send&&!['owner','admin'].includes(role)){toast('التسجيل في هذه المجموعة مخصص للمشرفين');return}
 if(!window.isSecureContext){toast('يلزم فتح التطبيق عبر اتصال HTTPS لتفعيل الميكروفون');return}
 if(!navigator.mediaDevices?.getUserMedia){toast('الميكروفون غير متاح. افتح التطبيق في Chrome أو Safari واسمح باستخدامه');return}
 let stream=null;
 try{
  try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})}
  catch(firstError){if(firstError?.name==='NotAllowedError'||firstError?.name==='SecurityError')throw firstError;stream=await navigator.mediaDevices.getUserMedia({audio:true})}
  if(state.active?.id!==recordingConversationId||state.user?.id!==recordingUserId){stream.getTracks().forEach(track=>track.stop());toast('تغيرت المحادثة قبل بدء التسجيل');return}
  state.voiceStream=stream;state.voiceChunks=[];state.cancelVoiceOnStop=false;state.voiceSendOnStop=false;state.voiceElapsedMs=0;state.voiceSegmentStartedAt=Date.now();state.voicePaused=false;state.voiceStartedAt=Date.now();
  let recorder=null,supported=null;
  if(typeof MediaRecorder!=='undefined'){
   const ua=navigator.userAgent||'',preferMp4=/iPhone|iPad|iPod/i.test(ua);
   const candidates=preferMp4?['audio/mp4','audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/webm']:['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus','audio/webm'];
   supported=candidates.find(type=>{try{return MediaRecorder.isTypeSupported?.(type)}catch(_e){return false}});
   try{recorder=new MediaRecorder(stream,supported?{mimeType:supported}:undefined)}catch(_e){recorder=null}
  }
  if(!recorder)recorder=await createFallbackVoiceRecorder(stream);
  state.voiceRecorder=recorder;
  recorder.ondataavailable=event=>{if(event.data?.size)state.voiceChunks.push(event.data)};
  recorder.onerror=event=>{console.error('Voice recording failed:',event.error||event);state.voiceSendOnStop=false;toast('تعذر تسجيل الصوت. تحقق من إذن الميكروفون ثم حاول مجدداً.');cleanupVoiceCapture();resizeComposer()};
  recorder.onstop=()=>{
   const cancelled=state.cancelVoiceOnStop,shouldSend=state.voiceSendOnStop;
   if(state.voiceSegmentStartedAt)state.voiceElapsedMs+=Date.now()-state.voiceSegmentStartedAt;
   const elapsed=Math.round(state.voiceElapsedMs/1000),chunks=state.voiceChunks.slice();
   const mime=(recorder.mimeType||supported||'audio/wav').split(';')[0].toLowerCase();
   state.voiceSendOnStop=false;cleanupVoiceCapture();
   if(cancelled){state.cancelVoiceOnStop=false;state.voiceElapsedMs=0;resizeComposer();return}
   const blob=new Blob(chunks,{type:mime});if(!blob.size){toast('لم يتم التقاط صوت. تحقق من إذن الميكروفون وحاول مرة أخرى.');resizeComposer();return}
   if(blob.size>12*1024*1024){toast('حجم التسجيل تجاوز الحد الأقصى 12 ميجابايت');resizeComposer();return}
   const ext=mime==='audio/mp4'?'m4a':mime==='audio/ogg'?'ogg':mime==='audio/mpeg'?'mp3':mime==='audio/wav'?'wav':'webm';
   const file=new File([blob],'voice-'+Date.now()+'.'+ext,{type:mime});state.attachment=file;state.voiceDuration=elapsed;
   showAttachmentPreview(file,'رسالة صوتية · '+formatVoiceDuration(elapsed)+' · '+Math.ceil(file.size/1024)+' كيلوبايت');resizeComposer();
   if(shouldSend){setTimeout(()=>{if(state.attachment===file)sendMessage()},0)}
  };
  if(recorder instanceof (window.MediaRecorder||Function)){recorder.start()}
  $('voiceRecordBtn').classList.add('recording');$('voiceRecordBtn').title='التسجيل الصوتي جارٍ';$('voiceCancelBtn').classList.add('hidden');setVoiceComposerActive(true);$('sendBtn').disabled=false;$('sendBtn').innerHTML='<i class="ph ph-paper-plane-tilt"></i>';$('sendBtn').title='إرسال التسجيل الصوتي';$('sendBtn').setAttribute('aria-label','إرسال التسجيل الصوتي');updateVoiceRecordingUI();
  state.voiceTimer=setInterval(()=>{const elapsed=Math.floor(currentVoiceElapsedMs()/1000);updateVoiceRecordingUI();if(elapsed>=180){state.voiceSendOnStop=false;stopVoiceRecording()}},250);
 }catch(error){
  if(stream){stream.getTracks().forEach(track=>track.stop())}
  if(state.voiceStream===stream)cleanupVoiceCapture();
  console.error('Microphone access failed:',error);
  toast(error?.name==='NotAllowedError'?'اسمح للمتصفح باستخدام الميكروفون من إعدادات الموقع ثم حاول مجدداً':error?.name==='NotFoundError'?'لم يتم العثور على ميكروفون متصل بالجهاز':error?.name==='NotReadableError'?'الميكروفون مشغول بتطبيق آخر. أغلقه ثم أعد المحاولة':error?.message||'تعذر تشغيل الميكروفون');
 }
}
function stopVoiceRecording(){if(state.voiceRecorder&&state.voiceRecorder.state!=='inactive')state.voiceRecorder.stop()}
function cancelVoiceRecording(){if(!state.voiceRecorder)return;state.cancelVoiceOnStop=true;state.voiceSendOnStop=false;state.voiceElapsedMs=0;state.voiceSegmentStartedAt=null;stopVoiceRecording()}
$('voicePauseBtn').onclick=toggleVoicePause;
$('voiceTrashBtn').onclick=()=>{if(state.voiceRecorder){cancelVoiceRecording();toast('تم حذف التسجيل وإعادة ضبط المؤقت')}};
const CHAT_ATTACHMENT_MIME_BY_EXTENSION={
 jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',
 pdf:'application/pdf',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',
 doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
 txt:'text/plain',csv:'text/csv',m4a:'audio/mp4',mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav',aac:'audio/aac'
};
const CHAT_ATTACHMENT_ALLOWED_MIME_TYPES=new Set(Object.values(CHAT_ATTACHMENT_MIME_BY_EXTENSION));
function resolveChatAttachmentMime(file){
 const declared=String(file?.type||'').split(';')[0].trim().toLowerCase();
 if(declared&&declared!=='application/octet-stream')return declared;
 const extension=String(file?.name||'').split('.').pop().toLowerCase();
 return CHAT_ATTACHMENT_MIME_BY_EXTENSION[extension]||declared;
}
async function uploadAttachment(file,conversationId=state.active?.id,userId=state.user?.id){
 if(!conversationId||!userId)throw new Error('اختر محادثة أولاً');
 if(!file||!Number.isFinite(file.size)||file.size<=0)throw new Error('الملف فارغ أو غير صالح');
 if(file.size>12*1024*1024)throw new Error('الحد الأقصى لحجم الملف 12 ميجابايت');
 const type=resolveChatAttachmentMime(file);
 if(!CHAT_ATTACHMENT_ALLOWED_MIME_TYPES.has(type))throw new Error('نوع الملف غير مدعوم. استخدم صورة أو PDF أو مستند Office أو فيديو MP4/WebM/MOV أو ملف صوتي مسجل من التطبيق.');
 const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=conversationId+'/'+userId+'/'+crypto.randomUUID()+'_'+safe;
 const {error}=await supabaseClient.storage.from('chat-media').upload(path,file,{upsert:false,contentType:type});if(error)throw error;return {path,type};
}
async function sendMessage(){
 if(state.voiceRecorder){toast('أوقف التسجيل الصوتي أولاً قبل الإرسال');return}
 const activeConversation=state.active,draftValue=$('messageInput').value,content=draftValue.trim(),file=state.attachment,conversationId=activeConversation?.id,userId=state.user?.id,editTarget=state.editTarget,editing=!!editTarget,replyTo=state.replyTarget?.id||null,privateContext=state.privateReplyPending?{...state.privateReplyPending}:null;
 const activeRole=(activeConversation?.members||[]).find(m=>m.user_id===userId)?.role;if(activeConversation?.type==='channel'&&!['owner','admin'].includes(activeRole)){toast('النشر في هذه القناة مخصص للمشرفين');return}if(activeConversation?.type==='group'&&state.groupSettings?.only_admins_can_send&&!['owner','admin'].includes(activeRole)){toast('الإرسال متاح لمشرفي المجموعة فقط');return}
 if(!conversationId||!userId||(!content&&!file)||state.uploading)return;
 const pendingKey=conversationId+':'+userId;
 let pendingSend=null;
 if(!editing){
  state.pendingMessageSends ||= new Map();
  const previous=state.pendingMessageSends.get(pendingKey);
  pendingSend=previous&&previous.content===content&&previous.replyTo===replyTo&&previous.file===file
   ?previous:{id:crypto.randomUUID(),conversationId,userId,content,replyTo,file,attachmentPath:null,attachmentType:null};
  state.pendingMessageSends.set(pendingKey,pendingSend);
 }
 state.uploading=true;$('sendBtn').disabled=true;$('messageInput').disabled=false;
 let savedMessage=null;
 try{
  const {data:{session},error:sessionError}=await supabaseClient.auth.getSession();
  if(sessionError)throw sessionError;
  if(!session?.user?.id||session.user.id!==userId)throw new Error('انتهت جلسة الدخول. أعد تسجيل الدخول ثم حاول إرسال الرسالة مجدداً.');
  if(editTarget){
   if(file)throw new Error('أزل المرفق قبل حفظ تعديل الرسالة');
   const target=editTarget,expectedRevision=Number(target.edit_revision||0);
   if(target.conversation_id!==conversationId||target.sender_id!==userId||!canEditMessage(target))throw new Error('انتهت مهلة التعديل أو لا تملك صلاحية تعديل الرسالة');
   const {data,error}=await supabaseClient.rpc('edit_message_secure',{p_message_id:target.id,p_new_content:content,p_expected_revision:expectedRevision});
   if(error){
    const {data:verified,error:verifyError}=await supabaseClient.from('chat_messages').select('*').eq('id',target.id).eq('conversation_id',conversationId).eq('sender_id',userId).maybeSingle();
    if(verifyError||!verified||verified.content!==content||Number(verified.edit_revision||0)<=expectedRevision)throw error;
    savedMessage=verified;
   }else savedMessage=Array.isArray(data)?data[0]:data;
   if(!savedMessage?.id)throw new Error('لم يتم تأكيد حفظ التعديل');
  }else{
   let attachment={path:pendingSend?.attachmentPath||null,type:pendingSend?.attachmentType||null};
   if(file&&!attachment.path){attachment=await uploadAttachment(file,conversationId,userId);pendingSend.attachmentPath=attachment.path;pendingSend.attachmentType=attachment.type}
   const {data,error}=await supabaseClient.from('chat_messages').insert({id:pendingSend.id,conversation_id:conversationId,sender_id:userId,content,...(replyTo?{reply_to:replyTo}:{}),...(attachment.path?{attachment_path:attachment.path,attachment_type:attachment.type}:{})}).select('*').single();
   if(error){
    const {data:verified,error:verifyError}=await supabaseClient.from('chat_messages').select('*').eq('id',pendingSend.id).eq('conversation_id',conversationId).eq('sender_id',userId).maybeSingle();
    if(verifyError||!verified)throw error;
    savedMessage=verified;
   }else savedMessage=data;
   if(!savedMessage?.id)throw new Error('لم يتم تأكيد حفظ الرسالة');
   if(state.pendingMessageSends.get(pendingKey)?.id===pendingSend.id)state.pendingMessageSends.delete(pendingKey);
   if(privateContext){const {error:ctxError}=await supabaseClient.from('private_reply_contexts').insert({direct_message_id:savedMessage.id,direct_conversation_id:conversationId,sender_id:userId,source_conversation_id:privateContext.sourceConversationId,source_message_id:privateContext.sourceMessageId,quoted_content:privateContext.quotedContent,quoted_sender_id:privateContext.quotedSenderId});if(ctxError){console.warn(ctxError);toast('أُرسلت الرسالة الخاصة دون اقتباس المجموعة')}else state.privateReplyContexts.set(savedMessage.id,{quoted_content:privateContext.quotedContent});if(state.privateReplyPending?.sourceMessageId===privateContext.sourceMessageId)state.privateReplyPending=null}}
 }catch(error){
  console.error('Message persistence failed:',error);
  toast(error.message||'لم يتم تأكيد حفظ الرسالة. احتفظنا بالنص لإعادة المحاولة.');
  state.uploading=false;resizeComposer();return;
 }
 try{
  // Clear only the exact draft that was sent, and only while its conversation remains active.
  if(state.active?.id===conversationId&&$('messageInput').value===draftValue&&state.attachment===file&&(state.replyTarget?.id||null)===replyTo&&((!state.editTarget&&!editTarget)||state.editTarget?.id===editTarget?.id)&&(!state.privateReplyPending||state.privateReplyPending.sourceMessageId===privateContext?.sourceMessageId)){
   $('messageInput').value='';state.attachment=null;state.voiceDuration=0;$('fileInput').value='';$('attachmentPreview').replaceChildren();$('attachmentPreview').classList.add('hidden');state.replyTarget=null;state.editTarget=null;state.privateReplyPending=null;renderComposerContext();resizeComposer();publishTyping(false);
  }
  if(state.active?.id===conversationId){
   const existing=state.messages.findIndex(m=>m.id===savedMessage.id);
   if(existing>=0)state.messages[existing]=savedMessage;else state.messages.push(savedMessage);
   if(editing){
    const restored=await loadMessages();
    if(!restored)toast('تم حفظ التعديل، لكن تعذر تحديث العرض. اضغط تحديث المحادثة.');
   }else if(!state.messageIds.has(savedMessage.id)){
    const rendered=await renderMessage(savedMessage,conversationId,state.messageLoadVersion);
    if(!rendered)toast('تم حفظ الرسالة، لكن تعذر عرضها فوراً. أعد فتح المحادثة لتحديث العرض.');
   }
   const conversation=state.conversations.find(item=>item.id===conversationId);
   if(conversation){conversation.last_message=savedMessage;conversation.last_message_at=savedMessage.created_at;}
   renderConversations();
  }
 }finally{state.uploading=false;resizeComposer()}
}
function resizeComposer(){const n=$('messageInput');n.style.height='auto';n.style.height=Math.min(n.scrollHeight,130)+'px';const role=(state.active?.members||[]).find(m=>m.user_id===state.user?.id)?.role,channelBlocked=state.active?.type==='channel'&&!['owner','admin'].includes(role),groupBlocked=state.active?.type==='group'&&!!state.groupSettings?.only_admins_can_send&&!['owner','admin'].includes(role);$('sendBtn').disabled=state.uploading||!state.active||channelBlocked||groupBlocked||(!n.value.trim()&&!state.attachment);updateDiagnostics()}
$('messageInput').addEventListener('input',()=>{resizeComposer();if($('messageInput').value.trim())publishTyping(true);else publishTyping(false)});
$('messageInput').addEventListener('blur',()=>publishTyping(false));
$('messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.stopPropagation();requestAnimationFrame(resizeComposer)}});
$('composerContextCancel').onclick=()=>{if(state.editTarget){$('messageInput').value='';state.attachment=null;$('fileInput').value='';$('attachmentPreview').classList.add('hidden')}cancelComposerContext();resizeComposer()};
$('newMessagesJump').onclick=jumpToLatestMessages;
$('chatSearchBtn').onclick=()=>{closeChatHeaderMenu();$('chatSearchPanel').classList.toggle('hidden');if(!$('chatSearchPanel').classList.contains('hidden'))$('chatSearchInput').focus()};
function closeChatHeaderMenu(){const menu=$('chatHeaderMenu'),button=$('chatHeaderMenuBtn');menu?.classList.add('hidden');button?.setAttribute('aria-expanded','false')}
$('chatHeaderMenuBtn').onclick=event=>{event.stopPropagation();const menu=$('chatHeaderMenu'),button=$('chatHeaderMenuBtn'),opening=menu.classList.contains('hidden');menu.classList.toggle('hidden',!opening);button.setAttribute('aria-expanded',String(opening))};
$('chatHeaderMenu')?.addEventListener('click',event=>{event.stopPropagation();if(event.target.closest('button'))closeChatHeaderMenu()});
document.addEventListener('click',()=>{closeChatHeaderMenu();document.querySelectorAll('.message-options-menu').forEach(menu=>{if(menu._closeMenu)menu._closeMenu();else menu.classList.add('hidden')});document.querySelectorAll('.message-menu-trigger').forEach(button=>button.setAttribute('aria-expanded','false'))});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeChatHeaderMenu();document.querySelectorAll('.message-options-menu').forEach(menu=>{if(menu._closeMenu)menu._closeMenu();else menu.classList.add('hidden')});document.querySelectorAll('.message-menu-trigger').forEach(button=>button.setAttribute('aria-expanded','false'))}});
$('chatSearchClose').onclick=()=>{$('chatSearchPanel').classList.add('hidden');$('chatSearchInput').value='';$('chatSearchResults').innerHTML='<p>اكتب كلمة للبحث داخل المحادثة الحالية.</p>'};
$('chatSearchInput').addEventListener('input',()=>{if(state.chatSearchTimer)clearTimeout(state.chatSearchTimer);const term=$('chatSearchInput').value;state.chatSearchTimer=setTimeout(()=>searchActiveConversation(term),250)});
$('chatSearchInput').addEventListener('keydown',event=>{if(event.key==='Escape')$('chatSearchPanel').classList.add('hidden')});
$('messages').addEventListener('scroll',()=>{
 const area=$('messages');if(!area)return;
 if(isMessagesNearBottom(area,70))clearNewMessages(true);
 if(state.loadingOlderMessages||!state.hasMoreMessages||state.isLoadingMessages)return;
 if(area.scrollTop<=110){if(!state.historyScrollFrame){state.historyScrollFrame=requestAnimationFrame(()=>{state.historyScrollFrame=0;if(area.scrollTop<=140)loadOlderMessages()})}}
},{passive:true});
$('sendBtn').onclick=()=>state.voiceRecorder?sendVoiceRecording():sendMessage();$('search').oninput=()=>{
 if(state.sidebarView==='team'){state.teamSearch=$('search').value.trim().toLocaleLowerCase('ar');renderTeamDashboard()}
 else if(state.sidebarView==='users'){
  state.directorySearch=$('search').value.trim().toLocaleLowerCase('ar').replace(/[^\\p{L}\\p{N}\\s@_-]/gu,'').slice(0,60);
  if(state.directorySearchTimer)clearTimeout(state.directorySearchTimer);
  state.directorySearchTimer=setTimeout(()=>loadDirectory(true),300);
 }else if(state.sidebarView==='channels'){renderMyChannels()}else renderConversations();
};$('search').onkeydown=e=>{if(e.key==='Escape'&&state.sidebarView==='users'){$('search').value='';state.directorySearch='';loadDirectory(true)}else if(e.key==='Escape'&&state.sidebarView==='team'){$('search').value='';state.teamSearch='';renderTeamDashboard()}};
$('refreshBtn').onclick=async()=>{
 $('refreshBtn').disabled=true;
 try{
  const ok=await loadConversations();
  if(!ok)return;
  // If the active conversation disappeared from local state, restore the most recent valid one.
  const target=state.active||state.conversations[0]||null;
  if(target){const refreshed=state.conversations.find(c=>c.id===target.id);await openConversation(refreshed||target)}
  else{
   state.active=null;state.messageIds.clear();state.messageLoadVersion++;
   $('chatTitle').textContent='لا توجد محادثات بعد';$('chatSub').textContent='ابدأ محادثة من دليل المستخدمين';
   $('messageInput').disabled=true;resizeComposer();
   $('messages').innerHTML='<div class="welcome"><h2>لا توجد محادثات بعد</h2><p>ابدأ محادثة جديدة من دليل المستخدمين.</p></div>';
  }
 }catch(error){console.error('Chat refresh failed:',error);toast('تعذر تحديث المحادثات. حاول مرة أخرى')}
 finally{$('refreshBtn').disabled=false}
};
$('chatsTab').onclick=()=>setSidebarView('chats');$('groupsTab').onclick=()=>setSidebarView('groups');$('channelsTab').onclick=()=>setSidebarView('channels');$('browseUsersBtn').onclick=()=>setSidebarView('users');$('directoryBackBtn').onclick=()=>{const previous=state.sidebarReturnView;state.sidebarReturnView=null;setSidebarView(previous==='groups'||previous==='channels'||(previous==='team'&&state.isTeamAdmin)?previous:'chats')};$('teamTab').onclick=()=>setSidebarView('team');$('refreshDirectory').onclick=()=>loadDirectory(true);$('loadMoreUsers').onclick=()=>loadDirectory(false);
document.querySelectorAll('.directory-filter').forEach(button=>button.addEventListener('click',()=>{state.directoryFilter=button.dataset.directoryFilter;document.querySelectorAll('.directory-filter').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))});loadDirectory(true)}));
document.querySelectorAll('.chat-filter').forEach(button=>button.addEventListener('click',()=>{state.conversationFilter=button.dataset.filter;document.querySelectorAll('.chat-filter').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))});renderConversations()}));
$('mobileMenu').onclick=()=>$('sidebar').classList.remove('closed');
$('newChat').title='إنشاء مجموعة جديدة';
$('createChannelOpen').onclick=()=>openChannelModal();
$('newChat').setAttribute('aria-label','إنشاء مجموعة جديدة');
$('newChat').onclick=()=>openGroupModal();

