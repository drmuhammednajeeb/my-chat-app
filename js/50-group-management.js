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


async function loadTeamDashboard(silent=false){
 if(!state.user)return false;
 state.teamLoading=true;if(state.sidebarView==='team'&&!state.teamData)showTeamDashboardSkeleton();
 try{const {data,error}=await supabaseClient.rpc('get_team_dashboard_stats');if(error)throw error;state.isTeamAdmin=true;state.teamData=data||{};$('teamTab').classList.remove('hidden');if(state.sidebarView==='team')renderTeamDashboard();return true}
 catch(error){state.isTeamAdmin=false;$('teamTab').classList.add('hidden');if(state.sidebarView==='team'&&!state.teamData){$('teamKpis').innerHTML='<div class="team-empty">تعذر تحميل لوحة الفريق. حدّث الصفحة أو أعد المحاولة.</div>';$('teamDashboard').setAttribute('aria-busy','false')}if(!silent&&error?.code!=='42501')toast('تعذر تحميل لوحة إدارة الفريق');console.warn('Team dashboard access/load:',error?.message||error);return false}
 finally{state.teamLoading=false}
}
function teamDate(value){if(!value)return 'لم يسجل نشاط بعد';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('ar-SA',{day:'numeric',month:'short'})}
function teamIsActive(user){return !!user.last_active_at&&Date.now()-new Date(user.last_active_at).getTime()<=7*86400000}
function renderTeamDashboard(){
 if(!state.isTeamAdmin||!state.teamData)return;$('teamDashboard').setAttribute('aria-busy','false');const d=state.teamData;
 const kpis=[['الأعضاء المسجلون',d.registered_count,'ph-users-three','حساب مسجل'],['نشطون',d.active_7d,'ph-user-check','أرسلوا رسالة خلال 7 أيام'],['غير نشطين',d.inactive_7d,'ph-user-minus','لم يرسلوا خلال 7 أيام'],['المجموعات',d.groups_count,'ph-users-four','حد المجموعة 200 عضو'],['إجمالي الرسائل',d.messages_total,'ph-chats-circle','كل الرسائل المحفوظة']];
 $('teamKpis').replaceChildren();kpis.forEach(([label,value,icon,hint])=>{const card=document.createElement('article');card.className='team-kpi';const top=document.createElement('div');top.className='team-kpi-top';const name=document.createElement('span');name.textContent=label;const symbol=document.createElement('span');symbol.className='team-kpi-icon';symbol.innerHTML='<i class="ph '+icon+'"></i>';top.append(name,symbol);const num=document.createElement('strong');num.textContent=Number(value||0).toLocaleString('en-US');const small=document.createElement('small');small.textContent=hint;card.append(top,num,small);$('teamKpis').append(card)});
 $('teamGeneratedAt').textContent='آخر تحديث: '+new Date(d.generated_at||Date.now()).toLocaleString('ar-SA');
 const daily=d.daily_messages||[],max=Math.max(1,...daily.map(x=>Number(x.count||0)));$('teamDailyChart').replaceChildren();
 daily.forEach(item=>{const day=document.createElement('div');day.className='team-day';const count=document.createElement('strong');count.textContent=Number(item.count||0).toLocaleString('en-US');const wrap=document.createElement('div');wrap.className='team-day-bar-wrap';const bar=document.createElement('span');bar.className='team-day-bar';bar.style.height=Math.max(3,Number(item.count||0)/max*94)+'px';bar.title=Number(item.count||0)+' رسالة';wrap.append(bar);const label=document.createElement('small');label.textContent=new Date(item.day+'T12:00:00').toLocaleDateString('ar-SA',{weekday:'short'});day.append(count,wrap,label);$('teamDailyChart').append(day)});
 $('teamMessageTotals').replaceChildren();[['آخر 7 أيام',d.messages_7d],['آخر 30 يوماً',d.messages_30d],['القنوات',d.channels_count]].forEach(([label,value])=>{const span=document.createElement('span');span.textContent=label+' · ';const b=document.createElement('b');b.textContent=Number(value||0).toLocaleString('en-US');span.append(b);$('teamMessageTotals').append(span)});
 renderTeamGroups();renderTeamGroupOptions();renderTeamMembers();
}
function renderTeamGroups(){
 const list=$('teamGroupsList');list.replaceChildren();const groups=state.teamData?.groups||[],term=state.teamSearch;
 const filtered=groups.filter(g=>(g.title||'').toLocaleLowerCase('ar').includes(term));
 if(!filtered.length){const empty=document.createElement('div');empty.className='team-empty';empty.textContent=groups.length?'لا توجد مجموعات تطابق البحث.':'لا توجد مجموعات حتى الآن. أنشئ مجموعة من قسم المحادثات.';list.append(empty);return}
 filtered.forEach(g=>{const button=document.createElement('button');button.type='button';button.className='team-group-item'+(state.teamSelectedGroupId===g.id?' selected':'');const line=document.createElement('div');line.className='team-group-line';const title=document.createElement('strong');title.textContent=g.title||'مجموعة بدون اسم';const count=document.createElement('small');count.textContent=Number(g.member_count||0)+' / 200 عضو';line.append(title,count);const progress=document.createElement('div');progress.className='team-progress';const fill=document.createElement('span');fill.style.width=Math.min(100,Number(g.member_count||0)/200*100)+'%';progress.append(fill);const foot=document.createElement('div');foot.className='team-group-foot';const created=document.createElement('span');created.textContent='تأسست '+teamDate(g.created_at);const last=document.createElement('span');last.textContent=g.last_message_at?'آخر تفاعل '+teamDate(g.last_message_at):'لا توجد رسائل';foot.append(created,last);button.append(line,progress,foot);button.onclick=()=>{state.teamSelectedGroupId=g.id;renderTeamGroups();renderTeamGroupOptions();loadTeamMembers()};list.append(button)});
}
function renderTeamGroupOptions(){
 const select=$('teamGroupSelect'),old=state.teamSelectedGroupId;select.replaceChildren(new Option('اختر مجموعة',''));
 (state.teamData?.groups||[]).forEach(g=>select.append(new Option((g.title||'مجموعة')+' ('+Number(g.member_count||0)+'/200)',g.id)));
 if((state.teamData?.groups||[]).some(g=>g.id===old))select.value=old;else{state.teamSelectedGroupId='';select.value=''}
}
async function loadTeamMembers(){
 const groupId=state.teamSelectedGroupId;if(!groupId){state.teamMembers=[];state.teamMembersLoadedFor='';renderTeamMembers();return}
 state.teamMembersLoading=true;showListSkeleton($('teamMembersList'),4);
 const {data,error}=await supabaseClient.from('conversation_members').select('conversation_id,user_id,role,joined_at').eq('conversation_id',groupId).order('joined_at',{ascending:true});state.teamMembersLoading=false;
 if(error){console.error('Team memberships:',error);state.teamMembersLoadedFor=groupId;$('teamMembersList').innerHTML='<div class="team-empty">تعذر تحميل عضويات المجموعة.</div>';return}
 state.teamMembersLoadedFor=groupId;
 const userMap=new Map((state.teamData?.users||[]).map(u=>[u.id,u]));state.teamMembers=(data||[]).map(m=>({...m,profile:userMap.get(m.user_id)||{id:m.user_id,display_name:'عضو غير معروف',username:''}}));renderTeamMembers();
}
function renderTeamMembers(){
 const list=$('teamMembersList');if(!list)return;const group=(state.teamData?.groups||[]).find(g=>g.id===state.teamSelectedGroupId);
 if(!group){list.replaceChildren();const empty=document.createElement('div');empty.className='team-empty';empty.textContent='اختر مجموعة لعرض أعضائها وإدارة عضوياتهم.';list.append(empty);$('teamAddMemberSelect').replaceChildren(new Option('اختر عضواً لإضافته',''));$('teamAddMemberBtn').disabled=true;return}
 if(state.teamMembersLoadedFor!==state.teamSelectedGroupId&&!state.teamMembersLoading){loadTeamMembers();return}
 const term=($('teamMemberSearch')?.value||'').trim().toLocaleLowerCase('ar'),filter=$('teamActivityFilter')?.value||'all';
 const members=state.teamMembers.filter(m=>{const p=m.profile||{},u=(state.teamData?.users||[]).find(x=>x.id===m.user_id)||{},active=teamIsActive(u),matches=((p.display_name||'')+' '+(p.username||'')).toLocaleLowerCase('ar').includes(term);return matches&&(filter==='all'||(filter==='active'&&active)||(filter==='inactive'&&!active))});
 list.replaceChildren();if(!members.length){const empty=document.createElement('div');empty.className='team-empty';empty.textContent='لا يوجد أعضاء يطابقون عوامل البحث والتصفية.';list.append(empty)}
 members.forEach(m=>{const p=m.profile||{},u=(state.teamData?.users||[]).find(x=>x.id===m.user_id)||{},active=teamIsActive(u);const row=document.createElement('article');row.className='team-member-row';const avatar=document.createElement('div');avatar.className='team-member-avatar';avatar.textContent=initials(p.display_name||p.username||'U');const copy=document.createElement('div');copy.className='team-member-copy';const name=document.createElement('strong');name.textContent=p.display_name||p.username||'عضو';const sub=document.createElement('small');sub.textContent=(p.username?'@'+p.username+' · ':'')+(m.role==='owner'?'مالك المجموعة':m.role==='admin'?'مشرف':'عضو')+' · آخر نشاط: '+teamDate(u.last_active_at);copy.append(name,sub);const status=document.createElement('span');status.className='team-status'+(active?' active':'');status.textContent=active?'نشط':'غير نشط';const actions=document.createElement('div');actions.className='team-member-actions';
  if(m.role!=='owner'){const role=document.createElement('button');role.type='button';role.textContent=m.role==='admin'?'إزالة الإشراف':'تعيين مشرف';role.onclick=()=>changeTeamMemberRole(m,m.role==='admin'?'member':'admin');actions.append(role);const remove=document.createElement('button');remove.type='button';remove.className='remove';remove.textContent='إزالة';remove.onclick=()=>removeTeamMember(m);actions.append(remove)}else{const owner=document.createElement('span');owner.className='team-status active';owner.textContent='مالك';actions.append(owner)}
  row.append(avatar,copy,status,actions);list.append(row)});
 const add=$('teamAddMemberSelect');add.replaceChildren(new Option('اختر عضواً لإضافته',''));const current=new Set(state.teamMembers.map(m=>m.user_id));(state.teamData?.users||[]).filter(u=>!current.has(u.id)).sort((a,b)=>(a.display_name||'').localeCompare(b.display_name||'','ar')).forEach(u=>add.append(new Option((u.display_name||u.username||'عضو')+(u.username?' · @'+u.username:''),u.id)));
 const full=Number(group.member_count||0)>=200;$('teamAddMemberBtn').disabled=full||!add.value;$('teamAddMemberBtn').title=full?'المجموعة وصلت إلى 200 عضو':'';
}
async function refreshTeamDashboard(){const ok=await loadTeamDashboard();if(ok&&state.teamSelectedGroupId)await loadTeamMembers()}
async function changeTeamMemberRole(member,role){if(!['member','admin'].includes(role))return;const {error}=await supabaseClient.from('conversation_members').update({role}).eq('conversation_id',member.conversation_id).eq('user_id',member.user_id);if(error){console.error(error);toast('تعذر تحديث صلاحية العضو');return}toast(role==='admin'?'تم تعيين العضو مشرفاً':'تم إلغاء صلاحية الإشراف');await refreshTeamDashboard()}
async function removeTeamMember(member){const name=member.profile?.display_name||member.profile?.username||'هذا العضو';if(!confirm('هل تريد إزالة '+name+' من المجموعة؟'))return;const {error}=await supabaseClient.from('conversation_members').delete().eq('conversation_id',member.conversation_id).eq('user_id',member.user_id);if(error){console.error(error);toast('تعذر إزالة العضو');return}toast('تمت إزالة العضو من المجموعة');await refreshTeamDashboard()}
async function addTeamMember(){const groupId=state.teamSelectedGroupId,userId=$('teamAddMemberSelect').value;if(!groupId||!userId)return;const group=(state.teamData?.groups||[]).find(g=>g.id===groupId);if(Number(group?.member_count||0)>=200){toast('المجموعة وصلت إلى الحد الأقصى: 200 عضو');return}$('teamAddMemberBtn').disabled=true;const {error}=await supabaseClient.from('conversation_members').insert({conversation_id:groupId,user_id:userId,role:'member'});if(error){console.error(error);toast(error.code==='23514'?'المجموعة وصلت إلى الحد الأقصى: 200 عضو':error.message||'تعذر إضافة العضو');$('teamAddMemberBtn').disabled=false;return}toast('تمت إضافة العضو إلى المجموعة');await refreshTeamDashboard()}
$('teamRefreshBtn').onclick=refreshTeamDashboard;$('teamGroupSearch').oninput=()=>{state.teamSearch=$('teamGroupSearch').value.trim().toLocaleLowerCase('ar');renderTeamGroups()};$('teamBackBtn').onclick=()=>{setSidebarView('chats');$('sidebar').classList.remove('closed')};$('teamGroupSelect').onchange=()=>{state.teamSelectedGroupId=$('teamGroupSelect').value;state.teamMembers=[];state.teamMembersLoadedFor='';renderTeamGroups();loadTeamMembers()};$('teamMemberSearch').oninput=renderTeamMembers;$('teamActivityFilter').onchange=renderTeamMembers;$('teamAddMemberSelect').onchange=()=>{const g=(state.teamData?.groups||[]).find(x=>x.id===state.teamSelectedGroupId);$('teamAddMemberBtn').disabled=!$('teamAddMemberSelect').value||Number(g?.member_count||0)>=200};$('teamAddMemberBtn').onclick=addTeamMember;
function renderMyChannels(){
 const list=$('directoryList');if(!list||state.sidebarView!=='channels')return;
 if(state.conversationsLoading&&!state.conversations.length){showListSkeleton(list,4);return}
 list.replaceChildren();
 const q=$('search').value.trim().toLocaleLowerCase('ar');
 const rows=(state.conversations||[]).filter(c=>c.type==='channel'&&((c.title||'')+' '+(c.description||'')).toLocaleLowerCase('ar').includes(q));
 if(!rows.length){const empty=document.createElement('div');empty.className='channel-empty';empty.textContent=q?'لا توجد قناة تطابق البحث.':'لا توجد قنوات في مساحتك بعد. أنشئ قناة خاصة أو افتح رابط دعوة للانضمام إلى قناة.';list.append(empty);return}
 rows.forEach(channel=>{
  const card=document.createElement('article');card.className='channel-card';
  const top=document.createElement('div');top.className='channel-card-top';
  const icon=document.createElement('div');icon.className='channel-card-icon';icon.innerHTML='<i class="ph ph-lock-key"></i>';
  const copy=document.createElement('div');copy.className='channel-card-copy';
  const title=document.createElement('strong');title.textContent=channel.title||'قناة بدون اسم';
  const mine=channel.created_by===state.user.id||(channel.members||[]).some(m=>m.user_id===state.user.id&&m.role==='owner');
  const meta=document.createElement('small');meta.textContent=mine?'قناتك الخاصة · أنت المالك':'قناة مشتركة معك عبر دعوة';
  copy.append(title,meta);top.append(icon,copy);card.append(top);
  if(channel.description){const desc=document.createElement('p');desc.textContent=channel.description;card.append(desc)}
  const actions=document.createElement('div');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;align-items:center';
  const action=document.createElement('button');action.type='button';action.textContent='فتح القناة';
  action.onclick=()=>openConversation(channel);actions.append(action);
  const myMembership=(channel.members||[]).find(m=>m.user_id===state.user.id),canInvite=mine||['owner','admin'].includes(myMembership?.role);
  if(canInvite){const invite=document.createElement('button');invite.type='button';invite.className='secondary';invite.textContent='نسخ رابط دعوة';invite.onclick=()=>shareChannelInvite(channel,invite);actions.append(invite)}
  const memberCount=document.createElement('small');memberCount.style.cssText='color:#667781;align-self:center';memberCount.textContent=(channel.members||[]).length+' أعضاء';actions.append(memberCount);
  card.append(actions);list.append(card);
 });
}
function openChannelModal(){
 if(!state.user)return toast('سجّل الدخول أولاً');
 $('channelNameInput').value='';$('channelDescriptionInput').value='';$('channelModal').classList.add('open');$('createChannelBtn').disabled=true;setTimeout(()=>$('channelNameInput').focus(),60);
}
function closeChannelModal(){$('channelModal').classList.remove('open')}
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
async function shareChannelInvite(channel,button){
 if(!channel||channel.type!=='channel')return;
 if(button)button.disabled=true;
 try{
  const {data,error}=await supabaseClient.rpc('create_channel_invite',{p_conversation_id:channel.id});if(error)throw error;
  const url=new URL(location.href);url.searchParams.set('invite',data);url.hash='';const link=url.toString();
  try{await navigator.clipboard.writeText(link);toast('تم نسخ رابط الدعوة. صالح لمدة 7 أيام، وإنشاء رابط جديد يلغي السابق.')}
  catch(_e){prompt('انسخ رابط الدعوة الخاص بالقناة:',link)}
 }catch(error){console.error('Channel invite creation failed:',error);toast(error.message||'تعذر إنشاء رابط الدعوة')}
 finally{if(button)button.disabled=false}
}
$('shareChannelBtn').onclick=()=>shareChannelInvite(state.active,$('shareChannelBtn'));
function openGroupModal(){
 if(!state.user)return toast('سجّل الدخول أولاً');
 groupSelectedProfiles.clear();$('groupNameInput').value='';$('groupMemberSearch').value='';$('groupModal').classList.add('open');renderGroupSelection();loadGroupCandidates('');setTimeout(()=>$('groupNameInput').focus(),60);
}
function closeGroupModal(){$('groupModal').classList.remove('open');}
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

