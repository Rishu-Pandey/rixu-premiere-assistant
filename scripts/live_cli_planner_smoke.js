'use strict';
// Account-backed planning checks only: no Premiere jobs or timeline mutations.
const fs=require('node:fs'),path=require('node:path');
const {createPlanner}=require('../src/planner');
const schemas=require('../src/planner-schemas'),core=require('../src/core');
async function main(){
  const results=await Promise.allSettled(['codex','claude'].map(async provider=>{
    const runtime=path.join(__dirname,'../runtime/cli-smoke',provider);fs.mkdirSync(runtime,{recursive:true});
    const planner=createPlanner({runtime});planner.configure({provider});
    const plan=await planner.request([
      {role:'system',content:'Plan only the requested Premiere clip edit. Return actions, sound:{requested:false,query:"",start:0}, error:"". Only trim_selected with edge start/end and positive seconds is allowed. No tools or file access.'},
      {role:'user',content:'Shorten the selected clips by removing one and a half seconds from their ending.'}
    ],schemas.edit);
    core.assert(!plan.error,plan.error);core.validateActions(plan.actions);
    core.assert(plan.actions.length===1&&plan.actions[0].type==='trim_selected'&&plan.actions[0].edge==='end'&&plan.actions[0].seconds===1.5,'CLI returned an unexpected edit.');
    return {provider,passed:true,actions:plan.actions,timelineApplied:false};
  }));
  const report=results.map((r,i)=>r.status==='fulfilled'?r.value:{provider:['codex','claude'][i],passed:false,error:r.reason.message});
  fs.writeFileSync(path.join(__dirname,'../output/demo/live-cli-planner-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));if(report.some(r=>!r.passed))process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
