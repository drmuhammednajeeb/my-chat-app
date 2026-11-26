/* Privacy-safe performance analytics; classic-script facade for index.html. */
(function(global){
  'use strict';
  const STORAGE_KEY='bizmindmakers.chat.performance.v2',MAX=500;
  const metricNames=['startup_supabase_script','startup_get_session','startup_membership_check','profile_load','startup_shell_reveal','startup_conversations_load','conversations_load','profile_modal_open','directory_query','conversation_open','message_fetch','message_render_batch','message_render_item','message_load_total','realtime_subscribe','realtime_message_render'];
  let samples=[] ,timer=null,diagnosticsCallback=null;
  try{const parsed=JSON.parse(global.localStorage.getItem(STORAGE_KEY)||'[]');if(Array.isArray(parsed))samples=parsed.slice(-MAX);}catch(_){}
  function persist(){try{global.localStorage.setItem(STORAGE_KEY,JSON.stringify(samples));}catch(_){}timer=null;}
  function record(metric,duration,details={}){const sample={metric,ms:Math.round(Math.max(0,Number(duration)||0)*10)/10,at:Date.now(),...details};samples.push(sample);if(samples.length>MAX)samples.splice(0,samples.length-MAX);if(timer)global.clearTimeout(timer);timer=global.setTimeout(persist,1200);try{if(diagnosticsCallback&&diagnosticsCallback())diagnosticsCallback(true);}catch(_){}}
  function percentile(values,p){if(!values.length)return null;const sorted=values.slice().sort((a,b)=>a-b);const rank=Math.max(1,Math.ceil((Math.min(100,Math.max(0,p))/100)*sorted.length));return sorted[rank-1];}
  function summary(){const metrics={};for(const metric of metricNames){const values=samples.filter(x=>x.metric===metric).slice(-200).map(x=>x.ms);if(values.length)metrics[metric]={samples:values.length,avg_ms:Math.round(values.reduce((a,b)=>a+b,0)/values.length),p50_ms:percentile(values,50),p95_ms:percentile(values,95),p99_ms:percentile(values,99),max_ms:Math.max(...values)};}
    let resources=[];try{resources=global.performance.getEntriesByType('resource').filter(e=>/supabase\\.co\\/(rest|storage|auth|realtime)/i.test(e.name).slice(-100);}catch(_){}
    const network={supabase_resource_count:resources.length,reported_transfer_bytes:resources.reduce((s,e)=>s+(e.transferSize||0),0),reported_encoded_bytes:resources.reduce((s,e)=>s+(e.encodedBodySize||0),0),avg_resource_ms:resources.length?Math.round(resources.reduce((s,e)=>s+e.duration,0)/resources.length):0,bytes_may_be_zero_when_cross_origin_timing_is_restricted:true};
    let connection=null;try{const c=global.navigator.connection||global.navigator.mozConnection||global.navigator.webkitConnection;connection=c?{effectiveType:c.effectiveType||null,downlink_mbps:c.downlink||null,rtt_ms:c.rtt||null,saveData:!!c.saveData}:null;}catch(_){}
    return {metrics,network,connection,long_tasks:samples.filter(x=>x.metric==='long_task').slice(-10).map(x=>({ms:x.ms,at:x.at})),stored_samples:samples.length,storage:'local browser only'};
  }
  function initLongTasks(){if(typeof global.PerformanceObserver==='undefined')return null;try{const observer=new global.PerformanceObserver(list=>list.getEntries().forEach(e=>record('long_task',e.duration)));observer.observe({type:'longtask',buffered:true});return observer;}catch(_){return null;}}
  global.BizmindPerformanceAnalytics={record,persist,percentile,summary,setDiagnosticsCallback(cb){diagnosticsCallback=cb;},initLongTasks,getSamples(){return samples.slice();}};
  global.addEventListener('pagehide',persist,{capture:true});
})(window);
