const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../panel/host.jsx'),'utf8');
function fixture({occupied=false,locked=false}={}){
  let mutations=0;
  const clips={numItems:occupied?1:0};if(occupied)clips[0]={start:{seconds:9},end:{seconds:10}};
  const track={clips,isLocked:()=>locked};
  const s={sequenceID:'test',markers:{getFirstMarker:()=>null},videoTracks:{0:track,numTracks:1},audioTracks:{0:track,numTracks:1},clone:()=>{mutations++;return true;}};
  const context={app:{project:{activeSequence:s}},File:function(){this.exists=true;},JSON,Math,Number,String,Error,Time:function(){}};
  context.$={global:context};vm.createContext(context);vm.runInContext(code,context);
  return {run:data=>JSON.parse(context.RIXU.dispatch(JSON.stringify({command:'apply',data:{sequenceId:'test',runId:'unique',duplicate:true,...data}}))),mutations:()=>mutations};
}
test('Host refuses occupied caption destinations before duplicating or importing media',()=>{
 const f=fixture({occupied:true}),r=f.run({graphics:[{path:'caption.png',start:1,end:2}],captionTrack:0});
 assert.match(r.error,/entirely empty/);assert.equal(f.mutations(),0);
});
test('Host refuses missing or locked tracks before mutation',()=>{
 const missing=fixture();assert.match(missing.run({graphics:[{path:'a.png',start:1,end:2}],captionTrack:2}).error,/Add destination/);assert.equal(missing.mutations(),0);
 const locked=fixture({locked:true});assert.match(locked.run({sounds:[{path:'a.wav',start:1,duration:.5,track:0}]}).error,/locked/);assert.equal(locked.mutations(),0);
});
test('Host rejects overlapping planned sounds before changing the sequence',()=>{
 const f=fixture(),r=f.run({sounds:[{path:'a.wav',start:1,duration:2,track:0},{path:'b.wav',start:2,duration:1,track:0}]});
 assert.match(r.error,/Planned clips overlap/);assert.equal(f.mutations(),0);
});

test('Native text requires a copy and non-overlapping clips on each role before mutation',()=>{
 const f=fixture(),row={path:'text.mogrt',role:'normal',start:1,end:3};
 assert.match(f.run({duplicate:false,textLayers:[row]}).error,/requires a sequence copy/);
 assert.match(f.run({textLayers:[row,{...row,start:2}]}).error,/overlap/);
 assert.match(f.run({textLayers:[{...row,path:'image.png'}]}).error,/Invalid native/);
 assert.equal(f.mutations(),0);
});
test('Premiere volume uses its +15 dB normalized parameter range',()=>{
 let value;
 const level={displayName:'Level',setValue:v=>{value=v;},getValue:()=>value};
 const clip={isSelected:()=>true,mediaType:'Audio',components:{numItems:1,0:{matchName:'Internal Volume Stereo',properties:{numItems:1,0:level}}}};
 const s={sequenceID:'test',videoTracks:{numTracks:0},audioTracks:{numTracks:1,0:{clips:{numItems:1,0:clip}}},markers:{getFirstMarker:()=>null,createMarker:()=>({})},name:'Fixture'};
 const ctx={app:{project:{activeSequence:s}},JSON,Math,Number,String,Error};ctx.$={global:ctx};vm.createContext(ctx);vm.runInContext(code,ctx);
 const r=JSON.parse(ctx.RIXU.dispatch(JSON.stringify({command:'apply',data:{sequenceId:'test',runId:'volume',duplicate:false,actions:[{type:'set_volume_selected',db:-12}]}})));
 assert.equal(r.error,undefined);assert.ok(Math.abs(value-.0446683592150963)<1e-10);
});

