'use strict';

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








const state={user:null,profile:null,userSettings:{},profileChannel:null,voiceRecorder:null,voiceChunks:[],voiceStream:null,voiceTimer:null,voiceStartedAt:null,voiceElapsedMs:0,voiceSegmentStartedAt:null,voicePaused:false,voiceSendOnStop:false,cancelVoiceOnStop:false,voiceDuration:0,conversations:[],conversationsLoading:false,teamLoading:false,memberReads:{},directConversationPromises:new Map(),conversationFilter:'all',sidebarView:'chats',sidebarReturnView:null,isTeamAdmin:false,teamData:null,teamSelectedGroupId:'',teamSearch:'',teamMembers:[],teamMembersLoading:false,teamMembersLoadedFor:'',directoryUsers:[],directoryLoading:false,directoryRequestId:0,directorySearch:'',directoryFilter:'all',directorySearchTimer:null,directoryOffset:0,directoryHasMore:false,onlineUsers:new Set(),presenceChannel:null,notifications:[],notificationUnread:0,notificationFilter:'unread',notificationChannel:null,notificationLoading:false,active:null,chatPrefs:new Map(),activeChatPreference:null,channel:null,typingChannel:null,typingTimer:null,typingSent:0,attachment:null,uploading:false,newMessageCount:0,chatSearchTimer:null,chatSearchRequest:0,authMode:'login',messageIds:new Set(),messages:[],reactions:new Map(),pinnedMessages:new Map(),replyMessages:new Map(),replyTarget:null,editTarget:null,messageLoadVersion:0,realtimeStatus:'CONNECTING',messagePollTimer:null,messagePollBusy:false,messagePollGeneration:0,renderingMessageIds:new Set(),diagnostics:{events:[],lastFetchAt:null,lastFetchCount:null,lastFetchError:null,lastRenderError:null,lastRenderAt:null,lastPollAt:null,lastRealtimeAt:null,lastRealtimeEvent:null,lastComposerChange:null,composerInteractions:[],lastHitTest:null}};
Object.assign(state,{workspaceCategory:'all',workspaceClassifications:new Map(),workspaceLabels:[],workspaceLabelItems:new Map(),workspaceRules:[],privateReplyPending:null,privateReplyContexts:new Map(),workspaceActiveLabelId:null,workspaceEditingNoteId:null});
// Privacy-safe local performance telemetry: timings only, no message text, user IDs, or URLs.
const PERF_STORAGE_KEY='bizmindmakers.chat.performance.v1';
const perfSamples=(()=>{try{const value=JSON.parse(localStorage.getItem(PERF_STORAGE_KEY)||'[]');return Array.isArray(value)?value.slice(-80):[]}catch(_e){return []}})();
let perfPersistTimer=null;


window.addEventListener('pagehide',persistPerfSamples,{capture:true});

if(typeof PerformanceObserver!=='undefined'){try{const longTaskObserver=new PerformanceObserver(list=>list.getEntries().forEach(entry=>recordPerf('long_task',entry.duration)));longTaskObserver.observe({type:'longtask',buffered:true})}catch(_e){}}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials=s=>(s||'U').trim().slice(0,1).toUpperCase();
const time=s=>new Date(s).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'});
const toast=(msg)=>{const n=document.createElement('div');n.textContent=msg;n.style.cssText='position:fixed;z-index:20;bottom:28px;left:50%;transform:translateX(-50%);background:#253c50;border:1px solid #426078;color:white;padding:11px 17px;border-radius:12px;font-size:12px;box-shadow:var(--shadow)';document.body.append(n);setTimeout(()=>n.remove(),3200)};










