/* Extracted from current main 66e4c2a7efd980e622768260da2eccf2baf868c7; classic-script execution retained. */
'use strict';

async function loadGroupCandidates(term=''){
 const request=++groupSearchRequest;const results=$('groupMemberResults');
 results.innerHTML='<div class="group-hint" style="padding:12px">جارٍ البحث عن الأعضاء…</div>';
 try{
  let people=[];
  if(!term){
   const {data,error}=await supabaseClient.from('profiles').select('id,username,display_name,avatar_url').neq('id',state.user.id).order('display_name',{ascending:true}).limit(60);
   if(error)throw error;people=data||[];
  }else{
   const pattern='%'+term.replace(/[\\%_]/g,'\\$&')+'%';
   const [byName,byHandle]=await Promise.all([
    supabaseClient.from('profiles').select('id,username,display_name,avatar_url').neq('id',state.user.id).ilike('display_name',pattern).limit(40),
    supabaseClient.from('profiles').select('id,username,display_name,avatar_url').neq('id',state.user.id).ilike('username',pattern).limit(40)
   ]);
   if(byName.error)throw byName.error;if(byHandle.error)throw byHandle.error;
   const merged=new Map();[...(byName.data||[]),...(byHandle.data||[])].forEach(p=>merged.set(p.id,p));people=[...merged.values()];
  }
  if(request!==groupSearchRequest)return;
  renderGroupCandidates(people);
 }catch(error){if(request===groupSearchRequest){results.innerHTML='<div class="group-hint" style="padding:12px">تعذر تحميل الأعضاء. حاول تحديث البحث.</div>';console.error('Group member search failed:',error)}}
}

function renderGroupCandidates(people){
 const results=$('groupMemberResults');results.replaceChildren();
 if(!people.length){const empty=document.createElement('div');empty.className='group-hint';empty.style.padding='12px';empty.textContent='لا توجد نتائج مطابقة.';results.append(empty);return}
 people.forEach(profile=>{
  const selected=groupSelectedProfiles.has(profile.id);const button=document.createElement('button');button.type='button';button.className='group-person'+(selected?' selected':'');
  const avatar=document.createElement('div');avatar.className='avatar';renderAvatar(avatar,profile);
  const copy=document.createElement('div');copy.className='group-person-copy';
  const name=document.createElement('strong');name.textContent=profile.display_name||profile.username||'مستخدم';
  const handle=document.createElement('small');handle.textContent='@'+(profile.username||'user');copy.append(name,handle);
  const check=document.createElement('span');check.className='group-person-check';check.innerHTML=selected?'<i class="ph ph-check"></i>':'';
  button.append(avatar,copy,check);button.onclick=()=>{if(groupSelectedProfiles.has(profile.id))groupSelectedProfiles.delete(profile.id);else groupSelectedProfiles.set(profile.id,profile);renderGroupCandidates(people);renderGroupSelection()};results.append(button);
 });
}

function renderGroupSelection(){
 const selected=$('groupSelectedMembers');selected.replaceChildren();
 groupSelectedProfiles.forEach(profile=>{
  const chip=document.createElement('span');chip.className='group-chip';chip.append(document.createTextNode(profile.display_name||profile.username||'عضو'));
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','إزالة '+(profile.display_name||profile.username));remove.onclick=()=>{groupSelectedProfiles.delete(profile.id);renderGroupSelection();loadGroupCandidates($('groupMemberSearch').value.trim())};chip.append(remove);selected.append(chip);
 });
 const count=groupSelectedProfiles.size;$('groupMemberCount').textContent=count?'تم اختيار '+count+' من الأعضاء، وستكون أنت مشرف المجموعة.':'لم يتم اختيار أعضاء بعد. اختر عضواً واحداً على الأقل.';
 $('createGroupBtn').disabled=count===0||!$('groupNameInput').value.trim();
}

function groupRole(conversation=state.active){return (conversation?.members||[]).find(m=>m.user_id===state.user?.id)?.role||'member'}

function isGroupAdmin(conversation=state.active){return ['owner','admin'].includes(groupRole(conversation))||!!state.isTeamAdmin}

function ensureGroupModal(){
 if($('groupManagementModal'))return;
 document.body.insertAdjacentHTML('beforeend',`
 <div id="groupManagementModal" class="group-management-modal" aria-hidden="true"><section class="group-management-dialog" role="dialog" aria-modal="true" aria-labelledby="groupManagementTitle">
 <header class="group-management-head"><div><h2 id="groupManagementTitle">معلومات المجموعة</h2><p id="groupManagementSubtitle"></p></div><button id="groupManagementClose" class="iconbtn" type="button" aria-label="إغلاق"><i class="ph ph-x"></i></button></header>
 <div id="groupManagementBody" class="group-management-body"></div></section></div>
 <div id="starredModal" class="starred-modal" aria-hidden="true"><section class="starred-dialog" role="dialog" aria-modal="true"><header class="starred-head"><h2>الرسائل المميزة بنجمة</h2><button id="starredClose" class="iconbtn" type="button"><i class="ph ph-x"></i></button></header><div id="starredBody" class="starred-body"></div></section></div>
 <div id="customListModal" class="custom-list-modal" aria-hidden="true"><section class="custom-list-dialog" role="dialog" aria-modal="true"><header class="custom-list-head"><h2>إضافة إلى القوائم المخصصة</h2><button id="customListClose" class="iconbtn" type="button"><i class="ph ph-x"></i></button></header><div id="customListBody" class="custom-list-body"></div></section></div>
 <div id="messageSelectionToolbar" class="message-selection-toolbar"><strong id="messageSelectionCount">0 محددة</strong><div class="group-management-row"><button id="starSelectedMessages" type="button">تمييز بنجمة</button><button id="exportSelectedMessages" type="button">تصدير المحدد</button><button id="cancelMessageSelection" type="button">إلغاء</button></div></div>`);
 $('groupManagementClose').onclick=closeGroupManagement;$('groupManagementModal').addEventListener('click',e=>{if(e.target===$('groupManagementModal'))closeGroupManagement()});
 $('starredClose').onclick=()=>{$('starredModal').classList.remove('open');$('starredModal').setAttribute('aria-hidden','true')};$('customListClose').onclick=()=>{$('customListModal').classList.remove('open');$('customListModal').setAttribute('aria-hidden','true')};
 $('cancelMessageSelection').onclick=()=>setMessageSelectionMode(false);
 $('starSelectedMessages').onclick=starSelectedMessages;$('exportSelectedMessages').onclick=exportSelectedMessages;
}

async function loadStarredMessageIds(conversationId){if(!state.user||!conversationId)return;const {data,error}=await supabaseClient.from('user_message_stars').select('message_id').eq('user_id',state.user.id).eq('conversation_id',conversationId);if(error){console.warn('Starred message state unavailable:',error.message);return}state.starredMessageIds=new Set((data||[]).map(x=>x.message_id))}

async function loadGroupSettings(conversationId){
 if(!conversationId||state.active?.id!==conversationId)return;
 const {data,error}=await supabaseClient.from('conversation_group_settings').select('*').eq('conversation_id',conversationId).maybeSingle();
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
