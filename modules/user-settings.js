(function(root){
 'use strict';
 const validTheme=value=>value==='dark'||value==='light'||value==='system';
 const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 function create(options){
  const settings=options||{};
  const getState=settings.getState||(()=>({}));
  const getClient=settings.getClient||(()=>null);
  const onThemePreference=settings.onThemePreference||(()=>{});
  const logger=settings.logger||{warn:()=>{}};
  async function load(){
   const state=getState(),userId=state.user&&state.user.id;
   if(!userId)return false;
   try{
    const client=getClient();
    if(!client)throw new Error('Supabase client is unavailable');
    const {data,error}=await client.from('user_settings').select('settings').eq('user_id',userId).maybeSingle();
    if(error)throw error;
    if(!getState().user||getState().user.id!==userId)return false;
    const userSettings=isRecord(data&&data.settings)?data.settings:{};
    state.userSettings=userSettings;
    if(validTheme(userSettings.theme))onThemePreference(userSettings.theme);
    return true;
   }catch(error){
    logger.warn('Account settings could not be loaded:',error&&error.message||error);
    return false;
   }
  }
  async function save(key,value){
   const state=getState(),userId=state.user&&state.user.id;
   if(!userId)return false;
   if(typeof key!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)||['__proto__','prototype','constructor'].includes(key)){
    throw new TypeError('Invalid user setting key');
   }
   const patch={};Object.defineProperty(patch,key,{value,enumerable:true,writable:true,configurable:true});
   const client=getClient();
   if(!client)throw new Error('Supabase client is unavailable');
   const {data,error}=await client.rpc('patch_my_user_settings',{p_patch:patch});
   if(error)throw error;
   const current=getState();
   if(!current.user||current.user.id!==userId)return false;
   current.userSettings=isRecord(data)?data:{...(isRecord(current.userSettings)?current.userSettings:{}),[key]:value};
   return true;
  }
  return Object.freeze({load,save});
 }
 const api=Object.freeze({create,isRecord,validTheme});
 root.BizmindUserSettings=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
