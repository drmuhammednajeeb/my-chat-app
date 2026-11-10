async function loadDirectory(reset=true){
 if(!state.user||(!reset&&state.directoryLoading))return;
 if(reset){state.directoryOffset=0;state.directoryUsers=[];state.directoryHasMore=false;state.directoryRequestId++}
 const requestId=state.directoryRequestId;
 state.directoryLoading=true;$('loadMoreUsers').disabled=true;$('loadMoreUsers').textContent='جارٍ تحميل المستخدمين…';
 if(reset)showListSkeleton($('directoryList'),5);
 const from=state.directoryOffset,to=from+49,term=state.directorySearch;
 let query=supabaseClient.from('profiles').select('id,username,display_name,avatar_url,membership_number,membership_number_verified').neq('id',state.user.id);
 if(term)query=query.or('display_name.ilike.%'+term+'%,username.ilike.%'+term+'%');
 if(state.directoryFilter==='online'){
  const ids=Array.from(state.onlineUsers);if(!ids.length){if(requestId===state.directoryRequestId){state.directoryLoading=false;state.directoryUsers=[];renderDirectory();$('loadMoreUsers').disabled=false;$('loadMoreUsers').textContent='عرض المزيد من المستخدمين';$('loadMoreUsers').classList.add('hidden')}return}
  query=query.in('id',ids);
 }
 const directoryStarted=performance.now();const {data,error}=await query.order('display_name',{ascending:true}).order('id',{ascending:true}).range(from,to);
 recordPerf('directory_query',performance.now()-directoryStarted,{success:!error,rows:data?.length||0});
 if(requestId!==state.directoryRequestId)return;
 state.directoryLoading=false;
 if(error){console.error('Directory search failed:',error);if(reset)$('directoryList').replaceChildren();const box=document.createElement('div');box.className='directory-empty';box.textContent='تعذر تنفيذ البحث. تحقق من صلاحيات قراءة الملفات الشخصية ثم حاول مجدداً.';$('directoryList').append(box);$('directorySummary').textContent='تعذر تحميل النتائج';$('loadMoreUsers').classList.add('hidden');return}
 const page=data||[];state.directoryUsers=reset?page:state.directoryUsers.concat(page);state.directoryOffset+=page.length;state.directoryHasMore=page.length===50;
 renderDirectory();$('loadMoreUsers').classList.toggle('hidden',!state.directoryHasMore||state.sidebarView!=='users');$('loadMoreUsers').disabled=false;$('loadMoreUsers').textContent='عرض المزيد من المستخدمين';
}
function renderDirectory(){
 const list=$('directoryList');if(!list)return;
 if(state.directoryLoading&&!state.directoryUsers.length){showListSkeleton(list,5);return}
 list.replaceChildren();
 const rows=state.directoryUsers.slice();
 const onlineCount=rows.filter(p=>state.onlineUsers.has(p.id)).length;
 const filterLabel=state.directoryFilter==='online'?' · المتصلون فقط':'';
 $('directorySummary').textContent=rows.length+' نتيجة'+filterLabel+' · '+onlineCount+' متصل الآن';
 rows.sort((a,b)=>Number(state.onlineUsers.has(b.id))-Number(state.onlineUsers.has(a.id))||(a.display_name||a.username||'').localeCompare(b.display_name||b.username||'','ar'));
 if(!rows.length){const empty=document.createElement('div');empty.className='directory-empty';empty.textContent=state.directorySearch?'لا توجد حسابات تطابق «'+state.directorySearch+'».':(state.directoryFilter==='online'?'لا يوجد مستخدمون متصلون الآن.':'لا يوجد مستخدمون آخرون حتى الآن.');list.append(empty);return}
 rows.forEach(profile=>{
  const row=document.createElement('article');row.className='directory-user';
  const avatar=document.createElement('div');renderAvatar(avatar,profile);  const dot=document.createElement('span');dot.className='directory-presence'+(state.onlineUsers.has(profile.id)?' online':'');dot.setAttribute('aria-label',state.onlineUsers.has(profile.id)?'متصل الآن':'غير متصل');avatar.append(dot);
  const copy=document.createElement('div');copy.className='directory-copy';
  const name=document.createElement('strong');name.textContent=profile.display_name||profile.username||'مستخدم';
  const handle=document.createElement('small');handle.textContent='@'+(profile.username||'user')+(profile.membership_number_verified?' · '+profile.membership_number:'');copy.append(name,handle);
  const status=document.createElement('span');status.className='directory-status'+(state.onlineUsers.has(profile.id)?' online':'');status.textContent=state.onlineUsers.has(profile.id)?'متصل الآن':'غير متصل';
  const action=document.createElement('button');action.type='button';action.className='directory-message-btn';action.textContent='مراسلة';action.setAttribute('aria-label','بدء محادثة مع '+(profile.display_name||profile.username||'المستخدم'));action.onclick=()=>openDirectConversation(profile,action);
  row.append(avatar,copy,status,action);list.append(row);
 });
}
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
const SELF_CHAT_MARKER='bizmindmakers:self-chat:v1';
function isSelfConversation(conversation){return !!conversation&&conversation.type==='group'&&conversation.created_by===state.user?.id&&conversation.description===SELF_CHAT_MARKER}
async function ensureSelfConversation(){
 if(!state.user)return null;
 let conversation=state.conversations.find(isSelfConversation);
 if(conversation)return conversation;
 const {data:conversationId,error:createError}=await supabaseClient.rpc('ensure_self_chat');
 if(createError)throw createError;
 const refreshed=await loadConversations();
 if(!refreshed)throw new Error('تم إنشاء مساحة مراسلة نفسك، لكن تعذر تحديث قائمة المحادثات');
 conversation=state.conversations.find(isSelfConversation);
 if(!conversation)throw new Error('لم تظهر مساحة مراسلة نفسك في قائمة المحادثات');
 return conversation;
}
function otherMember(conv){return (conv.members||[]).find(m=>m.user_id!==state.user.id)?.profile}
function convName(c){if(isSelfConversation(c))return (state.profile?.display_name||state.profile?.username||'أنا')+' (أنا)';if(c.type==='group')return c.title||'مجموعة جديدة';if(c.type==='channel')return c.title||'قناة بدون اسم';const p=otherMember(c);return p?.display_name||p?.username||'محادثة خاصة'}
function convPreview(c){const cleared=state.chatPrefs.get(c.id)?.cleared_before;if(c.type==='direct'&&cleared&&c.last_message?.created_at&&new Date(c.last_message.created_at)<=new Date(cleared))return 'تم مسح السجل من طرفك';return c.last_message?.content||'ابدأ المحادثة الآن'}
function renderConversations(section=state.sidebarView==='groups'?'groups':'direct'){
 const q=$('search').value.trim().toLowerCase(),list=$('conversationList');
 if(state.conversationsLoading&&!state.conversations.length){showListSkeleton(list,6);return}
 list.replaceChildren();
 const selfConversation=state.conversations.find(isSelfConversation);
 const selfPref=selfConversation?(state.chatPrefs.get(selfConversation.id)||{}):{};
 const selfListVisible=!state.activeListId||(state.activeListId==='__favorites__'?!!state.userConversationSettings.get(selfConversation?.id)?.is_favorite:!!state.chatListItems.get(selfConversation?.id)?.has(state.activeListId));
 const selfVisible=section==='direct'&&!!selfConversation&&!selfPref.is_archived&&selfListVisible&&
  ((convName(selfConversation)+' أنا مراسلة نفسك ملاحظاتي '+convPreview(selfConversation)+' '+(state.profile?.username||'')).toLowerCase().includes(q));
 if(selfVisible){
  const selfRow=document.createElement('button');selfRow.type='button';
  selfRow.className='conversation self-conversation-row'+(state.active?.id===selfConversation.id?' active':'');
  selfRow.setAttribute('aria-label','مراسلة نفسك');
  selfRow.innerHTML='<div class="conv-avatar self-chat-avatar"><i class="ph ph-note-pencil"></i></div><div class="conv-copy"><div class="conv-top"><strong>'+esc(state.profile?.display_name||state.profile?.username||'أنا')+' <span class="self-chat-tag">أنا</span></strong><span class="conv-time">'+(selfConversation.last_message?.created_at?time(selfConversation.last_message.created_at):'')+'</span></div><div class="conv-last">'+esc(convPreview(selfConversation)==='ابدأ المحادثة الآن'?'مراسلة نفسك':convPreview(selfConversation))+'</div></div>';
  selfRow.addEventListener('click',()=>openConversation(selfConversation));list.append(selfRow);
 }
 const rows=state.conversations.filter(c=>section==='groups'?c.type==='group'&&!isSelfConversation(c):c.type==='direct').slice().sort((a,b)=>Number(!!state.chatPrefs.get(b.id)?.is_shortcut)-Number(!!state.chatPrefs.get(a.id)?.is_shortcut)).filter(c=>{
  const pref=state.chatPrefs.get(c.id)||{},archived=!!pref.is_archived;
  if(section==='groups'&&archived)return false;
  if(section==='direct'&&(state.conversationFilter==='archived'?!archived:archived))return false;
  const matchesSearch=(convName(c)+' '+convPreview(c)+' '+(otherMember(c)?.username||'')).toLowerCase().includes(q);
  if(state.activeListId==='__favorites__'&&!state.userConversationSettings.get(c.id)?.is_favorite)return false;if(state.activeListId&&state.activeListId!=='__favorites__'&&!state.chatListItems.get(c.id)?.has(state.activeListId))return false;
  const unread=!!(c.last_message&&c.last_message.sender_id!==state.user.id&&c.last_message.created_at&&(!c.last_read_at||new Date(c.last_message.created_at)>new Date(c.last_read_at))&&(!pref.cleared_before||new Date(c.last_message.created_at)>new Date(pref.cleared_before)));
  const matchesFilter=section==='groups'||state.conversationFilter==='all'||state.conversationFilter==='archived'||(state.conversationFilter==='unread'&&unread);
  const category=state.workspaceClassifications.get(c.id)?.category||null;
  const labels=state.workspaceLabelItems.get(c.id)||new Set();const labelMatch=!state.workspaceActiveLabelId||labels.has(state.workspaceActiveLabelId);
  return matchesSearch&&matchesFilter&&(state.workspaceCategory==='all'||category===state.workspaceCategory)&&labelMatch;
 });
 if(!rows.length&&!selfVisible){const p=document.createElement('p');p.textContent=section==='groups'?(q?'لا توجد مجموعات تطابق البحث.':'لا توجد مجموعات عمل بعد. أنشئ مجموعة جديدة للبدء.'):state.conversationFilter==='archived'?'لا توجد محادثات مؤرشفة':q?'لا توجد نتائج':'لا توجد محادثات شخصية بعد';p.style.cssText='text-align:center;color:var(--muted);font-size:12px;padding:30px 8px';list.append(p);return}
 rows.forEach(c=>{
  const pref=state.chatPrefs.get(c.id)||{},archived=!!pref.is_archived;
  const shell=document.createElement('div');shell.className='conversation-swipe-shell'+(archived?' is-archived':'');
  const action=document.createElement('button');action.type='button';action.className='conversation-swipe-action'+(archived?' restore-action':' archive-action');
  action.innerHTML=archived?'<i class="ph ph-archive-restore"></i><span>استعادة</span>':'<i class="ph ph-archive-box"></i><span>أرشفة</span>';
  action.setAttribute('aria-label',archived?'استعادة المحادثة':'أرشفة المحادثة');
  const row=document.createElement('button');row.type='button';
  row.className='conversation swipe-conversation'+(state.active?.id===c.id?' active':'')+(archived?' archived-row':'');
  const unread=!!(c.last_message&&c.last_message.sender_id!==state.user.id&&c.last_message.created_at&&(!c.last_read_at||new Date(c.last_message.created_at)>new Date(c.last_read_at))&&(!pref.cleared_before||new Date(c.last_message.created_at)>new Date(pref.cleared_before)));
  row.setAttribute('aria-label',convName(c)+(unread?'، توجد رسالة غير مقروءة':''));
  const person=c.type==='direct'?otherMember(c):null;
  const avatar=person?.avatar_url&&/^https:\/\//i.test(person.avatar_url)?'<img src="'+esc(person.avatar_url)+'" alt="" loading="lazy">':c.type==='group'?'<i class="ph ph-users-three"></i>':c.type==='channel'?'<i class="ph ph-megaphone"></i>':esc(initials(convName(c)));
  row.innerHTML='<div class="conv-avatar">'+avatar+'</div><div class="conv-copy"><div class="conv-top"><strong>'+esc(convName(c))+(pref.is_shortcut?'<i class="ph ph-push-pin conv-shortcut-mark" title="اختصار مثبت"></i>':'')+(state.userConversationSettings.get(c.id)?.is_favorite?'<i class="ph ph-heart conv-shortcut-mark" title="مفضلة"></i>':'')+(archived?'<i class="ph ph-archive-box conversation-archive-mark" title="مؤرشفة"></i>':'')+'</strong><span class="conv-time">'+(c.last_message?.created_at?time(c.last_message.created_at):'')+(unread?'<i class="unread-dot" title="رسالة غير مقروءة"></i>':'')+'</span></div><div class="conv-last">'+esc(convPreview(c))+'</div></div>';
  bindConversationSwipe(shell,row,action,c,archived,list);
  shell.append(action,row);list.append(shell);
 });
}
function bindConversationSwipe(shell,row,action,conversation,archived,list){
 let startX=0,startY=0,tracking=false,suppressClick=false;
 const direction=archived?1:-1;
 const close=()=>{shell.classList.remove('swipe-open');row.style.transform=''};
 action.addEventListener('click',event=>{event.stopPropagation();close();archiveConversation(conversation,!archived)});
 row.addEventListener('pointerdown',event=>{
  if(event.pointerType==='mouse'&&event.button!==0)return;
  startX=event.clientX;startY=event.clientY;tracking=true;row.style.transition='none';
 });
 row.addEventListener('pointermove',event=>{
  if(!tracking)return;
  const dx=event.clientX-startX,dy=event.clientY-startY;
  if(Math.abs(dy)>Math.abs(dx)*1.2&&Math.abs(dy)>8){tracking=false;row.style.transition='';return}
  const offset=Math.max(0,Math.min(88,dx*direction));
  row.style.transform='translateX('+(direction*offset)+'px)';
 });
 row.addEventListener('pointerup',event=>{
  if(!tracking)return;
  tracking=false;row.style.transition='';
  const dx=event.clientX-startX,dy=event.clientY-startY;
  if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)*1.15&&Math.sign(dx)===direction){
   list.querySelectorAll('.conversation-swipe-shell.swipe-open').forEach(item=>{
    if(item!==shell){item.classList.remove('swipe-open');const other=item.querySelector('.swipe-conversation');if(other)other.style.transform=''}
   });
   shell.classList.add('swipe-open');row.style.transform='translateX('+(direction*88)+'px)';suppressClick=true;
  }else if(Math.abs(dx)>16){close();suppressClick=true}
 });
 row.addEventListener('pointercancel',()=>{tracking=false;row.style.transition='';close()});
 row.addEventListener('click',()=>{
  if(suppressClick){suppressClick=false;return}
  if(shell.classList.contains('swipe-open')){close();return}
  openConversation(conversation);
 });
}