/* Swipe horizontally on a message to reply; vertical movement remains native scrolling. */
(()=>{
 const area=$('messages');if(!area)return;
 let gesture=null;
 const reset=()=>{
  if(!gesture)return;
  const row=gesture.row;
  row.classList.remove('swipe-ready');row.style.transform='';row.style.transition='';
  row.querySelector('.swipe-reply-indicator')?.remove();gesture=null;
 };
 area.addEventListener('pointerdown',event=>{
  if(!['touch','pen'].includes(event.pointerType)||event.button!==0)return;
  const row=event.target.closest('.message');
  if(!row||event.target.closest('button,a,img,input,textarea'))return;
  const id=row.dataset.messageId,message=(state.messages||[]).find(item=>item.id===id);
  if(!message||message.deleted_at)return;
  reset();gesture={row,id,startX:event.clientX,startY:event.clientY,dx:0,dy:0,locked:false,pointerId:event.pointerId};
 },{passive:true});
 document.addEventListener('pointermove',event=>{
  if(!gesture||event.pointerId!==gesture.pointerId)return;
  const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;
  gesture.dx=dx;gesture.dy=dy;
  if(!gesture.locked){
   if(Math.abs(dy)>Math.abs(dx)*1.15&&Math.abs(dy)>8){reset();return}
   if(Math.abs(dx)<9||Math.abs(dx)<Math.abs(dy)*1.2)return;
   gesture.locked=true;
   const indicator=document.createElement('span');indicator.className='swipe-reply-indicator';indicator.innerHTML='<i class="ph ph-arrow-bend-up-left"></i>';gesture.row.append(indicator);
  }
  const amount=Math.max(-76,Math.min(76,dx));
  gesture.row.style.transition='none';gesture.row.style.transform='translateX('+amount+'px)';
  const indicator=gesture.row.querySelector('.swipe-reply-indicator');
  if(indicator)indicator.classList.toggle('from-left',dx<0);
  gesture.row.classList.toggle('swipe-ready',Math.abs(dx)>=34);
 },{passive:true});
 const finish=()=>{
  if(!gesture)return;
  const {row,id,dx,dy,locked}=gesture;
  const shouldReply=locked&&Math.abs(dx)>=62&&Math.abs(dx)>Math.abs(dy)*1.25;
  reset();
  if(shouldReply){const message=(state.messages||[]).find(item=>item.id===id);if(message)beginReply(message)}
 };
 document.addEventListener('pointerup',finish,{passive:true});
 document.addEventListener('pointercancel',reset,{passive:true});
})();

