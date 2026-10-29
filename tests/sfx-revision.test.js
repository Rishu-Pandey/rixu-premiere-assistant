const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../panel/host.jsx'),'utf8');
function fixture(userInLane=false){
 const list=(rows,key)=>{Object.defineProperty(rows,key,{get:()=>rows.length});return rows;};
 const markerList=()=>{const rows=[{name:'RIXU RUN:prior',comments:JSON.stringify({textTracks:{normal:0,highlight:1}}),start:{seconds:0},end:{seconds:0}}];return {rows,getFirstMarker:()=>rows[0]||null,getNextMarker:m=>rows[rows.indexOf(m)+1]||null,createMarker:()=>{const m={start:{seconds:0},end:{seconds:0}};rows.push(m);return m;}};};
 const clip=(name,id,rows)=>({nodeId:id,name,mediaType:'Audio',projectItem:{getMediaPath:()=>name+'.wav'},start:{seconds:0},end:{seconds:1},inPoint:{seconds:0},outPoint:{seconds:1},disabled:false,getSpeed:()=>1,isSpeedReversed:()=>false,isSelected:()=>false,setSelected:()=>{},remove(){rows.splice(rows.indexOf(this),1);}});
 function sequence(id){const voice=list([],'numItems'),sfx=list([],'numItems');voice.push(clip('User dialogue','voice-'+id,voice));sfx.push(clip(userInLane?'User music':'RIXU SFX prior','fx-'+id,sfx));return {sequenceID:id,name:'Original - SUPERMODE prior',getSettings:()=>({videoFrameWidth:1080,videoFrameHeight:1920}),getPlayerPosition:()=>({seconds:0}),timebase:String(254016000000/25),videoTracks:list([{clips:list([],'numItems')},{clips:list([],'numItems')}],'numTracks'),audioTracks:list([{clips:voice},{clips:sfx}],'numTracks'),markers:markerList()};}
 const source=sequence('source'),sequences=list([source],'numSequences');let clones=0;
 const project={activeSequence:source,sequences,openSequence:id=>{project.activeSequence=sequences.find(s=>s.sequenceID===id);}};
 source.clone=()=>{clones++;sequences.push(sequence('copy'));return true;};
 const ctx={app:{version:'26.2',project},File:function(){this.exists=true;},JSON,Math,Number,String,Error};ctx.$={global:ctx};vm.createContext(ctx);vm.runInContext(code,ctx);
 const run=sounds=>JSON.parse(ctx.RIXU.dispatch(JSON.stringify({command:'prepare_sfx_revision',data:{sequenceId:'source',sourceRunId:'prior',runId:'new-run',sounds:sounds||[{path:'click.wav',track:1,start:2,duration:.3}]}})));
 return {source,project,run,clones:()=>clones};
}
test('Sound-only revisions clone the owned sequence, reuse captions/tracks and replace only generated audio',()=>{
 const f=fixture(),r=f.run();assert.equal(r.error,undefined);assert.equal(r.captionsReused,true);assert.equal(r.replacedGeneratedSounds,1);assert.equal(f.clones(),1);
 assert.equal(f.source.audioTracks[1].clips.numItems,1);assert.equal(f.source.markers.rows[0].name,'RIXU RUN:prior');
 assert.equal(f.project.activeSequence.audioTracks.numTracks,2);assert.equal(f.project.activeSequence.videoTracks.numTracks,2);assert.equal(f.project.activeSequence.audioTracks[0].clips.numItems,1);assert.equal(f.project.activeSequence.audioTracks[1].clips.numItems,0);
 assert.ok(f.project.activeSequence.markers.rows.some(m=>m.name==='RIXU RUN PENDING:new-run'));assert.ok(!f.project.activeSequence.markers.rows.some(m=>m.name==='RIXU RUN:prior'));
});
test('Sound-only revisions refuse user media or planned overlaps before cloning',()=>{
 const occupied=fixture(true);assert.match(occupied.run().error,/user media/);assert.equal(occupied.clones(),0);
 const overlap=fixture();assert.match(overlap.run([{path:'a.wav',track:1,start:2,duration:1},{path:'b.wav',track:1,start:2.5,duration:1}]).error,/overlap/);assert.equal(overlap.clones(),0);
});
