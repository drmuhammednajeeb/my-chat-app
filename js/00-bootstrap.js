<script>
'use strict';
const __bootMainScriptStarted=performance.now();
const SUPABASE_URL='https://lvkeohpuucuklagvwpnq.supabase.co';
const SUPABASE_ANON_KEY='sb_publishable_3OM0vlZU0dkqK4X6aoGZsA_ZBawbYDR';
const supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});
const __supabaseResource=performance.getEntriesByType('resource').find(entry=>entry.name.includes('supabase.min.js'));
window.__BIZMIND_BOOT_TIMINGS__={mainScriptStarted:__bootMainScriptStarted,supabaseScriptMs:__supabaseResource?Math.round(__supabaseResource.duration):null,clientReady:performance.now()};
const $=id=>document.getElementById(id);
const APP_THEME_KEY='bizmindmakers-chat-theme';
let appThemePreference=window.__BIZMIND_THEME_PREFERENCE__||'system';
let appThemeMedia=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;
function applyAppTheme(theme,save=false){
 const resolved=theme==='system'?(appThemeMedia?.matches?'dark':'light'):theme;
 const root=document.documentElement;
 root.classList.toggle('dark',resolved==='dark');
 root.classList.toggle('light',resolved==='light');
 root.dataset.theme=resolved;root.style.colorScheme=resolved;
 if(save){appThemePreference=theme;try{if(theme==='system')localStorage.removeItem(APP_THEME_KEY);else localStorage.setItem(APP_THEME_KEY,theme)}catch(error){console.warn('Theme preference storage unavailable:',error)}}
 const button=$('appThemeToggle');
 if(button){button.innerHTML=resolved==='dark'?'<i class="ph ph-sun"></i>':'<i class="ph ph-moon"></i>';button.title=resolved==='dark'?'التبديل إلى الوضع الساطع':'التبديل إلى الوضع المظلم';button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(resolved==='dark'))}
}
async function loadUserSettings(){
 const userId=state.user?.id;if(!userId)return false;
 try{
  const {data,error}=await supabaseClient.from('user_settings').select('settings').eq('user_id',userId).maybeSingle();
  if(error)throw error;
  if(state.user?.id!==userId)return false;
  const settings=data?.settings&&typeof data.settings==='object'&&!Array.isArray(data.settings)?data.settings:{};
  state.userSettings=settings;
  if(['dark','light','system'].includes(settings.theme)){appThemePreference=settings.theme;applyAppTheme(settings.theme,true)}
  return true;
 }catch(error){console.warn('Account settings could not be loaded:',error?.message||error);return false}
}
async function saveUserSetting(key,value){
 const userId=state.user?.id;if(!userId)return false;
 const {data,error}=await supabaseClient.rpc('patch_my_user_settings',{p_patch:{[key]:value}});
 if(error)throw error;
 if(state.user?.id!==userId)return false;
 state.userSettings=(data&&typeof data==='object'&&!Array.isArray(data))?data:{...(state.userSettings||{}),[key]:value};
 return true;
}
function toggleAppTheme(){
 const current=document.documentElement.dataset.theme||'light';
 const next=current==='dark'?'light':'dark';
 applyAppTheme(next,true);
 void saveUserSetting('theme',next).catch(error=>{console.warn('Theme preference sync failed:',error);toast('تم تغيير المظهر على هذا الجهاز، وتعذرت مزامنته مع حسابك')});
}
$('appThemeToggle')?.addEventListener('click',toggleAppTheme);
if(appThemeMedia){const onSystemThemeChange=()=>{if(appThemePreference==='system')applyAppTheme('system',false)};if(appThemeMedia.addEventListener)appThemeMedia.addEventListener('change',onSystemThemeChange);else if(appThemeMedia.addListener)appThemeMedia.addListener(onSystemThemeChange)}
window.addEventListener('storage',event=>{if(event.key===APP_THEME_KEY){const next=event.newValue==='dark'||event.newValue==='light'?event.newValue:'system';appThemePreference=next;applyAppTheme(next,false)}});
applyAppTheme(appThemePreference,false);

let deferredInstallPrompt=null;
const installAppButton=$('installAppBtn');
if(installAppButton&&(window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true))installAppButton.hidden=true;
window.addEventListener('beforeinstallprompt',event=>{
 event.preventDefault();deferredInstallPrompt=event;
 if(installAppButton)installAppButton.hidden=false;
});
window.addEventListener('appinstalled',()=>{
 deferredInstallPrompt=null;if(installAppButton)installAppButton.hidden=true;
});
installAppButton?.addEventListener('click',async()=>{
 if(!deferredInstallPrompt){toast('لتثبيت التطبيق: افتح قائمة المتصفح ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».');return}
 const promptEvent=deferredInstallPrompt;deferredInstallPrompt=null;
 try{await promptEvent.prompt();await promptEvent.userChoice;}catch(error){console.warn('PWA install prompt:',error)}
 if(installAppButton)installAppButton.hidden=true;
});
if('serviceWorker' in navigator&&location.protocol==='https:'){
 window.addEventListener('load',()=>{
  navigator.serviceWorker.register('./service-worker.js').catch(error=>console.warn('Service worker registration failed:',error));
 });
}
const groupSelectedProfiles=new Map();let groupSearchTimer=null;let groupSearchRequest=0;let publicChannelsCache=[];let channelDirectoryRequest=0;
let messagesScrollFrame=0;
function showListSkeleton(container,count=5){
 if(!container)return;container.replaceChildren();const stack=document.createElement('div');stack.className='loading-stack';stack.setAttribute('aria-label','جارٍ تحميل البيانات');
 for(let i=0;i<count;i++){const row=document.createElement('div');row.className='loading-row';const avatar=document.createElement('span');avatar.className='loading-avatar';const copy=document.createElement('span');copy.className='loading-copy';const first=document.createElement('span');first.className='loading-line '+(i%2?'short':'');const second=document.createElement('span');second.className='loading-line long';copy.append(first,second);row.append(avatar,copy);stack.append(row)}container.append(stack);
}
function showTeamDashboardSkeleton(){
 const dashboard=$('teamDashboard');if(!dashboard)return;dashboard.setAttribute('aria-busy','true');
 $('teamKpis').innerHTML='<div class="team-loading-grid">'+Array.from({length:5},()=>'<div class="team-loading-card"><div class="loading-block"></div><div class="loading-block"></div></div>').join('')+'</div>';
 $('teamDailyChart').innerHTML='<div class="team-loading-panel"><div class="loading-block"></div><div class="loading-block"></div></div>';
 $('teamGroupsList').innerHTML='<div class="team-loading-panel"><div class="loading-block"></div><div class="loading-block"></div></div>';
 $('teamGeneratedAt').textContent='جارٍ تحميل إحصائيات الفريق…';
}