async function loadConversations(){
 state.conversationsLoading=true;
 if(!state.conversations.length){showListSkeleton($('conversationList'),6);showListSkeleton($('directoryList'),4)}
 const {data:members,error}=await supabaseClient.from('conversation_members').select('conversation_id,role,last_read_at').eq('user_id',state.user.id);
 if(error){state.conversationsLoading=false;toast('تعذر تحميل المحادثات');console.error(error);renderConversations();if(state.sidebarView==='channels')renderMyChannels();return false}
 state.memberReads=Object.fromEntries((members||[]).map(x=>[x.conversation_id,x.last_read_at]));const ids=(members||[]).map(x=>x.conversation_id);if(!ids.length){state.conversations=[];state.conversationsLoading=false;renderConversations();if(state.sidebarView==='channels')renderMyChannels();return true}
 const {data:convs,error:ce}=await supabaseClient.from('conversations').select('*').in('id',ids).order('last_message_at',{ascending:false});
 if(ce){state.conversationsLoading=false;toast('تعذر قراءة المحادثات');console.error(ce);renderConversations();if(state.sidebarView==='channels')renderMyChannels();return false}
 const {data:allMembers,error:me}=await supabaseClient.from('conversation_members').select('conversation_id,user_id,role,last_read_at,last_delivered_at,profiles(id,username,display_name,avatar_url,bio)').in('conversation_id',ids);
 if(me){state.conversationsLoading=false;toast('تعذر قراءة أعضاء المحادثات');console.error(me);renderConversations();if(state.sidebarView==='channels')renderMyChannels();return false}
 const {data:latest,error:le}=await supabaseClient.from('chat_messages').select('id,conversation_id,content,created_at,sender_id').in('conversation_id',ids).is('deleted_at',null).order('created_at',{ascending:false}).limit(Math.max(ids.length*2,40));
 if(le){state.conversationsLoading=false;toast('تعذر تحميل معاينة الرسائل');console.error(le);renderConversations();if(state.sidebarView==='channels')renderMyChannels();return false}
 state.conversations=(convs||[]).map(c=>({...c,last_read_at:state.memberReads[c.id]||null,members:(allMembers||[]).filter(m=>m.conversation_id===c.id).map(m=>({...m,profile:m.profiles})),last_message:(latest||[]).find(m=>m.conversation_id===c.id)}));
 await loadDirectChatPreferences();
 await loadWorkspaceData();
 state.conversations.sort((a,b)=>new Date(b.last_message?.created_at||b.created_at)-new Date(a.last_message?.created_at||a.created_at));
 state.conversationsLoading=false;renderConversations();if(state.sidebarView==='channels')renderMyChannels();
 if(state.active){const refreshed=state.conversations.find(c=>c.id===state.active.id);if(refreshed)state.active=refreshed}
 return true;
}
function findDirectConversation(userId){
 return state.conversations.find(c=>c.type==='direct'&&(c.members||[]).length===2&&c.members.some(m=>m.user_id===state.user.id)&&c.members.some(m=>m.user_id===userId))||null;
}
async function openDirectConversation(profile,button){
 if(!state.user||!profile?.id||profile.id===state.user.id)return;
 if(button?.disabled)return;
 if(button){button.disabled=true;button.textContent='جارٍ الفتح…'}
 const pending=state.directConversationPromises.get(profile.id);
 if(pending){
  try{const conversation=await pending;if(conversation)await openConversation(conversation)}
  catch(error){console.error('Direct conversation failed:',error);toast(error?.message||'تعذر فتح المحادثة الخاصة')}
  finally{if(button){button.disabled=false;button.textContent='مراسلة'}}
  return;
 }
 const task=(async()=>{
  let existing=findDirectConversation(profile.id);
  if(!existing){
   const refreshed=await loadConversations();
   if(!refreshed)throw new Error('تعذر التحقق من المحادثات الحالية. حاول مجدداً قبل إنشاء محادثة جديدة.');
   existing=findDirectConversation(profile.id);
  }
  if(existing)return existing;
  const {data:conversationId,error:rpcError}=await supabaseClient.rpc('get_or_create_direct_conversation',{p_other_user_id:profile.id});
  if(rpcError)throw rpcError;
  const refreshed=await loadConversations();
  if(!refreshed)throw new Error('تم تجهيز المحادثة، لكن تعذر تحديث القائمة. أعد المحاولة.');
  const conversation=state.conversations.find(c=>c.id===conversationId)||findDirectConversation(profile.id);
  if(!conversation)throw new Error('لم تظهر المحادثة في قائمتك. تحقق من صلاحيات قراءة أعضاء المحادثات.');
  return conversation;
 })();
 state.directConversationPromises.set(profile.id,task);
 try{
  const conversation=await task;
  await openConversation(conversation);
  toast('تم فتح المحادثة الخاصة');
 }catch(error){
  console.error('Direct conversation failed:',error);
  toast(error?.message||'تعذر بدء المحادثة. تحقق من صلاحيات إنشاء المحادثات وإضافة الأعضاء.');
 }finally{
  if(state.directConversationPromises.get(profile.id)===task)state.directConversationPromises.delete(profile.id);
  if(button){button.disabled=false;button.textContent='مراسلة'}
 }
}
async function loadDirectChatPreferences(){
 if(!state.user)return;
 const ids=state.conversations.map(c=>c.id);
 if(!ids.length){state.chatPrefs=new Map();return}
 const {data,error}=await supabaseClient.from('user_chat_preferences').select('conversation_id,theme,cleared_before,is_shortcut,is_archived').eq('user_id',state.user.id).in('conversation_id',ids);
 if(error){console.warn('Chat preferences unavailable:',error.message);return}
 state.chatPrefs=new Map((data||[]).map(p=>[p.conversation_id,p]));
}
async function saveDirectChatPreference(patch){
 const c=state.active;if(!c||!state.user)return false;
 const current=state.chatPrefs.get(c.id)||{theme:'dark',cleared_before:null,is_shortcut:false,is_archived:false};
 const next={...current,...patch,user_id:state.user.id,conversation_id:c.id,updated_at:new Date().toISOString()};
 const {data,error}=await supabaseClient.from('user_chat_preferences').upsert(next,{onConflict:'user_id,conversation_id'}).select('conversation_id,theme,cleared_before,is_shortcut,is_archived,is_favorite').single();
 if(error){console.error('Saving chat preference failed:',error);toast('تعذر حفظ إعداد المحادثة');return false}
 state.chatPrefs.set(c.id,data);state.activeChatPreference=data;return true;
}
function applyDirectChatTheme(){
 const pref=state.activeChatPreference;
 const direct=state.active?.type==='direct';
 /* Theme is global and account-synchronized; conversation preferences remain limited to chat actions. */
 ['directShortcutBtn','directClearBtn'].forEach(id=>$(id).classList.toggle('hidden',!direct));
 $('archiveConversationBtn').classList.toggle('hidden',!state.active);
 $('archiveConversationBtn').innerHTML=pref?.is_archived?'<i class="ph ph-archive-restore"></i>':'<i class="ph ph-archive-box"></i>';
 $('archiveConversationBtn').title=pref?.is_archived?'إلغاء الأرشفة':'أرشفة المحادثة';
 if(direct){
  $('directShortcutBtn').classList.toggle('active',!!pref?.is_shortcut);
  $('directShortcutBtn').innerHTML=pref?.is_shortcut?'<i class="ph ph-push-pin-slash"></i>':'<i class="ph ph-push-pin"></i>';
  $('directShortcutBtn').title=pref?.is_shortcut?'إزالة الاختصار':'إضافة اختصار للمحادثة';
 }
}

