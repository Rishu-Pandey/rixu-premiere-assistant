'use strict';
const {assert}=require('./core');
const durationOf=plan=>Math.max(plan.duration||0,...plan.captions.map(c=>c.end));
function captionUnits(plan){
 const grouped=new Map(),maps=new Map();
 for(const c of plan.captions){
  const id=c.originId||c.id;
  if(!grouped.has(id))grouped.set(id,{id,start:c.start,end:c.end,words:[],keys:new Map()});
  const u=grouped.get(id);u.end=Math.max(u.end,c.end);const indices=[];
  if(c.words?.length){for(const w of c.words)for(const [i,text] of w.text.split(/\s+/).filter(Boolean).entries()){
   const key=w.start+':'+w.end+':'+i;if(!u.keys.has(key)){u.keys.set(key,u.words.length);u.words.push(text);}indices.push(u.keys.get(key));
  }}else {if(!u.words.length)u.words=c.runs.map(r=>r.text);assert(u.words.join(' ')===c.runs.map(r=>r.text).join(' '),'Layout pieces disagree about their source caption.');indices.push(...c.runs.map((_,i)=>i));}
  assert(indices.length===c.runs.length,'Caption word mapping is inconsistent.');maps.set(c.id,indices);
 }
 return {units:[...grouped.values()].map(({keys,...u})=>({...u,text:u.words.join(' ')})),maps};
}
function validateDesign(d,plan,visualEvents=[],sceneCuts=[],policy={}){
 const {units}=captionUnits(plan),byId=new Map(units.map(u=>[u.id,u]));
 assert(Array.isArray(d.highlights)&&d.highlights.length<=500,'The semantic planner must return caption-specific highlights.');
 for(const h of d.highlights){const u=byId.get(h.id);assert(u&&Array.isArray(h.words)&&h.words.length&&h.words.length<=u.words.length&&h.words.every(i=>Number.isInteger(i)&&i>=0&&i<u.words.length)&&new Set(h.words).size===h.words.length,'Invalid occurrence-specific highlight.');assert(typeof h.reason==='string'&&h.reason.trim()&&h.reason.length<=300,'A highlight needs a contextual reason.');}
 const duration=durationOf(plan);
 const allowed=plan.captions.flatMap(c=>[c.start,c.end]).concat(plan.layouts.map(l=>l.frame/plan.fps),visualEvents.map(e=>e.time),sceneCuts.map(f=>f/plan.fps),policy.highEverySeconds?cadenceTargets(plan,{layout:{visualEvents},sceneCuts},policy).filter(t=>t.audioOnly).map(t=>t.target):[]);
 assert(Array.isArray(d.sfx)&&d.sfx.length<=300,'Invalid semantic sound cues.');
 for(const c of d.sfx){assert(Number.isFinite(c.time)&&c.time>=0&&c.time<duration&&allowed.some(t=>Math.abs(t-c.time)<=1/plan.fps),'AI cue is outside the supplied event times.');assert(typeof c.query==='string'&&c.query.trim()&&c.query.length<=250&&['onset','peak'].includes(c.anchor),'Invalid AI sound description/anchor.');assert(['hook','build','payoff','support'].includes(c.role)&&['low','medium','high'].includes(c.energy)&&typeof c.group==='string'&&c.group.length<=80&&typeof c.reason==='string'&&c.reason.trim()&&c.reason.length<=300,'Sound cues need a story role, energy and reason.');}
 assert(Array.isArray(d.quiet)&&d.quiet.length<=100,'Invalid quiet intervals.');
 for(const q of d.quiet)assert(Number.isFinite(q.start)&&Number.isFinite(q.end)&&q.start>=0&&q.end>q.start&&q.end<=duration&&typeof q.reason==='string'&&q.reason.trim(),'Invalid intentional quiet interval.');
 d.warnings=Array.isArray(d.warnings)?d.warnings.filter(w=>typeof w==='string').slice(0,20):[];
 return d;
}
function applyHighlights(plan,design,rules){
 const {maps}=captionUnits(plan),keep=new Map();
 for(const h of design.highlights){if(!keep.has(h.id))keep.set(h.id,new Map());for(const word of h.words)keep.get(h.id).set(word,h.reason);}
 for(const c of plan.captions)c.runs=c.runs.map((r,i)=>{const reason=keep.get(c.originId||c.id)?.get(maps.get(c.id)[i]);return {...r,emphasis:!!reason,sizeScale:reason?rules.scale:1,...(reason?{emphasisReason:reason}:{})};});
 return plan;
}
function cadenceTargets(plan,analysis,policy){
 const duration=durationOf(plan),step=policy.highEverySeconds||3;
 const allowed=[...new Set(plan.captions.flatMap(c=>[c.start,c.end]).concat(plan.layouts.map(l=>l.frame/plan.fps),(analysis?.layout?.visualEvents||[]).map(e=>e.time),(analysis?.sceneCuts||[]).map(f=>f/plan.fps)))].filter(t=>t>=0&&t<duration).sort((a,b)=>a-b);
 const targets=[];for(let time=0;time<duration-.2;time+=step){const candidates=allowed.filter(t=>Math.abs(t-time)<=(time===0?1:policy.highToleranceSeconds||.65));targets.push({target:time,candidates:candidates.length?candidates:[time],audioOnly:!candidates.length});}
 return targets;
}
function cadenceReport(sounds,duration,policy){
 if(!policy?.highEverySeconds)return null;
 const highs=sounds.filter(c=>['hook','payoff'].includes(c.role)&&c.energy==='high').map(c=>c.time).sort((a,b)=>a-b);
 const missing=[];for(let t=0;t<duration-.2;t+=policy.highEverySeconds)if(!highs.some(h=>Math.abs(h-t)<=(t===0?1:policy.highToleranceSeconds||.65)))missing.push(t);
 const gaps=[...(highs.length?[highs[0],...highs.slice(1).map((h,i)=>h-highs[i]),duration-highs.at(-1)]:[duration])];
 const minimum=Math.floor((policy.minimumClipsPerMinute||0)*duration/60),maxGap=Math.max(...gaps);
 return {targetSeconds:policy.highEverySeconds,highs,missingTargets:missing,maxGapSeconds:Math.round(maxGap*1000)/1000,clipCount:sounds.length,minimumClips:minimum,passed:!missing.length&&maxGap<=(policy.maxHighGapSeconds||3.6)&&sounds.length>=minimum};
}
function planStoryCues(plan,design,style,existing=[],policy={}){
 const duration=durationOf(plan),limit=Math.max(0,Math.round((policy.maximumClipsPerMinute||style.sfxPerMinute)*duration/60)-existing.length),gap=style.sfxMinGap||.3;
 const priority=c=>({hook:5,payoff:5,build:4,support:1}[c.role])+({low:0,medium:.2,high:.4}[c.energy]);
 const paired=(a,b)=>a.group&&a.group===b.group&&((a.role==='build'&&b.role==='payoff')||(a.role==='payoff'&&b.role==='build'));
 const selected=[];
 for(const c of [...design.sfx].sort((a,b)=>priority(b)-priority(a)||a.time-b.time)){
  if(selected.length>=limit)break;
  if(existing.some(e=>Math.abs(e.start-c.time)<.15)||design.quiet.some(q=>c.time>=q.start&&c.time<q.end))continue;
  if(selected.some(s=>Math.abs(s.time-c.time)<gap&&!paired(c,s)))continue;
  if(['hook','payoff'].includes(c.role)&&selected.some(s=>['hook','payoff'].includes(s.role)&&Math.abs(s.time-c.time)<(policy.highEverySeconds?1.4:3)))continue;
  if(selected.some(s=>s.role===c.role&&Math.abs(s.time-c.time)<.1))continue;
  selected.push({...c,priority:priority(c),explicit:false,gainOffsetDb:policy.highEverySeconds?(c.energy==='low'?-4:c.energy==='medium'?-2:2):(c.energy==='low'?-6:c.energy==='medium'?-3:0)});
 }
 return selected.filter(c=>c.role!=='build'||c.group&&selected.some(p=>p.role==='payoff'&&p.group===c.group)).sort((a,b)=>a.time-b.time);
}
async function requestDesign(planner,plan,p,analysis,instruction){
 const units=captionUnits(plan).units,visualEvents=analysis?.layout?.visualEvents||[];
 const policy=p.rules.sfx.cadence||{},targets=policy.highEverySeconds?cadenceTargets(plan,analysis,policy):[];
 const messages=[
  {role:'system',content:`Plan occurrence-specific caption emphasis and story-led recorded sound design. Read the entire continuous transcript before selecting words. Select important claims, contrasts, named entities, meaningful figures and payoffs. Return exact unit IDs and zero-based word indices with a contextual reason. No frequency quota, word-length/capitalisation ranking, remembered vocabulary, or global keyword highlighting. Select the smallest meaningful phrase; leave connective and filler words normal unless a negation changes the claim. Repeated words can have different emphasis in different sentences. Do not highlight exporter watermarks or transcription notices. Never change wording, timing or layout.
Design an opening hook and recurring justified builds/payoffs with quieter support between them. Keep the lively reference pacing when the supplied visual events support it: follow the explicit cadence policy when supplied and the reference rate otherwise. Several purposeful low support cues can connect major highs; do not reduce a lively edit to only a handful of stings. A rising recorded sound may build toward a reveal; put its peak at the reveal, with an optional short payoff at the same supplied time and shared group. Use hook/build/payoff/support roles and low/medium/high energy. Quiet intervals should be brief resets, usually 0.2-1 seconds, rather than muting entire explanatory passages. Every support cue still needs a specific reveal, action, comparison, motion or emphasis reason; do not add unrelated sounds to fill gaps. Use explicit cadence targets when supplied; otherwise space major peaks. Queries describe recorded sounds and must match the event. Do not rotate categories. Use only supplied caption/layout/cut/visual-event times for SFX; no invented visual events. Select from available families. Keep speech intelligible and existing voice/music unchanged. Retention improvement is an editorial aim, not a measured promise. Return only the schema. ${p.instructions}`},
  {role:'user',content:JSON.stringify({instruction,transcript:units.map(u=>u.text).join(' '),units,layouts:plan.layouts,visualEvents,sceneCutTimes:(analysis?.sceneCuts||[]).map(f=>f/plan.fps),fps:plan.fps,highCadencePolicy:policy,cadenceTargets:targets,availableSoundFamilies:[...new Set((p.rules.referenceStyle.palette||[]).map(s=>s.family))]})}
 ];
 if(targets.length)messages[0].content+=' The user now explicitly requests MORE SFX and an intentional high point approximately EVERY THREE SECONDS throughout. This overrides the earlier minimum-three-second spacing and 29/min ceiling. Plan one high-energy hook/payoff near EVERY cadence target using its supplied candidate times, including the opening. Keep the maximum gap between highs below '+policy.maxHighGapSeconds+' seconds. Aim for '+policy.targetClipsPerMinute+' SFX/minute with purpose-specific support and recorded builds between highs; at least '+policy.minimumClipsPerMinute+'/minute, capped at '+policy.maximumClipsPerMinute+'/minute. This is the user pacing specification, not a retention guarantee. Use short quiet resets only when they do not erase a required high or build. Every cue still needs a content/visual reason; vary recorded sources and gestures rather than repeating one loud hit. Do not change highlight wording or timing.';
 if(targets.some(t=>t.audioOnly))messages[0].content+=' Targets labelled audioOnly are explicitly requested rhythmic resets without a supplied picture/word boundary. Use their given times and describe the auditory/narrative purpose; do not invent a visual action there. Cover the full picture duration, including any outro after dialogue.';
 let d;
 for(let attempt=0;attempt<2;attempt++){
  d=validateDesign(await planner.request(messages,require('./planner-schemas').storyDesign),plan,visualEvents,analysis?.sceneCuts||[],policy);
  const report=cadenceReport(planStoryCues(plan,d,p.rules.referenceStyle,[],policy),durationOf(plan),policy);
  if(!report||report.passed)return d;
  messages.push({role:'assistant',content:JSON.stringify(d)},{role:'user',content:'Repair this pacing audit using only the supplied event candidates. Preserve valid highlight decisions. '+JSON.stringify(report)});
 }
 throw Error('The planner could not satisfy the requested three-second high cadence. Saved analysis is preserved; no timeline changes were made.');
}
module.exports={captionUnits,validateDesign,applyHighlights,planStoryCues,requestDesign,cadenceTargets,cadenceReport};