function isMessagesNearBottom(area=$('messages'),threshold=120){return !!area&&(area.scrollHeight-area.scrollTop-area.clientHeight)<=threshold}
function updateNewMessagesIndicator(){const button=$('newMessagesJump'),label=$('newMessagesJumpText');if(!button||!label)return;const count=state.newMessageCount||0;button.classList.toggle('hidden',count===0);label.textContent=count===1?'رسالة جديدة · الانتقال للأسفل':'رسائل جديدة · '+count.toLocaleString('ar-SA');button.setAttribute('aria-label',count+' رسائل جديدة. الانتقال إلى أحدث الرسائل')}
function clearNewMessages(markRead=false){const hadUnread=(state.newMessageCount||0)>0;state.newMessageCount=0;updateNewMessagesIndicator();if(hadUnread&&markRead&&state.active?.id&&document.visibilityState==='visible')markConversationReceipt(state.active.id,true).catch(error=>console.warn('Read receipt after jump failed:',error?.message||error))}
function jumpToLatestMessages(){const area=$('messages');if(!area)return;const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;area.scrollTo({top:area.scrollHeight,behavior:reduced?'auto':'smooth'});clearNewMessages(true)}
function scheduleMessagesBottom(area=$('messages'),behavior='auto'){
 if(!area)return;
 if(messagesScrollFrame)cancelAnimationFrame(messagesScrollFrame);
 messagesScrollFrame=requestAnimationFrame(()=>{messagesScrollFrame=0;if(area.isConnected)area.scrollTo({top:area.scrollHeight,behavior})});
}
const state={user:null,profile:null,userSettings:{},profileChannel:null,voiceRecorder:null,voiceChunks:[],voiceStream:null,voiceTimer:null,voiceStartedAt:null,voiceElapsedMs:0,voiceSegmentStartedAt:null,voicePaused:false,voiceSendOnStop:false,cancelVoiceOnStop:false,voiceDuration:0,conversations:[],conversationsLoading:false,teamLoading:false,memberReads:{},directConversationPromises:new Map(),conversationFilter:'all',sidebarView:'chats',sidebarReturnView:null,isTeamAdmin:false,teamData:null,teamSelectedGroupId:'',teamSearch:'',teamMembers:[],teamMembersLoading:false,teamMembersLoadedFor:'',directoryUsers:[],directoryLoading:false,directoryRequestId:0,directorySearch:'',directoryFilter:'all',directorySearchTimer:null,directoryOffset:0,directoryHasMore:false,onlineUsers:new Set(),presenceChannel:null,notifications:[],notificationUnread:0,notificationFilter:'unread',notificationChannel:null,notificationLoading:false,active:null,chatPrefs:new Map(),activeChatPreference:null,channel:null,typingChannel:null,typingTimer:null,typingSent:0,attachment:null,uploading:false,newMessageCount:0,chatSearchTimer:null,chatSearchRequest:0,authMode:'login',messageIds:new Set(),messages:[],reactions:new Map(),pinnedMessages:new Map(),replyMessages:new Map(),replyTarget:null,editTarget:null,messageLoadVersion:0,realtimeStatus:'CONNECTING',messagePollTimer:null,messagePollBusy:false,messagePollGeneration:0,messagePollCursor:null,messagePollLastCheckedAt:null,pendingMessageSends:new Map(),renderingMessageIds:new Set(),diagnostics:{events:[],lastFetchAt:null,lastFetchCount:null,lastFetchError:null,lastRenderError:null,lastRenderAt:null,lastPollAt:null,lastRealtimeAt:null,lastRealtimeEvent:null,lastComposerChange:null,composerInteractions:[],lastHitTest:null}};
Object.assign(state,{workspaceCategory:'all',workspaceClassifications:new Map(),workspaceLabels:[],workspaceLabelItems:new Map(),workspaceRules:[],privateReplyPending:null,privateReplyContexts:new Map(),workspaceActiveLabelId:null,workspaceEditingNoteId:null});
// Privacy-safe local performance telemetry: timings only, no message text, user IDs, or URLs.
const PERF_STORAGE_KEY='bizmindmakers.chat.performance.v1';
const perfSamples=(()=>{try{const value=JSON.parse(localStorage.getItem(PERF_STORAGE_KEY)||'[]');return Array.isArray(value)?value.slice(-80):[]}catch(_e){return []}})();
let perfPersistTimer=null;
function persistPerfSamples(){try{localStorage.setItem(PERF_STORAGE_KEY,JSON.stringify(perfSamples))}catch(_e){}perfPersistTimer=null}
function recordPerf(metric,duration,details={}){
 const sample={metric,ms:Math.round(Math.max(0,Number(duration)||0)*10)/10,at:Date.now(),...details};
 perfSamples.push(sample);if(perfSamples.length>80)perfSamples.splice(0,perfSamples.length-80);
 // Batch storage writes so instrumentation does not add synchronous I/O to message rendering.
 if(perfPersistTimer)clearTimeout(perfPersistTimer);
 perfPersistTimer=setTimeout(persistPerfSamples,1200);
 if(!$('diagnosticsPanel')?.hidden)updateDiagnostics();
}
window.addEventListener('pagehide',persistPerfSamples,{capture:true});
function performanceSummary(){
 const metrics={};
 for(const metric of ['startup_supabase_script','startup_get_session','startup_membership_check','profile_load','startup_shell_reveal','startup_conversations_load','profile_modal_open','directory_query','conversation_open','message_fetch','message_render_batch','message_render_item','message_load_total']){
  const values=perfSamples.filter(x=>x.metric===metric).slice(-50).map(x=>x.ms).sort((a,b)=>a-b);
  if(values.length)metrics[metric]={samples:values.length,avg_ms:Math.round(values.reduce((a,b)=>a+b,0)/values.length),p50_ms:values[Math.floor((values.length-1)*.5)],p95_ms:values[Math.floor((values.length-1)*.95)],max_ms:values[values.length-1]};
 }
 const resources=performance.getEntriesByType('resource').filter(entry=>/supabase\.co\/(rest|storage|auth|realtime)/i.test(entry.name)).slice(-100);
 const network={supabase_resource_count:resources.length,reported_transfer_bytes:resources.reduce((sum,item)=>sum+(item.transferSize||0),0),reported_encoded_bytes:resources.reduce((sum,item)=>sum+(item.encodedBodySize||0),0),avg_resource_ms:resources.length?Math.round(resources.reduce((sum,item)=>sum+item.duration,0)/resources.length):0,bytes_may_be_zero_when_cross_origin_timing_is_restricted:true};
 const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
 return {metrics,network,connection:connection?{effectiveType:connection.effectiveType||null,downlink_mbps:connection.downlink||null,rtt_ms:connection.rtt||null,saveData:!!connection.saveData}:null,long_tasks:perfSamples.filter(x=>x.metric==='long_task').slice(-10).map(x=>({ms:x.ms,at:x.at})),stored_samples:perfSamples.length,storage:'local browser only'};
}
if(typeof PerformanceObserver!=='undefined'){try{const longTaskObserver=new PerformanceObserver(list=>list.getEntries().forEach(entry=>recordPerf('long_task',entry.duration)));longTaskObserver.observe({type:'longtask',buffered:true})}catch(_e){}}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials=s=>(s||'U').trim().slice(0,1).toUpperCase();
const time=s=>new Date(s).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'});
const toast=(msg)=>{const n=document.createElement('div');n.textContent=msg;n.style.cssText='position:fixed;z-index:20;bottom:28px;left:50%;transform:translateX(-50%);background:#253c50;border:1px solid #426078;color:white;padding:11px 17px;border-radius:12px;font-size:12px;box-shadow:var(--shadow)';document.body.append(n);setTimeout(()=>n.remove(),3200)};


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
$('notificationBell').onclick=async()=>{
 const panel=$('notificationsPanel'),opening=panel.classList.contains('hidden');
 panel.classList.toggle('hidden',!opening);$('notificationBell').setAttribute('aria-expanded',String(opening));
 if(opening)await loadNotifications();
};
$('closeNotifications').onclick=()=>{$('notificationsPanel').classList.add('hidden');$('notificationBell').setAttribute('aria-expanded','false')};
$('markAllNotificationsRead').onclick=markAllNotificationsRead;$('notificationUnreadTab').onclick=()=>{state.notificationFilter='unread';renderNotifications()};$('notificationAllTab').onclick=()=>{state.notificationFilter='all';renderNotifications()};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('notificationsPanel').classList.contains('hidden')){$('notificationsPanel').classList.add('hidden');$('notificationBell').setAttribute('aria-expanded','false')}});

