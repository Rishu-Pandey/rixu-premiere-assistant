'use strict';
// Runs only the production visual-analysis code against an existing tool preview.
// It does not connect to Premiere, transcribe audio, or apply timeline edits.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {createPlanner}=require('../src/planner'),{classifySheet}=require('../src/visual-planner');
const {refinementInput,mergeRefinement,assembleLayouts}=require('../src/project-analysis');
async function main(){
 const folder=path.resolve(process.argv[2]),read=name=>JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'));
 const manifest=read('manifest.json'),results=read('classifications.json'),input=refinementInput(manifest,results);
 fs.writeFileSync(path.join(folder,'refinement-input.json'),JSON.stringify(input,null,2));
 const result=spawnSync(process.env.RIXU_PYTHON||'python',[path.join(__dirname,'project_analysis.py'),'refine',folder],{windowsHide:true,encoding:'utf8'});
 if(result.status!==0)throw Error(result.stderr);
 const runtime=path.resolve(__dirname,'../runtime/refinement-proof');fs.mkdirSync(runtime,{recursive:true});
 const provider=process.argv[3]||'codex',planner=createPlanner({runtime});planner.configure({provider});
 const refined=read('refinement-manifest.json'),extra=[];
 for(const [index,sheet] of refined.sheets.entries()){
   console.log('Production CLI refinement sheet '+(index+1)+' / '+refined.sheets.length);
   extra.push(...await classifySheet(planner,refined,sheet));
   fs.writeFileSync(path.join(folder,'refinement-classifications.json'),JSON.stringify(extra,null,2));
 }
 const merged=mergeRefinement(manifest,results,refined,extra),layout=assembleLayouts(merged.manifest,merged.results);
 fs.writeFileSync(path.join(folder,'cached-refinement-result.json'),JSON.stringify({manifest:merged.manifest,layout},null,2));
 const report={provider,render:manifest.render,initialProbeCount:manifest.probes.length,refinementProbeCount:refined.probes.length,remainingUnresolved:layout.unresolved.length,layoutRegions:layout.regions.length,timelineApplied:false,nativeTranscriptionVerified:false};
 fs.writeFileSync(path.join(__dirname,'../output/demo/live-project-analysis-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
