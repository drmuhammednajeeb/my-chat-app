(function(){
 'use strict';
 const KEY='bizmindmakers-chat-theme';
 let preference=null;
 try{preference=localStorage.getItem(KEY)}catch(_){}
 if(preference!=='dark'&&preference!=='light')preference=null;
 const systemDark=!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
 const theme=preference||(systemDark?'dark':'light');
 const root=document.documentElement;
 root.classList.add('auth-booting');
 root.classList.toggle('dark',theme==='dark');
 root.classList.toggle('light',theme==='light');
 root.dataset.theme=theme;
 root.style.colorScheme=theme;
 window.__BIZMIND_THEME_PREFERENCE__=preference||'system';
})();