function diagLog(event,details={}){const d=state.diagnostics;d.events.push({at:new Date().toLocaleTimeString('en-GB'),event,details});if(d.events.length>18)d.events.shift();updateDiagnostics()}
function updateDiagnostics(){const panel=$('diagnosticsPanel');if(!panel||panel.hidden)return;const input=$('messageInput'),wrap=document.querySelector('.composer-wrap'),rect=input?.getBoundingClientRect();let hit=null;if(rect&&rect.width&&rect.height){const el=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);hit=el?{tag:el.tagName,id:el.id||'',className:typeof el.className==='string'?el.className:'',isComposer:!!wrap?.contains(el)}:null}state.diagnostics.lastHitTest={inputRect:rect?{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)}:null,hit,computed:input?{display:getComputedStyle(input).display,visibility:getComputedStyle(input).visibility,pointerEvents:getComputedStyle(input).pointerEvents,zIndex:getComputedStyle(input).zIndex}:null};const active=state.active?.id||'none';const out={activeConversation:active==='none'?'none':active.slice(0,8)+'…',userSession:!!state.user,loadedMessages:state.messages?.length||0,renderedMessageNodes:$('messages')?.querySelectorAll('.message').length||0,messageIds:state.messageIds?.size||0,composer:{disabled:!!input?.disabled,readOnly:!!input?.readOnly,valueLength:input?.value?.length||0,focused:document.activeElement===input},composerHitTest:state.diagnostics.lastHitTest,composerInteractions:state.diagnostics.composerInteractions,realtime:{status:state.realtimeStatus,lastEvent:state.diagnostics.lastRealtimeEvent,at:state.diagnostics.lastRealtimeAt},polling:{active:!!state.messagePollTimer,busy:state.messagePollBusy,generation:state.messagePollGeneration,lastAt:state.diagnostics.lastPollAt},fetch:{at:state.diagnostics.lastFetchAt,count:state.diagnostics.lastFetchCount,error:state.diagnostics.lastFetchError},render:{at:state.diagnostics.lastRenderAt,error:state.diagnostics.lastRenderError},lastComposerChange:state.diagnostics.lastComposerChange,performance:performanceSummary(),events:state.diagnostics.events};$('diagnosticsOutput').textContent=JSON.stringify(out,null,2)}
$('debugBtn').onclick=()=>{const panel=$('diagnosticsPanel'),show=panel.hidden;panel.hidden=!show;$('debugBtn').setAttribute('aria-expanded',String(show));updateDiagnostics()};
$('testComposerFocus').onclick=()=>{const input=$('messageInput');input.focus();diagLog('composer-focus-test',{focused:document.activeElement===input,disabled:input.disabled,readOnly:input.readOnly})};
function recordComposerInteraction(event){if($('diagnosticsPanel')?.hidden)return;const wrap=document.querySelector('.composer-wrap'),target=event.target;if(!wrap?.contains(target))return;const item={event:event.type,target:target?.id||target?.tagName||'unknown',at:new Date().toLocaleTimeString('en-GB'),activeElement:document.activeElement?.id||document.activeElement?.tagName||'unknown',key:event.type==='keydown'?event.key:undefined};state.diagnostics.composerInteractions.push(item);if(state.diagnostics.composerInteractions.length>20)state.diagnostics.composerInteractions.shift();updateDiagnostics()}
['pointerdown','click','focusin','focusout','keydown','input'].forEach(type=>document.addEventListener(type,recordComposerInteraction,true));
$('messageInput').addEventListener('focus',()=>diagLog('composer-focus'));
$('messageInput').addEventListener('input',()=>{if(!$('diagnosticsPanel')?.hidden)diagLog('composer-input',{length:$('messageInput').value.length})},{capture:true});
new MutationObserver(()=>{state.diagnostics.lastComposerChange={at:new Date().toLocaleTimeString('en-GB'),disabled:$('messageInput').disabled,readOnly:$('messageInput').readOnly};diagLog('composer-attributes-changed',state.diagnostics.lastComposerChange)}).observe($('messageInput'),{attributes:true,attributeFilter:['disabled','readonly']});
window.addEventListener('error',e=>{state.diagnostics.lastRenderError='JS: '+(e.message||'unknown');diagLog('window-error',{message:e.message,source:e.filename,line:e.lineno})});
window.addEventListener('unhandledrejection',e=>{state.diagnostics.lastRenderError='Promise: '+String(e.reason?.message||e.reason||'unknown');diagLog('unhandled-rejection',{message:state.diagnostics.lastRenderError})});
function setAuthMode(mode){state.authMode=mode;const signup=mode==='signup';$('signupFields').classList.toggle('hidden',!signup);$('loginTab').classList.toggle('active',!signup);$('signupTab').classList.toggle('active',signup);$('authTitle').textContent=signup?'أنشئ حسابك':'مرحباً بعودتك';$('authSub').textContent=signup?'التسجيل متاح للأعضاء الذين لديهم دعوة ورقم عضوية رسمي فقط.':'سجّل الدخول لمتابعة محادثاتك.';$('authSubmit').textContent=signup?'إنشاء الحساب':'تسجيل الدخول';$('password').autocomplete=signup?'new-password':'current-password';$('authError').classList.add('hidden');$('resendSignupVerification')?.classList.add('hidden');$('resetPasswordWrap').classList.toggle('hidden',signup);updateResetCooldown()}
function authError(msg){$('authStatus').hidden=true;$('authError').textContent=msg;$('authError').classList.remove('hidden')}
function authProgress(msg){$('authError').classList.add('hidden');$('authStatus').textContent=msg;$('authStatus').hidden=false}
const RESET_COOLDOWN_MS=10*60*1000;
const RESET_COOLDOWN_PREFIX='bizmindmakers-password-reset-until:';
let resetCountdownTimer=null;
function resetCooldownKey(email){return RESET_COOLDOWN_PREFIX+String(email||'').trim().toLowerCase()}
function readResetExpiry(email){try{return Number(localStorage.getItem(resetCooldownKey(email))||0)||0}catch(e){return 0}}
function formatResetRemaining(ms){const total=Math.max(0,Math.ceil(ms/1000));return String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0')}
function updateResetCooldown(){
 const email=$('email').value.trim(),expiry=readResetExpiry(email),remaining=expiry-Date.now(),btn=$('resetPasswordBtn'),label=$('resetCountdown');
 if(remaining>0){
  btn.disabled=true;btn.textContent='يمكنك إعادة الإرسال بعد';label.hidden=false;
  label.innerHTML='يرجى الانتظار <strong>'+formatResetRemaining(remaining)+'</strong> قبل طلب رابط جديد.';
  if(!resetCountdownTimer)resetCountdownTimer=setInterval(updateResetCooldown,1000);
 }else{
  btn.disabled=false;btn.textContent='نسيت كلمة المرور؟';label.hidden=true;label.textContent='';
  if(expiry){try{localStorage.removeItem(resetCooldownKey(email))}catch(e){}}
  if(resetCountdownTimer){clearInterval(resetCountdownTimer);resetCountdownTimer=null}
 }
}
function startResetCooldown(email){
 try{localStorage.setItem(resetCooldownKey(email),String(Date.now()+RESET_COOLDOWN_MS))}catch(e){throw new Error('تعذر حفظ مؤقت الحماية في المتصفح. فعّل التخزين المحلي ثم أعد المحاولة.')}
 updateResetCooldown();
 if(resetCountdownTimer)clearInterval(resetCountdownTimer);
 resetCountdownTimer=setInterval(updateResetCooldown,1000);
}
async function sendPasswordReset(){
 const email=$('email').value.trim();
 if(!email)throw new Error('أدخل بريدك الإلكتروني أولاً.');
 if(!$('email').checkValidity())throw new Error('تحقق من صيغة البريد الإلكتروني.');
 const existing=readResetExpiry(email);
 if(existing>Date.now()){updateResetCooldown();return}
 const btn=$('resetPasswordBtn');btn.disabled=true;btn.textContent='جارٍ إرسال رابط الاستعادة...';
 $('authError').classList.add('hidden');authProgress('جارٍ إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني...');
 try{
  const redirectTo=window.location.origin+window.location.pathname;
  const {error}=await withAuthTimeout(supabaseClient.auth.resetPasswordForEmail(email,{redirectTo}),'لم يستجب خادم استعادة كلمة المرور خلال 20 ثانية. حاول مجدداً.');
  if(error)throw error;
  startResetCooldown(email);
  authProgress('إذا كان البريد مسجلاً لدينا، فستصلك رسالة تحتوي على رابط آمن لإعادة تعيين كلمة المرور. تحقق من صندوق الوارد والرسائل غير المرغوب فيها.');
 }catch(error){
  btn.disabled=false;btn.textContent='نسيت كلمة المرور؟';
  throw error;
 }
}

function withAuthTimeout(promise,label,ms=20000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),ms)})]).finally(()=>clearTimeout(timer))}
function slug(s){return String(s||'').toLowerCase().trim().replace(/[^a-z0-9_]/g,'').slice(0,24)}
async function ensureProfile(user){
 // Read first: existing profiles must never be overwritten by auth metadata on login.
 const {data:existing,error:readError}=await supabaseClient.from('profiles').select('*').eq('id',user.id).maybeSingle();
 if(readError)throw readError;
 if(existing)return existing;
 const meta=user.user_metadata||{};
 let username=slug(meta.username||user.email?.split('@')[0]||'user');
 if(username.length<3)username='user_'+user.id.slice(0,8);
 const display=(meta.display_name||user.email?.split('@')[0]||'مستخدم').slice(0,48);
 const {data:created,error:createError}=await supabaseClient.from('profiles').insert({id:user.id,username,display_name:display}).select('*').single();
 if(!createError&&created)return created;
 // A concurrent sign-in may have created the row after the initial read.
 const {data:retry,error:retryError}=await supabaseClient.from('profiles').select('*').eq('id',user.id).maybeSingle();
 if(retry)return retry;
 throw createError||retryError||new Error('تعذر إنشاء الملف الشخصي');
}
let authLifecycleVersion=0,appEntryPromise=null,appEntryUserId=null;
async function enterApp(user){
 if(!user?.id)return false;
 if(appEntryPromise){
  if(appEntryUserId===user.id)return appEntryPromise;
  try{await appEntryPromise}catch(_){}
 }
 const lifecycleVersion=authLifecycleVersion;
 appEntryUserId=user.id;
 appEntryPromise=enterAppInternal(user,lifecycleVersion);
 try{return await appEntryPromise}finally{if(appEntryUserId===user.id){appEntryPromise=null;appEntryUserId=null}}
}
async function enterAppInternal(user,lifecycleVersion){
 if(!user.email_confirmed_at){await supabaseClient.auth.signOut({scope:'local'});authError('يجب توثيق البريد الإلكتروني قبل دخول المنصة. افتح رسالة التوثيق ثم سجّل الدخول مجدداً.');return false;}
 const membershipStarted=performance.now();
 const {data:membershipState,error:membershipStateError}=await supabaseClient.rpc('get_my_membership_state');
 recordPerf('startup_membership_check',performance.now()-membershipStarted,{success:!membershipStateError});
 if(membershipStateError){console.error('Membership state check failed:',membershipStateError);authError('تعذر التحقق من حالة العضوية. تحقق من الاتصال وحاول مجدداً.');return false;}
 if(membershipState?.membership_status!=='active'||membershipState?.membership_number_verified!==true||!/^971[0-9]{9}$/.test(membershipState?.membership_number||'')){await supabaseClient.auth.signOut({scope:'local'});authError('هذه العضوية غير نشطة أو غير معتمدة. تواصل مع مسؤول المنصة.');return false;}
 state.user=user;state.customLists=[];state.chatListItems.clear();state.userConversationSettings.clear();state.activeListId=null;state.starredMessageIds.clear();state.groupSettings=null;state.selectedMessageIds.clear();state.selectionMode=false;subscribePersonalChatData();
 const profileStarted=performance.now();try{authProgress('تم التحقق من الحساب. جارٍ تجهيز ملفك الشخصي...');state.profile=await withAuthTimeout(ensureProfile(user),'استغرق تجهيز الملف الشخصي أكثر من 20 ثانية. تحقق من الاتصال ثم أعد المحاولة.');recordPerf('profile_load',performance.now()-profileStarted,{success:true})}catch(e){recordPerf('profile_load',performance.now()-profileStarted,{success:false});console.error('Profile setup after authentication failed:',e);authError('تم قبول تسجيل الدخول، لكن تعذر تجهيز الملف الشخصي: '+(e.message||'خطأ غير معروف'));return false}
 if(lifecycleVersion!==authLifecycleVersion)return false;
 if(state.profile.membership_status!=='active'||!/^971[0-9]{9}$/.test(state.profile.membership_number||''))throw new Error('هذه العضوية غير نشطة أو غير معتمدة. تواصل مع مسؤول المنصة.');
 $('auth').classList.add('hidden');$('app').classList.remove('hidden');
 const shellRevealAt=performance.now();
 if(window.__BIZMIND_BOOT_TIMINGS__){window.__BIZMIND_BOOT_TIMINGS__.shellRevealed=shellRevealAt;window.__BIZMIND_BOOT_TIMINGS__.authReadyMs=Math.round(shellRevealAt-(window.__BIZMIND_BOOT_TIMINGS__.mainScriptStarted||shellRevealAt))}
 recordPerf('startup_shell_reveal',shellRevealAt-(window.__BIZMIND_BOOT_TIMINGS__?.mainScriptStarted||shellRevealAt),{authenticated:true});
 document.documentElement.classList.remove('auth-booting');
 $('myName').textContent=state.profile.display_name;$('myHandle').textContent='@'+state.profile.username+' · '+(state.profile.membership_number||'');renderAvatar($('myAvatar'),state.profile,'avatar profile-avatar-edit');void loadUserSettings();
 const conversationsStarted=performance.now();
 const conversationsLoaded=await loadConversations();
 recordPerf('startup_conversations_load',performance.now()-conversationsStarted,{success:true});
 if(lifecycleVersion!==authLifecycleVersion)return false;
 let invitedChannelId=null;const inviteToken=new URLSearchParams(location.search).get('invite');
 if(inviteToken){try{const {data,error}=await supabaseClient.rpc('join_channel_by_invite',{p_token:inviteToken});if(error)throw error;invitedChannelId=data;await loadConversations();toast('تم الانضمام إلى القناة بنجاح');}catch(error){console.error('Channel invite join failed:',error);toast(error.message||'رابط الدعوة غير صالح أو منتهي الصلاحية')}finally{const cleanUrl=new URL(location.href);cleanUrl.searchParams.delete('invite');history.replaceState({},'',cleanUrl.pathname+cleanUrl.search+cleanUrl.hash)}}
 if(lifecycleVersion!==authLifecycleVersion)return false;
 // Non-critical profile, notification, and admin data load in parallel after the chat shell is ready.
 void Promise.allSettled([
  (async()=>{try{await ensureSelfConversation();if(lifecycleVersion===authLifecycleVersion)renderConversations()}catch(error){console.error('Self chat initialization failed:',error);toast('تعذر تجهيز مساحة مراسلة نفسك. يمكنك إعادة تحميل قائمة المحادثات لاحقاً')}})(),
  (async()=>{subscribeNotifications();await loadNotifications()})(),
  loadTeamDashboard(true)
 ]);
 // Startup must always settle on Home. Loading the conversation list is data hydration only;
 // it must never select or open a conversation on behalf of the user.
 stopMessagePolling();
 if(state.channel)supabaseClient.removeChannel(state.channel);
 if(state.typingChannel)supabaseClient.removeChannel(state.typingChannel);
 state.channel=null;state.typingChannel=null;state.active=null;state.activeChatPreference=null;
 state.messages=[];state.messageIds.clear();state.renderingMessageIds.clear();
 state.messageLoadVersion++;state.reactions=new Map();state.pinnedMessages=new Map();state.replyMessages=new Map();
 state.replyTarget=null;state.editTarget=null;state.groupSettings=null;
 $('messageInput').value='';$('messageInput').disabled=true;$('sendBtn').disabled=true;
 $('chatTitle').textContent=conversationsLoaded&&state.conversations.length?'مرحباً بك':'لا توجد محادثات بعد';
 $('chatSub').textContent='اختر محادثة من القائمة لبدء التواصل';
 $('messages').innerHTML='<div class="welcome"><div class="welcome-icon"><i class="ph ph-chat-teardrop-text"></i></div><h2>مرحباً بك في BizmindMakers Chat Pro</h2><p>اختر محادثة من القائمة لعرض الرسائل. لن تُفتح أي محادثة تلقائياً عند تشغيل التطبيق.</p></div>';
 applyDirectChatTheme();renderPinnedBanner();resizeComposer();
 setSidebarView('chats');
 $('sidebar').classList.remove('closed');
 startPresence();return true;
}
$('loginTab').onclick=()=>setAuthMode('login');$('signupTab').onclick=()=>setAuthMode('signup');
$('resetPasswordBtn').addEventListener('click',async()=>{try{await sendPasswordReset()}catch(error){console.error('Password reset request failed:',error);authError(error.message||'تعذر إرسال رابط الاستعادة. حاول مرة أخرى.')}});
$('email').addEventListener('input',updateResetCooldown);
$('resendSignupVerificationBtn')?.addEventListener('click',async()=>{
 const email=$('email').value.trim();
 if(!email||!$('email').checkValidity()){authError('أدخل البريد الإلكتروني المستخدم في الدعوة أولاً.');return}
 const button=$('resendSignupVerificationBtn');button.disabled=true;
 try{
  const {error}=await supabaseClient.auth.resend({type:'signup',email,options:{emailRedirectTo:window.location.href.split('#')[0].split('?')[0]}});
  if(error)throw error;
  authProgress('تم طلب إعادة إرسال رابط التوثيق. تحقق من البريد الوارد والرسائل غير المرغوب فيها.');
 }catch(error){authError(error.message||'تعذر إعادة إرسال رسالة التوثيق. حاول لاحقاً.')}
 finally{button.disabled=false}
});
if(readResetExpiry($('email').value.trim())>Date.now()){resetCountdownTimer=setInterval(updateResetCooldown,1000)}updateResetCooldown();
$('authForm').addEventListener('submit',async e=>{
 e.preventDefault();
 if($('authSubmit').disabled)return;
 $('authError').classList.add('hidden');$('authStatus').hidden=true;
 const email=$('email').value.trim(),password=$('password').value;
 const btn=$('authSubmit'),defaultLabel=state.authMode==='signup'?'إنشاء الحساب':'تسجيل الدخول';
 try{
  if(!email)throw new Error('أدخل البريد الإلكتروني.');
  if(!$('email').checkValidity())throw new Error('صيغة البريد الإلكتروني غير صحيحة.');
  if(!password)throw new Error('أدخل كلمة المرور.');
  if(state.authMode==='signup'){
   if(password.length<8)throw new Error('كلمة المرور يجب ألا تقل عن 8 أحرف.');
   const username=slug($('username').value),display=$('displayName').value.trim();
   const membershipNumber=$('membershipNumber').value.trim(),membershipInviteCode=$('membershipInviteCode').value.trim();
   if(username.length<3)throw new Error('اسم المستخدم يجب أن يتكون من 3 إلى 24 حرفاً إنجليزياً أو رقماً أو _');
   if(!display)throw new Error('أدخل الاسم الظاهر');
   if(!/^971[0-9]{9}$/.test(membershipNumber))throw new Error('أدخل رقم فوريفر الرسمي: 971 ثم تسعة أرقام.');
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(membershipInviteCode))throw new Error('رمز الدعوة غير صحيح. استخدم الرمز الذي أنشأه مسؤول التطبيق.');
   btn.disabled=true;btn.textContent='جارٍ إنشاء الحساب...';authProgress('جارٍ إنشاء حسابك والتحقق من البيانات...');
   const {data,error}=await supabaseClient.auth.signUp({email,password,options:{emailRedirectTo:window.location.href.split('#')[0].split('?')[0],data:{username,display_name:display,membership_number:membershipNumber,membership_invite_code:membershipInviteCode}}});
   if(error)throw error;
   if(data.session){authProgress('تم إنشاء الحساب. جارٍ فتح مساحة المحادثات...');await enterApp(data.user)}
   else{authProgress('تم إنشاء الحساب. أرسلنا رابط توثيق إلى بريدك الإلكتروني. افتح الرسالة ثم سجّل الدخول بعد التوثيق.');$('resendSignupVerification').classList.remove('hidden');}
  }else{
   btn.disabled=true;btn.textContent='جارٍ تسجيل الدخول...';authProgress('جارٍ التحقق من بيانات الدخول مع الخادم...');
   const {data,error}=await withAuthTimeout(supabaseClient.auth.signInWithPassword({email,password}),'لم يستجب خادم تسجيل الدخول خلال 20 ثانية. تحقق من الاتصال وحاول مجدداً.');
   if(error)throw error;
   if(!data?.user)throw new Error('تم الاتصال بالخادم لكن لم يتم استلام بيانات المستخدم. أعد المحاولة.');
   authProgress('تم قبول بيانات الدخول. جارٍ تجهيز حسابك وفتح التطبيق...');
   const entered=await enterApp(data.user);
   if(entered===false)throw new Error('تم التحقق من الحساب لكن تعذر إكمال تهيئة التطبيق. راجع رسالة الخطأ أعلاه.');
  }
 }catch(err){
  console.error('Authentication flow failed:',err);
  authError(err.message||'تعذر تسجيل الدخول. تحقق من الاتصال وحاول مرة أخرى.');
 }finally{
  btn.disabled=false;btn.textContent=defaultLabel;
 }
});
$('logoutBtn').onclick=async()=>{const {error}=await supabaseClient.auth.signOut({scope:'local'});if(error){toast('تعذر تسجيل الخروج من هذا الجهاز');console.error(error);return}location.reload()};
function renderAvatar(container,profile,className='directory-avatar'){
 container.replaceChildren();container.className=className;
 const fallback=document.createElement('span');fallback.textContent=initials(profile?.display_name||profile?.username);container.append(fallback);
 const raw=profile?.avatar_url;
 if(raw){try{const url=new URL(raw);if(url.protocol==='https:'){const img=document.createElement('img');img.src=url.href;img.alt='';img.loading=container.id==='myAvatar'?'eager':'lazy';img.decoding='async';img.fetchPriority=container.id==='myAvatar'?'high':'low';img.width=48;img.height=48;img.referrerPolicy='no-referrer';img.onerror=()=>container.replaceChildren(fallback);container.replaceChildren(img)}}catch(_e){}}
}
function renderChatAvatar(conversation){
 const target=$('chatAvatar');
 if(conversation?.type==='direct'){const profile=otherMember(conversation);renderAvatar(target,profile,'avatar');return}
 target.className='avatar';target.replaceChildren();
 const icon=document.createElement('i');icon.className='ph '+(isSelfConversation(conversation)?'ph-note-pencil':conversation?.type==='channel'?'ph-megaphone':'ph-users-three');target.append(icon);
}
async function prepareAvatarImage(file){
 if(typeof createImageBitmap!=='function')return {blob:file,type:file.type};
 const bitmap=await createImageBitmap(file);
 const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height));
 const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const context=canvas.getContext('2d',{alpha:false});
 if(!context){bitmap.close?.();return {blob:file,type:file.type}}
 context.drawImage(bitmap,0,0,width,height);bitmap.close?.();
 const webp=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.82));
 if(webp)return {blob:webp,type:'image/webp'};
 const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.84));
 return jpeg?{blob:jpeg,type:'image/jpeg'}:{blob:file,type:file.type};
}
async function withProfileTimeout(task,label,timeoutMs=20000){
 let timer;
 try{return await Promise.race([Promise.resolve(task),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' استغرق وقتاً أطول من المتوقع. تحقق من الاتصال ثم أعد المحاولة.')),timeoutMs)})])}
 finally{clearTimeout(timer)}
}
async function uploadProfileAvatar(file){
 if(!state.user||!file)throw new Error('اختر صورة أولاً');
 const allowed=['image/jpeg','image/png','image/webp'];
 if(!allowed.includes(file.type))throw new Error('اختر صورة بصيغة JPG أو PNG أو WebP');
 if(file.size>3*1024*1024)throw new Error('الحد الأقصى للصورة الشخصية 3 ميجابايت');
 const input=$('avatarInput');if(input)input.disabled=true;
 try{
  const prepared=await withProfileTimeout(prepareAvatarImage(file),'تجهيز الصورة',15000);
  const path=state.user.id+'/avatar';
  const uploadResult=await withProfileTimeout(supabaseClient.storage.from('avatars').upload(path,prepared.blob,{upsert:true,contentType:prepared.type,cacheControl:'31536000'}),'رفع الصورة',25000);
  if(uploadResult.error)throw uploadResult.error;
  const {data:publicData}=supabaseClient.storage.from('avatars').getPublicUrl(path);
  if(!publicData?.publicUrl)throw new Error('تعذر إنشاء رابط الصورة');
  const avatarUrl=publicData.publicUrl+'?v='+Date.now();
  const updateResult=await withProfileTimeout(supabaseClient.from('profiles').update({avatar_url:avatarUrl,updated_at:new Date().toISOString()}).eq('id',state.user.id).select('*').single(),'حفظ رابط الصورة',20000);
  if(updateResult.error)throw updateResult.error;
  const data=updateResult.data;if(!data)throw new Error('لم يتم استلام بيانات الملف الشخصي بعد الحفظ');
  state.profile=data;$('myName').textContent=data.display_name||data.username||'المستخدم';$('myHandle').textContent='@'+(data.username||'user')+' · '+(data.membership_number||'');
  renderAvatar($('myAvatar'),data,'avatar profile-avatar-edit');
  if($('profileModal')?.classList.contains('open'))renderAvatar($('profileModalAvatar'),data,'profile-modal-avatar');
  state.conversations.forEach(conv=>(conv.members||[]).forEach(member=>{if(member.user_id===data.id)member.profile={...(member.profile||{}),...data}}));
  if(state.active?.type==='direct'&&otherMember(state.active)?.id===state.user.id)renderChatAvatar(state.active);
  toast('تم اعتماد الصورة الشخصية وحفظها');
  return data;
 }catch(error){console.error('Profile avatar upload failed:',error);throw error}
 finally{if(input){input.disabled=false;input.value=''}}
}
$('myAvatar').onclick=()=>openProfileModal(state.profile,true);
$('myAvatar').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openProfileModal(state.profile,true)}});
// Photo selection is preview-only. Upload is triggered exclusively by profilePhotoApprove.