$('notificationBell').onclick=async()=>{
 const panel=$('notificationsPanel'),opening=panel.classList.contains('hidden');
 panel.classList.toggle('hidden',!opening);$('notificationBell').setAttribute('aria-expanded',String(opening));
 if(opening)await loadNotifications();
};
$('closeNotifications').onclick=()=>{$('notificationsPanel').classList.add('hidden');$('notificationBell').setAttribute('aria-expanded','false')};
$('markAllNotificationsRead').onclick=markAllNotificationsRead;$('notificationUnreadTab').onclick=()=>{state.notificationFilter='unread';renderNotifications()};$('notificationAllTab').onclick=()=>{state.notificationFilter='all';renderNotifications()};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('notificationsPanel').classList.contains('hidden')){$('notificationsPanel').classList.add('hidden');$('notificationBell').setAttribute('aria-expanded','false')}});



$('debugBtn').onclick=()=>{const panel=$('diagnosticsPanel'),show=panel.hidden;panel.hidden=!show;$('debugBtn').setAttribute('aria-expanded',String(show));updateDiagnostics()};
$('testComposerFocus').onclick=()=>{const input=$('messageInput');input.focus();diagLog('composer-focus-test',{focused:document.activeElement===input,disabled:input.disabled,readOnly:input.readOnly})};

['pointerdown','click','focusin','focusout','keydown','input'].forEach(type=>document.addEventListener(type,recordComposerInteraction,true));
$('messageInput').addEventListener('focus',()=>diagLog('composer-focus'));
$('messageInput').addEventListener('input',()=>{if(!$('diagnosticsPanel')?.hidden)diagLog('composer-input',{length:$('messageInput').value.length})},{capture:true});
new MutationObserver(()=>{state.diagnostics.lastComposerChange={at:new Date().toLocaleTimeString('en-GB'),disabled:$('messageInput').disabled,readOnly:$('messageInput').readOnly};diagLog('composer-attributes-changed',state.diagnostics.lastComposerChange)}).observe($('messageInput'),{attributes:true,attributeFilter:['disabled','readonly']});
window.addEventListener('error',e=>{state.diagnostics.lastRenderError='JS: '+(e.message||'unknown');diagLog('window-error',{message:e.message,source:e.filename,line:e.lineno})});
window.addEventListener('unhandledrejection',e=>{state.diagnostics.lastRenderError='Promise: '+String(e.reason?.message||e.reason||'unknown');diagLog('unhandled-rejection',{message:state.diagnostics.lastRenderError})});



const RESET_COOLDOWN_MS=10*60*1000;
const RESET_COOLDOWN_PREFIX='bizmindmakers-password-reset-until:';
let resetCountdownTimer=null;










let authLifecycleVersion=0,appEntryPromise=null,appEntryUserId=null;


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





$('myAvatar').onclick=()=>openProfileModal(state.profile,true);
$('myAvatar').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openProfileModal(state.profile,true)}});
// Photo selection is preview-only. Upload is triggered exclusively by profilePhotoApprove.





const SELF_CHAT_MARKER='bizmindmakers:self-chat:v1';
















$('archiveConversationBtn').onclick=()=>{if(state.active)archiveConversation(state.active,!state.activeChatPreference?.is_archived)};




$('directShortcutBtn').onclick=toggleDirectChatShortcut;
$('directClearBtn').onclick=clearDirectChatForMe;



const MESSAGE_REACTION_OPTIONS=[
 {type:'like',emoji:'👍',label:'إعجاب'},
 {type:'heart',emoji:'❤️',label:'أحببت'},
 {type:'wow',emoji:'😮',label:'مندهش'},
 {type:'pray',emoji:'🙏',label:'تقدير'},
 {type:'fire',emoji:'🔥',label:'رائع'},
 {type:'celebrate',emoji:'🎉',label:'احتفال'}
];



document.addEventListener('pointerdown',event=>{if(!event.target.closest('.message.reactions-open'))document.querySelectorAll('.message.reactions-open').forEach(row=>row.classList.remove('reactions-open'))},true);

const pendingReactionKeys=new Set();



















































$('voicePauseBtn').onclick=toggleVoicePause;
$('voiceTrashBtn').onclick=()=>{if(state.voiceRecorder){cancelVoiceRecording();toast('تم حذف التسجيل وإعادة ضبط المؤقت')}};



