const test=require('node:test'),assert=require('node:assert/strict'),{emphasizeLikeReferences,planCues,laneFor}=require('../src/editing-style');
test('Only context-specific selected occurrences are enlarged, consistently across layout splits',()=>{
 const runs='the Model grew by 25% today'.split(' ').map(text=>({text,emphasis:false,sizeScale:1}));
 const p={captions:[{id:'cue-0',originId:'cue',runs},{id:'cue-1',originId:'cue',runs:structuredClone(runs)},{id:'other-0',originId:'other',runs:structuredClone(runs)}]};
 emphasizeLikeReferences(p,{highlightFraction:1,highlightWords:{model:100,today:100}},{highlights:[{id:'cue',words:[4],reason:'The actual result of the claim.'}]},{scale:1.6});
 assert.equal(p.captions[0].runs.filter(r=>r.emphasis).length,1);assert.equal(p.captions[0].runs[1].emphasis,false);assert.equal(p.captions[0].runs[4].emphasis,true);assert.deepEqual(p.captions[0].runs,p.captions[1].runs);assert.ok(p.captions[2].runs.every(r=>!r.emphasis));
});
test('The reference rate is a ceiling: only planned story events play, with quiet contrast and paired build/payoff',()=>{
 const p={fps:30,layouts:[],captions:[{originId:'end',start:59,end:60,runs:[]}]},a={sceneCuts:Array.from({length:60},(_,i)=>i*30),layout:{visualEvents:[]}},s={sfxPerMinute:29,sfxMinGap:.3,familyCycle:['click','riser']};
 const cue=(time,role,query,group='')=>({time,role,query,group,energy:role==='support'?'low':'high',reason:'A grounded story beat.',anchor:role==='build'?'peak':'onset'});
 const design={sfx:[cue(1,'hook','a short dry click'),cue(8,'build','a rising swell','reveal'),cue(8,'payoff','a soft low thump','reveal'),cue(11,'support','a short dry click'),cue(20,'payoff','a clear chime')],quiet:[{start:10,end:12,reason:'Let the explanation breathe.'}]};
 const cues=planCues(p,design,a,s);assert.equal(cues.length,4);assert.equal(cues.filter(c=>c.time===8).length,2);assert.ok(!cues.some(c=>c.time===11));assert.equal(cues[0].query,'a short dry click');assert.ok(cues.every(c=>design.sfx.some(d=>d.time===c.time&&d.query===c.query)));
 assert.equal(planCues(p,design,a,s,[{start:1}]).length,3);assert.deepEqual(planCues(p,{sfx:[],quiet:[]},a,s),[]);
});
test('Three SFX lanes preserve simultaneous decays and refuse a fourth overlapping sound',()=>{
 const rows=[{start:0,duration:2,track:4},{start:.2,duration:2,track:5}];assert.equal(laneFor(rows,.4,1,4,3),6);rows.push({start:.4,duration:1,track:6});assert.equal(laneFor(rows,.5,1,4,3),null);assert.equal(laneFor(rows,2.3,1,4,3),4);
});
