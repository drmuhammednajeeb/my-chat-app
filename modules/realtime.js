/* Extracted from current main 66e4c2a7efd980e622768260da2eccf2baf868c7; classic-script execution retained. */
'use strict';

function startPresence(){
 if(state.presenceChannel||!state.user)return;
 const channel=supabaseClient.channel('online-users',{config:{presence:{key:state.user.id}}});
 channel.on('presence',{event:'sync'},()=>{
  const presence=channel.presenceState(),ids=new Set();
  Object.values(presence).flat().forEach(item=>{if(item?.user_id)ids.add(item.user_id)});
  state.onlineUsers=ids;if(state.sidebarView==='users'){if(state.directoryFilter==='online')loadDirectory(true);else renderDirectory()}
 });
 channel.subscribe(async status=>{
  if(status==='SUBSCRIBED'){
   const {error}=await channel.track({user_id:state.user.id,online_at:new Date().toISOString()});
   if(error)console.warn('Presence tracking unavailable:',error);
  }
 });
 state.presenceChannel=channel;
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

function handlePinRealtime(p,id){const r=p.eventType==='DELETE'?p.old:p.new;if(r?.conversation_id!==id)return;if(p.eventType==='DELETE')state.pinnedMessages.delete(r.message_id);else state.pinnedMessages.set(r.message_id,r);renderPinnedBanner();const row=Array.from(document.querySelectorAll('.message')).find(x=>x.dataset.messageId===r.message_id),m=state.messages.find(x=>x.id===r.message_id);if(row&&m)renderMessagePinMark(row,m)}

function handleMembershipRealtime(p,id){const m=p.new;if(m?.conversation_id!==id||state.active?.id!==id)return;const current=(state.active.members||[]).find(x=>x.user_id===m.user_id);if(current)Object.assign(current,m);document.querySelectorAll('.message.mine').forEach(row=>{const msg=state.messages.find(x=>x.id===row.dataset.messageId),bubble=row.querySelector('.bubble');if(msg&&bubble){bubble.querySelector('.message-status')?.remove();renderMessageStatus(msg,bubble)}})}

async function publishTyping(isTyping){if(!state.typingChannel||!state.user)return;const now=Date.now();if(isTyping&&now-state.typingSent<1000)return;state.typingSent=now;try{await state.typingChannel.send({type:'broadcast',event:'typing',payload:{user_id:state.user.id,name:state.profile?.display_name||'عضو',is_typing:isTyping}})}catch(e){console.debug('Typing broadcast failed',e?.message||e)}}

function stopMessagePolling(){state.isLoadingMessages=false;state.loadingOlderMessages=false;state.hasMoreMessages=false;state.messagePollGeneration++;if(state.messagePollTimer){clearInterval(state.messagePollTimer);state.messagePollTimer=null}state.messagePollBusy=false;diagLog('poll-stopped',{generation:state.messagePollGeneration})}

function startMessagePolling(conversationId){
 stopMessagePolling();const generation=state.messagePollGeneration;
 state.messagePollTimer=setInterval(()=>pollMessagesFallback(conversationId,generation),8000);diagLog('poll-started',{conversationId,generation});
}

async function pollMessagesFallback(conversationId,generation=state.messagePollGeneration){
 if(state.messagePollBusy||generation!==state.messagePollGeneration||state.active?.id!==conversationId||!state.user)return;
 state.messagePollBusy=true;state.diagnostics.lastPollAt=new Date().toLocaleTimeString('en-GB');
 try{
  let pollQuery=supabaseClient.from('chat_messages').select('*').eq('conversation_id',conversationId);if(state.activeChatPreference?.cleared_before)pollQuery=pollQuery.gt('created_at',state.activeChatPreference.cleared_before);const {data,error}=await pollQuery.order('created_at',{ascending:false}).limit(100);
  if(error)throw error;
  if(generation!==state.messagePollGeneration||state.active?.id!==conversationId)return;
  const current=new Map((state.messages||[]).filter(m=>m.conversation_id===conversationId).map(m=>[m.id,m]));
  const fetched=(data||[]).slice().reverse();let added=0;
  for(const message of fetched){
   if(generation!==state.messagePollGeneration||state.active?.id!==conversationId)break;
   if(!state.messageIds.has(message.id)&&!state.renderingMessageIds.has(message.id)){
    const rendered=await renderMessage(message,conversationId);
    if(rendered){current.set(message.id,message);added++}
   }
  }
  if(generation!==state.messagePollGeneration||state.active?.id!==conversationId)return;
  state.messages=Array.from(current.values()).sort(compareMessagesChronologically).slice(-100);
  if(added)await markConversationReceipt(conversationId,document.visibilityState==='visible'&&isMessagesNearBottom());
  const activeRole=(state.active?.members||[]).find(m=>m.user_id===state.user?.id)?.role;const channelReadOnly=state.active?.type==='channel'&&!['owner','admin'].includes(activeRole);if($('messageInput').disabled&&!channelReadOnly){$('messageInput').disabled=false;diagLog('composer-reenabled-by-poll')}
  resizeComposer();diagLog('poll-success',{fetched:fetched.length,added,rendered:$('messages').querySelectorAll('.message').length});
 }catch(error){diagLog('poll-error',{error:String(error?.message||error)});console.warn('Fallback message sync failed:',error)}
 finally{if(generation===state.messagePollGeneration)state.messagePollBusy=false;updateDiagnostics()}
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
 const incoming=payload?.new;if(!incoming?.id||state.active?.id!==conversationId)return;
 const row=Array.from(document.querySelectorAll('.message')).find(item=>item.dataset.messageId===incoming.id);
 const index=state.messages.findIndex(message=>message.id===incoming.id);
 if(index>=0)state.messages[index]=incoming;
 else if(row){
  // A rendered message missing from the in-memory list may be restored, but
  // never append an unknown historical UPDATE event to the conversation tail.
  state.messages.push(incoming);
  state.messages.sort(compareMessagesChronologically);
 }
 if(incoming.deleted_at){loadMessages().catch(error=>console.error('Deleted message refresh failed:',error));return}
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

function subscribeConversation(){
 if(state.channel)supabaseClient.removeChannel(state.channel);
 if(state.typingChannel)supabaseClient.removeChannel(state.typingChannel);
 const id=state.active.id;diagLog('realtime-subscribe',{conversationId:id});
 state.channel=supabaseClient.channel('chat:'+id)
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages',filter:'conversation_id=eq.'+id},p=>{if(state.active?.id!==id)return;state.diagnostics.lastRealtimeAt=new Date().toLocaleTimeString('en-GB');state.diagnostics.lastRealtimeEvent='INSERT';diagLog('realtime-insert',{id:p.new?.id});const incoming=p.new;if(state.activeChatPreference?.cleared_before&&new Date(incoming.created_at)<=new Date(state.activeChatPreference.cleared_before))return;const index=state.messages.findIndex(m=>m.id===incoming.id);if(index>=0)state.messages[index]=incoming;else state.messages.push(incoming);state.messages.sort(compareMessagesChronologically);if(!state.messageIds.has(incoming.id)&&!state.renderingMessageIds.has(incoming.id))renderMessage(incoming,id).catch(error=>console.error('Realtime message failed:',error));if(incoming.sender_id!==state.user.id)markConversationReceipt(id,document.visibilityState==='visible'&&isMessagesNearBottom())})
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'chat_messages',filter:'conversation_id=eq.'+id},p=>handleMessageUpdateRealtime(p,id))
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'message_reactions',filter:'conversation_id=eq.'+id},p=>handleReactionRealtime(p,id))
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'message_reactions',filter:'conversation_id=eq.'+id},p=>handleReactionRealtime(p,id))
  .on('postgres_changes',{event:'DELETE',schema:'public',table:'message_reactions'},p=>handleReactionRealtime(p,id))
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'message_pins',filter:'conversation_id=eq.'+id},p=>handlePinRealtime(p,id))
  .on('postgres_changes',{event:'DELETE',schema:'public',table:'message_pins'},p=>handlePinRealtime(p,id))
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'conversation_members',filter:'conversation_id=eq.'+id},p=>handleMembershipRealtime(p,id))
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'conversation_members',filter:'conversation_id=eq.'+id},async()=>{if(state.active?.id!==id)return;await loadConversations();if($('groupManagementModal')?.classList.contains('open'))await openGroupManagement()})
  .on('postgres_changes',{event:'DELETE',schema:'public',table:'conversation_members'},async p=>{if(p.old?.conversation_id!==id||state.active?.id!==id)return;await loadConversations();if($('groupManagementModal')?.classList.contains('open'))await openGroupManagement()})
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'conversation_group_settings',filter:'conversation_id=eq.'+id},p=>{if(state.active?.id!==id)return;state.groupSettings=p.new;applyGroupTheme();updateGroupComposerPermission()})
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'conversations',filter:'id=eq.'+id},p=>{if(state.active?.id!==id)return;Object.assign(state.active,p.new);$('chatTitle').textContent=convName(state.active);renderConversations()})
  .on('postgres_changes',{event:'*',schema:'public',table:'conversation_documents',filter:'conversation_id=eq.'+id},()=>{if(state.active?.id===id&&$('conversationWorkspaceModal')?.classList.contains('open'))loadConversationDocuments(id)})
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'private_reply_contexts',filter:'direct_conversation_id=eq.'+id},p=>{if(state.active?.id!==id)return;state.privateReplyContexts.set(p.new.direct_message_id,p.new);renderPrivateReplyQuote(p.new.direct_message_id,p.new)})
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'conversation_member_events',filter:'conversation_id=eq.'+id},()=>{if(state.active?.id===id&&$('groupManagementModal')?.classList.contains('open'))openGroupManagement()})
  .subscribe(s=>{state.realtimeStatus=s;diagLog('realtime-status',{status:s});$('connectionState').textContent=s==='SUBSCRIBED'?'متصل':s==='CHANNEL_ERROR'?'مشكلة اتصال — إعادة المحاولة':'إعادة الاتصال…';});
 state.typingChannel=supabaseClient.channel('typing:'+id).on('broadcast',{event:'typing'},({payload})=>{if(payload?.user_id!==state.user.id){$('typing').textContent=payload?.is_typing?(payload?.name||'عضو')+' يكتب الآن…':'';clearTimeout(state.typingTimer);if(payload?.is_typing)state.typingTimer=setTimeout(()=>$('typing').textContent='',2200)}}).subscribe();
}

