const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const c = require('../src/core');
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../skill/supermode/profile.json'), 'utf8'));
const sequence = { fps: 30, width: 1080, height: 1920, markers: [{name:'SUPERMODE:SPLIT:50%',start:2},{name:'SUPERMODE:FULL',start:4}] };
test('Hinglish SRT survives BOM, multiline text and timestamp offset',()=>{
  const cues=c.parseSrt('\uFEFF1\r\n00:00:01,250 --> 00:00:05,500\r\nYe ₹5,000 ka\r\nprofit hai.\r\n',2);
  assert.equal(cues[0].text,'Ye ₹5,000 ka profit hai.');assert.equal(cues[0].start,3.25);assert.equal(cues[0].end,7.5);
});
test('Malformed SRT fails instead of returning partial captions',()=>{
  assert.throws(()=>c.parseSrt('1\n00:00:80,000 --> 00:00:01,000\nBad'),/timestamp/);
  assert.throws(()=>c.parseSrt('1\n00:00:02,000 --> 00:00:01,000\nBad'),/Invalid/);
});
test('A cue crossing full/split/full becomes three frame-contiguous pieces',()=>{
  const p=c.planCaptions([{id:'a',start:1,end:5,text:'Growth is 25%',timing:'cue-only'}],sequence,rules);
  assert.deepEqual(p.captions.map(x=>[x.startFrame,x.endFrame,x.layout,x.y]),[[30,60,'full',Math.round(rules.layouts.fullY*1920)],[60,120,'split',960],[120,150,'full',Math.round(rules.layouts.fullY*1920)]]);
  assert.equal(p.warnings.length,1);assert.ok(p.captions.every(x=>x.text==='Growth is 25%'));
});
test('Word-timed native captions partition text by boundary without losing a crossing word',()=>{
  const cue={id:'a',start:1,end:3,text:'Revenue grows 25%',timing:'word-timed',words:[{text:'Revenue',start:1,end:1.5},{text:'grows',start:1.9,end:2.1},{text:'25%',start:2.2,end:3}]};
  const p=c.planCaptions([cue],sequence,rules);
  assert.equal(p.captions[0].text,'Revenue grows');assert.equal(p.captions[1].text,'grows 25%');
  assert.equal(p.captions[0].endFrame,p.captions[1].startFrame);
});
test('A layout marker at cue start takes effect immediately without zero-frame pieces',()=>{
  const p=c.planCaptions([{id:'a',start:2,end:4,text:'hello'}],sequence,rules);
  assert.equal(p.captions.length,1);assert.equal(p.captions[0].layout,'split');
});
test('Unequal horizontal split positions captions on the exact divider',()=>{
  const p=c.planCaptions([{id:'a',start:1,end:3,text:'hello'}],{...sequence,markers:[{name:'SUPERMODE:SPLIT:60%',start:0}]},rules);
  assert.equal(p.captions[0].y,1152);
});
test('Fractional sequence frame rates share the exact quantized boundary',()=>{
  const p=c.planCaptions([{id:'a',start:0,end:2,text:'hello'}],{...sequence,fps:24000/1001,markers:[{name:'SUPERMODE:SPLIT',start:1}]},rules);
  assert.equal(p.captions[0].endFrame,p.captions[1].startFrame);assert.equal(p.captions[0].end,p.captions[1].start);
});
test('Figures and explicitly configured key points have larger size',()=>{
  const runs=c.emphasize('Growth ₹5,000 and 25% zaroori',{...rules.emphasis,keywords:['growth','zaroori']});
  assert.equal(runs[0].emphasis,true);assert.equal(runs[1].sizeScale,rules.emphasis.scale);assert.equal(runs[2].sizeScale,1);assert.equal(runs[3].emphasis,true);assert.equal(runs[4].emphasis,true);
});
test('Source-native timestamps map through clip In points and timeline placement',()=>{
  const transcript={segments:[{words:[{text:'before',start:9,duration:.5},{text:'hello',start:11,duration:.5},{text:'after',start:17,duration:1}]}]};
  const words=c.wordsFromNative(transcript,{name:'take',start:3,end:8,inPoint:10,speed:1});
  assert.deepEqual(words.map(w=>[w.text,w.start,w.end]),[['hello',4,4.5]]);
  assert.throws(()=>c.wordsFromNative(transcript,{name:'take',start:3,end:8,inPoint:10,speed:2}),/normal-speed/);
});
test('A layout-split SRT cue does not create duplicate emphasis sound events',()=>{
  const p=c.planCaptions([{id:'a',start:1,end:5,text:'Revenue 25%'}],sequence,rules);
  const events=c.selectSfxCues(p,sequence.markers,rules,'emphasise figures');
  assert.equal(events.length,1);assert.equal(events[0].time,1);
});
test('Explicit SFX markers survive automatic density thinning',()=>{
  const p=c.planCaptions([{id:'a',start:1,end:1.2,text:'25%'}],sequence,rules);
  const events=c.selectSfxCues(p,[{name:'SFX:bell',start:1.1}],rules,'');
  assert.equal(events.length,2);assert.equal(events[1].explicit,true);
});
test('Direct command parser returns validated data, never executable scripts',()=>{
  assert.deepEqual(c.parseInstruction('trim selected clips by 2 seconds from end'),[{type:'trim_selected',seconds:2,edge:'end'}]);
  assert.deepEqual(c.parseInstruction('move selected clips by -1 seconds'),[{type:'move_selected',seconds:-1}]);
  assert.equal(c.parseInstruction('eval app.project.deleteEverything()'),null);
  assert.throws(()=>c.validateActions([{type:'eval',script:'arbitrary'}]),/Unsupported/);
  assert.throws(()=>c.validateActions([{type:'remove_selected'}]),/explicit ripple/);
});
test('SRT export round-trips timing and Unicode wording',()=>{
  const cues=[{start:1.125,end:2.875,text:'₹5 lakh ka profit'}];
  const round=c.parseSrt(c.toSrt(cues));assert.equal(round[0].text,cues[0].text);assert.equal(round[0].end,2.875);
});
test('SUPERMODE disallows silently changing its transcription/layout contract',()=>{
  assert.equal(c.validateRules(rules),rules);
  assert.throws(()=>c.validateRules({...rules,captions:{...rules.captions,hinglish:'automatic'}}),/requires SRT/);
});