async function archiveConversation(conversation,archive=true){
 if(!conversation||!state.user)return;
 if(isSelfConversation(conversation)){toast('مساحة مراسلة نفسك ثابتة ولا يمكن أرشفتها');return}
 const current=state.chatPrefs.get(conversation.id)||{theme:'dark',cleared_before:null,is_shortcut:false,is_archived:false};
 const payload={...current,is_archived:!!archive,user_id:state.user.id,conversation_id:conversation.id,updated_at:new Date().toISOString()};
 const {data,error}=await supabaseClient.from('user_chat_preferences').upsert(payload,{onConflict:'user_id,conversation_id'}).select('conversation_id,theme,cleared_before,is_shortcut,is_archived').single();
 if(error){console.error('Archive update failed:',error);toast('تعذرت أرشفة المحادثة');return}
 state.chatPrefs.set(conversation.id,data);
 if(state.active?.id===conversation.id){state.activeChatPreference=data;if(archive){state.active=null;applyDirectChatTheme();stopMessagePolling();if(state.channel)supabaseClient.removeChannel(state.channel);$('chatTitle').textContent='تمت أرشفة المحادثة';$('chatSub').textContent='يمكنك استعادتها من قسم المؤرشفة';$('messages').innerHTML='<div class="welcome"><div class="welcome-icon"><i class="ph ph-archive-box"></i></div><h2>تمت الأرشفة</h2><p>المحادثة ورسائلها محفوظة ويمكن استعادتها في أي وقت.</p></div>'}}
 renderConversations();toast(archive?'تمت أرشفة المحادثة في حسابك فقط':'تمت استعادة المحادثة إلى القائمة');
}
$('archiveConversationBtn').onclick=()=>{if(state.active)archiveConversation(state.active,!state.activeChatPreference?.is_archived)};
async function toggleDirectChatTheme(){
 if(state.active?.type!=='direct')return;
 const current=state.activeChatPreference?.theme||'dark',next=current==='dark'?'light':'dark';
 if(await saveDirectChatPreference({theme:next})){applyDirectChatTheme();toast(next==='light'?'تم تفعيل السمة البيضاء لك فقط':'تم تفعيل السمة السوداء لك فقط')}
}
async function toggleDirectChatShortcut(){
 if(state.active?.type!=='direct')return;
 const next=!state.activeChatPreference?.is_shortcut;
 if(await saveDirectChatPreference({is_shortcut:next})){applyDirectChatTheme();renderConversations();toast(next?'تمت إضافة المحادثة إلى اختصاراتك':'تمت إزالة المحادثة من اختصاراتك')}
}
async function clearDirectChatForMe(){
 if(state.active?.type!=='direct')return;
 if(!confirm('سيتم إخفاء الرسائل السابقة من حسابك فقط. لن تُحذف الرسائل من قاعدة البيانات ولن تتأثر لدى الطرف الآخر. هل تريد المتابعة؟'))return;
 const cutoff=new Date().toISOString();
 if(!await saveDirectChatPreference({cleared_before:cutoff}))return;
 state.messages=[];state.hasMoreMessages=false;state.messageIds.clear();state.renderingMessageIds.clear();state.replyMessages=new Map();state.reactions=new Map();state.pinnedMessages=new Map();state.newMessageCount=0;updateNewMessagesIndicator();renderPinnedBanner();$('messages').innerHTML='<div class="welcome"><div class="welcome-icon"><i class="ph ph-chat-teardrop-text"></i></div><h2>تم مسح سجل الدردشة من طرفك</h2><p>ستظهر هنا الرسائل الجديدة فقط. لا يزال السجل السابق متاحاً للطرف الآخر.</p></div>';
 toast('تم إخفاء الرسائل السابقة من حسابك فقط');
}

