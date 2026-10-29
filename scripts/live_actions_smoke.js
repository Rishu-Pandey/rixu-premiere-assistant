const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),cfg=JSON.parse(fs.readFileSync(path.join(root,'runtime/connection.json'))),supermode=JSON.parse(fs.readFileSync(path.join(root,'output/demo/live-smoke-report.json'))),report={at:new Date().toISOString(),steps:[]};
async function api(route,data){const r=await fetch(cfg.url+route,{method:data===undefined?'GET':'POST',headers:{'X-RIXU-Token':cfg.token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const v=await r.json();if(!r.ok)throw Error(v.error);return v;}
async function main(){
 await api('/api/dev/smoke',{operation:'open',sequenceId:supermode.originalSequenceId});
 await api('/api/dev/smoke',{operation:'select',mediaType:'video',track:0,index:0});
 for(const [instruction,expected] of [['trim selected clips by 1 seconds from end',[0,5]],['move selected clips by 1 seconds',[1,6]],['trim selected clips by 0.5 seconds from start',[1.5,6]]]){
   const p=await api('/api/plan',{instruction});const applied=await api('/api/apply',{id:p.id});const s=await api('/api/snapshot');
   assert.deepEqual([s.video[0].start,s.video[0].end],expected);report.steps.push({instruction,applied,snapshot:s});
 }
 await api('/api/dev/smoke',{operation:'open',sequenceId:supermode.originalSequenceId});const original=await api('/api/snapshot');assert.deepEqual([original.video[0].start,original.video[0].end],[0,6]);
 await api('/api/dev/smoke',{operation:'open',sequenceId:supermode.applied.sequenceId});await api('/api/dev/smoke',{operation:'seek',seconds:1.5});report.passed=true;
}
main().catch(e=>{report.error=e.message;process.exitCode=1;}).finally(()=>{const out=path.join(root,'output/demo/live-actions-report.json');fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed||false,error:report.error,checks:report.steps.length,report:out}));});
