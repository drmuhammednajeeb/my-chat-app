'use strict';
const assert=require('node:assert/strict');
const {create,storageKey}=require('../modules/app-theme.js');
function fixture({stored='system',dark=false}={}){
 const classes=new Set(),attrs={};let click,storageListener,mediaListener;
 const button={innerHTML:'',title:'',setAttribute:(k,v)=>attrs[k]=v,addEventListener:(name,fn)=>{if(name==='click')click=fn}};
 const root={classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)},dataset:{},style:{}};
 const store={value:stored,getItem:()=>store.value==='system'?null:store.value,setItem:(k,v)=>{store.value=v},removeItem:()=>{store.value='system'}};
 const media={matches:dark,addEventListener:(n,fn)=>mediaListener=fn};
 const win={__BIZMIND_THEME_PREFERENCE__:stored,matchMedia:()=>media,addEventListener:(n,fn)=>storageListener=fn};
 const doc={documentElement:root,getElementById:()=>button};
 const saved=[];
 const controller=create({window:win,document:doc,storage:store,media,saveUserSetting:async(k,v)=>saved.push([k,v]),toast:()=>{},logger:{warn:()=>{}}});
 return {controller,root,classes,attrs,store,init:()=>controller.init(),click:()=>click(),storage:e=>storageListener(e),system:()=>mediaListener(),saved,button};
}
{
 const f=fixture({stored:'dark'});f.init();assert.equal(f.root.dataset.theme,'dark');assert.ok(f.classes.has('dark'));assert.equal(f.attrs['aria-pressed'],'true');
}
{
 const f=fixture({stored:'system',dark:true});f.init();assert.equal(f.root.dataset.theme,'dark');f.controller.setPreference('light',true);assert.equal(f.root.dataset.theme,'light');assert.equal(f.store.value,'light');
 f.controller.setPreference('system',true);assert.equal(f.store.value,'system');
}
{
 const f=fixture();f.init();f.click();assert.equal(f.root.dataset.theme,'dark');
 f.storage({key:storageKey,newValue:'light'});assert.equal(f.root.dataset.theme,'light');
 f.storage({key:storageKey,newValue:null});assert.equal(f.root.dataset.theme,'light');
}
console.log('app-theme tests passed');
