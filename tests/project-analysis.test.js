const test=require('node:test'),assert=require('node:assert/strict');
const {assembleLayouts,chooseEmptyTracks,refinementInput,mergeRefinement}=require('../src/project-analysis');
const core=require('../src/core');
const rules=require('../skill/supermode/profile.json');
function fixture(){return {fps:30,endFrame:180,intervals:[{id:0,startFrame:0,endFrame:60},{id:1,startFrame:60,endFrame:120},{id:2,startFrame:120,endFrame:180}],probes:[{id:0,interval:0},{id:1,interval:0},{id:2,interval:1},{id:3,interval:1},{id:4,interval:2},{id:5,interval:2}]};}
const result=(id,layout,divider=.5,confidence=.99)=>({id,layout,divider,confidence,description:'Test-only picture classification'});
test('XML interval boundaries drive exact full/split/full caption splits from visual results',()=>{
  const m=fixture(),a=assembleLayouts(m,[result(0,'full'),result(1,'full'),result(2,'split',.6),result(3,'split',.6),result(4,'full'),result(5,'full')]);
  assert.equal(a.unresolved.length,0);assert.deepEqual(a.regions.map(r=>r.startFrame),[0,60,120]);
  const plan=core.planCaptions([{id:'one',start:1,end:5,text:'Growth 25%',timing:'cue-only'}],{width:1080,height:1920,fps:30,markers:a.markers},rules);
  assert.deepEqual(plan.captions.map(c=>[c.startFrame,c.endFrame]),[[30,60],[60,120],[120,150]]);
  assert.equal(plan.captions[1].y,1152);
});
test('Uncertain or changing in-clip layouts are flagged instead of invented timing',()=>{
  const m=fixture(),a=assembleLayouts(m,[result(0,'full'),result(1,'split'),result(2,'split',.5,.3),result(3,'split'),result(4,'full'),result(5,'full')]);
  assert.equal(a.unresolved.length,2);assert.equal(a.regions.length,1);assert.equal(a.regions[0].startFrame,120);
  assert.throws(()=>assembleLayouts(m,[result(0,'full')]),/omitted/);
  assert.throws(()=>assembleLayouts(m,[result(0,'full'),result(0,'full')]),/duplicate/);
});
test('Caption destination stays above existing picture and SFX uses an empty track',()=>{
  assert.deepEqual(chooseEmptyTracks({videoTracks:10,audioTracks:3,video:[{track:0},{track:8}],audio:[{track:0}]},2),{captionTrack:10,highlightTrack:11,appendVideoTracks:2,sfxTrack:2});
  assert.deepEqual(chooseEmptyTracks({videoTracks:3,audioTracks:1,video:[{track:2}],audio:[{track:0}]},2),{captionTrack:3,highlightTrack:4,appendVideoTracks:2,sfxTrack:null});
});
test('A layout change baked inside one XML clip is refined to the exact rendered frame',()=>{
 const manifest={fps:30,endFrame:30,sequenceName:'TEST ONLY',intervals:[{id:0,startFrame:0,endFrame:30}],probes:[{id:0,interval:0,frame:0},{id:1,interval:0,frame:29}]};
 const coarse=[result(0,'split'),result(1,'full')],refine=refinementInput(manifest,coarse);
 assert.equal(refine.probes.length,30);
 const merged=mergeRefinement(manifest,coarse,refine,refine.probes.map(p=>result(p.id,p.frame<13?'split':'full')));
 const layout=assembleLayouts(merged.manifest,merged.results);
 assert.equal(layout.unresolved.length,0);assert.deepEqual(layout.regions.map(r=>r.startFrame),[0,13]);
 assert.equal(layout.markers[1].start,13/30);
});

test('A targeted second pass resolves a boundary left low-confidence by the first pass',()=>{
 const m={fps:30,endFrame:30,sequenceName:'TEST ONLY',intervals:[{id:0,startFrame:0,endFrame:30}],probes:[{id:0,interval:0,frame:0},{id:1,interval:0,frame:29}]};
 const coarse=[result(0,'full'),result(1,'split')],first=refinementInput(m,coarse);
 const partial=mergeRefinement(m,coarse,first,first.probes.map(p=>result(p.id,p.frame<13?'full':'split',.5,p.frame<13?.75:.99)));
 assert.ok(assembleLayouts(partial.manifest,partial.results).unresolved.length);
 const second=refinementInput(partial.manifest,partial.results);
 const final=mergeRefinement(partial.manifest,partial.results,second,second.probes.map(p=>result(p.id,p.frame<13?'full':'split')));
 assert.equal(assembleLayouts(final.manifest,final.results).unresolved.length,0);
 assert.deepEqual(assembleLayouts(final.manifest,final.results).regions.map(r=>r.startFrame),[0,13]);
});
test('A detected hard cut can resolve two dark opening frames from agreeing same-scene samples',()=>{
 const m={fps:30,endFrame:30,sequenceName:'TEST ONLY',intervals:[{id:0,startFrame:0,endFrame:30}],probes:[]};
 const refined={...m,sceneCuts:[12],probes:Array.from({length:30},(_,frame)=>({id:frame,frame,time:frame/30,interval:0}))};
 const labels=refined.probes.map(p=>result(p.id,p.frame<12?'split':p.frame<14?'uncertain':'full',.5,p.frame<14&&p.frame>=12?.4:.99));
 const merged=mergeRefinement(m,[],refined,labels),a=assembleLayouts(merged.manifest,merged.results);
 assert.equal(a.unresolved.length,0);assert.deepEqual(a.regions.map(r=>r.startFrame),[0,12]);
 assert.equal(merged.results.filter(r=>r.resolvedBy).length,2);
 labels[12].description='Media offline: missing source';
 const failed=mergeRefinement(m,[],refined,labels);assert.ok(assembleLayouts(failed.manifest,failed.results).unresolved.length>0);
});
