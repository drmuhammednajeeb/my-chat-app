/* Extracted from current main 66e4c2a7efd980e622768260da2eccf2baf868c7; classic-script execution retained. */
'use strict';

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

async function openConversation(c){
 if(!c?.id)return;
 const conversationOpenStarted=performance.now();
 if(state.voiceRecorder){state.cancelVoiceOnStop=true;cancelVoiceRecording();toast('تم إلغاء التسجيل عند الانتقال إلى محادثة أخرى')}
 if(state.editTarget){$('messageInput').value='';state.attachment=null;$('fileInput').value='';$('attachmentPreview').classList.add('hidden')}
 state.active=c;state.activeChatPreference=state.chatPrefs.get(c.id)||{theme:'dark',cleared_before:null,is_shortcut:false,is_archived:false};applyDirectChatTheme();state.messages=[];state.newMessageCount=0;updateNewMessagesIndicator();$('chatSearchPanel').classList.add('hidden');$('chatSearchInput').value='';state.reactions=new Map();state.pinnedMessages=new Map();state.replyMessages=new Map();state.replyTarget=null;state.editTarget=null;renderComposerContext();renderPinnedBanner();state.messageIds.clear();state.renderingMessageIds.clear();state.messageLoadVersion++;diagLog('conversation-open',{id:c.id});renderConversations();$('chatTitle').textContent=convName(c);renderChatAvatar(c);if(c.type==='group'){await loadGroupSettings(c.id);await loadUserConversationSettings(c.id)}else{state.groupSettings=null;await loadUserConversationSettings(c.id)}const myRole=(c.members||[]).find(m=>m.user_id===state.user.id)?.role;const canPost=(c.type!=='channel'||myRole==='owner'||myRole==='admin')&&!(c.type==='group'&&state.groupSettings?.only_admins_can_send&&!['owner','admin'].includes(myRole));$('shareChannelBtn').classList.toggle('hidden',c.type!=='channel'||!(c.created_by===state.user.id||myRole==='owner'||myRole==='admin'));$('chatSub').textContent=isSelfConversation(c)?'مساحة شخصية · مراسلة نفسك':c.type==='group'?'مجموعة · '+(c.members||[]).length+' أعضاء':c.type==='channel'?'قناة إعلانات · '+(c.members||[]).length+' مشتركين': 'محادثة خاصة';// renderChatAvatar already renders the other participant's saved photo or initials.$('messageInput').disabled=!canPost;$('messageInput').placeholder=c.type==='channel'&&!canPost?'النشر متاح لمشرفي القناة فقط':'اكتب رسالتك هنا…';resizeComposer();
 $('messages').scrollTop=$('messages').scrollHeight;
 if(innerWidth<=760)$('sidebar').classList.add('closed');
 // Keep the composer available while messages and attachments load.
 stopMessagePolling();subscribeConversation();subscribeProfileUpdates(c);await loadStarredMessageIds(c.id);await loadMessages();recordPerf('conversation_open',performance.now()-conversationOpenStarted,{success:state.active?.id===c.id});if(state.active?.id===c.id)startMessagePolling(c.id);
}

function closeChatHeaderMenu(){const menu=$('chatHeaderMenu'),button=$('chatHeaderMenuBtn');menu?.classList.add('hidden');button?.setAttribute('aria-expanded','false')}

async function loadCustomLists(){
 if(!state.user)return;
 try{
  const [lists,items]=await Promise.all([
   supabaseClient.from('chat_lists').select('id,name,sort_order').eq('user_id',state.user.id).order('sort_order').order('created_at'),
   supabaseClient.from('chat_list_items').select('list_id,conversation_id').eq('user_id',state.user.id)
  ]);
  if(lists.error)throw lists.error;if(items.error)throw items.error;
  state.customLists=lists.data||[];state.chatListItems=new Map();
  (items.data||[]).forEach(x=>{const set=state.chatListItems.get(x.conversation_id)||new Set();set.add(x.list_id);state.chatListItems.set(x.conversation_id,set)});
  if(state.activeListId&&state.activeListId!=='__favorites__'&&!state.customLists.some(x=>x.id===state.activeListId))state.activeListId=null;
  renderCustomLists();
 }catch(error){console.warn('Custom chat lists could not be loaded:',error?.message||error)}
}

