/* Extracted from current main 66e4c2a7efd980e622768260da2eccf2baf868c7; classic-script execution retained. */
'use strict';

function renderAvatar(container,profile,className='directory-avatar'){
 container.replaceChildren();container.className=className;
 const fallback=document.createElement('span');fallback.textContent=initials(profile?.display_name||profile?.username);container.append(fallback);
 const raw=profile?.avatar_url;
 if(raw){try{const url=new URL(raw);if(url.protocol==='https:'){const img=document.createElement('img');img.src=url.href;img.alt='';img.loading=container.id==='myAvatar'?'eager':'lazy';img.decoding='async';img.fetchPriority=container.id==='myAvatar'?'high':'low';img.width=48;img.height=48;img.referrerPolicy='no-referrer';img.onerror=()=>container.replaceChildren(fallback);container.replaceChildren(img)}}catch(_e){}}
}

function renderChatAvatar(conversation){
 const target=$('chatAvatar');
 if(conversation?.type==='direct'){const profile=otherMember(conversation);renderAvatar(target,profile,'avatar');return}
 target.className='avatar';target.replaceChildren();
 const icon=document.createElement('i');icon.className='ph '+(isSelfConversation(conversation)?'ph-note-pencil':conversation?.type==='channel'?'ph-megaphone':'ph-users-three');target.append(icon);
}

async function prepareAvatarImage(file){
 if(typeof createImageBitmap!=='function')return {blob:file,type:file.type};
 const bitmap=await createImageBitmap(file);
 const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height));
 const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const context=canvas.getContext('2d',{alpha:false});
 if(!context){bitmap.close?.();return {blob:file,type:file.type}}
 context.drawImage(bitmap,0,0,width,height);bitmap.close?.();
 const webp=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.82));
 if(webp)return {blob:webp,type:'image/webp'};
 const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.84));
 return jpeg?{blob:jpeg,type:'image/jpeg'}:{blob:file,type:file.type};
}

async function withProfileTimeout(task,label,timeoutMs=20000){
 let timer;
 try{return await Promise.race([Promise.resolve(task),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' استغرق وقتاً أطول من المتوقع. تحقق من الاتصال ثم أعد المحاولة.')),timeoutMs)})])}
 finally{clearTimeout(timer)}
}

async function uploadProfileAvatar(file){
 if(!state.user||!file)throw new Error('اختر صورة أولاً');
 const allowed=['image/jpeg','image/png','image/webp'];
 if(!allowed.includes(file.type))throw new Error('اختر صورة بصيغة JPG أو PNG أو WebP');
 if(file.size>3*1024*1024)throw new Error('الحد الأقصى للصورة الشخصية 3 ميجابايت');
 const input=$('avatarInput');if(input)input.disabled=true;
 try{
  const prepared=await withProfileTimeout(prepareAvatarImage(file),'تجهيز الصورة',15000);
  const path=state.user.id+'/avatar';
  const uploadResult=await withProfileTimeout(supabaseClient.storage.from('avatars').upload(path,prepared.blob,{upsert:true,contentType:prepared.type,cacheControl:'31536000'}),'رفع الصورة',25000);
  if(uploadResult.error)throw uploadResult.error;
  const {data:publicData}=supabaseClient.storage.from('avatars').getPublicUrl(path);
  if(!publicData?.publicUrl)throw new Error('تعذر إنشاء رابط الصورة');
  const avatarUrl=publicData.publicUrl+'?v='+Date.now();
  const updateResult=await withProfileTimeout(supabaseClient.from('profiles').update({avatar_url:avatarUrl,updated_at:new Date().toISOString()}).eq('id',state.user.id).select('*').single(),'حفظ رابط الصورة',20000);
  if(updateResult.error)throw updateResult.error;
  const data=updateResult.data;if(!data)throw new Error('لم يتم استلام بيانات الملف الشخصي بعد الحفظ');
  state.profile=data;$('myName').textContent=data.display_name||data.username||'المستخدم';$('myHandle').textContent='@'+(data.username||'user')+' · '+(data.membership_number||'');
  renderAvatar($('myAvatar'),data,'avatar profile-avatar-edit');
  if($('profileModal')?.classList.contains('open'))renderAvatar($('profileModalAvatar'),data,'profile-modal-avatar');
  state.conversations.forEach(conv=>(conv.members||[]).forEach(member=>{if(member.user_id===data.id)member.profile={...(member.profile||{}),...data}}));
  if(state.active?.type==='direct'&&otherMember(state.active)?.id===state.user.id)renderChatAvatar(state.active);
  toast('تم اعتماد الصورة الشخصية وحفظها');
  return data;
 }catch(error){console.error('Profile avatar upload failed:',error);throw error}
 finally{if(input){input.disabled=false;input.value=''}}
}

