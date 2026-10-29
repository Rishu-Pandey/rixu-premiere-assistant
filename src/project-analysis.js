'use strict';
const {assert,frame}=require('./core');
const layoutSchema={type:'object',properties:{probes:{type:'array',items:{type:'object',properties:{id:{type:'integer'},layout:{type:'string',enum:['full','split','uncertain']},divider:{type:'number'},confidence:{type:'number'},description:{type:'string'}},required:['id','layout','divider','confidence','description'],additionalProperties:false}}},required:['probes'],additionalProperties:false};

function assembleLayouts(manifest,results){
  const byId=new Map();
  for(const p of results){
    assert(Number.isInteger(p.id)&&manifest.probes.some(x=>x.id===p.id)&&!byId.has(p.id),'Visual analysis returned an unknown or duplicate frame ID.');
    assert(['full','split','uncertain'].includes(p.layout)&&Number.isFinite(p.confidence)&&p.confidence>=0&&p.confidence<=1,'Invalid visual layout classification.');
    assert(Number.isFinite(p.divider)&&p.divider>.05&&p.divider<.95,'The split divider is outside the picture.');
    assert(typeof p.description==='string'&&p.description.length<=500,'Invalid visual event description.');byId.set(p.id,p);
  }
  assert(byId.size===manifest.probes.length,'Visual analysis omitted sampled frames.');
  const regions=[],unresolved=[];
  for(const interval of manifest.intervals){
    const probes=manifest.probes.filter(p=>p.interval===interval.id).map(p=>byId.get(p.id));
    const layout=probes[0]?.layout;
    const split=probes.filter(p=>p.layout==='split');
    const minDivider=split.length?Math.min(...split.map(p=>p.divider)):.5,maxDivider=split.length?Math.max(...split.map(p=>p.divider)):.5;
    if(!probes.length||layout==='uncertain'||probes.some(p=>p.layout!==layout||p.confidence<.8)||maxDivider-minDivider>.025){unresolved.push({...interval,reason:'Rendered layout changes inside this XML interval or cannot be classified confidently.'});continue;}
    const divider=layout==='split'?split.reduce((sum,p)=>sum+p.divider,0)/split.length:.5;
    const prior=regions.at(-1);
    if(prior&&prior.endFrame===interval.startFrame&&prior.layout===layout&&Math.abs(prior.divider-divider)<.015)prior.endFrame=interval.endFrame;
    else regions.push({startFrame:interval.startFrame,endFrame:interval.endFrame,layout,divider,description:probes[Math.floor(probes.length/2)].description});
  }
  const markers=regions.map(r=>({name:r.layout==='full'?'SUPERMODE:FULL':'SUPERMODE:SPLIT:'+((r.divider*100).toFixed(3))+'%',start:r.startFrame/manifest.fps}));
  return {regions,unresolved,markers,visualEvents:manifest.intervals.map(i=>({time:i.startFrame/manifest.fps,description:byId.get(manifest.probes.find(p=>p.interval===i.id)?.id)?.description||''}))};
}

