/* Extracted from current main 66e4c2a7efd980e622768260da2eccf2baf868c7; classic-script execution retained. */
'use strict';

function notificationIcon(type){
 const icons={message:'ph-chat-circle-text',mention:'ph-at',reply:'ph-arrow-bend-up-left',group_invite:'ph-users-three',admin_change:'ph-shield-check'};
 return icons[type]||'ph-bell';
}

function renderNotificationBadge(){
 const badge=$('notificationBadge'),count=Number(state.notificationUnread||0);
 badge.textContent=count>99?'99+':String(count);
 badge.classList.toggle('hidden',count===0);
 $('markAllNotificationsRead').disabled=count===0;
 $('notificationBell').setAttribute('aria-label',count?'مركز الإشعارات، '+count+' غير مقروء':'مركز الإشعارات');
}

function renderNotifications(){
 const list=$('notificationList');if(!list)return;list.replaceChildren();
 const unreadTab=$('notificationUnreadTab'),allTab=$('notificationAllTab');
 if(unreadTab){unreadTab.setAttribute('aria-pressed',String(state.notificationFilter==='unread'));unreadTab.style.background=state.notificationFilter==='unread'?'#d9fdd3':'#f0f2f5';unreadTab.style.color=state.notificationFilter==='unread'?'#075e54':'#54656f'}
 if(allTab){allTab.setAttribute('aria-pressed',String(state.notificationFilter==='all'));allTab.style.background=state.notificationFilter==='all'?'#d9fdd3':'#f0f2f5';allTab.style.color=state.notificationFilter==='all'?'#075e54':'#54656f'}
 const visible=state.notificationFilter==='unread'?state.notifications.filter(item=>!item.read_at):state.notifications;
 if(!visible.length){const empty=document.createElement('div');empty.className='notification-empty';empty.textContent=state.notificationFilter==='unread'?'لا توجد إشعارات غير مقروءة. ستظهر هنا الإشعارات الجديدة.':'لا توجد إشعارات حتى الآن.';list.append(empty);renderNotificationBadge();return}
 visible.forEach(item=>{
  const button=document.createElement('button');button.type='button';button.className='notification-item'+(!item.read_at?' unread':'');
  const icon=document.createElement('span');icon.className='notification-icon';const glyph=document.createElement('i');glyph.className='ph '+notificationIcon(item.notification_type);icon.append(glyph);
  const copy=document.createElement('span');copy.className='notification-copy';
  const title=document.createElement('strong');title.textContent=item.title||'إشعار جديد';
  const body=document.createElement('span');body.textContent=item.body||'';
  const date=document.createElement('time');date.dateTime=item.created_at;date.textContent=new Date(item.created_at).toLocaleString('ar-SA',{dateStyle:'medium',timeStyle:'short'});
  copy.append(title,body,date);button.append(icon,copy);
  if(!item.read_at){const dot=document.createElement('span');dot.className='notification-unread-dot';dot.setAttribute('aria-label','غير مقروء');button.append(dot)}
  button.onclick=()=>openNotification(item);list.append(button);
 });
 renderNotificationBadge();
}

async function loadNotifications(){
 if(!state.user||state.notificationLoading)return false;
 state.notificationLoading=true;
 try{
  const [rows,countResult]=await Promise.all([
   supabaseClient.from('user_notifications').select('id,recipient_id,actor_id,conversation_id,message_id,notification_type,title,body,created_at,read_at').eq('recipient_id',state.user.id).order('created_at',{ascending:false}).limit(60),
   supabaseClient.from('user_notifications').select('id',{count:'exact',head:true}).eq('recipient_id',state.user.id).is('read_at',null)
  ]);
  if(rows.error)throw rows.error;if(countResult.error)throw countResult.error;
  const merged=new Map((rows.data||[]).map(item=>[item.id,item]));
  (state.notifications||[]).forEach(item=>{if(!merged.has(item.id))merged.set(item.id,item)});
  state.notifications=Array.from(merged.values()).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,60);
  // The database count is authoritative; never add locally cached realtime rows to it.
  state.notificationUnread=countResult.count||0;renderNotifications();return true;
 }catch(error){console.warn('Notification loading failed:',error?.message||error);const list=$('notificationList');if(list){list.replaceChildren();const empty=document.createElement('div');empty.className='notification-empty';empty.textContent='تعذر تحميل الإشعارات. تحقق من الاتصال ثم أعد المحاولة.';list.append(empty)}return false}
 finally{state.notificationLoading=false}
}