$('directShortcutBtn').onclick=toggleDirectChatShortcut;
$('directClearBtn').onclick=clearDirectChatForMe;
async function openConversation(c){
 if(!c?.id)return;
 const openToken=state.conversationOpenVersion=(state.conversationOpenVersion||0)+1;
 closeConversationWorkspace();
 state.messageLoadVersion++;
 stopMessagePolling();
 const conversationOpenStarted=performance.now();
 if(state.voiceRecorder){state.cancelVoiceOnStop=true;cancelVoiceRecording();toast('تم إلغاء التسجيل عند الانتقال إلى محادثة أخرى')}
 if(state.editTarget){$('messageInput').value='';state.attachment=null;$('fileInput').value='';$('attachmentPreview').classList.add('hidden')}
 state.active=c;state.activeChatPreference=state.chatPrefs.get(c.id)||{theme:'dark',cleared_before:null,is_shortcut:false,is_archived:false};applyDirectChatTheme();state.messages=[];state.messagePollCursor=null;state.messagePollLastCheckedAt=null;state.newMessageCount=0;updateNewMessagesIndicator();$('chatSearchPanel').classList.add('hidden');$('chatSearchInput').value='';state.reactions=new Map();state.pinnedMessages=new Map();state.replyMessages=new Map();state.replyTarget=null;state.editTarget=null;renderComposerContext();renderPinnedBanner();state.messageIds.clear();state.renderingMessageIds.clear();diagLog('conversation-open',{id:c.id,openToken});renderConversations();$('chatTitle').textContent=convName(c);renderChatAvatar(c);
 if(c.type==='group'){
  await loadGroupSettings(c.id);
  if(openToken!==state.conversationOpenVersion||state.active?.id!==c.id)return;
  await loadUserConversationSettings(c.id);
 }else{
  state.groupSettings=null;
  await loadUserConversationSettings(c.id);
 }
 if(openToken!==state.conversationOpenVersion||state.active?.id!==c.id)return;
 const myRole=(c.members||[]).find(m=>m.user_id===state.user.id)?.role;const canPost=(c.type!=='channel'||myRole==='owner'||myRole==='admin')&&!(c.type==='group'&&state.groupSettings?.only_admins_can_send&&!['owner','admin'].includes(myRole));$('shareChannelBtn').classList.toggle('hidden',c.type!=='channel'||!(c.created_by===state.user.id||myRole==='owner'||myRole==='admin'));$('chatSub').textContent=isSelfConversation(c)?'مساحة شخصية · مراسلة نفسك':c.type==='group'?'مجموعة · '+(c.members||[]).length+' أعضاء':c.type==='channel'?'قناة إعلانات · '+(c.members||[]).length+' مشتركين': 'محادثة خاصة';// renderChatAvatar already renders the other participant's saved photo or initials.$('messageInput').disabled=!canPost;$('messageInput').placeholder=c.type==='channel'&&!canPost?'النشر متاح لمشرفي القناة فقط':'اكتب رسالتك هنا…';resizeComposer();
 $('messages').scrollTop=$('messages').scrollHeight;
 if(innerWidth<=760)$('sidebar').classList.add('closed');
 // Keep the composer available while messages and attachments load.
 subscribeConversation();subscribeProfileUpdates(c);await loadStarredMessageIds(c.id);
 if(openToken!==state.conversationOpenVersion||state.active?.id!==c.id)return;
 await loadMessages();
 if(openToken!==state.conversationOpenVersion||state.active?.id!==c.id)return;
 recordPerf('conversation_open',performance.now()-conversationOpenStarted,{success:true});
 startMessagePolling(c.id);
}