$('messageInput').addEventListener('input',()=>{resizeComposer();if($('messageInput').value.trim())publishTyping(true);else publishTyping(false)});
$('messageInput').addEventListener('blur',()=>publishTyping(false));
$('messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.stopPropagation();requestAnimationFrame(resizeComposer)}});
$('composerContextCancel').onclick=()=>{if(state.editTarget){$('messageInput').value='';state.attachment=null;$('fileInput').value='';$('attachmentPreview').classList.add('hidden')}cancelComposerContext();resizeComposer()};
$('newMessagesJump').onclick=jumpToLatestMessages;
$('chatSearchBtn').onclick=()=>{closeChatHeaderMenu();$('chatSearchPanel').classList.toggle('hidden');if(!$('chatSearchPanel').classList.contains('hidden'))$('chatSearchInput').focus()};

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

















$('teamRefreshBtn').onclick=refreshTeamDashboard;$('teamGroupSearch').oninput=()=>{state.teamSearch=$('teamGroupSearch').value.trim().toLocaleLowerCase('ar');renderTeamGroups()};$('teamBackBtn').onclick=()=>{setSidebarView('chats');$('sidebar').classList.remove('closed')};$('teamGroupSelect').onchange=()=>{state.teamSelectedGroupId=$('teamGroupSelect').value;state.teamMembers=[];state.teamMembersLoadedFor='';renderTeamGroups();loadTeamMembers()};$('teamMemberSearch').oninput=renderTeamMembers;$('teamActivityFilter').onchange=renderTeamMembers;$('teamAddMemberSelect').onchange=()=>{const g=(state.teamData?.groups||[]).find(x=>x.id===state.teamSelectedGroupId);$('teamAddMemberBtn').disabled=!$('teamAddMemberSelect').value||Number(g?.member_count||0)>=200};$('teamAddMemberBtn').onclick=addTeamMember;



$('closeChannelModal').onclick=closeChannelModal;$('cancelChannelCreation').onclick=closeChannelModal;
$('channelModal').addEventListener('click',event=>{if(event.target===$('channelModal'))closeChannelModal()});
$('channelNameInput').addEventListener('input',()=>{$('createChannelBtn').disabled=!$('channelNameInput').value.trim()});
$('createChannelBtn').onclick=async()=>{
 const title=$('channelNameInput').value.trim(),description=$('channelDescriptionInput').value.trim(),button=$('createChannelBtn');let createdId=null;
 if(!title)return toast('اكتب اسم القناة أولاً');if(title.length>80||description.length>500)return toast('تحقق من طول الاسم والوصف');
 button.disabled=true;button.textContent='جارٍ إنشاء القناة…';
 try{
  const {data,error}=await supabaseClient.rpc('create_private_channel',{p_title:title,p_description:description});
  if(error)throw error;
  createdId=typeof data==='string'?data:(data?.id||data?.[0]?.id||data?.[0]);
  if(!createdId)throw new Error('لم يُرجع الخادم معرّف القناة. حدّث الصفحة وتحقق من قائمة قنواتك قبل إعادة المحاولة.');
  closeChannelModal();
  const refreshed=await loadConversations();
  if(!refreshed)throw new Error('تم إنشاء القناة بالفعل، لكن تعذر تحديث القائمة. لا تنشئ قناة أخرى؛ أعد تحميل التطبيق لعرضها.');
  const created=state.conversations.find(c=>c.id===createdId);
  if(!created)throw new Error('تم إنشاء القناة بالفعل، لكن تعذّر تحميل عضويتك. أعد تحميل التطبيق لعرضها.');
  setSidebarView('channels');await openConversation(created);renderMyChannels();toast('تم إنشاء القناة وفتحها. يمكنك الآن مشاركة رابط الدعوة مع الأعضاء.');
 }catch(error){
  console.error('Channel creation failed:',error);
  if(createdId){closeChannelModal();setSidebarView('channels');toast(error.message||'تم إنشاء القناة. أعد تحميل التطبيق لتحديث القائمة.')}
  else toast(error.message||'تعذر إنشاء القناة');
 }finally{button.textContent='إنشاء القناة';button.disabled=!$('channelNameInput').value.trim()}
};

$('shareChannelBtn').onclick=()=>shareChannelInvite(state.active,$('shareChannelBtn'));


$('closeGroupModal').onclick=closeGroupModal;$('cancelGroupCreation').onclick=closeGroupModal;
$('groupModal').addEventListener('click',event=>{if(event.target===$('groupModal'))closeGroupModal()});
$('groupNameInput').addEventListener('input',renderGroupSelection);
$('groupMemberSearch').addEventListener('input',()=>{
 clearTimeout(groupSearchTimer);const term=$('groupMemberSearch').value.trim();groupSearchTimer=setTimeout(()=>loadGroupCandidates(term),220);
});
$('createGroupBtn').onclick=async()=>{
 const title=$('groupNameInput').value.trim();const others=[...groupSelectedProfiles.values()];
 if(!title)return toast('اكتب اسم المجموعة أولاً');if(!others.length)return toast('اختر عضواً واحداً على الأقل');
 const button=$('createGroupBtn');button.disabled=true;button.textContent='جارٍ إنشاء المجموعة…';
 try{
  const {data:conv,error:ce}=await supabaseClient.from('conversations').insert({type:'group',title,created_by:state.user.id}).select().single();if(ce)throw ce;
  const {error:ownerError}=await supabaseClient.from('conversation_members').insert({conversation_id:conv.id,user_id:state.user.id,role:'owner'});if(ownerError)throw ownerError;
  const {error:membersError}=await supabaseClient.from('conversation_members').insert(others.map(profile=>({conversation_id:conv.id,user_id:profile.id,role:'member'})));
  if(membersError)throw membersError;
  closeGroupModal();await loadConversations();const created=state.conversations.find(item=>item.id===conv.id);
  if(created)await openConversation(created);toast('تم إنشاء المجموعة وإضافة '+others.length+' أعضاء');
 }catch(error){console.error('Group creation failed:',error);toast(error?.message||'تعذر إنشاء المجموعة. تحقق من الاتصال والصلاحيات.')}
 finally{button.textContent='إنشاء المجموعة';renderGroupSelection()}
};

/* Reply gestures are bound locally to each rendered message bubble. */
$('voiceRecordBtn').onclick=()=>state.voiceRecorder?stopVoiceRecording():startVoiceRecording();
$('voiceCancelBtn').onclick=cancelVoiceRecording;
$('attachBtn').onclick=()=>$('fileInput').click();
$('fileInput').onchange=e=>{const f=e.target.files[0];if(!f)return;if(state.voiceRecorder)cancelVoiceRecording();state.attachment=f;showAttachmentPreview(f);resizeComposer()};
$('closeLightbox').onclick=()=>$('lightbox').classList.add('hidden');$('lightbox').onclick=e=>{if(e.target===$('lightbox'))$('lightbox').classList.add('hidden')};
$('conversationWorkspaceBtn').onclick=()=>{closeChatHeaderMenu();openConversationWorkspace()};
$('workspaceInboxTabs').addEventListener('click',e=>{const label=e.target.closest('[data-workspace-label]');if(label){state.workspaceActiveLabelId=state.workspaceActiveLabelId===label.dataset.workspaceLabel?null:label.dataset.workspaceLabel;renderWorkspaceInboxTabs();renderConversations();return}const b=e.target.closest('[data-workspace-category]');if(!b)return;state.workspaceCategory=b.dataset.workspaceCategory;state.workspaceActiveLabelId=null;renderWorkspaceInboxTabs();renderConversations()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('conversationWorkspaceModal')?.classList.contains('open'))closeConversationWorkspace()});
supabaseClient.auth.onAuthStateChange((event,session)=>{if(event==='TOKEN_REFRESHED'&&session?.user){state.user=session.user;$('connectionState').textContent='متصل'}if(event==='SIGNED_OUT'){state.workspaceClassifications.clear();state.workspaceActiveLabelId=null;state.workspaceEditingNoteId=null;state.workspaceLabels=[];state.workspaceLabelItems.clear();state.workspaceRules=[];state.privateReplyContexts.clear();state.privateReplyPending=null;authLifecycleVersion++;diagLog('auth-signed-out');if(state.voiceRecorder){state.cancelVoiceOnStop=true;cancelVoiceRecording()}stopMessagePolling();if(state.presenceChannel){supabaseClient.removeChannel(state.presenceChannel);state.presenceChannel=null}if(state.channel){supabaseClient.removeChannel(state.channel);state.channel=null}if(state.typingChannel){supabaseClient.removeChannel(state.typingChannel);state.typingChannel=null}if(state.notificationChannel){supabaseClient.removeChannel(state.notificationChannel);state.notificationChannel=null}if(state.personalChannel){supabaseClient.removeChannel(state.personalChannel);state.personalChannel=null}state.notifications=[];state.notificationUnread=0;$('notificationsPanel').classList.add('hidden');$('notificationBell').setAttribute('aria-expanded','false');renderNotificationBadge();state.onlineUsers.clear();state.customLists=[];state.chatListItems.clear();state.userConversationSettings.clear();state.starredMessageIds.clear();state.activeListId=null;state.selectedMessageIds.clear();state.selectionMode=false;state.groupSettings=null;state.user=null;state.active=null;$('messageInput').disabled=true;$('sendBtn').disabled=true;$('app').classList.add('hidden');$('auth').classList.remove('hidden');authError('انتهت جلسة الدخول على هذا الجهاز. سجّل الدخول للمتابعة.')}});
(async()=>{
 const bootStatus=document.getElementById('bootStatus');
 const bootSupabaseMs=window.__BIZMIND_BOOT_TIMINGS__?.supabaseScriptMs;
 if(Number.isFinite(bootSupabaseMs))recordPerf('startup_supabase_script',bootSupabaseMs);
 const bootDelayNotice=window.setTimeout(()=>{
  if(bootStatus)bootStatus.textContent='لا يزال التحقق جارياً. يرجى الانتظار مع التأكد من اتصال الإنترنت.';
 },8000);
 try{
  const sessionStarted=performance.now();
  const {data,error}=await supabaseClient.auth.getSession();
  recordPerf('startup_get_session',performance.now()-sessionStarted,{success:!error});
  if(window.__BIZMIND_BOOT_TIMINGS__){window.__BIZMIND_BOOT_TIMINGS__.getSessionMs=Math.round(performance.now()-sessionStarted);window.__BIZMIND_BOOT_TIMINGS__.authResolved=performance.now()}
  if(error)throw error;
  const session=data?.session;
  if(session?.user){
   await enterApp(session.user);
  }else{
   state.user=null;
   $('app').classList.add('hidden');
   $('auth').classList.remove('hidden');
  }
 }catch(error){
  console.error('Initial auth session check failed:',error);
  $('app').classList.add('hidden');
  $('auth').classList.remove('hidden');
  authError('تعذر التحقق من جلسة الدخول. تحقق من الاتصال ثم أعد تحميل التطبيق.');
 }finally{
  window.clearTimeout(bootDelayNotice);
  document.documentElement.classList.remove('auth-booting');
 }
})();