function renderCustomLists(){
 const panel=$('customListsPanel'),items=$('customListsItems');if(!panel||!items)return;
 const visible=['chats','groups'].includes(state.sidebarView);
 panel.classList.toggle('hidden',!visible);
 if(!visible)return;
 items.replaceChildren();
 const all=document.createElement('button');all.type='button';all.className='custom-list-chip'+(!state.activeListId?' active':'');all.textContent='الكل';all.onclick=()=>{state.activeListId=null;renderCustomLists();renderConversations()};items.append(all);const favorites=document.createElement('button');favorites.type='button';favorites.className='custom-list-chip'+(state.activeListId==='__favorites__'?' active':'');favorites.textContent='♥ المفضلة';favorites.onclick=()=>{state.activeListId='__favorites__';renderCustomLists();renderConversations()};items.append(favorites);
 state.customLists.forEach(list=>{
  const wrap=document.createElement('div');wrap.style.display='flex';wrap.style.gap='3px';
  const b=document.createElement('button');b.type='button';b.className='custom-list-chip'+(state.activeListId===list.id?' active':'');b.textContent=list.name;b.onclick=()=>{state.activeListId=list.id;renderCustomLists();renderConversations()};
  const edit=document.createElement('button');edit.type='button';edit.className='custom-list-chip';edit.title='إدارة القائمة';edit.textContent='⋯';edit.onclick=()=>manageCustomList(list);
  wrap.append(b,edit);items.append(wrap);
 });
}

async function createCustomList(){
 const name=prompt('اسم القائمة الجديدة (مثال: العمل أو فريق المبيعات):');if(name===null)return;
 const clean=name.trim();if(!clean||clean.length>40){toast('اسم القائمة مطلوب وبحد أقصى 40 حرفاً');return}
 const {data,error}=await supabaseClient.from('chat_lists').insert({user_id:state.user.id,name:clean,sort_order:state.customLists.length}).select('id,name,sort_order').single();
 if(error){toast(error.code==='23505'?'لديك قائمة بهذا الاسم بالفعل':'تعذر إنشاء القائمة');console.error(error);return}
 state.customLists.push(data);renderCustomLists();toast('تم إنشاء القائمة');
}

async function manageCustomList(list){
 const choice=prompt('اكتب: 1 لتغيير الاسم، 2 لحذف القائمة.\nلن يؤدي حذف القائمة إلى حذف أي محادثة.', '1');if(choice===null)return;
 if(choice.trim()==='1'){const name=prompt('الاسم الجديد للقائمة:',list.name);if(name===null)return;const clean=name.trim();if(!clean||clean.length>40)return toast('اسم القائمة غير صالح');const {data,error}=await supabaseClient.from('chat_lists').update({name:clean,updated_at:new Date().toISOString()}).eq('id',list.id).eq('user_id',state.user.id).select().single();if(error)return toast('تعذر تعديل اسم القائمة');Object.assign(list,data);renderCustomLists();toast('تم تعديل القائمة')}
 else if(choice.trim()==='2'&&confirm('حذف القائمة "'+list.name+'"؟ لن يتم حذف المحادثات.')){const {error}=await supabaseClient.from('chat_lists').delete().eq('id',list.id).eq('user_id',state.user.id);if(error)return toast('تعذر حذف القائمة');state.customLists=state.customLists.filter(x=>x.id!==list.id);if(state.activeListId===list.id)state.activeListId=null;await loadCustomLists();renderConversations();toast('تم حذف القائمة')}
}