test('Analysis render restores sequence In/Out and playhead even when export fails',()=>{
 const state={start:3,end:9,position:'original-position'};
 const s={sequenceID:'test',getInPointAsTime:()=>({seconds:3}),getOutPointAsTime:()=>({seconds:9}),getPlayerPosition:()=>({ticks:'original-position'}),setInPoint:x=>state.start=x,setOutPoint:x=>state.end=x,setPlayerPosition:x=>state.position=x,exportAsFinalCutProXML:()=>true,exportAsMediaDirect:()=>{throw Error('test-only render failure');}};
 const context={app:{project:{activeSequence:s}},File:function(p){this.fsName=p;this.exists=true;},Folder:function(p){this.fsName=p;this.exists=true;},JSON,Math,Number,String,Error};
 context.$={global:context};vm.createContext(context);vm.runInContext(code,context);
 const result=JSON.parse(context.RIXU.dispatch(JSON.stringify({command:'export_analysis',data:{sequenceId:'test',folder:'test-only-folder',preset:'test-only.epr',duration:6}})));
 assert.match(result.error,/test-only render failure/);assert.deepEqual(state,{start:3,end:9,position:'original-position'});
});

test('Validation cleanup deletes only supplied owned IDs and preserves the active sequence',()=>{
 const active={sequenceID:'active',name:'RIXU Native Text Validation'},owned={sequenceID:'owned',name:'RIXU Native Text Validation'},other={sequenceID:'other',name:'User edit'},unlisted={sequenceID:'unlisted',name:'RIXU Native Text Validation'},removed=[];
 const project={activeSequence:active,sequences:{0:active,1:owned,2:other,3:unlisted,numSequences:4},deleteSequence:s=>{removed.push(s.sequenceID);return true;}};
 const ctx={app:{project},JSON,Math,Number,String,Error};ctx.$={global:ctx};vm.createContext(ctx);vm.runInContext(code,ctx);
 const r=JSON.parse(ctx.RIXU.dispatch(JSON.stringify({command:'cleanup_native_validation',data:{ids:['active','owned','other']}})));
 assert.equal(r.error,undefined);assert.deepEqual(removed,['owned']);assert.equal(r.activeSequenceId,'active');
});

test('Recovered native and SFX batches are idempotent after a lost reply, and reject edited timings',()=>{
 const runId='saved-run',context={sequenceId:'copy',textTracks:{normal:0,highlight:1}},marker={name:'RIXU RUN PENDING:'+runId,comments:JSON.stringify(context)};
 const native={name:'RIXU Caption word [Normal]',start:{seconds:1},end:{seconds:2}},sound={name:'RIXU SFX ['+runId+':0] cut',start:{seconds:1},end:{seconds:1.2}};
 const s={sequenceID:'copy',timebase:String(254016000000/30),videoTracks:{numTracks:2,0:{clips:{numItems:1,0:native}},1:{clips:{numItems:0}}},audioTracks:{numTracks:1,0:{clips:{numItems:1,0:sound}}},markers:{getFirstMarker:()=>marker,getNextMarker:()=>null}};
 const project={activeSequence:s,sequences:{numSequences:1,0:s},openSequence:()=>{}};
 const ctx={app:{project},File:function(){this.exists=true;},JSON,Math,Number,String,Error};ctx.$={global:ctx};vm.createContext(ctx);vm.runInContext(code,ctx);
 const data={sequenceId:'copy',runId,textLayers:[{id:'word',role:'normal',path:'word.mogrt',start:1,end:2}],sounds:[{path:'click.wav',track:0,start:1,duration:.2,reason:'cut',applicationIndex:0}]};
 const dispatch=(command,d)=>JSON.parse(ctx.RIXU.dispatch(JSON.stringify({command,data:d})));
 assert.equal(dispatch('apply_batch',data).placed,0);assert.equal(dispatch('apply_batch',data).placed,0);
 native.end.seconds=3;assert.match(dispatch('apply_batch',data).error,/recovered caption was edited/);
 assert.match(dispatch('apply_complete',{...data,sfxCount:1}).error,/caption is missing or changed/);
 native.end.seconds=2;assert.equal(dispatch('apply_complete',{...data,sfxCount:1}).captionCount,1);assert.equal(marker.name,'RIXU RUN:'+runId);
});

