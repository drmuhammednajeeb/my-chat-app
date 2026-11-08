/* BizmindMakers Backup & Restore — isolated, user-scoped, merge-only restore. */
(function(){
'use strict';

const BACKUP_FORMAT='bizmindmakers-chat-backup';
const BACKUP_SCHEMA_VERSION=2;
const BACKUP_MAX_FILE_BYTES=140*1024*1024;
const BACKUP_MAX_BINARY_BYTES=65*1024*1024;
const BACKUP_MAX_PLAINTEXT_BYTES=100*1024*1024;
const BACKUP_KDF_ITERATIONS=310000;
const BACKUP_PAGE_SIZE=500;
const BACKUP_MAX_ROWS=100000;
const PERSONAL_TABLES_V1=[
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
const PERSONAL_TABLES=[...PERSONAL_TABLES_V1,'chat_lists','chat_list_items'];
const RESTORE_COLUMNS={
 user_chat_preferences:['user_id','conversation_id','theme','cleared_before','is_shortcut','created_at','updated_at','is_archived'],
 user_conversation_settings:['user_id','conversation_id','is_muted','notification_tone','updated_at','is_favorite'],
 user_conversation_labels:['id','user_id','name','color','icon','created_at','updated_at'],
 user_conversation_label_items:['user_id','label_id','conversation_id','created_at'],
 user_classification_rules:['id','user_id','name','enabled','priority','conditions','action','created_at','updated_at'],
 user_conversation_classifications:['user_id','conversation_id','category','source','updated_at'],
 private_conversation_notes:['id','user_id','conversation_id','note','order_status','financial_amount','currency','follow_up_at','responsible_user_id','created_at','updated_at'],
 user_message_stars:['user_id','conversation_id','message_id','created_at'],
 chat_lists:['id','user_id','name','sort_order','created_at','updated_at','folder_type','color'],
 chat_list_items:['user_id','list_id','conversation_id','created_at']
};
const RESTORE_TABLES=[
 'user_settings',
 'user_chat_preferences',
 'user_conversation_settings',
 'user_conversation_labels',
 'user_conversation_label_items',
 'user_classification_rules',
 'user_conversation_classifications',
 'private_conversation_notes',
 'user_message_stars',
 'chat_lists',
 'chat_list_items'
];
let selectedBackup=null;
let busy=false;

function backupEscape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function backupCurrentUser(){return typeof state!=='undefined'&&state.user?.id?state.user:null}
function backupAssertRestorableTable(name){if(!RESTORE_TABLES.includes(name))throw new Error('جدول غير مسموح بالاستعادة: '+name)}
function backupPickRestoreRow(name,row,userId){
 backupAssertRestorableTable(name);
 const columns=RESTORE_COLUMNS[name];
 if(!columns)throw new Error('لا توجد خريطة حقول معتمدة للاستعادة: '+name);
 const safe={};
 for(const key of columns)if(Object.prototype.hasOwnProperty.call(row,key))safe[key]=row[key];
 safe.user_id=userId;
 return safe;
}
function backupToast(message){if(typeof toast==='function')toast(message);else console.info(message)}
function backupHex(buffer){return Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('')}
function backupBase64(bytes){
 let binary='';
 for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
 return btoa(binary);
}
function backupFromBase64(value){
 const binary=atob(value),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return bytes;
}
async function backupDeriveKey(passphrase,salt){
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:BACKUP_KDF_ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function backupEncryptEnvelope(backup,passphrase){
 if(!globalThis.crypto?.subtle)throw new Error('التشفير الآمن غير مدعوم في هذا المتصفح.');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await backupDeriveKey(passphrase,salt);
 const plaintext=new TextEncoder().encode(JSON.stringify(backup));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plaintext);
 return {format:BACKUP_FORMAT,schemaVersion:BACKUP_SCHEMA_VERSION,createdAt:backup.createdAt,userId:backup.userId,encryption:{algorithm:'AES-256-GCM',kdf:'PBKDF2-SHA-256',iterations:BACKUP_KDF_ITERATIONS,salt:backupBase64(salt),iv:backupBase64(iv)},ciphertext:backupBase64(new Uint8Array(ciphertext))};
}
async function backupDigest(value){
 if(!globalThis.crypto?.subtle)throw new Error('المتصفح لا يدعم التحقق المشفر من سلامة النسخة.');
 const bytes=new TextEncoder().encode(JSON.stringify(value));
 return backupHex(await crypto.subtle.digest('SHA-256',bytes));
}
function backupCanonicalPayload(backup){
 const canonical={format:backup.format,schemaVersion:backup.schemaVersion,createdAt:backup.createdAt,userId:backup.userId,personal:backup.personal,conversationArchive:backup.conversationArchive};
 if(Number(backup.schemaVersion)>=2)canonical.profile=backup.profile??null;
 return canonical;
}
async function backupFetchAll(makeQuery,label,orderBy){
 const rows=[];
 for(let offset=0;;offset+=BACKUP_PAGE_SIZE){
  let query=makeQuery();
  for(const column of (Array.isArray(orderBy)?orderBy:orderBy?[orderBy]:[]))query=query.order(column,{ascending:true});
  const {data,error}=await query.range(offset,offset+BACKUP_PAGE_SIZE-1);
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
  user_notifications:()=>supabaseClient.from('user_notifications').select('*').eq('recipient_id',user.id),
  chat_lists:()=>supabaseClient.from('chat_lists').select('*').eq('user_id',user.id),
  chat_list_items:()=>supabaseClient.from('chat_list_items').select('*').eq('user_id',user.id)
 };
 const orderFor={user_settings:'updated_at',user_chat_preferences:'created_at',user_conversation_settings:'updated_at',user_message_stars:'created_at',user_conversation_labels:'created_at',user_conversation_label_items:'created_at',user_classification_rules:'created_at',user_conversation_classifications:'updated_at',private_conversation_notes:'created_at',user_notifications:'created_at',chat_lists:'created_at',chat_list_items:'created_at'};
 for(const table of PERSONAL_TABLES)personal[table]=await backupFetchAll(queryFor[table],table,orderFor[table]);
 const {data:profileRow,error:profileError}=await supabaseClient.from('profiles').select('id,username,display_name,bio,avatar_url,updated_at').eq('id',user.id).maybeSingle();
 if(profileError)throw new Error('تعذر تصدير الملف الشخصي: '+profileError.message);
 const profile=profileRow?{id:profileRow.id,username:profileRow.username,display_name:profileRow.display_name,bio:profileRow.bio,avatar_url:profileRow.avatar_url,updated_at:profileRow.updated_at}:null;
 personal.user_settings=personal.user_settings.map(row=>({
  user_id:row.user_id,
  settings:row.settings&&['dark','light','system'].includes(row.settings.theme)?{theme:row.settings.theme}:{},
  updated_at:row.updated_at
 }));
 const membership=await backupFetchAll(()=>supabaseClient.from('conversation_members').select('conversation_id').eq('user_id',user.id),'عضويات المحادثات','conversation_id');
 const conversationIds=[...new Set(membership.map(row=>row.conversation_id).filter(Boolean))];
 const conversationArchive={conversationCount:conversationIds.length,conversations:[],messages:[],reactions:[],pins:[],documents:[],attachments:[]};
 for(let i=0;i<conversationIds.length;i+=100){
  const ids=conversationIds.slice(i,i+100);
  conversationArchive.conversations.push(...await backupFetchAll(()=>supabaseClient.from('conversations').select('*').in('id',ids),'المحادثات','created_at'));
  for(const table of ['chat_messages','message_reactions','message_pins']){
   const key=table==='chat_messages'?'messages':table==='message_reactions'?'reactions':'pins';
   conversationArchive[key].push(...await backupFetchAll(()=>{
    const query=supabaseClient.from(table).select('*').in('conversation_id',ids);
    return table==='chat_messages'?query.is('deleted_at',null):query;
   },'أرشيف '+table,table==='message_pins'?'pinned_at':'created_at'));
  }
  conversationArchive.documents.push(...await backupFetchAll(()=>supabaseClient.from('conversation_documents').select('id,owner_id,conversation_id,storage_path,file_name,mime_type,size_bytes,visibility,created_at,shared_at').in('conversation_id',ids),'مستندات المحادثات','created_at'));
 }
 const fileRefs=new Map();
 for(const message of conversationArchive.messages){
  if(!message.attachment_path)continue;
  const key='chat-media:'+message.attachment_path;
  const current=fileRefs.get(key)||{bucket:'chat-media',path:message.attachment_path,mimeType:message.attachment_type||'application/octet-stream',kind:'message',conversationId:message.conversation_id,senderId:message.sender_id,ownerId:message.attachment_path.split('/')[1]||null,messageIds:[]};
  current.messageIds.push(message.id);fileRefs.set(key,current);
 }
 for(const doc of conversationArchive.documents){
  fileRefs.set('conversation-documents:'+doc.storage_path,{bucket:'conversation-documents',path:doc.storage_path,mimeType:doc.mime_type||'application/octet-stream',kind:'document',conversationId:doc.conversation_id,ownerId:doc.owner_id,documentId:doc.id,fileName:doc.file_name,visibility:doc.visibility});
 }
 let binaryBytes=0;
 for(const ref of fileRefs.values()){
  const {data,error}=await supabaseClient.storage.from(ref.bucket).download(ref.path);
  if(error||!data)throw new Error('تعذر تضمين ملف مرفق في النسخة ('+ref.path+'): '+(error?.message||'الملف غير متاح').slice(0,220));
  const bytes=new Uint8Array(await data.arrayBuffer());binaryBytes+=bytes.byteLength;
  if(binaryBytes>BACKUP_MAX_BINARY_BYTES)throw new Error('تجاوز حجم المرفقات 65 ميجابايت. أوقفنا التصدير بدلاً من إصدار نسخة ناقصة.');
  conversationArchive.attachments.push({...ref,sizeBytes:bytes.byteLength,data:backupBase64(bytes)});
 }
 const payload={
  format:BACKUP_FORMAT,
  schemaVersion:BACKUP_SCHEMA_VERSION,
  createdAt:new Date().toISOString(),
  userId:user.id,
  profile,
  personal,
  conversationArchive
 };
 const serializedSize=new TextEncoder().encode(JSON.stringify(payload)).length;
 if(serializedSize>BACKUP_MAX_PLAINTEXT_BYTES)throw new Error('حجم النسخة يتجاوز 100 ميجابايت قبل التشفير. قسّم النسخ الاحتياطي إلى نطاقات أصغر في إصدار لاحق.');
 const checksum=await backupDigest(backupCanonicalPayload(payload));
 return {...payload,checksum};
}
async function backupDownload(backup,passphrase){
 const envelope=await backupEncryptEnvelope(backup,passphrase);
 const blob=new Blob([JSON.stringify(envelope)],{type:'application/json;charset=utf-8'});
 if(blob.size>BACKUP_MAX_FILE_BYTES)throw new Error('حجم ملف النسخة المشفر تجاوز الحد المسموح.');
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');
 const stamp=new Date(backup.createdAt).toISOString().replace(/[:.]/g,'-');
 a.href=url;a.download='bizmindmakers-backup-encrypted-'+stamp+'.json';
 document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function backupValidateShape(value,user){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('ملف النسخة غير صالح.');
 if(value.format!==BACKUP_FORMAT)throw new Error('صيغة الملف ليست نسخة احتياطية معتمدة من BizmindMakers Chat.');
 if(![1,2].includes(value.schemaVersion))throw new Error('إصدار النسخة غير مدعوم. لا يمكن المتابعة بأمان.');
 if(value.userId!==user.id)throw new Error('هذه النسخة مرتبطة بحساب آخر. لن يتم استيراد بياناتها إلى حسابك.');
 if(!value.personal||typeof value.personal!=='object'||!value.conversationArchive||typeof value.conversationArchive!=='object'||value.schemaVersion!==envelope.schemaVersion)throw new Error('بنية النسخة ناقصة أو تالفة.');
 const requiredTables=value.schemaVersion===1?PERSONAL_TABLES_V1:PERSONAL_TABLES;
 for(const table of requiredTables){
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
 if(value.schemaVersion>=2){
  if(!value.profile||value.profile.id!==user.id)throw new Error('بيانات الملف الشخصي غير مرتبطة بالحساب الحالي.');
  for(const key of ['documents','attachments'])if(!Array.isArray(value.conversationArchive[key]))throw new Error('قسم الملفات غير مكتمل: '+key);
  let total=0;
  for(const item of value.conversationArchive.attachments){
   if(!item||!['chat-media','conversation-documents'].includes(item.bucket)||typeof item.path!=='string'||typeof item.data!=='string'||!Number.isSafeInteger(item.sizeBytes)||item.sizeBytes<0)throw new Error('سجل مرفق غير صالح.');
   total+=item.sizeBytes;if(total>BACKUP_MAX_BINARY_BYTES)throw new Error('حجم المرفقات يتجاوز الحد الآمن.');
  }
 }
}
async function backupParseFile(file,passphrase){
 if(!file)throw new Error('اختر ملف النسخة الاحتياطية.');
 if(file.size>BACKUP_MAX_FILE_BYTES)throw new Error('حجم الملف المشفر أكبر من الحد المسموح.');
 if(typeof passphrase!=='string'||passphrase.length<12)throw new Error('أدخل كلمة مرور النسخة (12 حرفاً على الأقل).');
 const raw=await file.text();
 let envelope;
 try{envelope=JSON.parse(raw)}catch(_){throw new Error('تعذر قراءة الملف؛ تأكد أنه ملف JSON سليم.')}
 const user=backupCurrentUser();
 if(!user)throw new Error('يجب تسجيل الدخول أولاً.');
 if(envelope?.format!==BACKUP_FORMAT||![1,2].includes(envelope?.schemaVersion))throw new Error('صيغة النسخة أو إصدارها غير مدعوم.');
 if(envelope.userId!==user.id)throw new Error('هذه النسخة مرتبطة بحساب آخر. لن يتم استيراد بياناتها إلى حسابك.');
 const meta=envelope.encryption;
 if(meta?.algorithm!=='AES-256-GCM'||meta?.kdf!=='PBKDF2-SHA-256'||meta?.iterations!==BACKUP_KDF_ITERATIONS||typeof envelope.ciphertext!=='string')throw new Error('بيانات التشفير في الملف غير صالحة.');
 let value;
 try{
  const salt=backupFromBase64(meta.salt),iv=backupFromBase64(meta.iv),ciphertext=backupFromBase64(envelope.ciphertext);
  if(salt.length!==16||iv.length!==12||ciphertext.length>BACKUP_MAX_FILE_BYTES)throw new Error('Invalid encrypted payload dimensions.');
  const key=await backupDeriveKey(passphrase,salt);
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ciphertext);
  value=JSON.parse(new TextDecoder().decode(plaintext));
 }catch(_){throw new Error('تعذر فك تشفير النسخة. تحقق من كلمة المرور ومن سلامة الملف.')}
 backupValidateShape(value,user);
 const expected=await backupDigest(backupCanonicalPayload(value));
 if(typeof value.checksum!=='string'||value.checksum!==expected)throw new Error('فشل التحقق من بصمة SHA-256 داخل النسخة.');
 return value;
}
function backupCountSummary(backup){
 const personal=Object.entries(backup.personal).map(([name,rows])=>({name,count:rows.length}));
 const archive=backup.conversationArchive;
 return {personal,archive:{conversations:archive.conversations.length,messages:archive.messages.length,reactions:archive.reactions.length,pins:archive.pins.length,documents:(archive.documents||[]).length,attachments:(archive.attachments||[]).length,attachmentBytes:(archive.attachments||[]).reduce((sum,item)=>sum+(item.sizeBytes||0),0)}};
}
async function backupExistingConversationIds(userId){
 const rows=await backupFetchAll(()=>supabaseClient.from('conversation_members').select('conversation_id').eq('user_id',userId),'التحقق من المحادثات المتاحة');
 return new Set(rows.map(row=>row.conversation_id));
}
async function backupExistingMembershipPairs(conversationIds){
 const pairs=new Set();
 for(let i=0;i<conversationIds.length;i+=100){
  const ids=conversationIds.slice(i,i+100);
  const rows=await backupFetchAll(()=>supabaseClient.from('conversation_members').select('conversation_id,user_id').in('conversation_id',ids),'التحقق من مسؤولي الملاحظات');
  rows.forEach(row=>pairs.add(row.conversation_id+':'+row.user_id));
 }
 return pairs;
}
async function backupStorageObjectExists(bucket,path){
 const parts=String(path).split('/'),name=parts.pop(),folder=parts.join('/');
 const {data,error}=await supabaseClient.storage.from(bucket).list(folder,{search:name,limit:100});
 if(error)throw new Error('تعذر فحص الملف في التخزين: '+error.message);
 return (data||[]).some(item=>item.name===name);
}
async function backupRestoreAttachments(backup,user,available){
 let restored=0,skipped=0;
 for(const item of (backup.conversationArchive.attachments||[])){
  if(!available.has(item.conversationId)){skipped++;continue}
  const bytes=backupFromBase64(item.data);if(bytes.byteLength!==item.sizeBytes)throw new Error('حجم المرفق لا يطابق بيانات النسخة: '+item.path);
  if(item.bucket==='chat-media'){
   if(String(item.path).split('/')[1]!==user.id||item.senderId!==user.id||(item.messageIds||[]).length===0){skipped++;continue}
   const {data:messages,error:messageError}=await supabaseClient.from('chat_messages').select('id,sender_id,attachment_path').in('id',item.messageIds).eq('conversation_id',item.conversationId);
   if(messageError)throw new Error('تعذر التحقق من ملكية مرفق الرسالة: '+messageError.message);
   if(!(messages||[]).some(row=>row.sender_id===user.id&&row.attachment_path===item.path)){skipped++;continue}
   if(await backupStorageObjectExists(item.bucket,item.path)){skipped++;continue}
   const {error}=await supabaseClient.storage.from(item.bucket).upload(item.path,new Blob([bytes],{type:item.mimeType}),{upsert:false,contentType:item.mimeType});
   if(error)throw new Error('تعذر استعادة مرفق الرسالة: '+error.message);restored++;
  }else if(item.bucket==='conversation-documents'){
   if(item.ownerId!==user.id){skipped++;continue}
   const exists=await backupStorageObjectExists(item.bucket,item.path);
   if(!exists){const {error}=await supabaseClient.storage.from(item.bucket).upload(item.path,new Blob([bytes],{type:item.mimeType}),{upsert:false,contentType:item.mimeType});if(error)throw new Error('تعذر استعادة المستند: '+error.message)}
   const {data:doc,error:docError}=await supabaseClient.from('conversation_documents').select('id').eq('id',item.documentId).maybeSingle();
   if(docError)throw new Error('تعذر التحقق من سجل المستند: '+docError.message);
   if(!doc){const meta=(backup.conversationArchive.documents||[]).find(row=>row.id===item.documentId);if(!meta)throw new Error('بيانات المستند غير موجودة في الأرشيف.');const {error}=await supabaseClient.from('conversation_documents').insert({id:meta.id,owner_id:user.id,conversation_id:meta.conversation_id,storage_path:meta.storage_path,file_name:meta.file_name,mime_type:meta.mime_type,size_bytes:meta.size_bytes,visibility:meta.visibility,created_at:meta.created_at,shared_at:meta.shared_at});if(error)throw new Error('تعذر استعادة سجل المستند: '+error.message)}
   if(!exists)restored++;else skipped++;
  }else skipped++;
 }
 return {name:'storage_attachments',restored,skipped};
}
async function backupRestore(backup){
 const user=backupCurrentUser();
 if(!user)throw new Error('انتهت جلسة الدخول. سجّل الدخول ثم أعد المحاولة.');
 backupValidateShape(backup,user);
 const expected=await backupDigest(backupCanonicalPayload(backup));
 if(backup.checksum!==expected)throw new Error('فشل التحقق من سلامة النسخة.');
 const personal=backup.personal,available=await backupExistingConversationIds(user.id),membershipPairs=await backupExistingMembershipPairs([...available]),results=[];
 if(backup.profile){const profilePatch={};if(typeof backup.profile.display_name==='string'&&backup.profile.display_name.trim())profilePatch.display_name=backup.profile.display_name.trim().slice(0,48);if(typeof backup.profile.bio==='string')profilePatch.bio=backup.profile.bio.slice(0,160);if(Object.keys(profilePatch).length){const {error}=await supabaseClient.from('profiles').update(profilePatch).eq('id',user.id);if(error)throw new Error('تعذر استعادة بيانات الملف الشخصي: '+error.message);results.push({name:'profile',restored:Object.keys(profilePatch).length,skipped:0})}}
 const apply=async(name,rows,conflict,filter)=>{
  backupAssertRestorableTable(name);
  const eligible=(rows||[]).filter(row=>!filter||filter(row));
  if(!eligible.length){results.push({name,restored:0,skipped:(rows||[]).length});return}
  const safeRows=eligible.map(row=>backupPickRestoreRow(name,row,user.id));
  const {error}=await supabaseClient.from(name).upsert(safeRows,{onConflict:conflict});
  if(error)throw new Error('توقف الاسترداد عند '+name+': '+error.message);
  results.push({name,restored:safeRows.length,skipped:(rows||[]).length-safeRows.length});
 };
 // Merge-only: no DELETE/TRUNCATE, and rows are constrained to the authenticated owner.
 backupAssertRestorableTable('user_settings');
 const settings=personal.user_settings[0]?.settings;
 const settingsPatch={};
 if(settings&&typeof settings==='object'&&!Array.isArray(settings)&&['dark','light','system'].includes(settings.theme))settingsPatch.theme=settings.theme;
 if(Object.keys(settingsPatch).length){
  const {error}=await supabaseClient.rpc('patch_my_user_settings',{p_patch:settingsPatch});
  if(error)throw new Error('تعذر استعادة إعدادات الحساب: '+error.message);
  results.push({name:'user_settings',restored:1,skipped:0});
 }else results.push({name:'user_settings',restored:0,skipped:personal.user_settings.length});
 await apply('user_chat_preferences',personal.user_chat_preferences,'user_id,conversation_id',row=>available.has(row.conversation_id));
 await apply('user_conversation_settings',personal.user_conversation_settings,'user_id,conversation_id',row=>available.has(row.conversation_id));
 await apply('user_classification_rules',personal.user_classification_rules,'id');
 await apply('user_conversation_classifications',personal.user_conversation_classifications,'user_id,conversation_id',row=>available.has(row.conversation_id));
 // Resolve labels by name first so a pre-existing label is never duplicated under a new UUID.
 backupAssertRestorableTable('user_conversation_labels');
 backupAssertRestorableTable('user_conversation_label_items');
 const labelMap=new Map();
 for(const old of personal.user_conversation_labels){
  const {data:existing,error:lookupError}=await supabaseClient.from('user_conversation_labels').select('id,name,color,icon').eq('user_id',user.id).eq('name',old.name).maybeSingle();
  if(lookupError)throw new Error('تعذر مطابقة الوسوم: '+lookupError.message);
  if(existing){labelMap.set(old.id,existing.id);continue}
  const safeLabel=backupPickRestoreRow('user_conversation_labels',old,user.id);
  const {data:created,error}=await supabaseClient.from('user_conversation_labels').upsert(safeLabel,{onConflict:'id'}).select('id').single();
  if(error)throw new Error('تعذر استعادة الوسم '+old.name+': '+error.message);
  labelMap.set(old.id,created.id);
 }
 const labelItems=personal.user_conversation_label_items.filter(row=>available.has(row.conversation_id)&&labelMap.has(row.label_id)).map(row=>({...backupPickRestoreRow('user_conversation_label_items',row,user.id),label_id:labelMap.get(row.label_id)}));
 if(labelItems.length){
  const {error}=await supabaseClient.from('user_conversation_label_items').upsert(labelItems,{onConflict:'user_id,label_id,conversation_id'});
  if(error)throw new Error('تعذر استعادة تصنيفات الوسوم: '+error.message);
 }
 results.push({name:'user_conversation_labels',restored:labelMap.size,skipped:personal.user_conversation_labels.length-labelMap.size});
 results.push({name:'user_conversation_label_items',restored:labelItems.length,skipped:personal.user_conversation_label_items.length-labelItems.length});
 const safeNotes=personal.private_conversation_notes.filter(row=>available.has(row.conversation_id)).map(row=>({...row,responsible_user_id:row.responsible_user_id&&membershipPairs.has(row.conversation_id+':'+row.responsible_user_id)?row.responsible_user_id:null}));
 await apply('private_conversation_notes',safeNotes,'id');
 // Starred-message references are restored only if the referenced message is still accessible.
 const stars=[];
 for(let i=0;i<personal.user_message_stars.length;i+=100){
  const batch=personal.user_message_stars.slice(i,i+100);
  const ids=batch.map(row=>row.message_id);
  if(!ids.length)continue;
  const {data,error}=await supabaseClient.from('chat_messages').select('id,conversation_id,deleted_at').in('id',ids);
  if(error)throw new Error('تعذر التحقق من الرسائل المميزة: '+error.message);
  const valid=new Set((data||[]).filter(row=>available.has(row.conversation_id)&&!row.deleted_at).map(row=>row.id));
  stars.push(...batch.filter(row=>valid.has(row.message_id)));
 }
 await apply('user_message_stars',stars,'user_id,message_id');
 const listMap=new Map();
 for(const old of (personal.chat_lists||[])){
  const {data:existing,error:lookupError}=await supabaseClient.from('chat_lists').select('id').eq('user_id',user.id).eq('name',old.name).maybeSingle();
  if(lookupError)throw new Error('تعذر مطابقة القوائم الشخصية: '+lookupError.message);
  if(existing){listMap.set(old.id,existing.id);continue}
  const safe=backupPickRestoreRow('chat_lists',old,user.id);
  const {data:created,error}=await supabaseClient.from('chat_lists').upsert(safe,{onConflict:'id'}).select('id').single();
  if(error)throw new Error('تعذر استعادة القائمة '+old.name+': '+error.message);listMap.set(old.id,created.id);
 }
 const listItems=(personal.chat_list_items||[]).filter(row=>available.has(row.conversation_id)&&listMap.has(row.list_id)).map(row=>({...backupPickRestoreRow('chat_list_items',row,user.id),list_id:listMap.get(row.list_id)}));
 if(listItems.length){const {error}=await supabaseClient.from('chat_list_items').upsert(listItems,{onConflict:'user_id,list_id,conversation_id'});if(error)throw new Error('تعذر استعادة عناصر القوائم: '+error.message)}
 results.push({name:'chat_lists',restored:listMap.size,skipped:(personal.chat_lists||[]).length-listMap.size});
 results.push({name:'chat_list_items',restored:listItems.length,skipped:(personal.chat_list_items||[]).length-listItems.length});
 results.push(await backupRestoreAttachments(backup,user,available));
 return results;
}
function backupSetBusy(value){
 busy=value;
 const root=document.getElementById('backupRestoreModal');
 if(!root)return;
 root.querySelectorAll('button,input').forEach(el=>{el.disabled=value});
 if(!value){
  const apply=root.querySelector('#backupRestoreApply');
  const file=root.querySelector('#backupRestoreFile')?.files?.[0];
  const pass=root.querySelector('#backupImportPassword')?.value||'';
  const validate=root.querySelector('#backupValidateFile');
  if(apply)apply.disabled=!selectedBackup;
  if(validate)validate.disabled=!(file&&pass.length>=12);
 }
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
  'المستندات: '+summary.archive.documents,
  'الملفات المرفقة: '+summary.archive.attachments,
  'حجم الملفات: '+(summary.archive.attachmentBytes/1024/1024).toFixed(2)+' ميجابايت',
  '',
  'المحادثات والرسائل والتفاعلات والملفات المشتركة محفوظة في الأرشيف؛ لا تُنشأ من جديد.',
  'تُستعاد القوائم الشخصية والمرفقات التي يملكها الحساب فقط.'
 ];
 node.textContent=lines.join('\n');
 document.getElementById('backupRestoreApply').disabled=!selectedBackup;
}
function backupOpenModal(){
 if(document.getElementById('backupRestoreModal')){document.getElementById('backupRestoreModal').classList.add('open');return}
 const modal=document.createElement('section');
 modal.id='backupRestoreModal';modal.className='backup-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','backupRestoreTitle');
 modal.innerHTML=`<div class="backup-dialog"><header><div><h2 id="backupRestoreTitle">النسخ الاحتياطي والاستعادة</h2><p>إدارة نسخة بياناتك الشخصية وأرشيف المحادثات</p></div><button type="button" id="backupRestoreClose" aria-label="إغلاق">×</button></header><div class="backup-content"><section><h3>إنشاء نسخة احتياطية مشفّرة</h3><p>تُشفّر النسخة محلياً قبل تنزيلها باستخدام AES-256-GCM. اختر كلمة مرور قوية واحتفظ بها؛ لا يمكن استعادة الملف بدونها.</p><label class="backup-secret-label">كلمة مرور التشفير<input id="backupExportPassword" type="password" minlength="12" maxlength="256" autocomplete="new-password" placeholder="12 حرفاً على الأقل"></label><label class="backup-secret-label">تأكيد كلمة المرور<input id="backupExportPasswordConfirm" type="password" minlength="12" maxlength="256" autocomplete="new-password"></label><button type="button" id="backupCreateBtn" class="backup-primary">إنشاء وتنزيل نسخة مشفّرة</button></section><section><h3>استعادة نسخة مشفّرة</h3><p>اختر ملف النسخة المشفّرة وأدخل كلمة المرور نفسها لفحصه قبل الاستعادة.</p><label class="backup-file-label">اختيار ملف النسخة<input id="backupRestoreFile" type="file" accept="application/json,.json"></label><label class="backup-secret-label">كلمة مرور النسخة<input id="backupImportPassword" type="password" minlength="12" maxlength="256" autocomplete="current-password"></label><button type="button" id="backupValidateFile" class="backup-primary" disabled>فحص النسخة ومعاينتها</button><pre id="backupRestorePreview" class="backup-preview">لم يتم اختيار ملف بعد.</pre><button type="button" id="backupRestoreApply" class="backup-primary" disabled>استعادة البيانات الشخصية</button></section><aside class="backup-warning"><strong>ضوابط الحماية</strong><ul><li>التشفير يتم داخل المتصفح ولا تُرسل كلمة المرور إلى الخادم.</li><li>لا يتم تصدير كلمات المرور أو رموز الجلسات أو مفاتيح الوصول.</li><li>الرسائل والمحادثات المشتركة محفوظة في الأرشيف فقط ولا تُعاد إلى قاعدة البيانات.</li><li>لا تُحذف أي بيانات حالية؛ الاستعادة دمج وليست استبدالاً.</li><li>ملفات المرفقات الثنائية غير مضمنة في هذه النسخة.</li><li>فقدان كلمة المرور يعني تعذّر فك تشفير النسخة.</li></ul></aside><p id="backupRestoreStatus" role="status" aria-live="polite"></p></div></div>`;
 const close=()=>{modal.classList.remove('open');selectedBackup=null;modal.querySelector('#backupExportPassword').value='';modal.querySelector('#backupExportPasswordConfirm').value='';modal.querySelector('#backupImportPassword').value='';modal.querySelector('#backupRestoreFile').value='';modal.querySelector('#backupRestoreApply').disabled=true;modal.querySelector('#backupRestorePreview').textContent='لم يتم اختيار ملف بعد.'};
 modal.querySelector('#backupRestoreClose').addEventListener('click',()=>{if(!busy)close()});
 modal.addEventListener('click',event=>{if(event.target===modal&&!busy)close()});
 modal.querySelector('#backupCreateBtn').addEventListener('click',async()=>{
  if(busy)return;
  const pass=modal.querySelector('#backupExportPassword').value,confirmPass=modal.querySelector('#backupExportPasswordConfirm').value;
  if(pass.length<12)return backupSetStatus('اختر كلمة مرور لا تقل عن 12 حرفاً.',true);
  if(pass!==confirmPass)return backupSetStatus('كلمتا المرور غير متطابقتين.',true);
  backupSetBusy(true);backupSetStatus('جارٍ جمع البيانات ثم تشفير النسخة محلياً...');
  try{const backup=await backupCreate();await backupDownload(backup,pass);backupSetStatus('اكتمل إنشاء النسخة المشفّرة وتنزيلها. احتفظ بالملف وكلمة المرور في مكانين آمنين. لا يمكن بدء الاستعادة من الذاكرة؛ اختر الملف المنزّل وافحصه أولاً.')}
  catch(error){console.error('Backup export failed:',error);backupSetStatus(error.message||'تعذر إنشاء النسخة.',true)}
  finally{modal.querySelector('#backupExportPassword').value='';modal.querySelector('#backupExportPasswordConfirm').value='';backupSetBusy(false)}
 });
 const fileInput=modal.querySelector('#backupRestoreFile'),passInput=modal.querySelector('#backupImportPassword'),validateButton=modal.querySelector('#backupValidateFile');
 const updateValidateState=()=>{validateButton.disabled=!(fileInput.files?.[0]&&passInput.value.length>=12)};
 fileInput.addEventListener('change',()=>{selectedBackup=null;modal.querySelector('#backupRestoreApply').disabled=true;modal.querySelector('#backupRestorePreview').textContent='اضغط «فحص النسخة ومعاينتها» بعد إدخال كلمة المرور.';backupSetStatus('');updateValidateState()});
 passInput.addEventListener('input',updateValidateState);
 validateButton.addEventListener('click',async()=>{
  if(busy)return;selectedBackup=null;modal.querySelector('#backupRestoreApply').disabled=true;backupSetBusy(true);backupSetStatus('جارٍ فك التشفير والتحقق من سلامة الملف...');
  try{selectedBackup=await backupParseFile(fileInput.files?.[0],passInput.value);backupRenderPreview(selectedBackup);backupSetStatus('تم فك التشفير والتحقق من الملف. راجع المعاينة قبل الاستعادة.')}
  catch(error){selectedBackup=null;modal.querySelector('#backupRestorePreview').textContent='';backupSetStatus(error.message||'تعذر التحقق من الملف.',true)}
  finally{passInput.value='';backupSetBusy(false);updateValidateState()}
 });
 modal.querySelector('#backupRestoreApply').addEventListener('click',async()=>{
  if(busy||!selectedBackup)return;
  const ok=confirm('سيتم دمج الإعدادات والبيانات الشخصية من النسخة. لن تُحذف البيانات الحالية ولن تُستعاد الرسائل المشتركة. هل تريد المتابعة؟');
  if(!ok)return;
  backupSetBusy(true);backupSetStatus('جارٍ استعادة البيانات الشخصية بشكل تدريجي...');
  try{
   const results=await backupRestore(selectedBackup);
   backupSetStatus('اكتملت الاستعادة. '+results.map(row=>row.name+': '+row.restored+' مستعاد، '+row.skipped+' متجاوز').join(' | '));
   selectedBackup=null;modal.querySelector('#backupRestoreFile').value='';modal.querySelector('#backupRestoreApply').disabled=true;backupToast('اكتملت استعادة البيانات الشخصية. حدّث الصفحة لتحديث الواجهات.');
  }catch(error){console.error('Backup restore failed:',error);backupSetStatus('قد تكون بعض الأقسام السابقة قد استُعيدت بالفعل. '+(error.message||'توقفت الاستعادة؛ راجع البيانات ثم أعد المحاولة.'),true)}
  finally{backupSetBusy(false)}
 });
 document.body.append(modal);modal.classList.add('open');
}
function backupInstallEntry(){
 const profileActions=document.querySelector('#sidebar .profile');
 if(!profileActions||document.getElementById('backupRestoreOpenBtn'))return;
 const button=document.createElement('button');
 button.id='backupRestoreOpenBtn';button.type='button';button.className='iconbtn';
 button.title='النسخ الاحتياطي والاستعادة';button.setAttribute('aria-label','النسخ الاحتياطي والاستعادة');
 button.innerHTML='<i class="ph ph-shield-check"></i>';
 button.addEventListener('click',backupOpenModal);
 const logout=document.getElementById('logoutBtn');
 if(logout)profileActions.insertBefore(button,logout);else profileActions.append(button);
 const style=document.createElement('style');
 style.textContent='.backup-modal{position:fixed;inset:0;z-index:180;display:none;place-items:center;padding:14px;background:#07111dcc;direction:rtl}.backup-modal.open{display:grid}.backup-dialog{width:min(100%,680px);max-height:94dvh;overflow:auto;border:1px solid var(--line);border-radius:16px;background:var(--panel);color:var(--text);box-shadow:0 20px 70px #0005}.backup-dialog>header{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;padding:15px 18px;background:var(--panel);border-bottom:1px solid var(--line)}.backup-dialog h2{margin:0;font-size:17px}.backup-dialog header p,.backup-content p{margin:5px 0 0;color:var(--muted);font-size:11px;line-height:1.7}.backup-dialog header button{width:34px;height:34px;border:1px solid var(--line);border-radius:9px;background:var(--panel2);color:var(--text);font-size:22px}.backup-content{display:grid;gap:12px;padding:14px}.backup-content section,.backup-warning{padding:13px;border:1px solid var(--line);border-radius:12px;background:var(--panel2)}.backup-content h3{margin:0;font-size:13px}.backup-primary,.backup-file-label{display:inline-flex;align-items:center;justify-content:center;gap:7px;margin-top:12px;padding:10px 13px;border:0;border-radius:9px;background:var(--accent);color:#fff;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.backup-primary:disabled{opacity:.45;cursor:not-allowed}.backup-file-label{background:var(--panel);border:1px solid var(--line);color:var(--text)}.backup-file-label input{max-width:190px;font-size:10px}.backup-secret-label{display:grid;gap:6px;margin-top:10px;color:var(--muted);font-size:11px}.backup-secret-label input{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--text);font:inherit}.backup-preview{max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;border-radius:9px;background:var(--panel);color:var(--muted);font:10px/1.8 ui-monospace,monospace}.backup-warning{border-color:#d49b3d66;background:#d49b3d0d;font-size:11px;line-height:1.8}.backup-warning ul{margin:7px 0 0;padding-inline-start:20px}.backup-warning strong{font-size:12px}.backup-content #backupRestoreStatus{min-height:20px;margin:0;color:var(--accent);font-size:11px;line-height:1.7;overflow-wrap:anywhere}.backup-content #backupRestoreStatus[data-state=error]{color:#d45b5b}@media(max-width:520px){.backup-modal{padding:7px}.backup-content{padding:9px}.backup-dialog{max-height:96dvh}}';
 document.head.append(style);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',backupInstallEntry,{once:true});
else backupInstallEntry();
})();