// Profile Center: resilient editing, explicit photo approval and recoverable close controls
let profileModalEditable=false,profilePendingPhoto=null,profilePhotoPreviewUrl=null,profilePhotoBusy=false,profileSaveBusy=false;



document.addEventListener('DOMContentLoaded',()=>{
$('profileModalClose').onclick=closeProfileModal;$('profileModalCancel').onclick=closeProfileModal;
$('profileModal').addEventListener('click',e=>{if(e.target===$('profileModal'))closeProfileModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('profileModal')?.classList.contains('open')){e.preventDefault();closeProfileModal()}});
$('myAvatar').onclick=()=>openProfileModal(state.profile,true);$('myName').onclick=()=>openProfileModal(state.profile,true);$('myName').style.cursor='pointer';
$('profilePhotoBtn').onclick=()=>{if(profileModalEditable&&!profilePhotoBusy)$('avatarInput').click()};
$('avatarInput').addEventListener('change',event=>{
 const file=event.target.files?.[0];if(!file)return;
 const allowed=['image/jpeg','image/png','image/webp'];
 if(!allowed.includes(file.type)){toast('اختر صورة بصيغة JPG أو PNG أو WebP');event.target.value='';return}
 if(file.size>3*1024*1024){toast('الحد الأقصى للصورة الشخصية 3 ميجابايت');event.target.value='';return}
 resetProfilePhotoSelection();profilePendingPhoto=file;profilePhotoPreviewUrl=URL.createObjectURL(file);
 renderAvatar($('profileModalAvatar'),{avatar_url:profilePhotoPreviewUrl},'profile-modal-avatar');
 $('profilePhotoApprove').classList.remove('hidden');$('profilePhotoCancel').classList.remove('hidden');
 $('profilePhotoStatus').textContent='معاينة الصورة — اضغط موافقة لحفظها';$('profilePhotoStatus').classList.remove('hidden');
});
$('profilePhotoCancel').onclick=()=>{resetProfilePhotoSelection();renderAvatar($('profileModalAvatar'),state.profile,'profile-modal-avatar')};
$('profilePhotoApprove').onclick=async()=>{
 if(!profileModalEditable||!profilePendingPhoto||profilePhotoBusy)return;
 profilePhotoBusy=true;const approve=$('profilePhotoApprove'),cancel=$('profilePhotoCancel'),status=$('profilePhotoStatus');
 approve.disabled=true;cancel.disabled=true;approve.textContent='جارٍ الحفظ…';status.textContent='يتم تجهيز الصورة ورفعها وحفظها…';status.classList.remove('hidden');
 try{await uploadProfileAvatar(profilePendingPhoto);resetProfilePhotoSelection()}
 catch(error){toast(error.message||'تعذر حفظ الصورة. يمكنك المحاولة مرة أخرى');approve.disabled=false;approve.textContent='إعادة المحاولة';cancel.disabled=false;status.textContent=error.message||'فشل حفظ الصورة — أعد المحاولة أو اختر صورة أخرى'}
 finally{profilePhotoBusy=false;cancel.disabled=false}
};
$('chatAvatar').onclick=()=>{if(state.active?.type==='direct')openProfileModal(otherMember(state.active),false)};
$('chatProfileOpen').onclick=()=>{if(state.active?.type==='direct')openProfileModal(otherMember(state.active),false)};
$('profileSaveBtn').onclick=async()=>{
 if(!profileModalEditable||!state.user||profileSaveBusy)return;
 const display=$('profileDisplayName').value.trim(),bio=$('profileBio').value.trim();if(!display)return toast('أدخل الاسم الظاهر');
 const btn=$('profileSaveBtn');profileSaveBusy=true;btn.disabled=true;btn.textContent='جارٍ حفظ التغييرات…';
 try{
  const result=await withProfileTimeout(supabaseClient.from('profiles').update({display_name:display,bio,updated_at:new Date().toISOString()}).eq('id',state.user.id).select('*').single(),'حفظ بيانات الملف الشخصي',20000);
  if(result.error)throw result.error;if(!result.data)throw new Error('لم يتم استلام بيانات الملف الشخصي بعد الحفظ');
  const data=result.data;state.profile=data;$('myName').textContent=data.display_name||data.username||'المستخدم';$('myHandle').textContent='@'+(data.username||'user')+' · '+(data.membership_number||'');
  state.conversations.forEach(conv=>(conv.members||[]).forEach(member=>{if(member.user_id===data.id)member.profile={...(member.profile||{}),...data}}));
  if(state.active?.type==='direct'&&otherMember(state.active)?.id===data.id)$('chatTitle').textContent=convName(state.active);
  renderAvatar($('myAvatar'),data,'avatar profile-avatar-edit');renderAvatar($('profileModalAvatar'),data,'profile-modal-avatar');renderConversations();closeProfileModal();toast('تم تحديث بيانات ملفك الشخصي');
 }catch(error){console.error('Profile update failed:',error);toast(error.message||'تعذر حفظ الملف الشخصي. حاول مرة أخرى')}
 finally{profileSaveBusy=false;btn.disabled=false;btn.textContent='حفظ التغييرات'}
};
});

