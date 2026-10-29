const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('Panel accepts one SRT and runs analysis, captions and SFX automatically without styling controls',async()=>{
 const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'web/index.html'),'utf8'),js=fs.readFileSync(path.join(root,'web/app.js'),'utf8'),ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1])),elements=new Map(),calls=[];
 assert.equal((html.match(/<select /g)||[]).length,1);assert.ok(!/id="(?:style|density|defaultLayout|fontSize|previewFirst|superToggle)"/.test(html));
 const el=id=>{assert.ok(ids.has(id),'Missing panel element '+id);if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,classList:{toggle(){}},dataset:{},files:[]});return elements.get(id);};
 const status={bridges:{cep:{connected:true}},ai:{configured:true,provider:'codex'}};
 const ctx={document:{getElementById:el,querySelectorAll:()=>[]},window:{RIXU_TOKEN:'fixture'},JSON,Error,Set,Promise,encodeURIComponent,setInterval:()=>0,setTimeout:fn=>fn(),fetch:async(route,opts)=>{calls.push({route,data:opts.body?JSON.parse(opts.body):null});return {ok:true,json:async()=>route==='/api/status'?status:route==='/api/analyse'?{id:'run'}:{id:'run',status:'complete',message:'Done',result:{sequenceName:'Copy',captionCount:3,sfxCount:2,textTracks:{normal:5,highlight:6}}}};}};
 vm.createContext(ctx);vm.runInContext(js,ctx);await new Promise(setImmediate);assert.equal(el('run').disabled,true);
 el('srtFile').files=[{name:'speech.srt',text:async()=> '1\n00:00:00,000 --> 00:00:01,000\nHello'}];await el('srtFile').onchange();assert.equal(el('run').disabled,false);await el('run').onclick();
 const request=calls.find(c=>c.route==='/api/analyse').data;assert.equal(request.language,'srt');assert.equal(request.autoApply,true);assert.equal(request.simple,true);assert.equal(request.style,'standard');assert.equal(request.sfx,true);assert.ok(request.srt.includes('Hello'));assert.equal(el('result').hidden,false);assert.ok(el('resultCounts').textContent.includes('2 SFX'));
});

test('Reopening the panel restores interrupted progress and resumes a saved plan without selecting SRT again',async()=>{
 const root=path.resolve(__dirname,'..'),elements=new Map(),calls=[];
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:true,disabled:false,classList:{toggle(){}},dataset:{},files:[]});return elements.get(id);};
 let complete=false;
 const saved={id:'saved-run',status:'interrupted',interruptedStage:'applying',planId:'saved-plan',canResume:true,message:'Saved 4 of 8 text layers.'};
 const ctx={document:{getElementById:el,querySelectorAll:()=>[]},window:{RIXU_TOKEN:'fixture'},setInterval:()=>0,setTimeout:fn=>fn(),encodeURIComponent,fetch:async(route,opts)=>{
   calls.push({route,data:opts.body?JSON.parse(opts.body):null});let result;
   if(route==='/api/status')result={bridges:{cep:{connected:true}},ai:{configured:true,provider:'codex'},latestAnalysis:saved};
   else if(route==='/api/analyse'){complete=true;result={id:saved.id};}
   else result=complete?{...saved,status:'complete',result:{sequenceName:'Recovered copy',captionCount:8,sfxCount:2,textTracks:{normal:1,highlight:2}}}:saved;
   return {ok:true,json:async()=>result};
 }};
 vm.runInNewContext(fs.readFileSync(path.join(root,'web/app.js'),'utf8'),ctx);await new Promise(setImmediate);
 assert.equal(el('progress').hidden,false);assert.match(el('status').textContent,/4 of 8/);assert.equal(el('retry').hidden,false);assert.equal(el('retry').disabled,false);assert.equal(el('run').disabled,true);
 await el('retry').onclick();assert.deepEqual(calls.find(c=>c.route==='/api/analyse').data,{id:'saved-run'});assert.equal(el('resultName').textContent,'Recovered copy');
});

test('An already prepared semantic revision exposes its apply button without another SRT',async()=>{
 const root=path.resolve(__dirname,'..'),elements=new Map();
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:true,disabled:false,classList:{toggle(){}},files:[]});return elements.get(id);};
 const saved={id:'prepared-revision',status:'prepared',planId:'plan',canResume:true,message:'Revised emphasis and sound are ready.'};
 const ctx={document:{getElementById:el,querySelectorAll:()=>[]},window:{RIXU_TOKEN:'fixture'},setInterval:()=>0,encodeURIComponent,fetch:async route=>({ok:true,json:async()=>route==='/api/status'?{bridges:{cep:{connected:true}},ai:{configured:true,provider:'codex'},latestAnalysis:saved}:saved})};
 vm.runInNewContext(fs.readFileSync(path.join(root,'web/app.js'),'utf8'),ctx);await new Promise(setImmediate);
 assert.equal(el('retry').hidden,false);assert.equal(el('retry').disabled,false);assert.equal(el('retry').textContent,'Apply saved captions & SFX');assert.equal(el('run').disabled,true);
});