function subscribeNotifications(){
 if(!state.user)return;
 if(state.notificationChannel)supabaseClient.removeChannel(state.notificationChannel);
 const userId=state.user.id;
 const channel=supabaseClient.channel('user-notifications:'+userId)
  // RLS limits visible rows to the recipient. Avoid a server-side filter here:
  // Realtime's filter validator has rejected recipient_id on some deployed sessions.
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'user_notifications'},payload=>{
   const item=payload.new;if(!item||item.recipient_id!==state.user?.id)return;
   const alreadyKnown=state.notifications.some(existing=>existing.id===item.id);
   if(!alreadyKnown){state.notifications.unshift(item);if(!item.read_at)state.notificationUnread++}
   state.notifications=state.notifications.slice(0,60);renderNotifications();
   const viewingConversation=state.active?.id===item.conversation_id&&document.visibilityState==='visible'&&isMessagesNearBottom();
   if(viewingConversation&&!item.read_at)markNotificationRead(item.id).catch(error=>console.warn('Auto-read notification failed:',error?.message||error));
   else{const prefs=state.userConversationSettings.get(item.conversation_id)||{};if(!prefs.is_muted&&$('notificationsPanel').classList.contains('hidden')){playNotificationTone(prefs.notification_tone||'default');toast(item.title||'لديك إشعار جديد')}}
  })
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'user_notifications'},payload=>{
   const item=payload.new;if(!item||item.recipient_id!==state.user?.id)return;
   const current=state.notifications.find(row=>row.id===item.id);
   if(current){if(!current.read_at&&item.read_at)state.notificationUnread=Math.max(0,state.notificationUnread-1);else if(current.read_at&&!item.read_at)state.notificationUnread++;Object.assign(current,item)}
   renderNotifications();
  })
  .subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('Notification realtime status:',status)});
 state.notificationChannel=channel;
}

async function markNotificationRead(id){
 const item=state.notifications.find(row=>row.id===id);if(!item||item.read_at)return true;
 const stamp=new Date().toISOString();
 const {error}=await supabaseClient.from('user_notifications').update({read_at:stamp}).eq('id',id).eq('recipient_id',state.user.id);
 if(error){console.warn('Mark notification read failed:',error.message);return false}
 item.read_at=stamp;state.notificationUnread=Math.max(0,state.notificationUnread-1);renderNotifications();return true;
}

async function markAllNotificationsRead(){
 if(!state.user||!state.notificationUnread)return;
 const button=$('markAllNotificationsRead');
 if(button)button.disabled=true;
 const stamp=new Date().toISOString();
 try{
  const {error}=await supabaseClient.from('user_notifications').update({read_at:stamp}).eq('recipient_id',state.user.id).is('read_at',null);
  if(error)throw error;
  state.notifications.forEach(item=>{if(!item.read_at)item.read_at=stamp});
  state.notificationUnread=0;renderNotifications();toast('تم تحديد الإشعارات كمقروءة');
 }catch(error){
  console.error('Mark all notifications read failed:',error);
  toast('تعذر تحديث حالة الإشعارات. حاول مرة أخرى');
  renderNotificationBadge();
 }finally{
  if(button)button.disabled=false;
 }
}

async function openNotification(item){
 await markNotificationRead(item.id);
 $('notificationsPanel').classList.add('hidden');$('notificationBell').setAttribute('aria-expanded','false');
 if(!item.conversation_id)return;
 let conversation=state.conversations.find(row=>row.id===item.conversation_id);
 if(!conversation){await loadConversations();conversation=state.conversations.find(row=>row.id===item.conversation_id)}
 if(!conversation){toast('لم تعد تملك عضوية هذه المحادثة');return}
 await openConversation(conversation);
 if(item.message_id)await jumpToMessage(item.message_id);
}

async function toggleMuteConversation(){
 const current=state.userConversationSettings.get(state.active?.id)||{is_muted:false,notification_tone:'default',is_favorite:false};
 const next=!current.is_muted;
 if(await saveUserConversationSettings({is_muted:next})){toast(next?'تم كتم إشعارات هذه المحادثة':'تم إلغاء كتم الإشعارات')}
}

async function setNotificationTone(){
 const current=state.userConversationSettings.get(state.active?.id)||{notification_tone:'default'};
 const options=[['default','الافتراضي'],['soft','هادئ'],['bell','جرس'],['chime','رنين'],['silent','صامت']];
 const answer=prompt('اختر نغمة الإشعار:\n'+options.map((x,i)=>(i+1)+' - '+x[1]).join('\n'),String(Math.max(1,options.findIndex(x=>x[0]===current.notification_tone)+1)));
 if(answer===null)return;const choice=options[Number(answer)-1];if(!choice)return toast('اختيار غير صالح');
 if(await saveUserConversationSettings({notification_tone:choice[0]})){playNotificationTone(choice[0]);toast('تم تحديث نغمة الإشعار')}
}

function playNotificationTone(tone){
 if(tone==='silent'||tone==='default')return;
 try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const ctx=new C(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.value=tone==='bell'?880:tone==='chime'?660:440;gain.gain.setValueAtTime(.0001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.06,ctx.currentTime+.02);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.24);osc.connect(gain);gain.connect(ctx.destination);ctx.resume().catch(()=>{});osc.start();osc.stop(ctx.currentTime+.25);osc.onended=()=>ctx.close()}catch(_e){}
}