function formatVoiceDuration(seconds){
 const total=Math.max(0,Math.floor(seconds||0)),minutes=String(Math.floor(total/60)).padStart(2,'0'),secs=String(total%60).padStart(2,'0');
 return (minutes+':'+secs).replace(/\d/g,d=>'٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

function currentVoiceElapsedMs(){
 return Math.max(0,state.voiceElapsedMs+(state.voicePaused||!state.voiceSegmentStartedAt?0:Date.now()-state.voiceSegmentStartedAt));
}

function updateVoiceRecordingUI(){
 const controls=$('voiceRecordingControls'),time=$('voiceRecordingTime'),pause=$('voicePauseBtn'),status=$('voiceRecordingStatus');
 if(!controls||!state.voiceRecorder)return;
 const elapsed=Math.floor(currentVoiceElapsedMs()/1000);
 if(time)time.textContent=formatVoiceDuration(elapsed);
 controls.classList.toggle('is-paused',!!state.voicePaused);
 if(status)status.textContent=state.voicePaused?'متوقف مؤقتاً':'جارٍ التسجيل';
 if(pause){pause.innerHTML=state.voicePaused?'<i class="ph ph-play"></i>':'<i class="ph ph-pause"></i>';pause.setAttribute('aria-label',state.voicePaused?'استئناف التسجيل':'إيقاف مؤقت');pause.title=state.voicePaused?'استئناف التسجيل':'إيقاف مؤقت'}
}

function clearVoiceTimer(){if(state.voiceTimer){clearInterval(state.voiceTimer);state.voiceTimer=null}}

function setVoiceComposerActive(active){
 const composer=$('voiceRecordBtn')?.closest('.composer');
 composer?.classList.toggle('voice-recording-active',!!active);
 $('voiceRecordingControls')?.classList.toggle('hidden',!active);
 if(!active){
  const send=$('sendBtn');if(send)send.innerHTML='<i class="ph ph-paper-plane-tilt"></i>';
 }
}

function cleanupVoiceCapture(){
 clearVoiceTimer();
 if(state.voiceAudioProcessor){try{state.voiceAudioProcessor.disconnect()}catch(_e){}state.voiceAudioProcessor=null}
 if(state.voiceAudioSource){try{state.voiceAudioSource.disconnect()}catch(_e){}state.voiceAudioSource=null}
 if(state.voiceAudioContext){const context=state.voiceAudioContext;state.voiceAudioContext=null;if(context.state!=='closed')context.close().catch(()=>{})}
 if(state.voiceStream){state.voiceStream.getTracks().forEach(track=>track.stop());state.voiceStream=null}
 state.voiceRecorder=null;state.voiceChunks=[];state.voiceStartedAt=null;state.voiceElapsedMs=0;state.voiceSegmentStartedAt=null;state.voicePaused=false;
 $('voiceRecordBtn').classList.remove('recording');$('voiceRecordBtn').innerHTML='<i class="ph ph-microphone"></i>';$('voiceRecordBtn').title='تسجيل رسالة صوتية';$('voiceCancelBtn').classList.add('hidden');
 setVoiceComposerActive(false);
}

function pauseVoiceRecording(){
 const recorder=state.voiceRecorder;if(!recorder||state.voicePaused||recorder.state!=='recording'||typeof recorder.pause!=='function')return;
 try{recorder.pause();if(state.voiceSegmentStartedAt)state.voiceElapsedMs+=Date.now()-state.voiceSegmentStartedAt;state.voiceSegmentStartedAt=null;state.voicePaused=true;updateVoiceRecordingUI()}catch(error){console.warn('Voice pause failed:',error);toast('تعذر إيقاف التسجيل مؤقتاً في هذا المتصفح')}
}

function resumeVoiceRecording(){
 const recorder=state.voiceRecorder;if(!recorder||!state.voicePaused||recorder.state!=='paused'||typeof recorder.resume!=='function')return;
 try{recorder.resume();state.voicePaused=false;state.voiceSegmentStartedAt=Date.now();updateVoiceRecordingUI()}catch(error){console.warn('Voice resume failed:',error);toast('تعذر استئناف التسجيل')}
}

function toggleVoicePause(){if(state.voicePaused)resumeVoiceRecording();else pauseVoiceRecording()}

function sendVoiceRecording(){
 if(!state.voiceRecorder)return;
 state.voiceSendOnStop=true;
 const send=$('sendBtn');if(send)send.disabled=true;
 if(state.voicePaused){state.voicePaused=false;state.voiceSegmentStartedAt=null}
 stopVoiceRecording();
}

function encodeVoiceWav(chunks,sampleRate){
 const total=chunks.reduce((sum,chunk)=>sum+chunk.length,0),input=new Float32Array(total);let offset=0;
 chunks.forEach(chunk=>{input.set(chunk,offset);offset+=chunk.length});
 const targetRate=16000,ratio=sampleRate/targetRate,outLength=Math.max(1,Math.floor(input.length/ratio)),buffer=new ArrayBuffer(44+outLength*2),view=new DataView(buffer);
 const write=(pos,value)=>{for(let i=0;i<value.length;i++)view.setUint8(pos+i,value.charCodeAt(i))};
 write(0,'RIFF');view.setUint32(4,36+outLength*2,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,targetRate,true);view.setUint32(28,targetRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,outLength*2,true);
 for(let i=0;i<outLength;i++){const sourceIndex=Math.min(input.length-1,Math.floor(i*ratio)),sample=Math.max(-1,Math.min(1,input[sourceIndex]));view.setInt16(44+i*2,sample<0?sample*0x8000:sample*0x7fff,true)}
 return new Blob([buffer],{type:'audio/wav'});
}

async function createFallbackVoiceRecorder(stream){
 const AudioContextClass=window.AudioContext||window.webkitAudioContext;
 if(!AudioContextClass)throw new Error('هذا المتصفح لا يدعم التسجيل الصوتي. حدّث المتصفح أو استخدم Chrome أو Safari.');
 const context=new AudioContextClass();state.voiceAudioContext=context;
 if(context.state==='suspended')await context.resume();
 if(context.state!=='running')throw new Error('تعذر تشغيل محرك الصوت. اضغط تسجيل مرة أخرى واسمح باستخدام الميكروفون.');
 const source=context.createMediaStreamSource(stream),processor=context.createScriptProcessor(4096,1,1),chunks=[];
 processor.onaudioprocess=event=>{if(!state.voiceRecorder||state.voiceRecorder.state!=='recording')return;chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));event.outputBuffer.getChannelData(0).fill(0)};
 source.connect(processor);processor.connect(context.destination);state.voiceAudioSource=source;state.voiceAudioProcessor=processor;
 return {state:'recording',mimeType:'audio/wav',onstop:null,pause(){if(this.state==='recording')this.state='paused'},resume(){if(this.state==='paused')this.state='recording'},stop(){if(this.state==='inactive')return;this.state='inactive';state.voiceChunks=[encodeVoiceWav(chunks,context.sampleRate)];if(typeof this.onstop==='function')this.onstop()}};
}

