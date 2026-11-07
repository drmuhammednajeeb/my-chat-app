'use strict';

/* BizmindMakers Chat Pro — auth feature module.
 * Transitional classic-script module; shared state remains owned by app.js.
 * Extracted function bodies are preserved verbatim.
 */

function setAuthMode(mode){state.authMode=mode;const signup=mode==='signup';$('signupFields').classList.toggle('hidden',!signup);$('loginTab').classList.toggle('active',!signup);$('signupTab').classList.toggle('active',signup);$('authTitle').textContent=signup?'أنشئ حسابك':'مرحباً بعودتك';$('authSub').textContent=signup?'التسجيل متاح للأعضاء الذين لديهم دعوة ورقم عضوية رسمي فقط.':'سجّل الدخول لمتابعة محادثاتك.';$('authSubmit').textContent=signup?'إنشاء الحساب':'تسجيل الدخول';$('password').autocomplete=signup?'new-password':'current-password';$('authError').classList.add('hidden');$('resendSignupVerification')?.classList.add('hidden');$('resetPasswordWrap').classList.toggle('hidden',signup);updateResetCooldown()}

function authError(msg){$('authStatus').hidden=true;$('authError').textContent=msg;$('authError').classList.remove('hidden')}

function authProgress(msg){$('authError').classList.add('hidden');$('authStatus').textContent=msg;$('authStatus').hidden=false}

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
 if(membershipState?.membership_status!=='active'||membershipState?.membership_number_verified!==true||!/^971001[0-9]{6}$/.test(membershipState?.membership_number||'')){await supabaseClient.auth.signOut({scope:'local'});authError('هذه العضوية غير نشطة أو غير معتمدة. تواصل مع مسؤول المنصة.');return false;}
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
 setSidebarView('chats');
 // Restore the latest chat immediately; do not wait for notifications, team stats, or the user directory.
 if(conversationsLoaded&&state.conversations.length){
  const latest=(invitedChannelId&&state.conversations.find(c=>c.id===invitedChannelId))||state.conversations[0];
  await openConversation(latest);
  if(lifecycleVersion!==authLifecycleVersion)return false;
 }else if(conversationsLoaded){
  $('chatTitle').textContent='لا توجد محادثات بعد';$('chatSub').textContent='ابدأ محادثة من دليل المستخدمين';$('messages').innerHTML='<div class="welcome"><div class="welcome-icon"><i class="ph ph-chat-teardrop-text"></i></div><h2>لا توجد محادثات بعد</h2><p>اختر مستخدماً من دليل المستخدمين لبدء محادثة جديدة.</p></div>';
 }
 startPresence();return true;
}