function chooseEmptyTracks(snapshot,preferredAudio){
  const videoUsed=new Set(snapshot.video.map(c=>c.track)),audioUsed=new Set(snapshot.audio.map(c=>c.track));
  const captionTrack=snapshot.videoTracks,highlightTrack=captionTrack+1;
  let sfxTrack=preferredAudio;
  if(sfxTrack>=snapshot.audioTracks||audioUsed.has(sfxTrack))sfxTrack=Array.from({length:snapshot.audioTracks},(_,i)=>i).find(i=>!audioUsed.has(i));
  return {captionTrack,highlightTrack,appendVideoTracks:2,sfxTrack:sfxTrack??null};
}
function refinementInput(manifest,results){
  const byId=new Map(results.map(r=>[r.id,r])),needed=new Set();
  for(const interval of assembleLayouts(manifest,results).unresolved){
    const probes=manifest.probes.filter(p=>p.interval===interval.id).sort((a,b)=>a.frame-b.frame);
    for(let i=0;i<probes.length;i++){
      const p=probes[i],r=byId.get(p.id);
      if(r.layout==='uncertain'||r.confidence<.8)needed.add(p.frame);
      if(i){const prev=probes[i-1],v=byId.get(prev.id);if(r.layout!==v.layout||r.layout==='uncertain'||v.layout==='uncertain'||r.confidence<.8||v.confidence<.8)for(let f=prev.frame;f<=p.frame;f++)needed.add(f);}
    }
  }
  assert(needed.size<=900,'Too many ambiguous frames for automatic refinement. Review the preview before continuing.');
  return {...manifest,sheets:[],probes:[...needed].sort((a,b)=>a-b).map((f,i)=>({id:100000+i,frame:f,time:f/manifest.fps,interval:manifest.intervals.find(x=>x.startFrame<=f&&f<x.endFrame).id}))};
}
function mergeRefinement(manifest,results,refinedManifest,refinedResults){
  const byFrame=new Map(),orig=new Map(results.map(r=>[r.id,r])),extra=new Map(refinedResults.map(r=>[r.id,r]));
  for(const p of manifest.probes)byFrame.set(p.frame,{...p,result:orig.get(p.id)});
  for(const p of refinedManifest.probes){assert(extra.has(p.id),'Refinement omitted a frame.');byFrame.set(p.frame,{...p,result:extra.get(p.id)});}
  const sceneCuts=[...(manifest.sceneCuts||[]),...(refinedManifest.sceneCuts||[])].filter(f=>Number.isInteger(f)&&f>0&&f<manifest.endFrame);
  const rows=[...byFrame.values()].sort((a,b)=>a.frame-b.frame),cuts=new Set([...manifest.intervals.flatMap(i=>[i.startFrame,i.endFrame]),...sceneCuts]);
  for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i];if(b.frame-a.frame===1&&a.result.confidence>=.8&&b.result.confidence>=.8&&['full','split'].includes(a.result.layout)&&['full','split'].includes(b.result.layout)&&a.result.layout!==b.result.layout)cuts.add(b.frame);}
  const boundaries=[...cuts].sort((a,b)=>a-b),intervals=boundaries.slice(0,-1).map((f,i)=>({id:i,startFrame:f,endFrame:boundaries[i+1],clips:manifest.intervals.find(x=>x.startFrame<=f&&f<x.endFrame)?.clips||[]}));
  const probes=rows.map((r,i)=>({id:i,frame:r.frame,time:r.frame/manifest.fps,interval:intervals.find(x=>x.startFrame<=r.frame&&r.frame<x.endFrame).id}));
  const finalResults=rows.map((r,i)=>({...r.result,id:i}));
  // A hard-cut scene can begin with one or two dark transition frames. Resolve
  // those only from multiple agreeing, confident samples in that same scene.
  // Missing-media errors and contradictory layouts always remain unresolved.
  for(const interval of intervals){
    const samples=probes.filter(p=>p.interval===interval.id).map(p=>({p,r:finalResults[p.id]}));
    const strong=samples.filter(x=>x.r.layout!=='uncertain'&&x.r.confidence>=.8);
    if(strong.length<2)continue;
    const layout=strong[0].r.layout;
    if(strong.some(x=>x.r.layout!==layout)||samples.some(x=>x.r.layout!=='uncertain'&&x.r.layout!==layout))continue;
    if(samples.some(x=>/offline|missing.media|render.error|media.pending/i.test(x.r.description)))continue;
    if(samples.some(x=>x.r.layout==='uncertain'&&(x.p.frame>interval.startFrame+1||!/./.test(x.r.description))))continue;
    const sceneCut=sceneCuts.includes(interval.startFrame);
    if(samples.some(x=>x.r.layout==='uncertain')&&!sceneCut)continue;
    const confidence=Math.min(...strong.map(x=>x.r.confidence));
    const divider=strong.reduce((sum,x)=>sum+x.r.divider,0)/strong.length;
    if(layout==='split'&&strong.some(x=>Math.abs(x.r.divider-divider)>.015))continue;
    for(const {r} of samples)if(r.layout==='uncertain'||r.confidence<.8){r.originalConfidence=r.confidence;r.layout=layout;r.divider=divider;r.confidence=confidence;r.resolvedBy='agreement within a detected hard-cut scene';}
  }
  return {manifest:{...manifest,sceneCuts:[...new Set([...(manifest.sceneCuts||[]),...(refinedManifest.sceneCuts||[])])],intervals,probes},results:finalResults};
}
module.exports={layoutSchema,assembleLayouts,chooseEmptyTracks,refinementInput,mergeRefinement};
