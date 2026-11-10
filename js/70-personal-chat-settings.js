function subscribePersonalChatData(){if(!state.user)return;if(state.personalChannel)supabaseClient.removeChannel(state.personalChannel);const uid=state.user.id;state.personalChannel=supabaseClient.channel('personal-chat-data:'+uid).on('postgres_changes',{event:'*',schema:'public',table:'chat_lists',filter:'user_id=eq.'+uid},()=>loadCustomLists().then(renderConversations)).on('postgres_changes',{event:'*',schema:'public',table:'chat_list_items',filter:'user_id=eq.'+uid},()=>loadCustomLists().then(renderConversations)).on('postgres_changes',{event:'*',schema:'public',table:'user_chat_preferences',filter:'user_id=eq.'+uid},async()=>{await loadDirectChatPreferences();renderConversations();updateConversationMenu()}).on('postgres_changes',{event:'*',schema:'public',table:'user_conversation_settings',filter:'user_id=eq.'+uid},p=>{const row=p.eventType==='DELETE'?p.old:p.new;if(row?.conversation_id){if(p.eventType==='DELETE')state.userConversationSettings.delete(row.conversation_id);else state.userConversationSettings.set(row.conversation_id,row);updateConversationMenu();renderConversations()}}).on('postgres_changes',{event:'*',schema:'public',table:'user_message_stars',filter:'user_id=eq.'+uid},()=>{if(state.active?.id)loadStarredMessageIds(state.active.id)})
 .on('postgres_changes',{event:'*',schema:'public',table:'user_conversation_classifications',filter:'user_id=eq.'+uid},async()=>{await loadWorkspaceData();renderConversations()})
 .on('postgres_changes',{event:'*',schema:'public',table:'user_conversation_labels',filter:'user_id=eq.'+uid},async()=>{await loadWorkspaceData();renderWorkspaceInboxTabs();renderWorkspaceLabels();renderConversations()})
 .on('postgres_changes',{event:'*',schema:'public',table:'user_conversation_label_items',filter:'user_id=eq.'+uid},async()=>{await loadWorkspaceData();renderWorkspaceLabels();renderConversations()})
 .on('postgres_changes',{event:'*',schema:'public',table:'user_classification_rules',filter:'user_id=eq.'+uid},async()=>{await loadWorkspaceData();renderConversations()})
 .on('postgres_changes',{event:'*',schema:'public',table:'private_conversation_notes',filter:'user_id=eq.'+uid},p=>{const row=p.eventType==='DELETE'?p.old:p.new;if($('conversationWorkspaceModal')?.classList.contains('open')&&state.active?.id===row?.conversation_id)loadPrivateConversationNotes(state.active.id)})
 .subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('Personal chat preferences realtime:',status)})}
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
async function loadStarredMessageIds(conversationId){
 if(!state.user?.id||!conversationId)return false;
 try{
  const {data,error}=await supabaseClient.from('user_message_stars').select('message_id').eq('user_id',state.user.id).eq('conversation_id',conversationId);
  if(state.active?.id!==conversationId)return false;
  if(error)throw error;
  state.starredMessageIds=new Set((data||[]).map(x=>x.message_id));
  return true;
 }catch(error){
  if(state.active?.id===conversationId)state.starredMessageIds=new Set();
  console.warn('Starred message state unavailable:',error?.message||error);
  return false;
 }
}
async function loadGroupSettings(conversationId){
 if(!conversationId||state.active?.id!==conversationId)return;
 const {data,error}=await supabaseClient.from('conversation_group_settings').select('*').eq('conversation_id',conversationId).maybeSingle();
 if(state.active?.id!==conversationId)return;
 if(error){console.warn('Group settings unavailable:',error.message);state.groupSettings=null;return}
 state.groupSettings=data||{conversation_id:conversationId,only_admins_can_send:false,disappearing_seconds:0,theme_color:'default'};
 applyGroupTheme();
 updateGroupComposerPermission();
}
async function saveGroupSettings(patch){
 const c=state.active;if(c?.type!=='group'||!isGroupAdmin())return toast('هذا الإجراء متاح لمشرفي المجموعة فقط');
 const current=state.groupSettings||{conversation_id:c.id};
 const next={...current,...patch,conversation_id:c.id,updated_by:state.user.id,updated_at:new Date().toISOString()};
 const {data,error}=await supabaseClient.from('conversation_group_settings').upsert(next,{onConflict:'conversation_id'}).select().single();
 if(error){console.error(error);toast('تعذر حفظ إعدادات المجموعة');return false}
 state.groupSettings=data;applyGroupTheme();updateGroupComposerPermission();toast('تم حفظ إعدادات المجموعة');return true;
}
function applyGroupTheme(){
 const chat=$('chat');const color=state.active?.type==='group'?state.groupSettings?.theme_color||'default':'default';
 chat.dataset.groupTheme=color==='default'?'':color;
}
function updateGroupComposerPermission(){
 if(!state.active)return;
 const role=groupRole(),blocked=state.active.type==='group'&&state.groupSettings?.only_admins_can_send&&!['owner','admin'].includes(role);
 const channelBlocked=state.active.type==='channel'&&!['owner','admin'].includes(role);
 $('messageInput').disabled=!!(blocked||channelBlocked);$('sendBtn').disabled=!!(blocked||channelBlocked);
 $('messageInput').placeholder=blocked?'الإرسال متاح لمشرفي المجموعة فقط':channelBlocked?'النشر متاح لمشرفي القناة فقط':'اكتب رسالتك هنا…';
}
async function loadAllUserConversationSettings(){if(!state.user)return;const ids=state.conversations.map(c=>c.id);if(!ids.length)return;const {data,error}=await supabaseClient.from('user_conversation_settings').select('conversation_id,is_muted,notification_tone,is_favorite').eq('user_id',state.user.id).in('conversation_id',ids);if(error){console.warn('Conversation notification preferences unavailable:',error.message);return}(data||[]).forEach(x=>state.userConversationSettings.set(x.conversation_id,x))}
async function loadUserConversationSettings(conversationId){
 if(!state.user||!conversationId)return;
 const {data,error}=await supabaseClient.from('user_conversation_settings').select('is_muted,notification_tone,is_favorite').eq('user_id',state.user.id).eq('conversation_id',conversationId).maybeSingle();
 if(error){console.warn('Conversation notification settings unavailable:',error.message);return}
 state.userConversationSettings.set(conversationId,data||{is_muted:false,notification_tone:'default',is_favorite:false});
 if(state.active?.id===conversationId)updateConversationMenu();
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
async function openGroupManagement(){
 const c=state.active;if(c?.type!=='group')return;
 ensureGroupModal();await loadGroupSettings(c.id);
 const [members,events]=await Promise.all([
  supabaseClient.from('conversation_members').select('conversation_id,user_id,role,joined_at,profiles(id,username,display_name,avatar_url)').eq('conversation_id',c.id).order('joined_at'),
  supabaseClient.from('conversation_member_events').select('id,actor_id,target_user_id,event_type,details,created_at').eq('conversation_id',c.id).order('created_at',{ascending:false}).limit(50)
 ]);
 if(members.error){toast('تعذر تحميل أعضاء المجموعة');return}
 if(events.error)console.warn('Membership history unavailable:',events.error);
 state.membershipEvents=events.data||[];
 const eventUserIds=[...new Set((events.data||[]).flatMap(e=>[e.actor_id,e.target_user_id]).filter(Boolean))];let eventNames=new Map();if(eventUserIds.length){const {data:eventProfiles}=await supabaseClient.from('profiles').select('id,display_name,username').in('id',eventUserIds);eventNames=new Map((eventProfiles||[]).map(p=>[p.id,p.display_name||p.username||'عضو']))}
 const rows=members.data||[],admin=isGroupAdmin(),settings=state.groupSettings||{};
 const body=$('groupManagementBody');body.replaceChildren();
 const section=(title)=>{const el=document.createElement('section');el.className='group-management-section';const h=document.createElement('h3');h.textContent=title;el.append(h);body.append(el);return el};
 const about=section('نبذة المجموعة ومعلوماتها');
 const titleInput=document.createElement('input');titleInput.className='group-management-field';titleInput.value=c.title||'';titleInput.maxLength=80;titleInput.placeholder='اسم المجموعة';titleInput.disabled=!admin;
 const desc=document.createElement('textarea');desc.className='group-management-field';desc.rows=3;desc.maxLength=500;desc.value=c.description||'';desc.placeholder='نبذة تعريفية عن المجموعة';desc.disabled=!admin;
 const saveAbout=document.createElement('button');saveAbout.className='group-management-btn primary';saveAbout.textContent='حفظ معلومات المجموعة';saveAbout.disabled=!admin;
 saveAbout.onclick=async()=>{const name=titleInput.value.trim();if(!name)return toast('اسم المجموعة مطلوب');const {error}=await supabaseClient.from('conversations').update({title:name,description:desc.value.trim(),updated_at:new Date().toISOString()}).eq('id',c.id);if(error){console.error(error);toast('تعذر تحديث معلومات المجموعة');return}c.title=name;c.description=desc.value.trim();$('chatTitle').textContent=convName(c);renderConversations();toast('تم تحديث معلومات المجموعة');$('groupManagementSubtitle').textContent=name};
 about.append(titleInput,desc,saveAbout);
 const meta=document.createElement('p');meta.textContent='تاريخ الإنشاء: '+new Date(c.created_at).toLocaleString('ar-SA')+' · '+rows.length+' أعضاء';about.append(meta);
 const people=section('الأعضاء والمشرفون · '+rows.length);
 rows.forEach(member=>{
  const line=document.createElement('div');line.className='group-member-row';
  const copy=document.createElement('div');copy.className='group-member-name';const name=document.createElement('strong');name.textContent=member.profiles?.display_name||member.profiles?.username||'عضو';const sub=document.createElement('small');sub.textContent='@'+(member.profiles?.username||'')+' · '+(member.role==='owner'?'مالك':member.role==='admin'?'مشرف':'عضو');copy.append(name,sub);line.append(copy);
  if(admin&&member.role!=='owner'&&member.user_id!==state.user.id){const actions=document.createElement('div');actions.className='group-member-actions';const role=document.createElement('button');role.textContent=member.role==='admin'?'إزالة الإشراف':'ترقية لمشرف';role.onclick=async()=>{const {error}=await supabaseClient.from('conversation_members').update({role:member.role==='admin'?'member':'admin'}).eq('conversation_id',c.id).eq('user_id',member.user_id);if(error){toast('تعذر تغيير صلاحية العضو');console.error(error);return}await loadConversations();openGroupManagement()};const remove=document.createElement('button');remove.className='danger';remove.textContent='إزالة';remove.onclick=async()=>{if(!confirm('إزالة هذا العضو من المجموعة؟'))return;const {error}=await supabaseClient.from('conversation_members').delete().eq('conversation_id',c.id).eq('user_id',member.user_id);if(error){toast('تعذر إزالة العضو');return}await loadConversations();openGroupManagement()};if(groupRole(c)==='owner'&&member.role==='admin'){const transfer=document.createElement('button');transfer.textContent='نقل الملكية';transfer.onclick=async()=>{if(!confirm('نقل ملكية المجموعة إلى هذا المشرف؟ ستصبح مشرفاً بعد النقل.'))return;const {error}=await supabaseClient.rpc('transfer_group_ownership',{p_conversation_id:c.id,p_new_owner:member.user_id});if(error){toast('تعذر نقل الملكية');console.error(error);return}toast('تم نقل ملكية المجموعة');await loadConversations();openGroupManagement()};actions.append(transfer)}actions.append(role,remove);line.append(actions)}
  people.append(line);
 });
 if(admin){const add=section('إضافة أعضاء');const input=document.createElement('input');input.className='group-management-field';input.placeholder='اسم المستخدم أو الاسم الظاهر';input.maxLength=48;const button=document.createElement('button');button.className='group-management-btn primary';button.textContent='بحث وإضافة';button.onclick=async()=>{const term=input.value.trim().replace(/[,%()'"]/g,'');if(term.length<2)return toast('أدخل حرفين على الأقل');const {data,error}=await supabaseClient.from('profiles').select('id,username,display_name').neq('id',state.user.id).or('username.ilike.%'+term+'%,display_name.ilike.%'+term+'%').limit(8);if(error){toast('تعذر البحث عن الأعضاء');return}const candidates=(data||[]).filter(p=>!rows.some(m=>m.user_id===p.id));if(!candidates.length){toast('لم يتم العثور على أعضاء جدد بهذا البحث');return}let chooser=add.querySelector('.group-candidate-results');if(!chooser){chooser=document.createElement('div');chooser.className='group-candidate-results';add.append(chooser)}chooser.replaceChildren();candidates.forEach(candidate=>{const pick=document.createElement('button');pick.type='button';pick.className='group-management-btn';pick.textContent=(candidate.display_name||candidate.username)+' · @'+candidate.username;pick.onclick=async()=>{pick.disabled=true;const {error:addError}=await supabaseClient.from('conversation_members').insert({conversation_id:c.id,user_id:candidate.id,role:'member'});if(addError){toast('تعذر إضافة العضو');console.error(addError);pick.disabled=false;return}toast('تمت إضافة '+(candidate.display_name||candidate.username));await loadConversations();openGroupManagement()};chooser.append(pick)});toast('اختر العضو المطلوب من نتائج البحث')};add.append(input,button)}
 const controls=section('إعدادات المجموعة · صلاحية المشرف');
 const only=document.createElement('label');only.className='group-toggle';only.textContent='السماح للمشرفين فقط بإرسال الرسائل';const check=document.createElement('input');check.type='checkbox';check.checked=!!settings.only_admins_can_send;check.disabled=!admin;check.onchange=()=>saveGroupSettings({only_admins_can_send:check.checked});only.append(check);controls.append(only);
 const themeLabel=document.createElement('p');themeLabel.textContent='سمة الدردشة';controls.append(themeLabel);
 const colors=document.createElement('div');colors.className='group-color-options';[['default','#7b8794'],['emerald','#0b9b78'],['blue','#3688d8'],['violet','#9166d8'],['amber','#c58a25'],['rose','#d65e80']].forEach(([value,color])=>{const b=document.createElement('button');b.type='button';b.style.background=color;b.disabled=!admin;b.setAttribute('aria-label',value);b.setAttribute('aria-pressed',String((settings.theme_color||'default')===value));b.onclick=async()=>{if(await saveGroupSettings({theme_color:value}))openGroupManagement()};colors.append(b)});controls.append(colors);
 const expiry=document.createElement('label');expiry.className='group-management-muted';expiry.textContent='مدة اختفاء الرسائل الجديدة';const select=document.createElement('select');select.className='group-management-field';select.disabled=!admin;[[0,'إيقاف'],[86400,'بعد 24 ساعة'],[604800,'بعد 7 أيام'],[2592000,'بعد 30 يوماً']].forEach(([v,label])=>{const option=document.createElement('option');option.value=v;option.textContent=label;select.append(option)});select.value=String(settings.disappearing_seconds||0);select.onchange=()=>saveGroupSettings({disappearing_seconds:Number(select.value)});controls.append(expiry,select);
 const history=section('سجل تغييرات الأعضاء');if(!state.membershipEvents.length){const p=document.createElement('p');p.className='group-management-muted';p.textContent='لا توجد تغييرات مسجلة بعد.';history.append(p)}else state.membershipEvents.forEach(event=>{const line=document.createElement('div');line.className='group-event-row';const who=eventNames.get(event.target_user_id)||'عضو';const actor=event.actor_id===state.user.id?'أنت':(eventNames.get(event.actor_id)||'مشرف سابق');const label={joined:'انضم إلى المجموعة',left:'غادر المجموعة',removed:'تمت إزالته',promoted:'تمت ترقيته',demoted:'أزيلت عنه صلاحية الإشراف'}[event.event_type]||event.event_type;line.textContent=actor+' · '+who+' · '+label+' · '+new Date(event.created_at).toLocaleString('ar-SA');history.append(line)});
 $('groupManagementTitle').textContent=c.title||'معلومات المجموعة';$('groupManagementSubtitle').textContent='تاريخ الإنشاء · '+new Date(c.created_at).toLocaleDateString('ar-SA');$('groupManagementModal').classList.add('open');$('groupManagementModal').setAttribute('aria-hidden','false');
}
function closeGroupManagement(){$('groupManagementModal')?.classList.remove('open');$('groupManagementModal')?.setAttribute('aria-hidden','true')}
async function openStarredMessages(){
 ensureGroupModal();const body=$('starredBody');body.replaceChildren();
 const {data,error}=await supabaseClient.from('user_message_stars').select('message_id,conversation_id,created_at,chat_messages(id,content,created_at,sender_id,deleted_at)').eq('user_id',state.user.id).eq('conversation_id',state.active.id).order('created_at',{ascending:false}).limit(100);
 if(error){toast('تعذر تحميل الرسائل المميزة');return}
 if(!data?.length){const p=document.createElement('p');p.className='group-management-muted';p.textContent='لا توجد رسائل مميزة بنجمة في هذه المحادثة.';body.append(p)}
 (data||[]).forEach(item=>{const b=document.createElement('button');b.className='starred-message-row';b.type='button';const m=item.chat_messages;b.innerHTML='<strong>★ '+esc(m?.sender_id===state.user.id?'أنت':'عضو')+'</strong><span></span><small></small>';b.querySelector('span').textContent=m?.deleted_at?'تم حذف الرسالة':m?.content||'مرفق';b.querySelector('small').textContent=m?.created_at?new Date(m.created_at).toLocaleString('ar-SA'):'';b.onclick=()=>{$('starredModal').classList.remove('open');jumpToMessage(item.message_id)};body.append(b)});
 $('starredModal').classList.add('open');$('starredModal').setAttribute('aria-hidden','false');
}
async function toggleMessageStar(messageId,star=true){
 const userId=state.user?.id,m=state.messages.find(x=>x.id===messageId);
 if(!userId||!m?.conversation_id){toast('تعذر تحديد الرسالة أو الحساب الحالي');return false}
 state.starredMessageIds ||= new Set();
 try{
  const query=supabaseClient.from('user_message_stars');
  const result=star
   ?await query.upsert({user_id:userId,conversation_id:m.conversation_id,message_id:m.id},{onConflict:'user_id,message_id'})
   :await query.delete().eq('user_id',userId).eq('message_id',m.id);
  if(result?.error)throw result.error;
  if(star)state.starredMessageIds.add(messageId);else state.starredMessageIds.delete(messageId);
  return true;
 }catch(error){console.error('Message star update failed:',error);toast(error?.message||'تعذر تحديث تمييز الرسالة. حاول مجدداً');return false}
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
async function starSelectedMessages(){const ids=[...state.selectedMessageIds];let succeeded=0;for(const id of ids){if(await toggleMessageStar(id,true))succeeded++}toast('تم تمييز '+succeeded+' من '+ids.length+' رسالة');setMessageSelectionMode(false)}
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
function applyGroupComposerOnOpen(){
 const role=groupRole(),blocked=state.active?.type==='group'&&state.groupSettings?.only_admins_can_send&&!['owner','admin'].includes(role),channelBlocked=state.active?.type==='channel'&&!['owner','admin'].includes(role);
 $('messageInput').disabled=blocked||channelBlocked;$('sendBtn').disabled=blocked||channelBlocked;
 $('messageInput').placeholder=blocked?'الإرسال متاح لمشرفي المجموعة فقط':channelBlocked?'النشر متاح لمشرفي القناة فقط':'اكتب رسالتك هنا…';
}
function groupMenuActions(){
 $('groupInfoBtn').onclick=openGroupManagement;
 $('selectMessagesBtn').onclick=()=>setMessageSelectionMode(!state.selectionMode);
 $('muteNotificationsBtn').onclick=toggleMuteConversation;$('notificationSettingsBtn').onclick=setNotificationTone;
 $('disappearingBtn').onclick=()=>openGroupManagement();
 $('starredMessagesBtn').onclick=openStarredMessages;
 $('groupThemeBtn').onclick=()=>openGroupManagement();
 $('favoriteConversationBtn').onclick=toggleFavoriteConversation;
 $('addToCustomListBtn').onclick=openCustomListPicker;
 $('exportConversationBtn').onclick=exportActiveConversation;
 $('closeConversationBtn').onclick=closeActiveConversation;
 $('clearConversationBtn').onclick=clearActiveConversation;
 $('leaveGroupBtn').onclick=leaveActiveGroup;
}
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

</script>
