const test=require('node:test'),assert=require('node:assert/strict'),{captionUnits,validateDesign,applyHighlights,planStoryCues}=require('../src/semantic-design');
const {cadenceReport,requestDesign,cadenceTargets}=require('../src/semantic-design');
const runs=text=>text.split(' ').map(text=>({text,emphasis:true,sizeScale:1.6}));
test('A word spanning a layout boundary retains one semantic decision even with native word timings',()=>{
 const first={id:'native-0',originId:'native',start:0,end:1,words:[{text:'not',start:0,end:.5},{text:'free',start:.5,end:1.5}],runs:runs('not free')};
 const second={id:'native-1',originId:'native',start:1,end:2,words:[{text:'free',start:.5,end:1.5},{text:'today',start:1.5,end:2}],runs:runs('free today')};
 const p={captions:[first,second]};assert.deepEqual(captionUnits(p).units[0].words,['not','free','today']);
 applyHighlights(p,{highlights:[{id:'native',words:[0,1],reason:'The negation is essential to the claim.'}]},{scale:1.6});
 assert.ok(first.runs.every(r=>r.emphasis));assert.equal(second.runs[0].emphasis,true);assert.equal(second.runs[1].emphasis,false);
});

test('The explicit three-second policy repairs sparse plans and checks actual high gaps and density',async()=>{
 const p={fps:25,layouts:[],captions:Array.from({length:12},(_,i)=>({id:'c-'+i,originId:'c-'+i,start:i,end:i+1,runs:runs('Claim')}))};
 const policy={highEverySeconds:3,highToleranceSeconds:.65,maxHighGapSeconds:3.6,targetClipsPerMinute:55,minimumClipsPerMinute:45,maximumClipsPerMinute:70};
 const cue=(time,role)=>({time,role,energy:role==='support'?'low':'high',group:'beat-'+time,query:'a short dry click',anchor:'onset',reason:'A supplied meaningful event.'});
 const complete={highlights:[],sfx:[...['0','3','6','9'].map(t=>cue(+t,t==='0'?'hook':'payoff')),...[1,2,4,5,7,8,10,11].map(t=>cue(t,'support'))],quiet:[],warnings:[]};
 let calls=0;const planner={request:async()=>{calls++;return calls===1?{...complete,sfx:[cue(0,'hook')]}:structuredClone(complete);}};
 const result=await requestDesign(planner,p,{instructions:'SUPERMODE',rules:{sfx:{cadence:policy},referenceStyle:{sfxPerMinute:29,palette:[]}}},null,'Every three seconds.');
 assert.equal(calls,2);const selected=planStoryCues(p,result,{sfxPerMinute:29,sfxMinGap:.3},[],policy),report=cadenceReport(selected,12,policy);
 assert.equal(report.passed,true);assert.equal(report.maxGapSeconds,3);assert.ok(selected.length>Math.round(29*12/60));
 assert.equal(cadenceReport(complete.sfx.filter(c=>c.role==='support'),12,policy).passed,false);
});
test('Invalid occurrence IDs and invented audio times cannot become a semantic edit',()=>{
 const p={fps:30,layouts:[],captions:[{id:'c-0',originId:'c',start:0,end:2,runs:runs('A longerWord 25%')}]};
 const d={highlights:[{id:'unknown',words:[0],reason:'Claim.'}],sfx:[],quiet:[],warnings:[]};
 assert.throws(()=>validateDesign(d,p),/occurrence/);d.highlights=[{id:'c',words:[3],reason:'Claim.'}];assert.throws(()=>validateDesign(d,p),/occurrence/);
 d.highlights=[];d.sfx=[{time:1,query:'click',anchor:'onset',role:'payoff',energy:'high',group:'claim',reason:'Claim.'}];assert.throws(()=>validateDesign(d,p),/supplied event/);
 d.sfx=[];validateDesign(d,p);applyHighlights(p,d,{scale:1.6});assert.ok(p.captions[0].runs.every(r=>!r.emphasis));
});
test('Dense candidate highs are spaced, and a discarded payoff cannot leave an orphaned build',()=>{
 const p={fps:30,layouts:[],captions:[{start:0,end:60,runs:[]}]},s={sfxPerMinute:29,sfxMinGap:.3};
 const cue=(time,role,group)=>({time,role,group,energy:'high',query:'a short soft low thump',reason:'Claim.',anchor:'onset'});
 const d={sfx:[cue(1,'payoff','first'),cue(2,'build','second'),cue(2,'payoff','second'),cue(10,'payoff','third')],quiet:[]};
 const selected=planStoryCues(p,d,s);assert.deepEqual(selected.map(c=>c.time),[1,10]);
});

test('Three-second coverage extends through the whole picture, with labelled audio-only resets after dialogue',()=>{
 const p={duration:10,fps:25,layouts:[],captions:[{id:'c-0',originId:'c',start:0,end:1,runs:runs('Opening')}]},policy={highEverySeconds:3,highToleranceSeconds:.65,maxHighGapSeconds:3.6};
 const targets=cadenceTargets(p,null,policy);assert.deepEqual(targets.map(t=>t.target),[0,3,6,9]);assert.ok(targets.slice(1).every(t=>t.audioOnly));
 const d={highlights:[],sfx:[{time:9,query:'a short recorded chime',anchor:'onset',role:'payoff',energy:'high',group:'outro',reason:'An explicitly requested audio cadence reset, with no invented visual event.'}],quiet:[],warnings:[]};
 assert.doesNotThrow(()=>validateDesign(d,p,[],[],policy));assert.throws(()=>validateDesign(d,p),/supplied event/);assert.equal(cadenceReport(d.sfx,10,policy).passed,false);
});
