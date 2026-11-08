/* Extracted from current main 66e4c2a7efd980e622768260da2eccf2baf868c7; classic-script execution retained. */
'use strict';

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
  action.onclick=()=>window.dispatchEvent(new CustomEvent('bizmind:open-conversation',{detail:{conversation:channel}}));actions.append(action);
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

function openGroupModal(){
 if(!state.user)return toast('سجّل الدخول أولاً');
 groupSelectedProfiles.clear();$('groupNameInput').value='';$('groupMemberSearch').value='';$('groupModal').classList.add('open');renderGroupSelection();loadGroupCandidates('');setTimeout(()=>$('groupNameInput').focus(),60);
}

function closeGroupModal(){$('groupModal').classList.remove('open');}

// Internal feature contract: conversation lifecycle requests channel-list refreshes via an event.
window.addEventListener('bizmind:render-my-channels',()=>renderMyChannels());