function showAttachmentPreview(file,label){const preview=$('attachmentPreview');preview.replaceChildren();const text=document.createElement('span');text.textContent=label||('المرفق المحدد: '+file.name+' ('+Math.ceil(file.size/1024)+' كيلوبايت)');preview.append(text);const clear=document.createElement('button');clear.type='button';clear.textContent='إزالة';clear.style.cssText='margin-inline-start:12px;border:0;background:transparent;color:#dc5555;cursor:pointer;font:inherit';clear.onclick=()=>{state.attachment=null;state.voiceDuration=0;$('fileInput').value='';preview.classList.add('hidden');preview.replaceChildren();resizeComposer()};preview.append(clear);preview.classList.remove('hidden')}

async function startVoiceRecording(){
 if(!state.active||state.uploading||state.attachment||state.voiceRecorder)return;
 const recordingConversationId=state.active.id,recordingUserId=state.user?.id;
 const role=(state.active.members||[]).find(m=>m.user_id===state.user?.id)?.role;
 if(state.active.type==='channel'&&!['owner','admin'].includes(role)){toast('التسجيل في هذه القناة مخصص للمشرفين');return}
 if(!window.isSecureContext){toast('يلزم فتح التطبيق عبر اتصال HTTPS لتفعيل الميكروفون');return}
 if(!navigator.mediaDevices?.getUserMedia){toast('الميكروفون غير متاح. افتح التطبيق في Chrome أو Safari واسمح باستخدامه');return}
 let stream=null;
 try{
  try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})}
  catch(firstError){if(firstError?.name==='NotAllowedError'||firstError?.name==='SecurityError')throw firstError;stream=await navigator.mediaDevices.getUserMedia({audio:true})}
  if(state.active?.id!==recordingConversationId||state.user?.id!==recordingUserId){stream.getTracks().forEach(track=>track.stop());toast('تغيرت المحادثة قبل بدء التسجيل');return}
  state.voiceStream=stream;state.voiceChunks=[];state.cancelVoiceOnStop=false;state.voiceSendOnStop=false;state.voiceElapsedMs=0;state.voiceSegmentStartedAt=Date.now();state.voicePaused=false;state.voiceStartedAt=Date.now();
  let recorder=null,supported=null;
  if(typeof MediaRecorder!=='undefined'){
   const ua=navigator.userAgent||'',preferMp4=/iPhone|iPad|iPod/i.test(ua);
   const candidates=preferMp4?['audio/mp4','audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/webm']:['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus','audio/webm'];
   supported=candidates.find(type=>{try{return MediaRecorder.isTypeSupported?.(type)}catch(_e){return false}});
   try{recorder=new MediaRecorder(stream,supported?{mimeType:supported}:undefined)}catch(_e){recorder=null}
  }
  if(!recorder)recorder=await createFallbackVoiceRecorder(stream);
  state.voiceRecorder=recorder;
  recorder.ondataavailable=event=>{if(event.data?.size)state.voiceChunks.push(event.data)};
  recorder.onerror=event=>{console.error('Voice recording failed:',event.error||event);state.voiceSendOnStop=false;toast('تعذر تسجيل الصوت. تحقق من إذن الميكروفون ثم حاول مجدداً.');cleanupVoiceCapture();resizeComposer()};
  recorder.onstop=()=>{
   const cancelled=state.cancelVoiceOnStop,shouldSend=state.voiceSendOnStop;
   if(state.voiceSegmentStartedAt)state.voiceElapsedMs+=Date.now()-state.voiceSegmentStartedAt;
   const elapsed=Math.round(state.voiceElapsedMs/1000),chunks=state.voiceChunks.slice();
   const mime=(recorder.mimeType||supported||'audio/wav').split(';')[0].toLowerCase();
   state.voiceSendOnStop=false;cleanupVoiceCapture();
   if(cancelled){state.cancelVoiceOnStop=false;state.voiceElapsedMs=0;resizeComposer();return}
   const blob=new Blob(chunks,{type:mime});if(!blob.size){toast('لم يتم التقاط صوت. تحقق من إذن الميكروفون وحاول مرة أخرى.');resizeComposer();return}
   if(blob.size>12*1024*1024){toast('حجم التسجيل تجاوز الحد الأقصى 12 ميجابايت');resizeComposer();return}
   const ext=mime==='audio/mp4'?'m4a':mime==='audio/ogg'?'ogg':mime==='audio/mpeg'?'mp3':mime==='audio/wav'?'wav':'webm';
   const file=new File([blob],'voice-'+Date.now()+'.'+ext,{type:mime});state.attachment=file;state.voiceDuration=elapsed;
   showAttachmentPreview(file,'رسالة صوتية · '+formatVoiceDuration(elapsed)+' · '+Math.ceil(file.size/1024)+' كيلوبايت');resizeComposer();
   if(shouldSend){setTimeout(()=>{if(state.attachment===file)sendMessage()},0)}
  };
  if(recorder instanceof (window.MediaRecorder||Function)){recorder.start()}
  $('voiceRecordBtn').classList.add('recording');$('voiceRecordBtn').title='التسجيل الصوتي جارٍ';$('voiceCancelBtn').classList.add('hidden');setVoiceComposerActive(true);$('sendBtn').disabled=false;updateVoiceRecordingUI();
  state.voiceTimer=setInterval(()=>{const elapsed=Math.floor(currentVoiceElapsedMs()/1000);updateVoiceRecordingUI();if(elapsed>=180){state.voiceSendOnStop=false;stopVoiceRecording()}},250);
 }catch(error){
  if(stream){stream.getTracks().forEach(track=>track.stop())}
  if(state.voiceStream===stream)cleanupVoiceCapture();
  console.error('Microphone access failed:',error);
  toast(error?.name==='NotAllowedError'?'اسمح للمتصفح باستخدام الميكروفون من إعدادات الموقع ثم حاول مجدداً':error?.name==='NotFoundError'?'لم يتم العثور على ميكروفون متصل بالجهاز':error?.name==='NotReadableError'?'الميكروفون مشغول بتطبيق آخر. أغلقه ثم أعد المحاولة':error?.message||'تعذر تشغيل الميكروفون');
 }
}

