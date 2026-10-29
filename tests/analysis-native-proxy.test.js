const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),core=require('../src/core');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('Analysed retimed dialogue uses Premiere native transcription on the sequence-timed proxy',{timeout:20000},async t=>{
 const base=path.resolve(os.tmpdir()),folder=fs.mkdtempSync(path.join(base,'rixu-native-proxy-test-')),runtime=path.join(folder,'runtime'),output=path.join(folder,'output'),skill=path.join(folder,'skill');
 fs.mkdirSync(runtime);fs.mkdirSync(output);fs.cpSync(path.join(__dirname,'../skill/supermode'),skill,{recursive:true});
 const id='00000000-1111-2222-3333-444444444444',analysisFolder=path.join(output,'analysis-'+id);fs.mkdirSync(analysisFolder);
 const proxy=path.join(analysisFolder,'dialogue.wav');fs.writeFileSync(proxy,'Test-only native transport fixture; never decoded as audio.');
 const snapshot={sequenceId:'fixture',sequenceName:'Native proxy test',width:1080,height:1920,fps:30,videoTracks:3,audioTracks:3,video:[{id:'v',track:0,start:0,end:6}],audio:[{name:'Retimed source',track:0,start:0,end:6,mediaPath:'not-used-source.mp4',speed:2}],markers:[],details:[]};
 const digest=core.digest({sequenceId:snapshot.sequenceId,video:snapshot.video,audio:snapshot.audio,markers:[],fps:30,width:1080,height:1920});
 fs.writeFileSync(path.join(analysisFolder,'analysis.json'),JSON.stringify({id,createdAt:new Date().toISOString(),status:'needs_transcript',snapshot,snapshotDigest:digest,tracks:{captionTrack:1,sfxTrack:2},render:{duration:6},layout:{unresolved:[],markers:[{name:'SUPERMODE:SPLIT',start:2}],visualEvents:[]}}));
 const port=51000+Math.floor(Math.random()*1000),child=spawn(process.execPath,[path.join(__dirname,'../src/server.js')],{windowsHide:true,env:{...process.env,RIXU_PORT:String(port),RIXU_RUNTIME:runtime,RIXU_OUTPUT:output,RIXU_SUPERMODE_DIR:skill,RIXU_AI_PROVIDER:'off',RIXU_AI_URL:'',RIXU_AI_MODEL:'',RIXU_AI_KEY:''}});
 let polling=false,timer,cfg,seen=[];t.after(async()=>{clearInterval(timer);while(polling)await delay(10);child.kill();});
 for(let n=0;n<100;n++){if(fs.existsSync(path.join(runtime,'connection.json'))){cfg=JSON.parse(fs.readFileSync(path.join(runtime,'connection.json')));break;}await delay(20);}assert.ok(cfg);
 async function api(route,method='GET',value){const r=await fetch(cfg.url+route,{method,headers:{'Content-Type':'application/json','X-RIXU-Token':cfg.token},body:value===undefined?undefined:JSON.stringify(value)});return {status:r.status,value:await r.json()};}
 await api('/bridge/hello','POST',{kind:'cep'});await api('/bridge/hello','POST',{kind:'uxp'});
 timer=setInterval(async()=>{if(polling)return;polling=true;try{for(const kind of ['cep','uxp']){const j=(await api('/bridge/poll?kind='+kind)).value;if(!j)continue;seen.push(j);let result;if(j.command==='snapshot'||j.command==='inspect_sequence')result=snapshot;else if(j.command==='import_transcription_proxy')result={imported:true};else if(j.command==='transcribe_native')result={provider:'premiere_native',transcripts:[{path:proxy,transcript:{segments:[{words:[{text:'Revenue',start:1,duration:.6},{text:'25%',start:2,duration:.5}]}]}}]};else throw Error(j.command);await api('/bridge/result','POST',{id:j.id,result});}}finally{polling=false;}},15);
 const r=await api('/api/plan-supermode','POST',{language:'english',englishSource:'connector',analysisId:id,sfx:false});
 assert.equal(r.status,200,JSON.stringify(r.value));assert.equal(r.value.nativeTranscription,true);assert.equal(r.value.captionSource,'premiere_native');
 assert.deepEqual(seen.find(j=>j.command==='transcribe_native').data.paths,[proxy]);
 assert.equal(seen.find(j=>j.command==='import_transcription_proxy').data.path,proxy);
 assert.equal(r.value.captionTrack,1);assert.ok(r.value.graphics.some(g=>g.layout==='split'));
 snapshot.details=[{id:'changed',components:[]}];
 assert.match((await api('/api/plan-supermode','POST',{language:'english',analysisId:id,sfx:false})).value.error,/effects or layout changed/);
});
