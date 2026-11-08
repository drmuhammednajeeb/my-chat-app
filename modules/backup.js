/* BizmindMakers Backup & Restore — isolated, user-scoped, merge-only restore. */
(function(){
'use strict';

const BACKUP_FORMAT='bizmindmakers-chat-backup';
const BACKUP_SCHEMA_VERSION=1;
const BACKUP_MAX_FILE_BYTES=100*1024*1024;
const BACKUP_PAGE_SIZE=500;
const BACKUP_MAX_ROWS=100000;
const PERSONAL_TABLES=[
 'user_settings',
 'user_chat_preferences',
 'user_conversation_settings',
 'user_message_stars',
 'user_conversation_labels',
 'user_conversation_label_items',
 'user_classification_rules',
 'user_conversation_classifications',
 'private_conversation_notes',
 'user_notifications'
];
const RESTORE_TABLES=[
 'user_chat_preferences',
 'user_conversation_settings',
 'user_classification_rules',
 'user_conversation_classifications',
 'private_conversation_notes',
 'user_message_stars'
];
let selectedBackup=null;
let busy=false;

function backupEscape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function backupCurrentUser(){return typeof state!=='undefined'&&state.user?.id?state.user:null}
function backupToast(message){if(typeof toast==='function')toast(message);else console.info(message)}
function backupHex(buffer){return Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('')}
async function backupDigest(value){
 if(!globalThis.crypto?.subtle)throw new Error('المتصفح لا يدعم التحقق المشفر من سلامة النسخة.');
 const bytes=new TextEncoder().encode(JSON.stringify(value));
 return backupHex(await crypto.subtle.digest('SHA-256',bytes));
}
function backupCanonicalPayload(backup){
 return {format:backup.format,schemaVersion:backup.schemaVersion,createdAt:backup.createdAt,userId:backup.userId,personal:backup.personal,conversationArchive:backup.conversationArchive};
}
async function backupFetchAll(makeQuery,label){
 const rows=[];
 for(let offset=0;;offset+=BACKUP_PAGE_SIZE){
  const {data,error}=await makeQuery().range(offset,offset+BACKUP_PAGE_SIZE-1);
  if(error)throw new Error('تعذر قراءة '+label+': '+error.message);
  const page=data||[];
  rows.push(...page);
  if(rows.length>BACKUP_MAX_ROWS)throw new Error('حجم البيانات في '+label+' تجاوز الحد الآمن للتصدير.');
  if(page.length<BACKUP_PAGE_SIZE)break;
 }
 return rows;
}
async function backupFetchByConversation(table,conversationIds){
 const rows=[];
 for(let i=0;i<conversationIds.length;i+=100){
  const ids=conversationIds.slice(i,i+100);
  rows.push(...await backupFetchAll(()=>supabaseClient.from(table).select('*').in('conversation_id',ids),'أرشيف '+table));
 }
 return rows;
}
async function backupCreate(){
 const user=backupCurrentUser();
 if(!user)throw new Error('يجب تسجيل الدخول أولاً.');
 const personal={};
 const queryFor={
  user_settings:()=>supabaseClient.from('user_settings').select('user_id,settings,updated_at').eq('user_id',user.id),
  user_chat_preferences:()=>supabaseClient.from('user_chat_preferences').select('*').eq('user_id',user.id),
  user_conversation_settings:()=>supabaseClient.from('user_conversation_settings').select('*').eq('user_id',user.id),
  user_message_stars:()=>supabaseClient.from('user_message_stars').select('*').eq('user_id',user.id),
  user_conversation_labels:()=>supabaseClient.from('user_conversation_labels').select('*').eq('user_id',user.id),
  user_conversation_label_items:()=>supabaseClient.from('user_conversation_label_items').select('*').eq('user_id',user.id),
  user_classification_rules:()=>supabaseClient.from('user_classification_rules').select('*').eq('user_id',user.id),
  user_conversation_classifications:()=>supabaseClient.from('user_conversation_classifications').select('*').eq('user_id',user.id),
  private_conversation_notes:()=>supabaseClient.from('private_conversation_notes').select('*').eq('user_id',user.id),
  user_notifications:()=>supabaseClient.from('user_notifications').select('*').eq('recipient_id',user.id)
 };
 for(const table of PERSONAL_TABLES){
  personal[table]=await backupFetchAll(queryFor[table],table);
 }
 const membership=await backupFetchAll(()=>supabaseClient.from('conversation_members').select('conversation_id').eq('user_id',user.id),'عضويات المحادثات');
 const conversationIds=[...new Set(membership.map(row=>row.conversation_id).filter(Boolean))];
 const conversationArchive={conversationCount:conversationIds.length,conversations:[],messages:[],reactions:[],pins:[]};
 for(let i=0;i<conversationIds.length;i+=100){
  const ids=conversationIds.slice(i,i+100);
  conversationArchive.conversations.push(...await backupFetchAll(()=>supabaseClient.from('conversations').select('*').in('id',ids),'المحادثات'));
  for(const table of ['chat_messages','message_reactions','message_pins']){
   const key=table==='chat_messages'?'messages':table==='message_reactions'?'reactions':'pins';
   conversationArchive[key].push(...await backupFetchAll(()=>supabaseClient.from(table).select('*').in('conversation_id',ids),'أرشيف '+table));
  }
 }
 const payload={
  format:BACKUP_FORMAT,
  schemaVersion:BACKUP_SCHEMA_VERSION,
  createdAt:new Date().toISOString(),
  userId:user.id,
  personal,
  conversationArchive
 };
 const checksum=await backupDigest(backupCanonicalPayload(payload));
 return {...payload,checksum};
}
function backupDownload(backup){
 const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');
 const stamp=new Date(backup.createdAt).toISOString().replace(/[:.]/g,'-');
 a.href=url;a.download='bizmindmakers-backup-'+stamp+'.json';
 document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function backupValidateShape(value,user){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('ملف النسخة غير صالح.');
 if(value.format!==BACKUP_FORMAT)throw new Error('صيغة الملف ليست نسخة احتياطية معتمدة من BizmindMakers Chat.');
 if(value.schemaVersion!==BACKUP_SCHEMA_VERSION)throw new Error('إصدار النسخة غير مدعوم. لا يمكن المتابعة بأمان.');
 if(value.userId!==user.id)throw new Error('هذه النسخة مرتبطة بحساب آخر. لن يتم استيراد بياناتها إلى حسابك.');
 if(!value.personal||typeof value.personal!=='object'||!value.conversationArchive||typeof value.conversationArchive!=='object')throw new Error('بنية النسخة ناقصة أو تالفة.');
 for(const table of PERSONAL_TABLES){
  const rows=value.personal[table];
  if(!Array.isArray(rows))throw new Error('قسم البيانات غير مكتمل: '+table);
  if(rows.length>BACKUP_MAX_ROWS)throw new Error('عدد السجلات يتجاوز الحد المسموح.');
  for(const row of rows){
   if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('سجل غير صالح في '+table);
   if(table==='user_notifications'){
    if(row.recipient_id!==user.id)throw new Error('تحتوي النسخة على إشعار لا يخص الحساب الحالي.');
   }else if(row.user_id!==user.id)throw new Error('تحتوي النسخة على سجل لا يخص الحساب الحالي: '+table);
  }
 }
 for(const key of ['conversations','messages','reactions','pins']){
  if(!Array.isArray(value.conversationArchive[key]))throw new Error('أرشيف المحادثات غير مكتمل.');
  if(value.conversationArchive[key].length>BACKUP_MAX_ROWS)throw new Error('أرشيف المحادثات يتجاوز الحد الآمن.');
 }
}
async function backupParseFile(file){
 if(!file)throw new Error('اختر ملف النسخة الاحتياطية.');
 if(file.size>BACKUP_MAX_FILE_BYTES)throw new Error('حجم الملف أكبر من 100 ميجابايت.');
 const raw=await file.text();
 let value;
 try{value=JSON.parse(raw)}catch(_){throw new Error('تعذر قراءة الملف؛ تأكد أنه ملف JSON سليم.')}
 const user=backupCurrentUser();
 if(!user)throw new Error('يجب تسجيل الدخول أولاً.');
 backupValidateShape(value,user);
 const expected=await backupDigest(backupCanonicalPayload(value));
 if(typeof value.checksum!=='string'||value.checksum!==expected)throw new Error('فشل التحقق من بصمة SHA-256. قد يكون الملف تالفاً أو تم تعديله.');
 return value;
}
function backupCountSummary(backup){
 const personal=Object.entries(backup.personal).map(([name,rows])=>({name,count:rows.length}));
 const archive=backup.conversationArchive;
 return {personal,archive:{conversations:archive.conversations.length,messages:archive.messages.length,reactions:archive.reactions.length,pins:archive.pins.length}};
}
async function backupExistingConversationIds(userId){
 const rows=await backupFetchAll(()=>supabaseClient.from('conversation_members').select('conversation_id').eq('user_id',userId),'التحقق من المحادثات المتاحة');
 return new Set(rows.map(row=>row.conversation_id));
}
async function backupRestore(backup){
 const user=backupCurrentUser();
 if(!user)throw new Error('انتهت جلسة الدخول. سجّل الدخول ثم أعد المحاولة.');
 backupValidateShape(backup,user);
 const expected=await backupDigest(backupCanonicalPayload(backup));
 if(backup.checksum!==expected)throw new Error('فشل التحقق من سلامة النسخة.');
 const personal=backup.personal,available=await backupExistingConversationIds(user.id),results=[];
 const apply=async(name,rows,conflict,filter)=>{
  const eligible=(rows||[]).filter(row=>!filter||filter(row));
  if(!eligible.length){results.push({name,restored:0,skipped:(rows||[]).length});return}
  const safeRows=eligible.map(row=>({...row,user_id:user.id}));
  const {error}=await supabaseClient.from(name).upsert(safeRows,{onConflict:conflict});
  if(error)throw new Error('توقف الاسترداد عند '+name+': '+error.message);
  results.push({name,restored:safeRows.length,skipped:(rows||[]).length-safeRows.length});
 };
 // Merge-only: no DELETE/TRUNCATE, and rows are constrained to the authenticated owner.
 const settings=personal.user_settings[0]?.settings;
 if(settings&&typeof settings==='object'&&!Array.isArray(settings)){
  const {error}=await supabaseClient.rpc('patch_my_user_settings',{p_patch:settings});
  if(error)throw new Error('تعذر استعادة إعدادات الحساب: '+error.message);
  results.push({name:'user_settings',restored:1,skipped:0});
 }else results.push({name:'user_settings',restored:0,skipped:0});
 await apply('user_chat_preferences',personal.user_chat_preferences,'user_id,conversation_id',row=>available.has(row.conversation_id));
 await apply('user_conversation_settings',personal.user_conversation_settings,'user_id,conversation_id',row=>available.has(row.conversation_id));
 await apply('user_classification_rules',personal.user_classification_rules,'id');
 await apply('user_conversation_classifications',personal.user_conversation_classifications,'user_id,conversation_id',row=>available.has(row.conversation_id));
 // Resolve labels by name first so a pre-existing label is never duplicated under a new UUID.
 const labelMap=new Map();
 for(const old of personal.user_conversation_labels){
  const {data:existing,error:lookupError}=await supabaseClient.from('user_conversation_labels').select('id,name,color,icon').eq('user_id',user.id).eq('name',old.name).maybeSingle();
  if(lookupError)throw new Error('تعذر مطابقة الوسوم: '+lookupError.message);
  if(existing){labelMap.set(old.id,existing.id);continue}
  const {data:created,error}=await supabaseClient.from('user_conversation_labels').upsert({...old,user_id:user.id},{onConflict:'id'}).select('id').single();
  if(error)throw new Error('تعذر استعادة الوسم '+old.name+': '+error.message);
  labelMap.set(old.id,created.id);
 }
 const labelItems=personal.user_conversation_label_items.filter(row=>available.has(row.conversation_id)&&labelMap.has(row.label_id)).map(row=>({...row,user_id:user.id,label_id:labelMap.get(row.label_id)}));
 if(labelItems.length){
  const {error}=await supabaseClient.from('user_conversation_label_items').upsert(labelItems,{onConflict:'user_id,label_id,conversation_id'});
  if(error)throw new Error('تعذر استعادة تصنيفات الوسوم: '+error.message);
 }
 results.push({name:'user_conversation_labels',restored:labelMap.size,skipped:personal.user_conversation_labels.length-labelMap.size});
 results.push({name:'user_conversation_label_items',restored:labelItems.length,skipped:personal.user_conversation_label_items.length-labelItems.length});
 await apply('private_conversation_notes',personal.private_conversation_notes,'id',row=>available.has(row.conversation_id));
 // Starred-message references are restored only if the referenced message is still accessible.
 const stars=[];
 for(let i=0;i<personal.user_message_stars.length;i+=100){
  const batch=personal.user_message_stars.slice(i,i+100);
  const ids=batch.map(row=>row.message_id);
  if(!ids.length)continue;
  const {data,error}=await supabaseClient.from('chat_messages').select('id,conversation_id').in('id',ids);
  if(error)throw new Error('تعذر التحقق من الرسائل المميزة: '+error.message);
  const valid=new Set((data||[]).filter(row=>available.has(row.conversation_id)).map(row=>row.id));
  stars.push(...batch.filter(row=>valid.has(row.message_id)));
 }
 await apply('user_message_stars',stars,'user_id,message_id');
 return results;
}
function backupSetBusy(value){
 busy=value;
 const root=document.getElementById('backupRestoreModal');
 if(!root)return;
 root.querySelectorAll('button,input').forEach(el=>{if(el.dataset.keepEnabled!=='true')el.disabled=value});
}
function backupSetStatus(message,isError){
 const node=document.getElementById('backupRestoreStatus');
 if(!node)return;
 node.textContent=message;node.dataset.state=isError?'error':'info';
}
function backupRenderPreview(backup){
 const summary=backupCountSummary(backup),node=document.getElementById('backupRestorePreview');
 if(!node)return;
 const lines=[
  'تاريخ الإنشاء: '+new Date(backup.createdAt).toLocaleString('ar-SA'),
  'معرّف الحساب: '+backup.userId,
  '',
  'البيانات الشخصية (تصدير):',
  ...summary.personal.map(item=>item.name+': '+item.count),
  '',
  'أرشيف للقراءة فقط:',
  'المحادثات: '+summary.archive.conversations,
  'الرسائل: '+summary.archive.messages,
  'التفاعلات: '+summary.archive.reactions,
  'الرسائل المثبتة: '+summary.archive.pins,
  '',
  'الاستعادة لا تعيد كتابة الرسائل أو المحادثات المشتركة.'
 ];
 node.textContent=lines.join('\n');
 document.getElementById('backupRestoreApply').disabled=false;
}
function backupOpenModal(){
 if(document.getElementById('backupRestoreModal')){document.getElementById('backupRestoreModal').classList.add('open');return}
 const modal=document.createElement('section');
 modal.id='backupRestoreModal';modal.className='backup-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','backupRestoreTitle');
 modal.innerHTML='<div class="backup-dialog"><header><div><h2 id="backupRestoreTitle">النسخ الاحتياطي والاستعادة</h2><p>إدارة نسخة بياناتك الشخصية وأرشيف المحادثات</p></div><button type="button" id="backupRestoreClose" aria-label="إغلاق">×</button></header><div class="backup-content"><section><h3>إنشاء نسخة احتياطية</h3><p>تصدير بياناتك الشخصية مع أرشيف قراءة فقط للمحادثات والرسائل التي تستطيع الوصول إليها.</p><button type="button" id="backupCreateBtn" class="backup-primary">إنشاء وتنزيل نسخة احتياطية</button></section><section><h3>استعادة نسخة</h3><p>اختر ملف JSON أصلياً من هذا التطبيق. الاستعادة تدمج إعداداتك وبياناتك الشخصية دون حذف الموجود.</p><label class="backup-file-label">اختيار ملف النسخة<input id="backupRestoreFile" type="file" accept="application/json,.json"></label><pre id="backupRestorePreview" class="backup-preview">لم يتم اختيار ملف بعد.</pre><button type="button" id="backupRestoreApply" class="backup-primary" disabled>استعادة البيانات الشخصية</button></section><aside class="backup-warning"><strong>ضوابط الحماية</strong><ul><li>لا يتم تصدير كلمات المرور أو رموز الجلسات أو مفاتيح الوصول.</li><li>الرسائل والمحادثات المشتركة محفوظة في الأرشيف فقط ولا تُعاد إلى قاعدة البيانات.</li><li>لا تُحذف أي بيانات حالية؛ الاستعادة دمج وليست استبدالاً.</li><li>ملفات المرفقات الثنائية غير مضمنة في هذه النسخة.</li><li>قد تُتخطى سجلات مرتبطة بمحادثات لم تعد متاحة لحسابك.</li></ul></aside><p id="backupRestoreStatus" role="status" aria-live="polite"></p></div></div>';
 document.body.append(modal);
 const close=()=>modal.classList.remove('open');
 modal.querySelector('#backupRestoreClose').addEventListener('click',close);
 modal.addEventListener('click',event=>{if(event.target===modal)close()});
 modal.querySelector('#backupCreateBtn').addEventListener('click',async()=>{
  if(busy)return;backupSetBusy(true);backupSetStatus('جارٍ جمع البيانات والتحقق من الصلاحيات...');
  try{const backup=await backupCreate();backupDownload(backup);backupSetStatus('اكتمل إنشاء النسخة وتنزيلها. احتفظ بها في مكان آمن.');backupRenderPreview(backup);selectedBackup=backup}
  catch(error){console.error('Backup export failed:',error);backupSetStatus(error.message||'تعذر إنشاء النسخة.',true)}
  finally{backupSetBusy(false)}
 });
 modal.querySelector('#backupRestoreFile').addEventListener('change',async event=>{
  selectedBackup=null;modal.querySelector('#backupRestoreApply').disabled=true;modal.querySelector('#backupRestorePreview').textContent='جارٍ فحص الملف...';backupSetStatus('');
  try{selectedBackup=await backupParseFile(event.target.files?.[0]);backupRenderPreview(selectedBackup);backupSetStatus('الملف سليم وبصمته صحيحة. راجع المعاينة قبل الاستعادة.')}
  catch(error){modal.querySelector('#backupRestorePreview').textContent='';backupSetStatus(error.message||'تعذر التحقق من الملف.',true)}
 });
 modal.querySelector('#backupRestoreApply').addEventListener('click',async()=>{
  if(busy||!selectedBackup)return;
  const ok=confirm('سيتم دمج الإعدادات والبيانات الشخصية من النسخة. لن تُحذف البيانات الحالية ولن تُستعاد الرسائل المشتركة. هل تريد المتابعة؟');
  if(!ok)return;
  backupSetBusy(true);backupSetStatus('جارٍ استعادة البيانات الشخصية بشكل تدريجي...');
  try{
   const results=await backupRestore(selectedBackup);
   backupSetStatus('اكتملت الاستعادة. '+results.map(row=>row.name+': '+row.restored+' مستعاد، '+row.skipped+' متجاوز').join(' | '));
   backupToast('اكتملت استعادة البيانات الشخصية. حدّث الصفحة لتحديث الواجهات.');
  }catch(error){console.error('Backup restore failed:',error);backupSetStatus(error.message||'توقفت الاستعادة. قد تكون بعض الأقسام السابقة قد استُعيدت بالفعل؛ أعد المحاولة بعد المراجعة.',true)}
  finally{backupSetBusy(false)}
 });
 document.body.append(modal);modal.classList.add('open');
}
function backupInstallEntry(){
 const menu=document.getElementById('chatHeaderMenu');
 if(!menu||document.getElementById('backupRestoreOpenBtn'))return;
 const button=document.createElement('button');
 button.id='backupRestoreOpenBtn';button.type='button';button.className='theme-toggle-btn';button.setAttribute('role','menuitem');
 button.innerHTML='<i class="ph ph-shield-check"></i><span>النسخ الاحتياطي والاستعادة</span>';
 button.addEventListener('click',()=>{menu.classList.add('hidden');backupOpenModal()});
 menu.append(button);
 const style=document.createElement('style');
 style.textContent='.backup-modal{position:fixed;inset:0;z-index:180;display:none;place-items:center;padding:14px;background:#07111dcc;direction:rtl}.backup-modal.open{display:grid}.backup-dialog{width:min(100%,680px);max-height:94dvh;overflow:auto;border:1px solid var(--line);border-radius:16px;background:var(--panel);color:var(--text);box-shadow:0 20px 70px #0005}.backup-dialog>header{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;padding:15px 18px;background:var(--panel);border-bottom:1px solid var(--line)}.backup-dialog h2{margin:0;font-size:17px}.backup-dialog header p,.backup-content p{margin:5px 0 0;color:var(--muted);font-size:11px;line-height:1.7}.backup-dialog header button{width:34px;height:34px;border:1px solid var(--line);border-radius:9px;background:var(--panel2);color:var(--text);font-size:22px}.backup-content{display:grid;gap:12px;padding:14px}.backup-content section,.backup-warning{padding:13px;border:1px solid var(--line);border-radius:12px;background:var(--panel2)}.backup-content h3{margin:0;font-size:13px}.backup-primary,.backup-file-label{display:inline-flex;align-items:center;justify-content:center;gap:7px;margin-top:12px;padding:10px 13px;border:0;border-radius:9px;background:var(--accent);color:#fff;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.backup-primary:disabled{opacity:.45;cursor:not-allowed}.backup-file-label{background:var(--panel);border:1px solid var(--line);color:var(--text)}.backup-file-label input{max-width:190px;font-size:10px}.backup-preview{max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;border-radius:9px;background:var(--panel);color:var(--muted);font:10px/1.8 ui-monospace,monospace}.backup-warning{border-color:#d49b3d66;background:#d49b3d0d;font-size:11px;line-height:1.8}.backup-warning ul{margin:7px 0 0;padding-inline-start:20px}.backup-warning strong{font-size:12px}.backup-content #backupRestoreStatus{min-height:20px;margin:0;color:var(--accent);font-size:11px;line-height:1.7;overflow-wrap:anywhere}.backup-content #backupRestoreStatus[data-state=error]{color:#d45b5b}@media(max-width:520px){.backup-modal{padding:7px}.backup-content{padding:9px}.backup-dialog{max-height:96dvh}}';
 document.head.append(style);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',backupInstallEntry,{once:true});
else backupInstallEntry();
})();
