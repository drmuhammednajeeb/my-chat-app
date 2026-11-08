/* Extracted from current main 66e4c2a7efd980e622768260da2eccf2baf868c7; classic-script execution retained. */
'use strict';

function groupRole(conversation=state.active){return (conversation?.members||[]).find(m=>m.user_id===state.user?.id)?.role||'member'}

function isGroupAdmin(conversation=state.active){return ['owner','admin'].includes(groupRole(conversation))||!!state.isTeamAdmin}

const SELF_CHAT_MARKER='bizmindmakers:self-chat:v1';

function isSelfConversation(conversation){return !!conversation&&conversation.type==='group'&&conversation.created_by===state.user?.id&&conversation.description===SELF_CHAT_MARKER}

function otherMember(conv){return (conv.members||[]).find(m=>m.user_id!==state.user.id)?.profile}

function convName(c){if(isSelfConversation(c))return (state.profile?.display_name||state.profile?.username||'أنا')+' (أنا)';if(c.type==='group')return c.title||'مجموعة جديدة';if(c.type==='channel')return c.title||'قناة بدون اسم';const p=otherMember(c);return p?.display_name||p?.username||'محادثة خاصة'}

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



function scheduleMessagesBottom(area=$('messages'),behavior='auto'){
 if(!area)return;
 if(messagesScrollFrame)cancelAnimationFrame(messagesScrollFrame);
 messagesScrollFrame=requestAnimationFrame(()=>{messagesScrollFrame=0;if(area.isConnected)area.scrollTo({top:area.scrollHeight,behavior})});
}

function persistPerfSamples(){try{localStorage.setItem(PERF_STORAGE_KEY,JSON.stringify(perfSamples))}catch(_e){}perfPersistTimer=null}

function recordPerf(metric,duration,details={}){
 const sample={metric,ms:Math.round(Math.max(0,Number(duration)||0)*10)/10,at:Date.now(),...details};
 perfSamples.push(sample);if(perfSamples.length>80)perfSamples.splice(0,perfSamples.length-80);
 // Batch storage writes so instrumentation does not add synchronous I/O to message rendering.
 if(perfPersistTimer)clearTimeout(perfPersistTimer);
 perfPersistTimer=setTimeout(persistPerfSamples,1200);
 if(!$('diagnosticsPanel')?.hidden)updateDiagnostics();
}

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

function diagLog(event,details={}){const d=state.diagnostics;d.events.push({at:new Date().toLocaleTimeString('en-GB'),event,details});if(d.events.length>18)d.events.shift();updateDiagnostics()}

function updateDiagnostics(){const panel=$('diagnosticsPanel');if(!panel||panel.hidden)return;const input=$('messageInput'),wrap=document.querySelector('.composer-wrap'),rect=input?.getBoundingClientRect();let hit=null;if(rect&&rect.width&&rect.height){const el=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);hit=el?{tag:el.tagName,id:el.id||'',className:typeof el.className==='string'?el.className:'',isComposer:!!wrap?.contains(el)}:null}state.diagnostics.lastHitTest={inputRect:rect?{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)}:null,hit,computed:input?{display:getComputedStyle(input).display,visibility:getComputedStyle(input).visibility,pointerEvents:getComputedStyle(input).pointerEvents,zIndex:getComputedStyle(input).zIndex}:null};const active=state.active?.id||'none';const out={activeConversation:active==='none'?'none':active.slice(0,8)+'…',userSession:!!state.user,loadedMessages:state.messages?.length||0,renderedMessageNodes:$('messages')?.querySelectorAll('.message').length||0,messageIds:state.messageIds?.size||0,composer:{disabled:!!input?.disabled,readOnly:!!input?.readOnly,valueLength:input?.value?.length||0,focused:document.activeElement===input},composerHitTest:state.diagnostics.lastHitTest,composerInteractions:state.diagnostics.composerInteractions,realtime:{status:state.realtimeStatus,lastEvent:state.diagnostics.lastRealtimeEvent,at:state.diagnostics.lastRealtimeAt},polling:{active:!!state.messagePollTimer,busy:state.messagePollBusy,generation:state.messagePollGeneration,lastAt:state.diagnostics.lastPollAt},fetch:{at:state.diagnostics.lastFetchAt,count:state.diagnostics.lastFetchCount,error:state.diagnostics.lastFetchError},render:{at:state.diagnostics.lastRenderAt,error:state.diagnostics.lastRenderError},lastComposerChange:state.diagnostics.lastComposerChange,performance:performanceSummary(),events:state.diagnostics.events};$('diagnosticsOutput').textContent=JSON.stringify(out,null,2)}

function recordComposerInteraction(event){if($('diagnosticsPanel')?.hidden)return;const wrap=document.querySelector('.composer-wrap'),target=event.target;if(!wrap?.contains(target))return;const item={event:event.type,target:target?.id||target?.tagName||'unknown',at:new Date().toLocaleTimeString('en-GB'),activeElement:document.activeElement?.id||document.activeElement?.tagName||'unknown',key:event.type==='keydown'?event.key:undefined};state.diagnostics.composerInteractions.push(item);if(state.diagnostics.composerInteractions.length>20)state.diagnostics.composerInteractions.shift();updateDiagnostics()}
