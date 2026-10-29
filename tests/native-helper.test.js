const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../uxp-native/main.js'),'utf8');
const transcript={language:'en-us',segments:[{words:[{start:0,duration:.5,text:'Revenue'}]}]};
function helper({existing=false,available=true,success=true}={}){
 let ready=existing,calls=0,options;
 const clip={kind:'clip',name:'Speech fixture',isSequence:async()=>false,getMediaFilePath:async()=> 'C:/fixture/speech.mp4'};
 const folder={kind:'folder',getItems:async()=>[clip]};
 const ppro={Project:{getActiveProject:async()=>({getRootItem:async()=>({getItems:async()=>[folder]})})},ClipProjectItem:{cast:i=>i.kind==='clip'?i:null},FolderItem:{cast:i=>i.kind==='folder'?i:null},Transcript:{
   exportToJSON:async()=>{if(!ready)throw Error('No transcript');return JSON.stringify(transcript);},
   isLanguagePackAvailable:async language=>{assert.equal(language,'en-US');return available;},
   transcribeClipProjectItem:async(item,o)=>{calls++;options=o;ready=success;return success;}
 }};
 const ctx={require:n=>n==='premierepro'?ppro:{entrypoints:{setup:()=>{}}},window:{RIXU_CONNECTION:{url:'http://127.0.0.1:1',token:'fixture'}},document:{getElementById:()=>({textContent:''})},setInterval:()=>0,setTimeout,fetch:async url=>{assert.ok(url.startsWith('http://127.0.0.1:1/'));return {ok:true,json:async()=>({})};}};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 return {run:()=>ctx.transcribe({paths:['C:/fixture/speech.mp4']}),calls:()=>calls,options:()=>options};
}
test('Native helper finds source clips inside project bins and reuses completed native transcripts',async()=>{
 const h=helper({existing:true,available:false}),r=await h.run();assert.equal(h.calls(),0);assert.equal(r.provider,'premiere_native');assert.equal(r.transcripts[0].transcript.segments[0].words[0].text,'Revenue');
});
test('Native helper requests English from Premiere and reads its exported word timings',async()=>{
 const h=helper(),r=await h.run();assert.equal(h.calls(),1);assert.equal(h.options().language,'en-US');assert.equal(r.transcripts[0].transcript.language,'en-us');
});
test('Missing native English language pack is reported before attempting transcription',async()=>{
 const h=helper({available:false});await assert.rejects(h.run(),/language pack is missing/);assert.equal(h.calls(),0);
});
test('Native transcription failure is surfaced without substituting another ASR provider',async()=>{
 const h=helper({success:false});await assert.rejects(h.run(),/Premiere transcription failed/);assert.equal(h.calls(),1);
});
