// Uses Premiere's native transcription on the labelled synthetic English speech fixture.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),cfg=JSON.parse(fs.readFileSync(path.join(root,'runtime/connection.json'))),report={at:new Date().toISOString(),speechFixture:'Synthetic Windows English speech for software testing only'};
async function api(route,data){const r=await fetch(cfg.url+route,{method:data===undefined?'GET':'POST',headers:{'X-RIXU-Token':cfg.token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw Error(value.error);return value;}
async function main(){
 const status=await api('/api/status');assert.ok(status.bridges.uxp?.connected,'Load the native transcription helper first.');
 report.before=await api('/api/dev/smoke',{operation:'native_fixture'});
 const plan=await api('/api/plan-supermode',{language:'english',dialogueTrack:0,sfx:false,style:'standard',instruction:'English captions with larger figures and important words'});
 assert.equal(plan.nativeTranscription,true);assert.ok(plan.graphics.length>0);report.planId=plan.id;report.output=plan.output;report.captionPlan=plan.captionPlan;
 const text=plan.graphics.map(c=>c.text).join(' ');assert.match(text,/revenue/i);assert.match(text,/caption|english/i);
 report.applied=await api('/api/apply',{id:plan.id,captionTrack:1});
 report.after=await api('/api/dev/smoke',{operation:'inspect'});
 assert.equal(report.after.video.filter(c=>c.track===1).length,plan.graphics.length);assert.equal(report.after.animations.length,0,'Plain captions must have no scale animation');
 assert.notEqual(report.after.sequenceId,report.before.sequenceId);report.passed=true;
}
main().catch(e=>{report.error=e.message;process.exitCode=1;}).finally(()=>{const out=path.join(root,'output/demo/live-native-report.json');fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:!!report.passed,error:report.error,report:out}));});
