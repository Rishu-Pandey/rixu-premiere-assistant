const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),core=require('../src/core');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('Interrupted placement survives companion restart, releases a restarted Premiere job and resumes its saved plan',{timeout:20000},async t=>{
 const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'rixu-recovery-')),runtime=path.join(folder,'runtime'),output=path.join(folder,'output'),skill=path.join(folder,'skill');
 fs.mkdirSync(runtime);fs.mkdirSync(output);fs.cpSync(path.join(root,'skill/supermode'),skill,{recursive:true});
 const rules=JSON.parse(fs.readFileSync(path.join(skill,'profile.json'))),instructions=fs.readFileSync(path.join(skill,'SKILL.md'),'utf8'),revision=core.digest({rules,instructions});
 const id='11111111-1111-4111-8111-111111111111',planId='22222222-2222-4222-8222-222222222222',aFolder=path.join(output,'analysis-'+id),pFolder=path.join(output,planId);fs.mkdirSync(aFolder);fs.mkdirSync(pFolder);
 const original={sequenceId:'original',sequenceName:'Original',width:1080,height:1920,fps:30,videoTracks:1,audioTracks:1,video:[{id:'original-clip',index:0,name:'Picture',track:0,start:0,end:5,selected:false}],audio:[],markers:[],details:[]};
 const copy={...original,sequenceId:'copy',videoTracks:3,audioTracks:4,video:[{...original.video[0],id:'copied-clip'}]};
 const textLayers=Array.from({length:8},(_,i)=>({id:'caption-'+i,role:'normal',path:path.join(pFolder,i+'.mogrt'),start:i*.5,end:i*.5+.5}));
 const sounds=[{path:'fixture.wav',track:1,start:0,duration:.1},{path:'fixture.wav',track:2,start:1,duration:.1}];
 fs.writeFileSync(path.join(aFolder,'analysis.json'),JSON.stringify({id,output:aFolder,createdAt:new Date().toISOString(),status:'applying',message:'Lost host reply',snapshot:original,planId}));
 fs.writeFileSync(path.join(pFolder,'plan.json'),JSON.stringify({id:planId,output:pFolder,status:'prepared',skillRevision:revision,rules,captionPlan:{warnings:[]},textLayers,sounds,unmatched:[],appendAudioTracks:3}));
 let timer,polling=false;
 const port=56000+Math.floor(Math.random()*1000),child=spawn(process.execPath,[path.join(root,'src/server.js')],{windowsHide:true,env:{...process.env,RIXU_PORT:String(port),RIXU_RUNTIME:runtime,RIXU_OUTPUT:output,RIXU_SUPERMODE_DIR:skill}});t.after(async()=>{clearInterval(timer);while(polling)await delay(10);child.kill();});
 let cfg;for(let n=0;n<100;n++){if(fs.existsSync(path.join(runtime,'connection.json'))){cfg=JSON.parse(fs.readFileSync(path.join(runtime,'connection.json')));try{await fetch(cfg.url+'/health');break;}catch{}}await delay(20);}
 async function api(route,method='GET',data){const r=await fetch(cfg.url+route,{method,headers:{'Content-Type':'application/json','X-RIXU-Token':cfg.token},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,value:await r.json()};}
 let a=(await api('/api/analyse?id='+id)).value;assert.equal(a.status,'interrupted');assert.equal(a.canResume,true);
 let context=null,active=original,begins=0,batches=0,crashed=false;const commands=[];
 await api('/bridge/hello','POST',{kind:'cep',session:'old'});
 timer=setInterval(async()=>{if(polling)return;polling=true;try{const j=(await api('/bridge/poll?kind=cep')).value;if(!j)return;commands.push(j.command);let result;
  if(j.command==='inspect_application')result={matches:context?[{sequenceId:'copy',context,complete:false}]:[]};
  else if(j.command==='inspect_sequence')result=active;
  else if(j.command==='apply'){begins++;context={sequenceId:'copy',sequenceName:'Recovered copy',runId:planId,textTracks:{normal:1,highlight:2},originalPreserved:true};active=copy;result=context;assert.equal(j.data.batchMode,true);}
  else if(j.command==='open_application'){active=copy;result=copy;}
  else if(j.command==='apply_batch'){batches++;if(batches===2&&!crashed){crashed=true;await api('/bridge/hello','POST',{kind:'cep',session:'new'});return;}result={placed:(j.data.textLayers||j.data.sounds).length};}
  else if(j.command==='apply_complete')result={...context,captionCount:8,sfxCount:2};else throw Error(j.command);
  await api('/bridge/result','POST',{id:j.id,result});
 }finally{polling=false;}},10);
 const start=await api('/api/analyse','POST',{id});assert.equal(start.status,202);assert.equal(start.value.reusedPlan,true);
 const duplicate=await api('/api/analyse','POST',{language:'srt',srt:'different input'});assert.equal(duplicate.value.id,id);assert.equal(duplicate.value.existing,true);
 for(let n=0;n<200;n++){a=(await api('/api/analyse?id='+id)).value;if(a.status==='interrupted')break;await delay(15);}
 assert.equal(a.status,'interrupted',a.message);assert.match(a.message,/PREMIERE_RESTARTED/);assert.equal(a.application.textDone,4);
 assert.equal((await api('/api/analyse','POST',{id})).status,202);
 for(let n=0;n<250;n++){a=(await api('/api/analyse?id='+id)).value;if(['complete','failed','interrupted'].includes(a.status))break;await delay(15);}
 assert.equal(a.status,'complete',a.message);assert.equal(a.result.captionCount,8);assert.equal(a.result.sfxCount,2);assert.equal(begins,1);assert.equal(a.application.textDone,8);assert.equal(a.application.sfxDone,2);
 assert.ok(!commands.includes('export_analysis'));assert.ok(!commands.includes('transcribe_native'));
 const saved=JSON.parse(fs.readFileSync(path.join(aFolder,'analysis.json')));assert.equal(saved.status,'complete');
});