function stopVoiceRecording(){if(state.voiceRecorder&&state.voiceRecorder.state!=='inactive')state.voiceRecorder.stop()}

function cancelVoiceRecording(){if(!state.voiceRecorder)return;state.cancelVoiceOnStop=true;state.voiceSendOnStop=false;state.voiceElapsedMs=0;state.voiceSegmentStartedAt=null;stopVoiceRecording()}

async function uploadAttachment(file,conversationId=state.active?.id,userId=state.user?.id){
 if(!conversationId||!userId)throw new Error('اختر محادثة أولاً');
 if(file.size>12*1024*1024)throw new Error('الحد الأقصى لحجم الملف 12 ميجابايت');
 const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=conversationId+'/'+userId+'/'+crypto.randomUUID()+'_'+safe;
 const {error}=await supabaseClient.storage.from('chat-media').upload(path,file,{upsert:false,contentType:file.type});if(error)throw error;return {path,type:file.type};
}

async function sendMessage(){
 if(state.voiceRecorder){toast('أوقف التسجيل الصوتي أولاً قبل الإرسال');return}
 const draftValue=$('messageInput').value,content=draftValue.trim(),file=state.attachment,conversationId=state.active?.id,userId=state.user?.id,editing=!!state.editTarget;
 const activeRole=(state.active?.members||[]).find(m=>m.user_id===userId)?.role;if(state.active?.type==='channel'&&!['owner','admin'].includes(activeRole)){toast('النشر في هذه القناة مخصص للمشرفين');return}if(state.active?.type==='group'&&state.groupSettings?.only_admins_can_send&&!['owner','admin'].includes(activeRole)){toast('الإرسال متاح لمشرفي المجموعة فقط');return}
 if(!conversationId||!userId||(!content&&!file)||state.uploading)return;
 state.uploading=true;$('sendBtn').disabled=true;$('messageInput').disabled=false;
 let savedMessage=null;
 try{
  const {data:{session},error:sessionError}=await supabaseClient.auth.getSession();
  if(sessionError)throw sessionError;
  if(!session?.user?.id||session.user.id!==userId)throw new Error('انتهت جلسة الدخول. أعد تسجيل الدخول ثم حاول إرسال الرسالة مجدداً.');
  if(state.editTarget){if(file)throw new Error('أزل المرفق قبل حفظ تعديل الرسالة');const target=state.editTarget;if(target.conversation_id!==conversationId||target.sender_id!==userId||!canEditMessage(target))throw new Error('انتهت مهلة التعديل أو لا تملك صلاحية تعديل الرسالة');const {data,error}=await supabaseClient.rpc('edit_message_secure',{p_message_id:target.id,p_new_content:content,p_expected_revision:Number(target.edit_revision||0)});if(error)throw error;savedMessage=Array.isArray(data)?data[0]:data;if(!savedMessage?.id)throw new Error('لم يتم تأكيد حفظ التعديل')}else{let attachment={};if(file)attachment=await uploadAttachment(file,conversationId,userId);const privateContext=state.privateReplyPending?{...state.privateReplyPending}:null;const replyTo=state.replyTarget?.id||null;const {data,error}=await supabaseClient.from('chat_messages').insert({conversation_id:conversationId,sender_id:userId,content,...(replyTo?{reply_to:replyTo}:{}),...(attachment.path?{attachment_path:attachment.path,attachment_type:attachment.type}:{})}).select('*').single();if(error)throw error;savedMessage=data;if(privateContext){const {error:ctxError}=await supabaseClient.from('private_reply_contexts').insert({direct_message_id:savedMessage.id,direct_conversation_id:conversationId,sender_id:userId,source_conversation_id:privateContext.sourceConversationId,source_message_id:privateContext.sourceMessageId,quoted_content:privateContext.quotedContent,quoted_sender_id:privateContext.quotedSenderId});if(ctxError){console.warn(ctxError);toast('أُرسلت الرسالة الخاصة دون اقتباس المجموعة')}else state.privateReplyContexts.set(savedMessage.id,{quoted_content:privateContext.quotedContent});state.privateReplyPending=null}}
 }catch(error){
  console.error('Message persistence failed:',error);
  toast(error.message||'لم يتم تأكيد حفظ الرسالة. احتفظنا بالنص لإعادة المحاولة.');
  state.uploading=false;resizeComposer();return;
 }
 // Clear only the exact draft that was sent, and only while its conversation remains active.
 if(state.active?.id===conversationId&&$('messageInput').value===draftValue&&state.attachment===file){
  $('messageInput').value='';state.attachment=null;state.voiceDuration=0;$('fileInput').value='';$('attachmentPreview').replaceChildren();$('attachmentPreview').classList.add('hidden');state.replyTarget=null;state.editTarget=null;state.privateReplyPending=null;renderComposerContext();resizeComposer();publishTyping(false);
 }
 if(state.active?.id===conversationId){
  const existing=state.messages.findIndex(m=>m.id===savedMessage.id);
  if(existing>=0)state.messages[existing]=savedMessage;else state.messages.push(savedMessage);
  if(editing){
   const restored=await loadMessages();
   if(!restored)toast('تم حفظ التعديل، لكن تعذر تحديث العرض. اضغط تحديث المحادثة.');
  }else if(!state.messageIds.has(savedMessage.id)){
   const rendered=await renderMessage(savedMessage,conversationId);
   if(!rendered)toast('تم حفظ الرسالة، لكن تعذر عرضها فوراً. أعد فتح المحادثة لتحديث العرض.');
  }
  const conversation=state.conversations.find(item=>item.id===conversationId);
  if(conversation){conversation.last_message=savedMessage;conversation.last_message_at=savedMessage.created_at;}
  renderConversations();
 }
 state.uploading=false;resizeComposer();
}

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
