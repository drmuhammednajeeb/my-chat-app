'use strict';

/* BizmindMakers Chat Pro — theme service.
 * Owns theme preference and system-theme synchronization.
 * Depends only on browser APIs and the existing shared settings function at invocation time.
 */
const themeService = (() => {
 const STORAGE_KEY='bizmindmakers-chat-theme';
 let preference=window.__BIZMIND_THEME_PREFERENCE__||'system';
 const media=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;

 function apply(theme,save=false){
  const resolved=theme==='system'?(media?.matches?'dark':'light'):theme;
  const root=document.documentElement;
  root.classList.toggle('dark',resolved==='dark');
  root.classList.toggle('light',resolved==='light');
  root.dataset.theme=resolved;root.style.colorScheme=resolved;
  if(save){
   preference=theme;
   try{if(theme==='system')localStorage.removeItem(STORAGE_KEY);else localStorage.setItem(STORAGE_KEY,theme)}
   catch(error){console.warn('Theme preference storage unavailable:',error)}
  }
  const button=document.getElementById('appThemeToggle');
  if(button){button.innerHTML=resolved==='dark'?'<i class="ph ph-sun"></i>':'<i class="ph ph-moon"></i>';button.title=resolved==='dark'?'التبديل إلى الوضع الساطع':'التبديل إلى الوضع المظلم';button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(resolved==='dark'))}
 }

 function init(){
  if(media){
   const onSystemThemeChange=()=>{if(preference==='system')apply('system',false)};
   if(media.addEventListener)media.addEventListener('change',onSystemThemeChange);
   else if(media.addListener)media.addListener(onSystemThemeChange);
  }
  window.addEventListener('storage',event=>{
   if(event.key!==STORAGE_KEY)return;
   const next=event.newValue==='dark'||event.newValue==='light'?event.newValue:'system';
   preference=next;apply(next,false);
  });
  apply(preference,false);
 }

 function toggle(){
  const current=document.documentElement.dataset.theme||'light';
  const next=current==='dark'?'light':'dark';
  apply(next,true);
  void saveUserSetting('theme',next).catch(error=>{
   console.warn('Theme preference sync failed:',error);
   toast('تم تغيير المظهر على هذا الجهاز، وتعذرت مزامنته مع حسابك');
  });
 }

 return Object.freeze({init,apply,toggle,getPreference:()=>preference});
})();