// Group management, disappearing messages, personal stars, notifications and custom chat lists.
Object.assign(state,{
 customLists:[],chatListItems:new Map(),activeListId:null,groupSettings:null,
 userConversationSettings:new Map(),starredMessageIds:new Set(),
 selectionMode:false,selectedMessageIds:new Set(),membershipEvents:[],personalChannel:null
});







































document.addEventListener('DOMContentLoaded',()=>{
 ensureGroupModal();
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeGroupManagement();$('starredModal')?.classList.remove('open');$('starredModal')?.setAttribute('aria-hidden','true');$('customListModal')?.classList.remove('open');$('customListModal')?.setAttribute('aria-hidden','true')}});
 $('createCustomListBtn').onclick=createCustomList;
 groupMenuActions();
 const originalRenderMessage=renderMessage;
 // The renderer decorates each new message with a selection checkbox only while selection mode is active.
 const observer=new MutationObserver(records=>{if(!state.selectionMode)return;records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1&&node.classList.contains('message'))decorateMessageSelection(node,state.messages.find(m=>m.id===node.dataset.messageId))}))});
 observer.observe($('messages'),{childList:true});
 const originalSetSidebarView=setSidebarView;
 setSidebarView=function(view){originalSetSidebarView(view);renderCustomLists()};
 const originalRenderConversations=renderConversations;
 renderConversations=function(section){originalRenderConversations(section);if(state.activeListId){const list=state.customLists.find(x=>x.id===state.activeListId);if(state.activeListId==='__favorites__'){$('sidebarSectionTitle').textContent='المفضلة'}else if(list){const title=$('sidebarSectionTitle');if(title)title.textContent=list.name+' · '+(state.sidebarView==='groups'?'المجموعات':'المحادثات')}}};
 const originalOpenConversation=openConversation;
 openConversation=async function(c){await originalOpenConversation(c);if(state.active?.id===c.id){applyGroupComposerOnOpen();updateConversationMenu()}};
 const originalLoadConversations=loadConversations;
 loadConversations=async function(){const result=await originalLoadConversations();await Promise.all([loadCustomLists(),loadAllUserConversationSettings()]);renderCustomLists();renderConversations();return result};
 const originalSavePreference=saveDirectChatPreference;
 saveDirectChatPreference=async function(patch){const ok=await originalSavePreference(patch);if(ok&&state.activeChatPreference){state.chatPrefs.set(state.active.id,{...state.chatPrefs.get(state.active.id),...state.activeChatPreference,...patch});updateConversationMenu()}return ok};
 const originalSubscribeNotifications=subscribeNotifications;
 subscribeNotifications=function(){originalSubscribeNotifications();};
 const originalRenderMessageFn=renderMessage;
 renderMessage=async function(m,...args){const result=await originalRenderMessageFn(m,...args);if(result&&state.selectionMode){const row=document.querySelector('.message[data-message-id="'+m.id+'"]');decorateMessageSelection(row,m)}return result};
 const oldUpdateConversationMenu=updateConversationMenu;
 updateConversationMenu=function(){oldUpdateConversationMenu();if(state.active){const setting=state.userConversationSettings.get(state.active.id)||{};$('muteNotificationsBtn').innerHTML=setting.is_muted?'<i class="ph ph-bell"></i><span>إلغاء كتم الإشعارات</span>':'<i class="ph ph-bell-slash"></i><span>كتم الإشعارات</span>'}};
 // Add star actions to message context menus without changing existing reply/edit/delete controls.
 const messageArea=$('messages');
 messageArea.addEventListener('contextmenu',event=>{if(!state.selectionMode)return;const row=event.target.closest('.message');if(!row)return;event.preventDefault();const check=row.querySelector('.message-select-check');if(check){check.checked=!check.checked;check.dispatchEvent(new Event('change'))}});
 // Existing group/direct menu items are made available only after a conversation is active.
 updateConversationMenu();
});

