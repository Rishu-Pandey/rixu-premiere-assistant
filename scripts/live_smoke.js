// Run only against the isolated RIXU test project after its panel is connected.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),cfg=JSON.parse(fs.readFileSync(path.join(root,'runtime/connection.json')));
const out=path.join(root,'output/demo/live-smoke-report.json'),report={at:new Date().toISOString()};
async function api(route,data){const r=await fetch(cfg.url+route,{method:data===undefined?'GET':'POST',headers:{'X-RIXU-Token':cfg.token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw Error(value.error);return value;}
async function main(){
 if(process.argv.includes('--original')){const prior=JSON.parse(fs.readFileSync(out));await api('/api/dev/smoke',{operation:'open',sequenceId:prior.originalSequenceId});}
 report.before=await api('/api/snapshot');assert.match(report.before.projectPath,/output[\\/]demo[\\/]RIXU SUPERMODE TEST\.prproj$/i);
 report.originalSequenceId=report.before.sequenceId;
 const srt='1\n00:00:01,000 --> 00:00:05,000\nRevenue grew 25%\n';
 const plan=await api('/api/plan-supermode',{language:'hinglish',srt,sfx:true,style:'animated',instruction:'Emphasise figures and use a whoosh at layout changes.'});
 report.planId=plan.id;report.output=plan.output;report.plannedCaptions=plan.graphics;report.plannedSounds=plan.sounds;report.warnings=plan.captionPlan.warnings;report.unmatched=plan.unmatched;
 fs.writeFileSync(out,JSON.stringify(report,null,2));
 assert.deepEqual(plan.graphics.map(c=>[c.start,c.end,c.y]),[[1,2,1574],[2,4,960],[4,5,1574]]);
 report.applied=await api('/api/apply',{id:plan.id,captionTrack:1});fs.writeFileSync(out,JSON.stringify(report,null,2));
 report.after=await api('/api/dev/smoke',{operation:'inspect'});
 assert.notEqual(report.after.sequenceId,report.before.sequenceId);
 assert.equal(report.after.video.filter(c=>c.track===1).length,3);
 assert.deepEqual(report.after.video.filter(c=>c.track===0).map(c=>[c.start,c.end]),[[0,6]]);
 const actual=report.after.video.filter(c=>c.track===1).sort((a,b)=>a.start-b.start);
 assert.deepEqual(actual.map(c=>[c.start,c.end]),[[1,2],[2,4],[4,5]]);
 assert.equal(report.after.audio.length,plan.sounds.length);
 for(const sound of report.after.details.filter(c=>c.mediaType==='Audio')){const level=sound.components.find(c=>c.name==='Volume').properties.find(p=>p.name==='Level').value;assert.ok(Math.abs(level-Math.pow(10,(-12-15)/20))<.00001,'Actual Premiere volume must represent -12 dB');}
 report.passed=true;fs.writeFileSync(out,JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:true,captionCount:actual.length,sfxCount:report.after.audio.length,sequenceName:report.after.sequenceName,report:out}));
}
main().catch(error=>{report.error=error.message;fs.writeFileSync(out,JSON.stringify(report,null,2));console.error(error.message);process.exitCode=1;});