function subscribePersonalChatData(){if(!state.user)return;if(state.personalChannel)supabaseClient.removeChannel(state.personalChannel);const uid=state.user.id;state.personalChannel=supabaseClient.channel('personal-chat-data:'+uid).on('postgres_changes',{event:'*',schema:'public',table:'chat_lists',filter:'user_id=eq.'+uid},()=>loadCustomLists().then(renderConversations)).on('postgres_changes',{event:'*',schema:'public',table:'chat_list_items',filter:'user_id=eq.'+uid},()=>loadCustomLists().then(renderConversations)).on('postgres_changes',{event:'*',schema:'public',table:'user_chat_preferences',filter:'user_id=eq.'+uid},async()=>{await loadDirectChatPreferences();renderConversations();updateConversationMenu()}).on('postgres_changes',{event:'*',schema:'public',table:'user_conversation_settings',filter:'user_id=eq.'+uid},p=>{const row=p.eventType==='DELETE'?p.old:p.new;if(row?.conversation_id){if(p.eventType==='DELETE')state.userConversationSettings.delete(row.conversation_id);else state.userConversationSettings.set(row.conversation_id,row);updateConversationMenu();renderConversations()}}).on('postgres_changes',{event:'*',schema:'public',table:'user_message_stars',filter:'user_id=eq.'+uid},()=>{if(state.active?.id)loadStarredMessageIds(state.active.id)})
 .on('postgres_changes',{event:'*',schema:'public',table:'user_conversation_classifications',filter:'user_id=eq.'+uid},async()=>{await loadWorkspaceData();renderConversations()})
 .on('postgres_changes',{event:'*',schema:'public',table:'user_conversation_labels',filter:'user_id=eq.'+uid},async()=>{await loadWorkspaceData();renderWorkspaceInboxTabs();renderWorkspaceLabels();renderConversations()})
 .on('postgres_changes',{event:'*',schema:'public',table:'user_conversation_label_items',filter:'user_id=eq.'+uid},async()=>{await loadWorkspaceData();renderWorkspaceLabels();renderConversations()})
 .on('postgres_changes',{event:'*',schema:'public',table:'user_classification_rules',filter:'user_id=eq.'+uid},async()=>{await loadWorkspaceData();renderConversations()})
 .on('postgres_changes',{event:'*',schema:'public',table:'private_conversation_notes',filter:'user_id=eq.'+uid},p=>{const row=p.eventType==='DELETE'?p.old:p.new;if($('conversationWorkspaceModal')?.classList.contains('open')&&state.active?.id===row?.conversation_id)loadPrivateConversationNotes(state.active.id)})
 .subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('Personal chat preferences realtime:',status)})}
