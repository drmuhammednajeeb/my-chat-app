(function(root){
 'use strict';
 const STORAGE_KEY='bizmindmakers-chat-theme';
 function create(options){
  const settings=options||{};
  const win=settings.window||root;
  const doc=settings.document||win.document;
  let storage=settings.storage;\n  if(!storage){try{storage=win.localStorage}catch(_){storage={getItem:()=>null,setItem:()=>{throw new Error('Storage unavailable')},removeItem:()=>{throw new Error('Storage unavailable')}}}}
  const media=settings.media|| (win.matchMedia?win.matchMedia('(prefers-color-scheme: dark)'):null);
  const saveUserSetting=settings.saveUserSetting||(()=>Promise.resolve(false));
  const toast=settings.toast||(()=>{});
  const logger=settings.logger||{warn:()=>{}};
  let preference=win.__BIZMIND_THEME_PREFERENCE__||'system';
  function apply(theme,save){
   const selected=['dark','light','system'].includes(theme)?theme:'system';
   const resolved=selected==='system'?(media&&media.matches?'dark':'light'):selected;
   const element=doc.documentElement;
   element.classList.toggle('dark',resolved==='dark');
   element.classList.toggle('light',resolved==='light');
   element.dataset.theme=resolved;element.style.colorScheme=resolved;
   if(save){
    preference=selected;
    try{if(selected==='system')storage.removeItem(STORAGE_KEY);else storage.setItem(STORAGE_KEY,selected)}
    catch(error){logger.warn('Theme preference storage unavailable:',error)}
   }
   const button=doc.getElementById('appThemeToggle');
   if(button){
    button.innerHTML=resolved==='dark'?'<i class="ph ph-sun"></i>':'<i class="ph ph-moon"></i>';
    button.title=resolved==='dark'?'التبديل إلى الوضع الساطع':'التبديل إلى الوضع المظلم';
    button.setAttribute('aria-label',button.title);
    button.setAttribute('aria-pressed',String(resolved==='dark'));
   }
   return resolved;
  }
  function setPreference(theme,save){if(!['dark','light','system'].includes(theme))return false;apply(theme,!!save);return true}
  function toggle(){
   const next=(doc.documentElement.dataset.theme||'light')==='dark'?'light':'dark';
   apply(next,true);
   Promise.resolve().then(()=>saveUserSetting('theme',next)).catch(error=>{
    logger.warn('Theme preference sync failed:',error);
    toast('تم تغيير المظهر على هذا الجهاز، وتعذرت مزامنته مع حسابك');
   });
  }
  function init(){
   const button=doc.getElementById('appThemeToggle');
   if(button)button.addEventListener('click',toggle);
   if(media){
    const onSystemChange=()=>{if(preference==='system')apply('system',false)};
    if(media.addEventListener)media.addEventListener('change',onSystemChange);
    else if(media.addListener)media.addListener(onSystemChange);
   }
   win.addEventListener('storage',event=>{
    if(event.key!==STORAGE_KEY)return;
    const next=event.newValue==='dark'||event.newValue==='light'?event.newValue:'system';
    preference=next;apply(next,false);
   });
   apply(preference,false);
   return api;
  }
  const api=Object.freeze({init,setPreference,apply:theme=>apply(theme,false),getPreference:()=>preference});
  return api;
 }
 root.BizmindAppTheme=Object.freeze({create,storageKey:STORAGE_KEY});
 if(typeof module!=='undefined'&&module.exports)module.exports=root.BizmindAppTheme;
})(typeof window!=='undefined'?window:globalThis);
