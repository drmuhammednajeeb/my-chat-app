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
  if(!messages.length){area.innerHTML='<div class="welcome"><div class="welcome-icon"><i class="ph ph-chat-teardrop-text"></i></div><h2>بداية محادثة جديدة</h2><p>أرسل أول رسالة لبدء التواصل.</p></div>'}
  else{
   let allMessagesRendered=true;
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
 let channel=supabaseClient.channel('profile-updates:'+state.user.id);
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
function subscribeConversation(){