async function openCustomListPicker(){
 ensureGroupModal();const body=$('customListBody');body.replaceChildren();
 if(!state.customLists.length){const p=document.createElement('p');p.className='group-management-muted';p.textContent='أنشئ قائمة مخصصة أولاً من قسم «قوائمي» في الشريط الجانبي.';body.append(p);const b=document.createElement('button');b.className='group-management-btn primary';b.textContent='إنشاء قائمة';b.onclick=async()=>{await createCustomList();openCustomListPicker()};body.append(b)}
 else{
  const current=state.chatListItems.get(state.active.id)||new Set();
  state.customLists.forEach(list=>{const label=document.createElement('label');label.className='custom-list-option';const input=document.createElement('input');input.type='checkbox';input.checked=current.has(list.id);input.onchange=()=>toggleConversationInList(list.id,input.checked);const span=document.createElement('span');span.textContent=list.name;label.append(input,span);body.append(label)});
  const create=document.createElement('button');create.className='group-management-btn primary';create.textContent='إنشاء قائمة جديدة';create.onclick=async()=>{await createCustomList();openCustomListPicker()};body.append(create);
 }
 $('customListModal').classList.add('open');$('customListModal').setAttribute('aria-hidden','false');
}

async function toggleConversationInList(listId,add){
 const c=state.active;if(!c)return;
 let result;
 if(add)result=await supabaseClient.from('chat_list_items').upsert({user_id:state.user.id,list_id:listId,conversation_id:c.id},{onConflict:'user_id,list_id,conversation_id'});
 else result=await supabaseClient.from('chat_list_items').delete().eq('user_id',state.user.id).eq('list_id',listId).eq('conversation_id',c.id);
 if(result.error){toast('تعذر تحديث القائمة');console.error(result.error);return}
 const set=state.chatListItems.get(c.id)||new Set();if(add)set.add(listId);else set.delete(listId);state.chatListItems.set(c.id,set);renderConversations();toast(add?'أضيفت المحادثة إلى القائمة':'أزيلت المحادثة من القائمة');
}

async function loadAllUserConversationSettings(){if(!state.user)return;const ids=state.conversations.map(c=>c.id);if(!ids.length)return;const {data,error}=await supabaseClient.from('user_conversation_settings').select('conversation_id,is_muted,notification_tone,is_favorite').eq('user_id',state.user.id).in('conversation_id',ids);if(error){console.warn('Conversation notification preferences unavailable:',error.message);return}(data||[]).forEach(x=>state.userConversationSettings.set(x.conversation_id,x))}

async function loadUserConversationSettings(conversationId){
 if(!state.user||!conversationId)return;
 const {data,error}=await supabaseClient.from('user_conversation_settings').select('is_muted,notification_tone,is_favorite').eq('user_id',state.user.id).eq('conversation_id',conversationId).maybeSingle();
 if(error){console.warn('Conversation notification settings unavailable:',error.message);return}
 state.userConversationSettings.set(conversationId,data||{is_muted:false,notification_tone:'default',is_favorite:false});
 updateConversationMenu();
}

async function saveUserConversationSettings(patch){
 const c=state.active;if(!c||!state.user)return false;
 const current=state.userConversationSettings.get(c.id)||{is_muted:false,notification_tone:'default',is_favorite:false};
 const next={...current,...patch,user_id:state.user.id,conversation_id:c.id,updated_at:new Date().toISOString()};
 const {data,error}=await supabaseClient.from('user_conversation_settings').upsert(next,{onConflict:'user_id,conversation_id'}).select('is_muted,notification_tone,is_favorite').single();
 if(error){console.error(error);toast('تعذر حفظ إعداد الإشعارات');return false}
 state.userConversationSettings.set(c.id,data);updateConversationMenu();return true;
}