test('A semantic revision can activate only its original source in the owning project',()=>{
 const source={sequenceID:'source',name:'Original',getSettings:()=>({videoFrameWidth:1080,videoFrameHeight:1920}),timebase:String(254016000000/30),getPlayerPosition:()=>({seconds:0}),videoTracks:{numTracks:0},audioTracks:{numTracks:0},markers:{getFirstMarker:()=>null}};
 let opened=0;const project={path:'E:/Project/Edit.prproj',activeSequence:source,sequences:{numSequences:1,0:source},openSequence:()=>{opened++;}};
 const ctx={app:{version:'26.2',project},JSON,Math,Number,String,Error};ctx.$={global:ctx};vm.createContext(ctx);vm.runInContext(code,ctx);
 const run=data=>JSON.parse(ctx.RIXU.dispatch(JSON.stringify({command:'open_analysis_source',data})));
 assert.match(run({projectPath:'E:/Other/Edit.prproj',sequenceId:'source'}).error,/Open the project/);assert.equal(opened,0);
 assert.match(run({projectPath:project.path,sequenceId:'missing'}).error,/missing/);assert.equal(opened,0);
 assert.equal(run({projectPath:project.path,sequenceId:'source'}).sequenceId,'source');assert.equal(opened,1);
});

test('Level review changes only completed owned sounds and preflights the full batch',()=>{
 let value=0,writes=0;
 const level={displayName:'Level',setValue:v=>{value=v;writes++;},getValue:()=>value};
 const clip={name:'RIXU SFX [run:0] high',start:{seconds:2},components:{numItems:1,0:{matchName:'AE.ADBE Volume',properties:{numItems:1,0:level}}}};
 const marker={name:'RIXU RUN:run'},s={sequenceID:'copy',markers:{getFirstMarker:()=>marker,getNextMarker:()=>null},audioTracks:{numTracks:1,0:{clips:{numItems:1,0:clip}}}};
 const ctx={app:{project:{activeSequence:s}},JSON,Math,Number,String,Error};ctx.$={global:ctx};vm.createContext(ctx);vm.runInContext(code,ctx);
 const run=sounds=>JSON.parse(ctx.RIXU.dispatch(JSON.stringify({command:'set_sfx_levels',data:{sequenceId:'copy',runId:'run',sounds}})));
 assert.match(run([{reason:'high',track:0,start:2,gainDb:-10},{reason:'missing',track:0,start:3,gainDb:-10}]).error,/sound changed/);assert.equal(writes,0);
 assert.equal(run([{reason:'high',track:0,start:2,gainDb:-10}]).updated,1);assert.ok(Math.abs(value-Math.pow(10,(-10-15)/20))<1e-10);
 marker.name='User marker';assert.match(run([{reason:'high',track:0,start:2,gainDb:0}]).error,/owned copy/);assert.equal(writes,1);
});

test('Saving a completed application requires its exact project, sequence and ownership marker',()=>{
 let saves=0;const marker={name:'RIXU RUN:owned'},s={sequenceID:'copy',markers:{getFirstMarker:()=>marker,getNextMarker:()=>null}},project={path:'E:/Edit.prproj',activeSequence:s,save:()=>{saves++;}};
 const ctx={app:{project},JSON,Math,Number,String,Error};ctx.$={global:ctx};vm.createContext(ctx);vm.runInContext(code,ctx);
 const run=data=>JSON.parse(ctx.RIXU.dispatch(JSON.stringify({command:'save_completed_application',data:{sequenceId:'copy',runId:'owned',projectPath:project.path,...data}})));
 assert.match(run({projectPath:'E:/Other.prproj'}).error,/changed/);assert.equal(saves,0);
 assert.match(run({runId:'other'}).error,/owned run/);assert.equal(saves,0);assert.equal(run({}).saved,true);assert.equal(saves,1);
});