function setSidebarView(view){
 if(view==='team'&&!state.isTeamAdmin){toast('لا تملك صلاحية إدارة الفريق');return}
 if(view==='users'&&state.sidebarView!=='users')state.sidebarReturnView=state.sidebarView;
 state.sidebarView=view;const users=view==='users',channels=view==='channels',groups=view==='groups',team=view==='team',personal=view==='chats';
 if(users){state.directorySearch='';state.directoryFilter='all';document.querySelectorAll('.directory-filter').forEach(item=>{const active=item.dataset.directoryFilter==='all';item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))})}
 $('chatsTab').classList.toggle('active',personal);$('groupsTab').classList.toggle('active',groups);$('channelsTab').classList.toggle('active',channels);$('teamTab').classList.toggle('active',team);
 $('chatsTab').setAttribute('aria-selected',String(personal));$('groupsTab').setAttribute('aria-selected',String(groups));$('channelsTab').setAttribute('aria-selected',String(channels));$('teamTab').setAttribute('aria-selected',String(team));
 $('chatFilters').classList.toggle('hidden',!personal);$('directoryFilters').classList.toggle('hidden',!users);$('conversationList').classList.toggle('hidden',!personal&&!groups);
 $('directoryList').classList.toggle('hidden',!users&&!channels);$('directorySummary').classList.toggle('hidden',!users);$('loadMoreUsers').classList.toggle('hidden',!users||!state.directoryHasMore);
 $('browseUsersBtn').classList.toggle('hidden',users||team);$('directoryBackBtn').classList.toggle('hidden',!users);$('newChat').classList.toggle('hidden',!groups);$('createChannelOpen').classList.toggle('hidden',!channels);$('refreshDirectory').classList.toggle('hidden',!users);
 document.querySelector('.searchbox').classList.toggle('hidden',team);
 $('sidebarSectionTitle').textContent=users?'دليل المستخدمين':channels?'القنوات الإذاعية':groups?'مجموعات العمل':team?'إدارة الفريق':'المحادثات الشخصية';
 $('search').placeholder=users?'ابحث بالاسم أو اسم المستخدم…':channels?'ابحث في قنواتك…':groups?'ابحث في مجموعات العمل…':team?'ابحث عن مجموعة…':'ابحث في المحادثات الشخصية…';
 $('search').setAttribute('aria-label',users?'البحث في المستخدمين':channels?'البحث في القنوات':groups?'البحث في مجموعات العمل':team?'البحث في المجموعات':'بحث المحادثات الشخصية');$('search').value='';if(users)state.directorySearch='';
 $('teamDashboard').classList.toggle('hidden',!team);$('chat').classList.toggle('team-mode',team);
 if(team){$('diagnosticsPanel').hidden=true;if(innerWidth<=760)$('sidebar').classList.add('closed');if(state.teamData)renderTeamDashboard();else showTeamDashboardSkeleton();if(!state.teamLoading&&!state.teamData)loadTeamDashboard(true)}
 else if(users){renderDirectory();if(!state.directoryUsers.length&&!state.directoryLoading)loadDirectory()}
 else if(channels){renderMyChannels()}else renderConversations();
}