function updateConversationMenu(){
 const c=state.active;if(!c)return;
 const group=c.type==='group',role=groupRole(),admin=isGroupAdmin(),settings=state.userConversationSettings.get(c.id)||{};
 const show=(id,visible)=>$(id)?.classList.toggle('hidden',!visible);
 ['groupInfoBtn','selectMessagesBtn','conversationWorkspaceBtn','muteNotificationsBtn','notificationSettingsBtn','disappearingBtn','starredMessagesBtn','groupThemeBtn','favoriteConversationBtn','addToCustomListBtn','exportConversationBtn','closeConversationBtn','clearConversationBtn','leaveGroupBtn'].forEach(id=>show(id,true));
 show('groupInfoBtn',group);show('conversationWorkspaceBtn',true);show('disappearingBtn',group);show('groupThemeBtn',group);show('leaveGroupBtn',group);
 $('muteNotificationsBtn').innerHTML=settings.is_muted?'<i class="ph ph-bell"></i><span>إلغاء كتم الإشعارات</span>':'<i class="ph ph-bell-slash"></i><span>كتم الإشعارات</span>';
 const favorite=!!state.userConversationSettings.get(c.id)?.is_favorite;
 $('notificationSettingsBtn').classList.remove('hidden');
 $('favoriteConversationBtn').innerHTML=favorite?'<i class="ph ph-heart-break"></i><span>إزالة من المفضلة</span>':'<i class="ph ph-heart"></i><span>إضافة إلى المفضلة</span>';
}

async function clearActiveConversation(){
 const c=state.active;if(!c)return;
 if(!confirm('مسح سجل هذه الدردشة من طرفك فقط؟ لن تُحذف الرسائل لدى بقية الأعضاء.'))return;
 if(!await saveDirectChatPreference({cleared_before:new Date().toISOString()}))return;
 state.messages=[];state.messageIds.clear();$('messages').innerHTML='<div class="welcome"><h2>تم مسح الدردشة من طرفك</h2><p>يمكنك متابعة المحادثة من هنا.</p></div>';renderPinnedBanner();toast('تم مسح الدردشة من طرفك فقط');
}

async function closeActiveConversation(){
 if(state.voiceRecorder){toast('أوقف التسجيل قبل إغلاق الدردشة');return}
 closeChatHeaderMenu();stopMessagePolling();if(state.channel)supabaseClient.removeChannel(state.channel);if(state.typingChannel)supabaseClient.removeChannel(state.typingChannel);
 state.channel=null;state.typingChannel=null;state.active=null;state.messages=[];state.messageIds.clear();state.messageLoadVersion++;
 $('chatTitle').textContent='اختر محادثة';$('chatSub').textContent='محادثاتك الخاصة والمجموعات';$('messages').innerHTML='<div class="welcome"><h2>تم إغلاق الدردشة</h2><p>اختر محادثة أخرى من القائمة.</p></div>';$('messageInput').disabled=true;$('sendBtn').disabled=true;
 if(innerWidth<=760)$('sidebar').classList.remove('closed');renderConversations();
}

async function leaveActiveGroup(){
 const c=state.active;if(c?.type!=='group')return;
 if(groupRole()==='owner'){toast('لا يمكن للمالك مغادرة المجموعة قبل نقل الملكية إلى مشرف آخر');return}
 if(!confirm('هل تريد مغادرة هذه المجموعة؟'))return;
 const {error}=await supabaseClient.from('conversation_members').delete().eq('conversation_id',c.id).eq('user_id',state.user.id);
 if(error){toast('تعذر مغادرة المجموعة');console.error(error);return}
 toast('غادرت المجموعة');await loadConversations();await closeActiveConversation();
}

async function toggleFavoriteConversation(){
 const current=!!state.userConversationSettings.get(state.active?.id)?.is_favorite;
 if(await saveUserConversationSettings({is_favorite:!current})){updateConversationMenu();renderConversations();toast(current?'أزيلت من المفضلة':'أضيفت إلى المفضلة')}
}

// Internal feature contract: channel UI requests navigation without importing or calling this module.
window.addEventListener('bizmind:open-conversation',event=>{
 const conversation=event.detail?.conversation;
 if(conversation)void openConversation(conversation);
});