$('stickerBtn').onclick=openChatStickerPicker;
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
function resetProfilePhotoSelection(){
 if(profilePhotoPreviewUrl){URL.revokeObjectURL(profilePhotoPreviewUrl);profilePhotoPreviewUrl=null}
 profilePendingPhoto=null;
 const approve=$('profilePhotoApprove'),cancel=$('profilePhotoCancel'),status=$('profilePhotoStatus'),input=$('avatarInput');
 if(approve){approve.classList.add('hidden');approve.disabled=false;approve.textContent='موافقة على الصورة'}
 if(cancel)cancel.classList.add('hidden');
 if(status){status.classList.add('hidden');status.textContent=''}
 if(input){input.value='';input.disabled=false}
}
function openProfileModal(profile,editable=false){
 if(!profile)return;const profileModalStarted=performance.now();profileModalEditable=!!editable;
 resetProfilePhotoSelection();
 $('profileModalTitle').textContent=editable?'ملفي الشخصي':'الملف الشخصي';$('profileModalSubtitle').textContent=editable?'إدارة بيانات حسابك':'معلومات المستخدم';
 $('profileDisplayName').value=profile.display_name||'';$('profileUsername').value=profile.username?'@'+profile.username:'';$('profileBio').value=profile.bio||'';
 renderAvatar($('profileModalAvatar'),profile,'profile-modal-avatar');$('profileDisplayName').readOnly=!editable;$('profileBio').readOnly=!editable;
 $('profilePhotoBtn').classList.toggle('hidden',!editable);$('profileSaveBtn').classList.toggle('hidden',!editable);$('profileReadOnlyNote').classList.toggle('hidden',editable);
 $('profileModal').classList.add('open');$('profileModal').setAttribute('aria-hidden','false');document.body.classList.add('profile-modal-open');recordPerf('profile_modal_open',performance.now()-profileModalStarted);
}
function closeProfileModal(){
 $('profileModal').classList.remove('open');$('profileModal').setAttribute('aria-hidden','true');document.body.classList.remove('profile-modal-open');
 if(!profilePhotoBusy)resetProfilePhotoSelection();
}
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

