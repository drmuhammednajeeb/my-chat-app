'use strict';

/* BizmindMakers Chat Pro — admin feature module.
 * Transitional classic-script module; shared state remains owned by app.js.
 * Extracted function bodies are preserved verbatim.
 */

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
