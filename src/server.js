'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const core = require('./core');
const { parseSfxInstruction, namedMatches } = require('./sfx-commands');
const { createPlanner } = require('./planner');
const plannerSchemas = require('./planner-schemas');
const projectAnalysis = require('./project-analysis');
const {classifySheet}=require('./visual-planner');
const editingStyle=require('./editing-style');
const semanticDesign=require('./semantic-design');
const ROOT = path.resolve(__dirname, '..');
const RUNTIME = process.env.RIXU_RUNTIME || path.join(ROOT, 'runtime');
const OUTPUT = process.env.RIXU_OUTPUT || path.join(ROOT, 'output');
const AUDIT = process.env.RIXU_LIBRARY_AUDIT || path.join(ROOT, 'library-audit');
const SKILL = process.env.RIXU_SUPERMODE_DIR || path.join(os.homedir(), '.codex', 'skills', 'supermode');
const PORT = +(process.env.RIXU_PORT || 48163);
fs.mkdirSync(RUNTIME, { recursive: true }); fs.mkdirSync(OUTPUT, { recursive: true });
const TOKEN_FILE = path.join(RUNTIME, 'token.txt');
if (!fs.existsSync(TOKEN_FILE)) fs.writeFileSync(TOKEN_FILE, crypto.randomBytes(32).toString('hex'));
const TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
const connection = { url: `http://127.0.0.1:${PORT}`, token: TOKEN, root: ROOT };
fs.writeFileSync(path.join(RUNTIME, 'connection.json'), JSON.stringify(connection, null, 2));
const bridges = new Map(), jobs = new Map(), plans = new Map(), history = [];
const analyses = new Map();let analysisBusy=false,activeAnalysisId=null;
function saveAnalysis(a){a.updatedAt=new Date().toISOString();const file=path.join(a.output,'analysis.json');fs.writeFileSync(file+'.tmp',JSON.stringify(a,null,2));fs.renameSync(file+'.tmp',file);}
function analysisPhase(a,status,message){a.status=status;a.message=message;saveAnalysis(a);}
function analysisFailure(a,error){const interrupted=a.status==='applying'||/PREMIERE_RESTARTED|PREMIERE_DISCONNECTED/.test(error.message);if(a.status==='applying'&&plans.has(a.planId)){const p=plans.get(a.planId);p.status='needs-inspection';fs.writeFileSync(path.join(p.output,'plan.json'),JSON.stringify(p,null,2));}a.interruptedStage=a.status;analysisPhase(a,interrupted?'interrupted':'failed',error.message+(interrupted?' Saved progress is available. Resume this run when Premiere is ready.':''));}
for(const entry of fs.readdirSync(OUTPUT,{withFileTypes:true}))if(entry.isDirectory()&&/^analysis-[0-9a-f-]{36}$/.test(entry.name)){
  try{const file=path.join(OUTPUT,entry.name,'analysis.json'),a=readJson(file);if(a.id!==entry.name.slice(9))continue;a.output=path.join(OUTPUT,entry.name);
    if(!['needs_transcript','needs_review','needs_tracks','failed','prepared','complete','interrupted'].includes(a.status)){a.interruptedStage=a.status;a.status='interrupted';a.message='The companion restarted. Resume the saved run; completed analysis and plans are preserved.';saveAnalysis(a);}
    analyses.set(a.id,a);
    if(/^[0-9a-f-]{36}$/.test(a.planId||'')){
      const file=path.join(OUTPUT,a.planId,'plan.json');
      if(fs.existsSync(file)){const p=readJson(file);if(p.id===a.planId&&p.textLayers){p.status=a.status==='complete'?'applied':'prepared';plans.set(p.id,p);}}
      if(a.status==='complete'&&a.result)history.push({id:a.planId,at:a.createdAt,result:a.result});
    }
  }catch(_){}
}
const planner = createPlanner({runtime:RUNTIME,timeoutMs:180000});
let earshotWorker = null;
const earshotPending = new Map();
function scoreQuery(query) {
  if (!earshotWorker) {
    const python = process.env.RIXU_EARSHOT_PYTHON || path.join(ROOT, '.tools/earshot-env/Scripts/python.exe');
    core.assert(fs.existsSync(python), 'Live semantic search needs the local Earshot environment. Cached standard sound categories remain available.');
    earshotWorker = spawn(python, [path.join(ROOT, 'scripts/earshot_worker.py')], { cwd: ROOT, windowsHide: true, env: { ...process.env, PYTHONUTF8:'1' } });
    const log = fs.createWriteStream(path.join(RUNTIME, 'earshot-worker.log'), {flags:'a'}); earshotWorker.stderr.pipe(log);
    readline.createInterface({ input: earshotWorker.stdout }).on('line', line => {
      try { const result=JSON.parse(line), pending=earshotPending.get(result.id); if(pending){clearTimeout(pending.timer);earshotPending.delete(result.id);result.error?pending.reject(new Error(result.error)):pending.resolve(result.results);} } catch (_) {}
    });
    const fail = error => { for (const p of earshotPending.values()) {clearTimeout(p.timer);p.reject(new Error('Earshot worker failed: '+error));} earshotPending.clear();earshotWorker=null; };
    earshotWorker.on('error', fail);earshotWorker.on('exit', code => fail('exit '+code));
  }
  return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{earshotPending.delete(id);reject(new Error('Earshot query timed out. Inspect runtime/earshot-worker.log.'));},240000);earshotPending.set(id,{resolve,reject,timer});earshotWorker.stdin.write(JSON.stringify({id,query})+'\n');});
}
process.on('exit', ()=>earshotWorker?.kill());
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }
function profile() {
  const rules = core.validateRules(readJson(path.join(SKILL, 'profile.json')));
  const instructions = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  return { rules, instructions, revision: core.digest({ rules, instructions }), path: SKILL };
}
function send(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req) {
  let text = ''; for await (const part of req) { text += part; if (text.length > 12e6) throw new Error('Request is too large.'); }
  return text ? JSON.parse(text) : {};
}
function connected(kind) { const b = bridges.get(kind); return !!b && Date.now() - b.lastSeen < 5000; }
function job(kind, command, data = {}, timeout = 45000) {
  if (!connected(kind)) return Promise.reject(new Error(kind === 'uxp' ? 'Native transcription connector is offline. Load the bundled UXP Native Transcription helper, or export an English SRT from Premiere’s Text panel.' : 'Premiere panel bridge is offline. Open RIXU Assistant under Window > Extensions.'));
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { jobs.delete(id); reject(new Error(`${command} timed out; inspect Premiere before retrying.`)); }, timeout);
    jobs.set(id, { id, kind, command, data, taken: false, resolve: value => { clearTimeout(timer); jobs.delete(id); resolve(value); }, reject: reason => { clearTimeout(timer); jobs.delete(id); reject(new Error(reason)); } });
  });
}
setInterval(()=>{for(const [kind,b] of bridges)if(Date.now()-b.lastSeen>15000)for(const j of [...jobs.values()])if(j.kind===kind)j.reject('PREMIERE_DISCONNECTED: Premiere stopped responding.');},2000).unref();
async function snapshot() { return job('cep', 'snapshot'); }
function snapshotDigest(s) { return core.digest({ sequenceId: s.sequenceId, video: s.video, audio: s.audio, markers: s.markers, fps: s.fps, width: s.width, height: s.height }); }
function isGeneratedCaption(c){
  if(!/^RIXU Caption /.test(c.name||''))return false;
  if(/\[(Normal|Highlight)\]$/.test(c.name))return true;
  const p=String(c.mediaPath||'').replaceAll('\\','/').toLowerCase(),root=OUTPUT.replaceAll('\\','/').toLowerCase();
  return p.startsWith(root+'/')&&/\/graphics\/[^/]+\.png$/.test(p);
}
function inspectionDigest(s){return core.digest({snapshot:snapshotDigest(s),details:(s.details||[]).map(d=>({...d,components:d.components.map(c=>({...c,properties:c.properties.map(p=>({...p,value:p.keys?.length?null:p.value}))}))}))});}
function sourceInspectionDigest(s){
  const clean=c=>{const {id,index,selected,...rest}=c;return rest;};
  return core.digest({width:s.width,height:s.height,fps:s.fps,
    video:s.video.filter(c=>!isGeneratedCaption(c)).map(clean),audio:s.audio.filter(c=>!/^RIXU SFX /.test(c.name||'')).map(clean),
    details:(s.details||[]).filter(d=>!/^RIXU Caption /.test(d.name||'')).map(d=>({track:d.track,name:d.name,components:d.components.map(c=>({...c,properties:c.properties.map(p=>({...p,value:p.keys?.length?null:p.value}))}))}))});
}
function editInspectionDigest(s){return inspectionDigest({...s,video:s.video.map(c=>({...c,selected:false})),audio:s.audio.map(c=>({...c,selected:false}))});}
function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: ROOT, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(out) : reject(new Error(err.slice(-3000) || `${executable} failed (${code}).`)));
  });
}
function library() {
  const analysisPath = path.join(AUDIT, 'earshot-library-analysis.json');
  const index = readJson(analysisPath);
  const measured = new Map(readJson(path.join(AUDIT, 'real-sfx-index.json')).sounds.map(r => [r.path.toLowerCase(), r]));
  const extras = readJson(path.join(AUDIT, 'real-sfx-extra-measurements.json'));
  for (const [p, r] of Object.entries(extras)) measured.set(p.toLowerCase(), r);
  return { index, measured };
}
async function soundMatches(query, limit = 8, excludeMonoRisk = true) {
  const { index, measured } = library(); const lower = query.toLowerCase();
  const keys = /whoosh|swoosh|air/.test(lower) ? ['transition_whoosh'] : /pop|rounded/.test(lower) ? ['caption_pop'] : /click|dry/.test(lower) ? ['caption_click'] : /chime|notification|bell|ding/.test(lower) ? ['notification'] : /riser|swell/.test(lower) ? ['riser'] : /glitch/.test(lower) ? ['glitch'] : /impact|thump|boom/.test(lower) ? [/soft/.test(lower) ? 'soft_impact' : 'heavy_impact'] : /typing|keyboard/.test(lower) ? ['typing'] : /paper/.test(lower) ? ['paper'] : /room|ambien/.test(lower) ? ['room_tone'] : [];
  const words = lower.split(/\s+/).filter(w => w.length > 2 && !['sound', 'effect', 'short', 'single'].includes(w));
  const unique = new Map();
  const standard = Object.values(index.assets.find(a=>!a.near_silent)?.query_matches || {}).some(r=>r.query===query);
  const live = standard ? null : new Map((await scoreQuery(query)).map(r=>[r.path.toLowerCase(),r]));
  for (const asset of index.assets) {
    if (asset.near_silent || (excludeMonoRisk && asset.mono_compatibility_caution)) continue;
    const m = measured.get(asset.path.toLowerCase()); if (!m || !fs.existsSync(asset.path)) continue;
    const evidence = live ? live.get(asset.path.toLowerCase()) : keys.map(k => asset.query_matches[k]).filter(Boolean).sort((a, b) => b.z - a.z)[0];
    const haystack = (asset.relative_path + ' ' + asset.top_terms.map(t => t.description).join(' ')).toLowerCase();
    const lexical = words.filter(w => haystack.includes(w)).length;
    if (!evidence && !lexical) continue;
    const row = { path: asset.path, relativePath: asset.relative_path, sha256: asset.sha256, duration: m.duration,
      activeDuration: m.active_dur || m.duration, peakTime: m.peak_time, onset: Math.max(0, (m.peak_time || 0) - (m.attack_ms || 0) / 1000),
      peakDb: m.peak_db, monoCaution: asset.mono_compatibility_caution, z: evidence?.z ?? null, verdict: evidence?.verdict || 'filename/tag search only',
      matchedQuery: evidence?.query || null, description: asset.top_terms[0]?.description, score: (evidence?.z || 0) + lexical * .02 };
    const old = unique.get(asset.sha256); if (!old || row.score > old.score) unique.set(asset.sha256, row);
  }
  return [...unique.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
async function setSfxSource(plan, sourcePath) {
  const source = plan.candidates.find(c => c.path === sourcePath);
  core.assert(source, 'Choose a sound from this plan’s library candidates.');
  core.assert(fs.existsSync(source.path), 'The selected library file is missing.');
  const duration = Math.floor(source.duration * plan.snapshot.fps) / plan.snapshot.fps;
  core.assert(duration > 0, 'The selected sound is shorter than a sequence frame.');
  const sound = {source, path:source.path, start:plan.start, sourceIn:0, duration,
    track:plan.rules.sfx.track, gainDb:plan.rules.sfx.gainDb, reason:plan.query};
  if (/\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(source.path)) {
    sound.path = path.join(plan.output, 'sfx-audio-'+core.digest(source.path).slice(0,12)+'.wav');
    await runProcess(process.env.RIXU_FFMPEG || 'ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',source.path,'-map','0:a:0','-vn','-c:a','pcm_s24le',sound.path]);
    sound.originalPath = source.path;
  }
  plan.sounds = [sound];
  fs.writeFileSync(path.join(plan.output, 'plan.json'), JSON.stringify(plan,null,2));
  return plan;
}
async function buildSfxPlan(instruction, request, current) {
  const p = profile(), {index, measured} = library();
  const available = index.assets.filter(a => !a.near_silent && (!p.rules.sfx.excludeMonoRisk || !a.mono_compatibility_caution) && measured.has(a.path.toLowerCase()) && fs.existsSync(a.path));
  let candidates = namedMatches(request.query, available).slice(0,12).map(a => {
    const m = measured.get(a.path.toLowerCase());
    return {path:a.path, relativePath:a.relative_path, duration:a.measured_duration_seconds || m.duration, peakDb:m.peak_db,
      nameMatch:true, description:a.top_terms?.[0]?.description || '', z:null, verdict:'Library filename/folder match',
      audioEvidence:(a.top_terms||[]).slice(0,3), monoCaution:!!a.mono_compatibility_caution};
  });
  if (!candidates.length) candidates = (await soundMatches(request.query,12,p.rules.sfx.excludeMonoRisk)).filter(r => r.z !== null && r.z >= p.rules.sfx.minimumMatchZ);
  core.assert(candidates.length, 'No supported library match for “'+request.query+'”. Search the SFX library for a more specific name. No timeline changes were made.');
  const id = crypto.randomUUID(), folder = path.join(OUTPUT,id);
  fs.mkdirSync(folder,{recursive:true});
  const plan = {id,kind:'sfx',instruction,query:request.query,start:core.frame(request.start,current.fps)/current.fps,
    snapshot:current,snapshotDigest:snapshotDigest(current),skillRevision:p.revision,rules:p.rules,status:'prepared',
    candidates,sounds:[],output:folder,warnings:['Preview the source before applying. Real-vs-synthetic classification was not checked for this command.'],createdAt:new Date().toISOString()};
  await setSfxSource(plan,candidates[0].path);
  plans.set(id,plan);
  return plan;
}
async function buildSupermode(input) {
  if(input.language==='english'){
    core.assert(!input.englishSource||['premiere_srt','connector'].includes(input.englishSource),'Unknown English caption input.');
    if(input.englishSource==='premiere_srt')core.assert(input.nativeSrt,'ENGLISH_PREMIERE_SRT_REQUIRED: Export the English captions from Premiere’s built-in transcription as SRT, then choose that file.');
  }
  const analysis=input.analysisId?analyses.get(input.analysisId):null;
  const originalCurrent=input.reuseAnalysisSnapshot&&analysis?analysis.snapshot:await snapshot(), p = profile();let current=originalCurrent;
  const learned=input.simple===true&&p.rules.referenceStyle?.learned;
  core.assert(input.analysisId||input.manualLayouts===true,'ANALYSIS_REQUIRED: Analyse the current video before captioning. A single default layout is allowed only in explicit manual-marker mode.');
  if(input.analysisId){
    core.assert(analysis&&analysis.layout?.unresolved.length===0,'Run Analyse and resolve uncertain layout intervals first.');
    core.assert(analysis.snapshotDigest===snapshotDigest(originalCurrent),'Timeline changed after analysis. Run Analyse again.');
    if(!input.reuseAnalysisSnapshot)core.assert(inspectionDigest(await job('cep','inspect_sequence',{},90000))===inspectionDigest(analysis.snapshot),'Picture effects or layout changed after analysis. Run Analyse again.');
    core.assert(learned||input.sfx===false||analysis.tracks.sfxTrack!==null,'Add an empty audio track for SFX, then analyse again.');
    current={...originalCurrent,markers:[...originalCurrent.markers.filter(m=>!/^SUPERMODE:(FULL|SPLIT)/i.test(m.name)),...analysis.layout.markers]};
    p.rules={...p.rules,preserveOriginalSequence:true,sfx:{...p.rules.sfx,track:learned?originalCurrent.audioTracks:analysis.tracks.sfxTrack??p.rules.sfx.track}};
  }
  let cues, native = null;
  if (input.language === 'hinglish'||input.language==='srt') {
    core.assert(input.srt, input.language==='srt'?'SRT_REQUIRED: Choose your SRT file.':'HINGLISH_SRT_REQUIRED: Select your Hinglish SRT file.');
    cues = core.parseSrt(input.srt, Number(input.offset || 0));
  } else {
    if (input.nativeSrt) {
      cues = core.parseSrt(input.nativeSrt, Number(input.offset || 0));
    } else {
      let dialogue = current.audio.filter(c => c.track === Number(input.dialogueTrack || 0));
      if(analysis){
        const proxy=path.join(analysis.output,'dialogue.wav');core.assert(fs.existsSync(proxy),'The sequence-timed audio proxy is missing. Analyse again.');
        await job('cep','import_transcription_proxy',{path:proxy});
        dialogue=[{name:'Analysed sequence audio',mediaPath:proxy,start:0,end:analysis.render.duration,inPoint:0,speed:1,reversed:false}];
      }
      core.assert(dialogue.length, 'No dialogue clips on the selected audio track.');
      for(const clip of dialogue){
        core.assert(clip.mediaPath,`Dialogue source is nested or unavailable: ${clip.name}. Supply an English SRT exported from Premiere’s Text panel.`);
        core.assert(!clip.reversed && Math.abs((clip.speed || 1)-1)<.00001,`Native transcript mapping currently requires normal-speed forward dialogue: ${clip.name}. Supply a Premiere-exported English SRT for retimed clips.`);
      }
      native = await job('uxp', 'transcribe_native', { paths: [...new Set(dialogue.map(c => c.mediaPath))], language: 'en-US' }, 10 * 60 * 1000);
      const byPath = new Map(native.transcripts.map(t => [t.path.toLowerCase(), t.transcript]));
      const words = [];
      for (const clip of dialogue) {
        const transcript = byPath.get(clip.mediaPath.toLowerCase());
        core.assert(transcript, `Premiere did not return a native transcript for ${clip.name}.`);
        words.push(...core.wordsFromNative(transcript, clip));
      }
      cues = core.groupWords(words, p.rules.captions.maxWords);
      core.assert(cues.length, 'Native transcription returned no words in the active sequence ranges.');
    }
  }
  if(learned)core.assert(Math.max(...cues.map(c=>c.end))<=(analysis?.render?.duration??Math.max(...current.video.map(c=>c.end)))+1/current.fps,'The SRT extends beyond this video. Choose the matching SRT.');
  let captionPlan = core.planCaptions(cues, current, p.rules, input);
  captionPlan.duration=analysis?.render?.duration||Math.max(...captionPlan.captions.map(c=>c.end));
  core.assert(!learned||planner.status().configured,'Semantic emphasis requires the selected Codex or Claude planner.');
  let design;
  if(input.reuseDesignId){const prior=plans.get(input.reuseDesignId);core.assert(learned&&prior?.semanticDesign&&prior.snapshotDigest===snapshotDigest(originalCurrent),'The saved semantic design belongs to another timeline.');design=semanticDesign.validateDesign(structuredClone(prior.semanticDesign),captionPlan,analysis?.layout?.visualEvents||[],analysis?.sceneCuts||[],p.rules.sfx.cadence);}
  else design=planner.status().configured ? await designWithAI((input.instruction || '')+(input.preserveHighlightsId?' This is a sound-only revision. Return highlights:[]; the approved existing caption styling is preserved by the tool.':''), captionPlan, p,analysis,learned) : null;
  if(input.preserveHighlightsId){const prior=plans.get(input.preserveHighlightsId);core.assert(prior?.semanticDesign&&prior.snapshotDigest===snapshotDigest(originalCurrent),'The caption-preserving revision belongs to another timeline.');design.highlights=structuredClone(prior.semanticDesign.highlights);semanticDesign.validateDesign(design,captionPlan,analysis?.layout?.visualEvents||[],analysis?.sceneCuts||[],p.rules.sfx.cadence);}
  if(learned&&analysis)fs.writeFileSync(path.join(analysis.output,'semantic-design.json'),JSON.stringify(design,null,2));
  if (design&&!learned) {
    captionPlan = core.planCaptions(cues, current, p.rules, {...input,keywords:[...(input.keywords||[]),...design.keywords]});
    captionPlan.warnings.push(...design.warnings);
  }
  if(learned){captionPlan=editingStyle.emphasizeLikeReferences(captionPlan,p.rules.referenceStyle,design,p.rules.emphasis);captionPlan.warnings.push(...design.warnings);}
  let cueRequests = input.sfx === false || p.rules.sfx.intensity === 'off' ? [] : (design ? [...core.selectSfxCues({...captionPlan,captions:[],layouts:[]}, current.markers, p.rules, ''),...design.sfx] : core.selectSfxCues(captionPlan, current.markers, p.rules, input.instruction || ''));
  cueRequests.sort((a,b)=>a.time-b.time);
  if(learned&&input.sfx!==false){const names=new Set(library().index.assets.map(a=>path.basename(a.path).toLowerCase()));const existing=current.audio.filter(c=>!/^RIXU SFX /.test(c.name)&&c.end-c.start<=8&&names.has(path.basename(c.mediaPath||'').toLowerCase()));cueRequests=editingStyle.planCues(captionPlan,design,analysis,p.rules.referenceStyle,existing,p.rules.sfx.cadence);if(p.rules.sfx.cadence?.highEverySeconds)cueRequests.sort((a,b)=>b.priority-a.priority||a.time-b.time);}
  else if (design) {let last=-Infinity;const gap={sparse:2.5,balanced:1.3,lively:.7}[p.rules.sfx.intensity]||1.3;cueRequests=cueRequests.filter(c=>{if(!c.explicit&&c.time-last<gap)return false;last=c.time;return true;});}
  const sounds = [], unmatched = [], used = new Set(),useCounts=new Map();
  for (const cue of cueRequests) {
    const category=editingStyle.family(cue.query);
    const palette=learned?(p.rules.referenceStyle.palette||[]).filter(r=>r.family===category&&fs.existsSync(r.path)&&r.measurement?.peak_dbfs>-55&&(!p.rules.sfx.excludeMonoRisk||!r.monoCaution)).map(r=>({...r,z:r.queryEvidence?.[category]?.z??null,verdict:'reused recorded reference source',matchedQuery:r.queryEvidence?.[category]?.query,selectionEvidence:'Used '+r.referenceUses+' times in the reference edits; trimmed and measured locally with Earshot.'})):[];
    const roleDuration=learned&&cue.role==='support' ? (category==='whoosh'?1.5:.7) : learned&&['hook','payoff'].includes(cue.role) ? 1.5 : p.rules.sfx.maxDuration;
    const matches = (palette.length?palette:await soundMatches(learned?(editingStyle.queries[category]||cue.query):cue.query,40,p.rules.sfx.excludeMonoRisk)).filter(r => (r.referenceMatch||r.z !== null && r.z >= p.rules.sfx.minimumMatchZ) && (r.activeDuration <= roleDuration||category==='typing'&&cue.anchor==='onset'&&r.activeDuration<=p.rules.sfx.maxDuration));
    if(learned)matches.sort((a,b)=>editingStyle.preferredScore(b,p.rules.referenceStyle)-editingStyle.preferredScore(a,p.rules.referenceStyle));
    if(learned)matches.sort((a,b)=>(editingStyle.preferredScore(b,p.rules.referenceStyle)-(useCounts.get(b.sha256)||0)*10/(b.referenceUses||1))-(editingStyle.preferredScore(a,p.rules.referenceStyle)-(useCounts.get(a.sha256)||0)*10/(a.referenceUses||1)));
    const pick = learned?(matches.find(m=>m.sha256!==sounds.at(-1)?.source.sha256)||matches[0]):matches.find(r => !used.has(r.sha256)) || matches[0];
    if (!pick) { unmatched.push(cue); continue; }
    used.add(pick.sha256);
    useCounts.set(pick.sha256,(useCounts.get(pick.sha256)||0)+1);
    const anchor = cue.anchor === 'peak' ? pick.peakTime : pick.onset;
    const wantedStart = cue.time - (anchor || 0);
    const sourceIn = Math.max(0, -wantedStart);
    const duration = Math.max(1 / current.fps, Math.min(Math.min(pick.duration, pick.activeDuration + .03) - sourceIn,roleDuration));
    const start=learned?core.frame(Math.max(0,wantedStart),current.fps)/current.fps:Math.max(0,wantedStart);
    const lane=learned?editingStyle.laneFor(sounds,start,duration,p.rules.sfx.track,p.rules.referenceStyle.sfxLanes||3):p.rules.sfx.track;
    if (lane===null||(!learned&&sounds.some(s => Math.max(0, wantedStart) < s.start + s.duration && Math.max(0, wantedStart) + duration > s.start))) {
      unmatched.push({ ...cue, query: cue.query + ' (skipped: overlaps another planned sound on the SFX track)' }); continue;
    }
    sounds.push({ ...cue, source: pick, path: pick.path, start, sourceIn, duration,
      track: lane, gainDb: Math.min((learned?(pick.referenceGainDb??p.rules.sfx.gainDb):p.rules.sfx.gainDb)+(cue.gainOffsetDb||0),-1-(pick.peakDb||0)) });
  }
  const id = crypto.randomUUID(); const folder = path.join(OUTPUT, id); fs.mkdirSync(folder, { recursive: true });
  sounds.sort((a,b)=>a.time-b.time);
  // Audio-only copies prevent a video-container SFX from also inserting its picture.
  for (const [i,sound] of sounds.entries()) if (/\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(sound.path)) {
    const audioFile=path.join(folder,`sfx-audio-${i}.wav`);
    await runProcess(process.env.RIXU_FFMPEG || 'ffmpeg',['-hide_banner','-loglevel','error','-y','-i',sound.path,'-map','0:a:0','-vn','-c:a','pcm_s24le',audioFile]);
    sound.originalPath=sound.path;sound.path=audioFile;
  }
  let soundReview=null;
  if(learned&&sounds.length&&analysis&&fs.existsSync(path.join(analysis.output,'preview.mp4'))){
    const reviewInput=path.join(folder,'sound-review-input.json');fs.writeFileSync(reviewInput,JSON.stringify({base:path.join(analysis.output,'preview.mp4'),sounds,quiet:design.quiet}));
    await runProcess(process.env.RIXU_EARSHOT_PYTHON||path.join(ROOT,'.tools/earshot-env/Scripts/python.exe'),[path.join(ROOT,'scripts/review_sound_plan.py'),reviewInput,path.join(folder,'audio-review')]);
    soundReview=readJson(path.join(folder,'audio-review/sound-review.json'));sounds.splice(0,sounds.length,...soundReview.sounds);unmatched.push(...soundReview.skipped);
  }
  const cadence=learned?semanticDesign.cadenceReport(sounds,Math.max(captionPlan.duration||0,...captionPlan.captions.map(c=>c.end)),p.rules.sfx.cadence):null;
  if(cadence){fs.writeFileSync(path.join(folder,'cadence-audit.json'),JSON.stringify(cadence,null,2));core.assert(cadence.passed,'The resolved sound plan did not meet the requested three-second high cadence: '+JSON.stringify(cadence)+'. No timeline changes were made.');}
  const renderInput = path.join(folder, 'render-input.json');
  fs.writeFileSync(renderInput, JSON.stringify({ plan: captionPlan, rules: p.rules }));
  let graphics,textLayers;
  if(input.preserveHighlightsId){const prior=plans.get(input.preserveHighlightsId);graphics=prior.graphics;textLayers=prior.textLayers;}
  else {await runProcess(process.env.RIXU_PYTHON || 'python', [path.join(ROOT, 'scripts', 'render_captions.py'), renderInput, path.join(folder, 'graphics')]);graphics=readJson(path.join(folder,'graphics','graphics.json'));await runProcess(process.env.RIXU_PYTHON||'python',[path.join(ROOT,'scripts/build_native_captions.py'),renderInput,path.join(folder,'native-text')]);textLayers=readJson(path.join(folder,'native-text','text-layers.json'));}
  fs.writeFileSync(path.join(folder, 'captions.srt'), core.toSrt(captionPlan.captions));
  const plan = { soundReview,cadence,id, kind: 'supermode', instruction: input.instruction || '', snapshot: originalCurrent, snapshotDigest: snapshotDigest(originalCurrent),analysisId:input.analysisId||null,captionTrack:analysis?.tracks.captionTrack,
    skillRevision: p.revision, captionPlan, graphics, textLayers,sounds, unmatched,appendAudioTracks:learned&&sounds.length?(p.rules.referenceStyle.sfxLanes||3):0, rules: {...p.rules,preserveOriginalSequence:true}, createdAt: new Date().toISOString(),
    output: folder, status: 'prepared', semanticDesign:learned?design:undefined,nativeTranscription: !!native, captionSource:input.language==='srt'?'supplied_srt':input.language==='hinglish'?'hinglish_srt':native?'premiere_native':'premiere_srt', emphasisKeywords:[...(input.keywords||[]),...(design?.keywords||[])],
    captionDelivery: 'Editable Premiere text: normal and larger highlighted words on two newly appended topmost video tracks. PNGs are panel previews only.' };
  plans.set(id, plan); fs.writeFileSync(path.join(folder, 'plan.json'), JSON.stringify(plan, null, 2)); return plan;
}
async function designWithAI(instruction, captionPlan, p,analysis=null,semantic=false) {
  const visualEvents=analysis?.layout?.visualEvents||[];
  if(semantic)return semanticDesign.requestDesign(planner,captionPlan,p,analysis,instruction);
  const wireRules={...p.rules,referenceStyle:p.rules.referenceStyle?{...p.rules.referenceStyle,palette:undefined,preferredSounds:undefined}:undefined};
  const styleNote=' Select meaningful claims and figures in context; no quota, capitalisation or word-length fallback. Use recorded SFX with story purpose and quiet contrast. Never fill a density target.';
  const d = await planner.request([
    {role:'system',content:'You plan caption emphasis and recorded-library sound cues in Premiere. Return JSON only: {"keywords":["important word"],"sfx":[{"time":1.2,"query":"a short camera shutter click sound","anchor":"onset","reason":"camera mentioned"}],"warnings":[]}. Use only provided caption, layout or visual-event times, do not invent visual events. Honour the instruction, density and skill. No edits to caption wording or positions. Captions appear instantly with no animation. Avoid needless repetition, music or generated sounds. Leave ambiguous events empty.'+styleNote+' '+p.instructions+'\n'+JSON.stringify(wireRules)},
    {role:'user',content:JSON.stringify({instruction,captions:captionPlan.captions.map(c=>({start:c.start,end:c.end,text:c.text})),layouts:captionPlan.layouts,visualEvents,fps:captionPlan.fps})}
  ],plannerSchemas.design);
  core.assert(Array.isArray(d.keywords)&&d.keywords.length<=100&&d.keywords.every(k=>typeof k==='string'&&k.length<=100),'Invalid AI emphasis keywords.');
  core.assert(Array.isArray(d.sfx)&&d.sfx.length<=300,'Invalid AI SFX cues.');
  const allowed=captionPlan.captions.flatMap(c=>[c.start,c.end]).concat(captionPlan.layouts.map(l=>l.frame/captionPlan.fps),visualEvents.map(e=>e.time));
  for(const cue of d.sfx) {
    core.assert(Number.isFinite(cue.time)&&cue.time>=0&&allowed.some(t=>Math.abs(t-cue.time)<=1/captionPlan.fps),'AI cue is outside the supplied event times.');
    core.assert(typeof cue.query==='string'&&cue.query.length>0&&cue.query.length<=250&&['onset','peak'].includes(cue.anchor),'Invalid AI sound description/anchor.');
    cue.reason=String(cue.reason||'instruction cue').slice(0,200);cue.explicit=false;
  }
  d.warnings=Array.isArray(d.warnings)?d.warnings.filter(w=>typeof w==='string').slice(0,20):[];
  return d;
}
async function aiPlan(instruction, current, mode) {
  const p = profile();
  const result = await planner.request([
    {role:'system',content:`Return JSON only: {"actions":[...],"sound":{"requested":false,"query":"","start":0},"error":""}. Allowed actions: ${JSON.stringify(core.ACTIONS)}. Do not return scripts. Require explicit quantities and target selected clips only unless place_media/add_marker. For one named library sound at an explicit time, return actions:[] and sound:{requested:true,query:"requested sound description",start:seconds}. Start/opening means 0 seconds. Do not invent a local file path; the library resolver chooses the source for preview. Do not combine actions and a sound request. Unsupported or ambiguous requests: empty actions, requested:false, error:"specific reason". Action examples: trim_selected {edge:"end",seconds:2}; move_selected {seconds:1}; set_scale_selected {percent:110}; set_volume_selected {db:-12}; remove_selected {ripple:false}; add_marker {time:2,name:"SFX:whoosh"}; rename_selected {name:"take"}; disable_selected {disabled:true}; clone_sequence {}. ${mode?p.instructions+'\n'+JSON.stringify(p.rules):''}`},
    {role:'user',content:JSON.stringify({instruction,sequence:{name:current.sequenceName,selected:[...current.video,...current.audio].filter(c=>c.selected).map(c=>({name:c.name,type:c.mediaType,start:c.start,end:c.end}))}})}
  ],plannerSchemas.edit);
  core.assert(!result.error,result.error);
  if(result.sound?.requested) {
    core.assert(Array.isArray(result.actions)&&result.actions.length===0,'Plan sound placement separately from clip edits.');
    core.assert(typeof result.sound.query==='string'&&result.sound.query.trim()&&result.sound.query.length<=250&&Number.isFinite(result.sound.start)&&result.sound.start>=0,'Planner sound request needs a description and non-negative time.');
    return {sound:{query:result.sound.query.trim(),start:result.sound.start}};
  }
  return {actions:core.validateActions(result.actions)};
}
async function classifyFrames(a,manifest,phase,refine=false){
  const results=[],provider=planner.status().provider,model=planner.status().model;
  const stem=refine?'refinement-classifications':'classifications',resultFile=path.join(a.output,stem+'.json'),contextFile=path.join(a.output,stem+'.context.json');
  const contextDigest=core.digest(manifest),priorContext=fs.existsSync(contextFile)?readJson(contextFile):null;
  const cached=priorContext?.digest===contextDigest&&fs.existsSync(resultFile)?readJson(resultFile):[];
  const cache=new Map(cached.map(r=>[r.id,r]));
  core.assert(cache.size===cached.length,'Duplicate cached classification IDs; start a fresh analysis.');
  a.planner={provider,model};
  fs.writeFileSync(contextFile,JSON.stringify({digest:contextDigest,provider,model,reusedFrom:cached.length?priorContext.provider:null}));
  for(const [i,sheet] of manifest.sheets.entries()){
    core.assert(planner.status().provider===provider&&planner.status().model===model,'The selected planner changed during analysis. Retry analysis with one provider.');
    if(sheet.probes.every(p=>cache.has(p.id))){results.push(...sheet.probes.map(p=>cache.get(p.id)));continue;}
    phase('classifying','The '+provider+' planner is '+(refine?'refining ambiguous layouts':'analysing preview frames')+' — sheet '+(i+1)+' of '+manifest.sheets.length+'.');
    const response={probes:await classifySheet(planner,manifest,sheet)};
    results.push(...response.probes);fs.writeFileSync(resultFile,JSON.stringify(results,null,2));
  }
  return results;
}
async function refineLayouts(a,manifest,results,phase){
  const input=projectAnalysis.refinementInput(manifest,results);
  if(!input.probes.length)return {manifest,results};
  phase('refining','Extracting closer preview frames to locate layout changes inside XML clips.');
  fs.writeFileSync(path.join(a.output,'refinement-input.json'),JSON.stringify(input,null,2));
  await runProcess(process.env.RIXU_PYTHON||'python',[path.join(ROOT,'scripts/project_analysis.py'),'refine',a.output]);
  const refined=readJson(path.join(a.output,'refinement-manifest.json')),extra=await classifyFrames(a,refined,phase,true);
  const merged=projectAnalysis.mergeRefinement(manifest,results,refined,extra);
  fs.writeFileSync(path.join(a.output,'final-manifest.json'),JSON.stringify(merged.manifest,null,2));
  fs.writeFileSync(path.join(a.output,'final-classifications.json'),JSON.stringify(merged.results,null,2));
  return merged;
}
async function afterLayouts(a,input,phase){
  phase(a.layout.unresolved.length?'needs_review':'analysed',a.layout.unresolved.length?'Some rendered intervals remain ambiguous after refinement. No captions have been positioned by guess.':'XML and rendered layout analysis complete.');
  if(a.layout.unresolved.length)return;
  if(!input.simple&&input.sfx!==false&&a.tracks.sfxTrack===null){phase('needs_tracks','Add an empty audio track for SFX, then analyse again.');return;}
  if(input.language==='hinglish'&&!input.srt){phase('needs_transcript','Select the Hinglish SRT, then continue using this completed analysis.');return;}
  if(input.language==='english'&&!input.nativeSrt&&!connected('uxp')){phase('needs_transcript','Layout analysis is ready. Automatic English timing needs the native Premiere transcription helper, which is offline. Select an SRT exported from Premiere’s own transcription to continue; no other ASR is substituted.');return;}
  await finishAnalysis(a,input,phase);
}
async function analyseProject(a,input){
  analysisBusy=true;activeAnalysisId=a.id;
  const save=()=>saveAnalysis(a);
  const phase=(status,message)=>analysisPhase(a,status,message);
  try{
    phase('inspecting','Reading the active sequence and exporting its XML.');
    const s=await job('cep','inspect_sequence',{},90000);
    if(input.reuseRender)core.assert(a.snapshot&&inspectionDigest(s)===inspectionDigest(a.snapshot),'Timeline or picture changed; the cached render cannot be reused. Run a new analysis.');
    a.snapshot=s;a.snapshotDigest=snapshotDigest(s);a.tracks=projectAnalysis.chooseEmptyTracks(s,profile().rules.sfx.track);
    const analysisSnapshot={...s,video:s.video.filter(c=>!isGeneratedCaption(c))};
    fs.writeFileSync(path.join(a.output,'snapshot.json'),JSON.stringify(analysisSnapshot,null,2));
    if(!input.reuseRender){
    const prep=JSON.parse(await runProcess(process.env.RIXU_PYTHON||'python',[path.join(ROOT,'scripts/project_analysis.py'),'prepare',a.output]));
    const duration=Math.max(...analysisSnapshot.video.map(c=>c.end));core.assert(Number.isFinite(duration)&&duration>0,'The active sequence has no picture to analyse.');
    phase('rendering','Premiere is exporting the sequence XML and a low-quality preview. Only sampled still frames go to the visual planner.');
    const exported=await job('cep','export_analysis',{sequenceId:s.sequenceId,folder:a.output,preset:prep.preset,duration,generatedRoot:OUTPUT,hideGeneratedCaptions:true},900000);
    a.exportResult={result:exported.result,exists:exported.exists};save();
    core.assert(snapshotDigest(exported.snapshot)===a.snapshotDigest,'Sequence changed during preview rendering. Run Analyse again.');
    core.assert(inspectionDigest(await job('cep','inspect_sequence',{},90000))===inspectionDigest(a.snapshot),'Picture effects changed during preview rendering. Run Analyse again.');
    }
    phase('sampling','Reading XML edit times and extracting preview frames on both sides of cuts.');
    await runProcess(process.env.RIXU_PYTHON||'python',[path.join(ROOT,'scripts/project_analysis.py'),'sheets',a.output]);
    const manifest=readJson(path.join(a.output,'manifest.json'));a.render=manifest.render;a.xmlClipCount=manifest.xmlClipCount;a.probeCount=manifest.probes.length;
    let classified=await classifyFrames(a,manifest,phase),finalManifest=manifest;
    if(projectAnalysis.assembleLayouts(manifest,classified).unresolved.length){const refined=await refineLayouts(a,manifest,classified,phase);classified=refined.results;finalManifest=refined.manifest;}
    // A second, targeted pass revisits remaining low-confidence frames rather
    // than repeatedly classifying the original broad XML intervals.
    if(projectAnalysis.assembleLayouts(finalManifest,classified).unresolved.length){const refined=await refineLayouts(a,finalManifest,classified,phase);classified=refined.results;finalManifest=refined.manifest;}
    a.layout=projectAnalysis.assembleLayouts(finalManifest,classified);a.sceneCuts=finalManifest.sceneCuts||[];
    await afterLayouts(a,input,phase);
  }catch(error){analysisFailure(a,error);}
  finally{analysisBusy=false;activeAnalysisId=null;}
}
async function applySavedAnalysis(a,plan,phase){
  core.assert(profile().revision===plan.skillRevision,'SUPERMODE rules changed. Prepare again.');
  core.assert(plan.rules.preserveOriginalSequence,'Automatic analysis requires preserving the original sequence.');
  plan.status='applying';fs.writeFileSync(path.join(plan.output,'plan.json'),JSON.stringify(plan,null,2));
  phase('applying','Recovering the saved caption and SFX plan.');
  const found=await job('cep','inspect_application',{runId:plan.id},60000);
  core.assert(found.matches.length<=1,'More than one copy owns this run. Inspect Premiere before resuming.');
  const match=found.matches[0];
  if(match?.complete){core.assert(match.context?.textTracks,'Completed legacy run needs inspection.');a.result=match.context;}
  else {
    if(match){core.assert(match.context?.textTracks,'The interrupted copy did not finish setup. Open the original sequence and start a new run; analysis files are preserved.');a.application={...match.context,textDone:a.sfxOnly?plan.textLayers.length:a.application?.sequenceId===match.sequenceId?a.application.textDone||0:0,sfxDone:a.application?.sequenceId===match.sequenceId?a.application.sfxDone||0:0};await job('cep','open_application',{sequenceId:match.sequenceId,runId:plan.id},60000);}
    else if(a.sfxOnly){
      await job('cep','open_completed_application',{sequenceId:a.sfxSource.sequenceId,runId:a.sfxSource.runId,projectPath:a.snapshot.projectPath},60000);
      const current=await job('cep','inspect_sequence',{},90000);core.assert(editInspectionDigest(current)===a.sfxSourceDigest,'The captioned source changed while the denser sound pass was prepared. No new copy was made.');
      a.application=await job('cep','prepare_sfx_revision',{sequenceId:current.sequenceId,sourceRunId:a.sfxSource.runId,runId:plan.id,sounds:plan.sounds},120000);a.application.textDone=plan.textLayers.length;a.application.sfxDone=0;saveAnalysis(a);
    }
    else {
      let current=await job('cep','inspect_sequence',{},90000);
      if(a.sourceAnalysisId&&current.sequenceId!==a.snapshot.sequenceId){await job('cep','open_analysis_source',{sequenceId:a.snapshot.sequenceId,projectPath:a.snapshot.projectPath},60000);current=await job('cep','inspect_sequence',{},90000);}
      core.assert(inspectionDigest(current)===inspectionDigest(a.snapshot),'The open timeline differs from the saved analysis. Open the original matching sequence before resuming.');
      a.application=await job('cep','apply',{sequenceId:current.sequenceId,textLayers:plan.textLayers,sounds:plan.sounds,appendAudioTracks:plan.appendAudioTracks,replaceGeneratedSounds:true,duplicate:true,replaceGeneratedCaptions:true,generatedRoot:OUTPUT,runId:plan.id,batchMode:true},120000);
      a.application.textDone=0;a.application.sfxDone=0;saveAnalysis(a);
    }
    const picture=await job('cep','inspect_sequence',{},90000);
    core.assert(sourceInspectionDigest(picture)===sourceInspectionDigest(a.snapshot),'Picture or dialogue on the generated copy changed. Inspect the copy before resuming.');
    const ctx=a.application,texts=plan.textLayers,sounds=plan.sounds;
    for(let i=ctx.textDone;i<texts.length;i+=4){phase('applying',`Placing editable text: ${i} of ${texts.length} layers; ${ctx.sfxDone} of ${sounds.length} SFX.`);await job('cep','apply_batch',{sequenceId:ctx.sequenceId,runId:plan.id,textLayers:texts.slice(i,i+4)},120000);ctx.textDone=Math.min(i+4,texts.length);saveAnalysis(a);await new Promise(r=>setTimeout(r,200));}
    for(let i=ctx.sfxDone;i<sounds.length;i+=4){phase('applying',`Editable captions placed. Adding SFX: ${i} of ${sounds.length}.`);await job('cep','apply_batch',{sequenceId:ctx.sequenceId,runId:plan.id,sounds:sounds.slice(i,i+4).map((s,n)=>({...s,applicationIndex:i+n}))},120000);ctx.sfxDone=Math.min(i+4,sounds.length);saveAnalysis(a);await new Promise(r=>setTimeout(r,200));}
    a.result=await job('cep','apply_complete',{sequenceId:ctx.sequenceId,runId:plan.id,textLayers:texts,sfxCount:sounds.length},60000);
  }
  plan.status='applied';fs.writeFileSync(path.join(plan.output,'plan.json'),JSON.stringify(plan,null,2));history.push({id:plan.id,at:new Date().toISOString(),result:a.result});
  a.result.reviewNotes=[];if(plan.captionPlan.warnings.length)a.result.reviewNotes.push('Layout-split SRT cues repeat their wording because this SRT has no individual word times.');if(plan.unmatched.length)a.result.reviewNotes.push(plan.unmatched.length+' sound cues could not be placed; review the saved run report.');
  phase('complete','Captions and SFX applied to a sequence copy.');
}
async function finishAnalysis(a,input,phase){
  phase('planning','Creating layout-aware captions and selecting recorded library SFX.');
  const plan=await buildSupermode({...input,analysisId:a.id,englishSource:input.nativeSrt?'premiere_srt':'connector'});a.planId=plan.id;
  saveAnalysis(a);
  if(input.autoApply)return applySavedAnalysis(a,plan,phase);
  phase('prepared','Caption/SFX plan is ready for preview and application.');
}
async function route(req, res, url) {
  if (url.pathname === '/health') return send(res, 200, { service: 'rixu-premiere-assistant', version: require('../package.json').version });
  const supplied = req.headers['x-rixu-token'] || url.searchParams.get('token');
  if (supplied !== TOKEN) return send(res, 401, { error: 'Local panel connection token required.' });
  if (url.pathname === '/' || url.pathname.startsWith('/web/')) {
    const file = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
    const allowed = ['index.html', 'app.js', 'style.css']; core.assert(allowed.includes(file), 'Unknown panel resource.');
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'text/css';
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    return res.end(fs.readFileSync(path.join(ROOT, 'web', file), 'utf8').replaceAll('__RIXU_TOKEN__', TOKEN));
  }
  if (url.pathname === '/api/status') return send(res, 200, { bridges: Object.fromEntries([...bridges].map(([k, v]) => [k, { ...v, connected: connected(k) }])), actions: core.ACTIONS,
    ai: planner.status(),latestAnalysis:[...analyses.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(a=>({id:a.id,status:a.status,message:a.message,canResume:!!a.planId||fs.existsSync(path.join(a.output,'request.json'))}))[0]||null, history: history.slice(-20), skill: { path: SKILL, revision: profile().revision } });
  if (url.pathname === '/bridge/poll') {
    const kind = url.searchParams.get('kind'); core.assert(['cep', 'uxp'].includes(kind), 'Invalid bridge kind.');
    const old = bridges.get(kind) || {}; bridges.set(kind, { ...old, lastSeen: Date.now() });
    const pending = [...jobs.values()].find(j => j.kind === kind && !j.taken);
    if (pending) pending.taken = true;
    return send(res, 200, pending ? { id: pending.id, command: pending.command, data: pending.data } : null);
  }
  if (url.pathname === '/bridge/hello') { const b = await body(req); core.assert(['cep', 'uxp'].includes(b.kind), 'Invalid bridge.');const old=bridges.get(b.kind);if(b.session&&old&&old.session!==b.session)for(const j of [...jobs.values()])if(j.kind===b.kind)j.reject('PREMIERE_RESTARTED: The Premiere panel session restarted.');bridges.set(b.kind, { ...b, lastSeen: Date.now() }); return send(res, 200, { ok: true }); }
  if (url.pathname === '/bridge/result') {
    const b = await body(req), pending = jobs.get(b.id); core.assert(pending, 'Job expired or already completed.'); jobs.delete(b.id);
    if (b.error) pending.reject(String(b.error)); else pending.resolve(b.result); return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/profile' && req.method === 'GET') return send(res, 200, profile());
  if (url.pathname === '/api/profile' && req.method === 'PUT') {
    const b = await body(req), old = profile(); core.assert(b.revision === old.revision, 'SUPERMODE changed since this editor opened. Reload before saving.');
    core.validateRules(b.rules); core.assert(typeof b.instructions === 'string' && b.instructions.startsWith('---'), 'Keep the skill YAML frontmatter.');
    const backup = path.join(RUNTIME, `supermode-${Date.now()}.json`); fs.writeFileSync(backup, JSON.stringify(old, null, 2));
    fs.writeFileSync(path.join(SKILL, 'profile.json'), JSON.stringify(b.rules, null, 2)); fs.writeFileSync(path.join(SKILL, 'SKILL.md'), b.instructions);
    return send(res, 200, profile());
  }
  if (url.pathname === '/api/ai' && req.method === 'PUT') return send(res,200,planner.configure(await body(req)));
  if (url.pathname === '/api/ai/test' && req.method === 'POST') return send(res,200,await planner.test());
  if (url.pathname === '/api/snapshot') return send(res, 200, await snapshot());
  if(url.pathname==='/api/native-text/render-probe'&&req.method==='POST')return send(res,200,await job('cep','render_text_probe',await body(req),180000));
  if(url.pathname==='/api/native-text/remove-animation'&&req.method==='POST'){
    const s=await snapshot();return send(res,200,await job('cep','remove_caption_animation',{sequenceId:s.sequenceId,generatedRoot:OUTPUT},180000));
  }
  if(url.pathname==='/api/native-text/cleanup'&&req.method==='POST'){
    const b=await body(req);core.assert(Array.isArray(b.ids)&&b.ids.length<=100&&b.ids.every(id=>/^[0-9a-f-]{36}$/.test(id)),'Invalid owned validation sequence IDs.');
    return send(res,200,await job('cep','cleanup_native_validation',{ids:b.ids},60000));
  }
  if(url.pathname==='/api/native-text/probe'&&req.method==='POST'){
    const input=await body(req);
    const template=path.join(process.env.ProgramFiles||'C:/Program Files','Adobe/Adobe Premiere Pro 2026/Essential Graphics/Basic Title.mogrt');
    core.assert(fs.existsSync(template),'Installed Adobe Basic Title template not found.');
    return send(res,200,await job('cep','probe_native_text',{path:input.path||template,seconds:75,addTracks:!!input.addTracks,audioTracks:input.audioTracks,sounds:input.sounds,layers:input.layers,folder:input.folder,preset:input.preset,duration:input.duration,fixture:input.useFixture?path.join(ROOT,'output/demo/test-picture.mp4'):undefined},180000));
  }
  if (url.pathname === '/api/inspect-sequence') return send(res,200,await job('cep','inspect_sequence',{},90000));
  if(url.pathname==='/api/analyse'&&req.method==='GET'){const a=analyses.get(url.searchParams.get('id'));core.assert(a,'Analysis not found; run Analyse again.');return send(res,200,{...a,canResume:!!a.planId||fs.existsSync(path.join(a.output,'request.json'))});}
  if(url.pathname==='/api/plan'&&req.method==='GET'){const p=plans.get(url.searchParams.get('id'));core.assert(p,'Plan not found.');return send(res,200,p);}
  if(url.pathname==='/api/save-analysis'&&req.method==='POST'){const b=await body(req),a=analyses.get(b.id);core.assert(a?.status==='complete'&&a.result?.sequenceId,'Complete a run before saving its project.');return send(res,200,await job('cep','save_completed_application',{sequenceId:a.result.sequenceId,runId:a.planId,projectPath:a.snapshot.projectPath},90000));}
  if(url.pathname==='/api/review-sfx-levels'&&req.method==='POST'){
    const b=await body(req),a=analyses.get(b.id),p=a&&plans.get(a.planId);core.assert(a?.status==='complete'&&p?.soundReview,'Complete a measured sound plan first.');
    await runProcess(process.env.RIXU_EARSHOT_PYTHON||path.join(ROOT,'.tools/earshot-env/Scripts/python.exe'),[path.join(ROOT,'scripts/review_sound_plan.py'),path.join(p.output,'sound-review-input.json'),path.join(p.output,'audio-review')]);
    const review=readJson(path.join(p.output,'audio-review/sound-review.json'));core.assert(review.sounds.length===p.sounds.length&&review.sounds.every((s,i)=>s.path===p.sounds[i].path&&s.start===p.sounds[i].start&&s.duration===p.sounds[i].duration),'The review changed placements; prepare a new sound pass.');
    const result=await job('cep','set_sfx_levels',{sequenceId:a.result.sequenceId,runId:p.id,sounds:review.sounds},90000);p.sounds=review.sounds;p.soundReview=review;fs.writeFileSync(path.join(p.output,'plan.json'),JSON.stringify(p,null,2));a.result.levelReview={mixPeakDbfs:review.mixPeakDbfs,newClippedSamples:review.newClippedSamples};saveAnalysis(a);return send(res,200,result);
  }
  if(url.pathname==='/api/revise-analysis'&&req.method==='POST'){
    const b=await body(req);core.assert(!analysisBusy,'Wait for the current analysis to finish.');
    const parent=analyses.get(b.id),previous=parent&&plans.get(parent.planId);
    core.assert(parent&&previous&&parent.layout?.unresolved.length===0,'A completed analysed caption plan is required for revision.');
    const id=crypto.randomUUID(),folder=path.join(OUTPUT,'analysis-'+id);fs.mkdirSync(folder,{recursive:true});
    const a={id,output:folder,createdAt:new Date().toISOString(),status:'planning',message:'Revising emphasis and sound design from saved analysis.',snapshot:parent.snapshot,snapshotDigest:parent.snapshotDigest,tracks:parent.tracks,layout:parent.layout,sceneCuts:parent.sceneCuts||[],render:parent.render,sourceAnalysisId:parent.id};
    if(b.sfxOnly){core.assert(parent.status==='complete'&&parent.result?.sequenceId,'A sound-only revision needs a completed captioned copy.');await job('cep','open_completed_application',{sequenceId:parent.result.sequenceId,runId:previous.id,projectPath:parent.snapshot.projectPath},60000);const source=await job('cep','inspect_sequence',{},90000);core.assert(sourceInspectionDigest(source)===sourceInspectionDigest(parent.snapshot),'Picture or dialogue changed; analyse that edit before a sound revision.');a.sfxOnly=true;a.sfxSource={sequenceId:source.sequenceId,runId:previous.id};a.sfxSourceDigest=editInspectionDigest(source);}
    for(const file of ['preview.mp4','dialogue.wav'])if(fs.existsSync(path.join(parent.output,file)))fs.copyFileSync(path.join(parent.output,file),path.join(folder,file));
    const units=semanticDesign.captionUnits(previous.captionPlan).units;
    const input={language:'srt',srt:core.toSrt(units),simple:true,sfx:true,style:'standard',autoApply:b.autoApply===true,reuseAnalysisSnapshot:true,reuseDesignId:b.reuseDesign===true?previous.id:undefined,preserveHighlightsId:b.sfxOnly?previous.id:undefined,instruction:String(b.instruction||'Choose context-specific meaningful emphasis and build purposeful sound highs with quiet contrast.')};
    fs.writeFileSync(path.join(folder,'request.json'),JSON.stringify(input,null,2));analyses.set(id,a);saveAnalysis(a);analysisBusy=true;activeAnalysisId=id;
    finishAnalysis(a,input,(s,m)=>analysisPhase(a,s,m)).catch(e=>analysisFailure(a,e)).finally(()=>{analysisBusy=false;activeAnalysisId=null;});
    return send(res,202,{id,reusedAnalysis:parent.id});
  }
  if(url.pathname==='/api/analyse'&&req.method==='POST'){
    let b=await body(req);if(analysisBusy)return send(res,202,{id:activeAnalysisId||[...analyses.values()].find(a=>!['complete','failed','interrupted','prepared','needs_review','needs_tracks','needs_transcript'].includes(a.status))?.id,existing:true});
    if(b.id){const a=analyses.get(b.id);core.assert(a,'Analysis not found.');
      if(a.status==='complete')return send(res,202,{id:a.id});
      if(a.planId&&['interrupted','failed','prepared'].includes(a.status)&&plans.has(a.planId)){
        analysisBusy=true;activeAnalysisId=a.id;const phase=(s,m)=>analysisPhase(a,s,m);
        applySavedAnalysis(a,plans.get(a.planId),phase).catch(e=>analysisFailure(a,e)).finally(()=>{analysisBusy=false;activeAnalysisId=null;});return send(res,202,{id:a.id,reusedPlan:true});
      }
      if(!b.language&&fs.existsSync(path.join(a.output,'request.json')))b={...readJson(path.join(a.output,'request.json')),...b};
      if(a.sourceAnalysisId&&['failed','interrupted'].includes(a.status)&&fs.existsSync(path.join(a.output,'request.json'))){analysisBusy=true;activeAnalysisId=a.id;finishAnalysis(a,b,(s,m)=>analysisPhase(a,s,m)).catch(e=>analysisFailure(a,e)).finally(()=>{analysisBusy=false;activeAnalysisId=null;});return send(res,202,{id:a.id,reusedAnalysis:true});}
    }
    core.assert(planner.status().configured,'Select and test Codex CLI or Claude CLI in Settings before analysis.');
    core.assert(['english','hinglish','srt'].includes(b.language),'Choose a supported caption input.');
    if(b.language==='srt')core.assert(b.srt,'SRT_REQUIRED: Choose your SRT file.');
    if(b.simple){core.assert(profile().rules.referenceStyle?.learned,'The reference style is still being prepared.');b.style='standard';b.sfx=true;b.autoApply=true;}
    if(b.id){const a=analyses.get(b.id);core.assert(a,'Analysis not found.');
      if(a.status==='needs_review'){
        analysisBusy=true;activeAnalysisId=a.id;const phase=(s,m)=>analysisPhase(a,s,m);
        (async()=>{core.assert(inspectionDigest(await job('cep','inspect_sequence',{},90000))===inspectionDigest(a.snapshot),'Picture changed; run a fresh analysis.');const finalExists=fs.existsSync(path.join(a.output,'final-manifest.json'));const refined=await refineLayouts(a,readJson(path.join(a.output,finalExists?'final-manifest.json':'manifest.json')),readJson(path.join(a.output,finalExists?'final-classifications.json':'classifications.json')),phase);a.layout=projectAnalysis.assembleLayouts(refined.manifest,refined.results);a.sceneCuts=refined.manifest.sceneCuts||[];await afterLayouts(a,b,phase);})().catch(e=>analysisFailure(a,e)).finally(()=>{analysisBusy=false;activeAnalysisId=null;});return send(res,202,{id:a.id});
      }
      if(['failed','interrupted'].includes(a.status)){analyseProject(a,{...b,reuseRender:fs.existsSync(path.join(a.output,'preview.mp4'))&&!!a.snapshot});return send(res,202,{id:a.id});}
      core.assert(a.status==='needs_transcript','No completed analysis is waiting for a transcript.');analysisBusy=true;activeAnalysisId=a.id;const phase=(s,m)=>analysisPhase(a,s,m);finishAnalysis(a,b,phase).catch(e=>analysisFailure(a,e)).finally(()=>{analysisBusy=false;activeAnalysisId=null;});return send(res,202,{id:a.id});}
    const id=crypto.randomUUID(),folder=path.join(OUTPUT,'analysis-'+id);fs.mkdirSync(folder,{recursive:true});const a={id,output:folder,status:'queued',message:'Starting project analysis.',createdAt:new Date().toISOString()};fs.writeFileSync(path.join(folder,'request.json'),JSON.stringify(b,null,2));analyses.set(id,a);analyseProject(a,b);return send(res,202,{id});
  }
  if (url.pathname === '/api/dev/smoke' && req.method === 'POST') {
    core.assert(process.env.RIXU_DEV==='1','Live smoke endpoints are disabled.');
    const b=await body(req);core.assert(['fixture','native_fixture','seek','open','select','inspect'].includes(b.operation),'Unknown smoke operation.');
    const data=b.operation==='fixture'?{path:path.join(ROOT,'output/demo/test-picture.mp4')}:b.operation==='native_fixture'?{path:path.join(ROOT,'output/demo/english-speech-fixture.mp4')}:b;
    return send(res,200,await job('cep','test_'+b.operation,data,60000));
  }
  if (url.pathname === '/api/marker') { const b = await body(req); core.assert(['full', 'split'].includes(b.layout), 'Invalid layout.'); return send(res, 200, await job('cep', 'layout_marker', { ...b, divider: profile().rules.layouts.divider })); }
  if (url.pathname === '/api/search') return send(res, 200, { results: await soundMatches(url.searchParams.get('q') || 'whoosh', 30, false) });
  if (url.pathname === '/api/plan-supermode' && req.method === 'POST') return send(res, 200, await buildSupermode(await body(req)));
  if (url.pathname === '/api/plan' && req.method === 'POST') {
    const b = await body(req), current = await snapshot(), soundRequest = parseSfxInstruction(b.instruction);
    if (soundRequest) return send(res,200,await buildSfxPlan(b.instruction,soundRequest,current));
    const direct=core.parseInstruction(b.instruction), proposed=direct?{actions:direct}:await aiPlan(b.instruction,current,b.supermode);
    if(proposed.sound)return send(res,200,await buildSfxPlan(b.instruction,proposed.sound,current));
    const actions=proposed.actions;
    const p = profile(), id = crypto.randomUUID(); const plan = { id, kind: 'actions', actions: core.validateActions(actions), snapshot: current,
      snapshotDigest: snapshotDigest(current), skillRevision: p.revision, status: 'prepared', rules: p.rules, instruction: b.instruction };
    plans.set(id, plan); return send(res, 200, plan);
  }
  if (url.pathname === '/api/plan-sfx-select' && req.method === 'POST') {
    const b = await body(req), p = plans.get(b.id);
    core.assert(p && p.kind === 'sfx' && p.status === 'prepared','Prepare a sound placement plan first.');
    return send(res,200,await setSfxSource(p,b.path));
  }
  if (url.pathname === '/api/plan-edit' && req.method === 'POST') {
    const b = await body(req), plan = plans.get(b.id); core.assert(plan && plan.kind === 'supermode' && plan.status === 'prepared', 'No editable prepared caption plan.');
    core.assert(Array.isArray(b.captions) && b.captions.length === plan.captionPlan.captions.length, 'Caption edit count differs.');
    for (const [i, text] of b.captions.entries()) { core.assert(typeof text === 'string' && text.trim(), 'Caption text cannot be empty.'); const c = plan.captionPlan.captions[i]; c.text = text; c.runs = core.emphasize(text, plan.rules.emphasis,plan.emphasisKeywords); }
    const inputFile = path.join(plan.output, 'render-input.json'); fs.writeFileSync(inputFile, JSON.stringify({ plan: plan.captionPlan, rules: plan.rules }));
    await runProcess(process.env.RIXU_PYTHON || 'python', [path.join(ROOT, 'scripts', 'render_captions.py'), inputFile, path.join(plan.output, 'graphics')]);
    plan.graphics = readJson(path.join(plan.output, 'graphics', 'graphics.json')); fs.writeFileSync(path.join(plan.output, 'captions.srt'), core.toSrt(plan.captionPlan.captions));
    await runProcess(process.env.RIXU_PYTHON||'python',[path.join(ROOT,'scripts/build_native_captions.py'),inputFile,path.join(plan.output,'native-text')]);plan.textLayers=readJson(path.join(plan.output,'native-text','text-layers.json'));
    fs.writeFileSync(path.join(plan.output,'plan.json'),JSON.stringify(plan,null,2));
    return send(res, 200, plan);
  }
  if (url.pathname === '/api/apply' && req.method === 'POST') {
    const b = await body(req), p = plans.get(b.id); core.assert(p && p.status === 'prepared', 'Plan is missing or already applied.');
    core.assert(profile().revision === p.skillRevision, 'SUPERMODE rules changed. Prepare a new plan.');
    const current = await snapshot(); core.assert(snapshotDigest(current) === p.snapshotDigest, 'Timeline or selection changed. Prepare a new plan.');
    if(p.analysisId){const a=analyses.get(p.analysisId);core.assert(a&&inspectionDigest(await job('cep','inspect_sequence',{},90000))===inspectionDigest(a.snapshot),'Analysed picture changed. Run Analyse again.');}
    p.status = 'applying';
    try {
      const result = await job('cep', 'apply', { sequenceId: current.sequenceId, actions: p.actions, graphics: p.textLayers?undefined:p.graphics,textLayers:p.textLayers,replaceGeneratedCaptions:!!p.textLayers,generatedRoot:OUTPUT,
        sounds: p.sounds, appendAudioTracks:p.appendAudioTracks,replaceGeneratedSounds:!!p.appendAudioTracks,duplicate: p.rules.preserveOriginalSequence, captionTrack: Number(p.captionTrack ?? b.captionTrack ?? current.videoTracks),
        runId: p.id, animationSeconds: p.rules.captions.animationSeconds }, p.textLayers?900000:180000);
      p.status = 'applied'; history.push({ id: p.id, at: new Date().toISOString(), result }); return send(res, 200, result);
    } catch (error) { p.status = 'needs-inspection'; history.push({ id: p.id, error: error.message, at: new Date().toISOString() }); throw error; }
  }
  if (url.pathname === '/api/asset') {
    const target = path.resolve(url.searchParams.get('path') || '');
    const outputAsset = target.startsWith(OUTPUT + path.sep) && /\.(png|jpg|mp4|wav)$/i.test(target);
    const sfxAsset = library().index.assets.some(a => a.path.toLowerCase() === target.toLowerCase());
    core.assert(outputAsset || sfxAsset, 'Asset is outside the generated outputs and connected library.');
    const stat = fs.statSync(target), range = req.headers.range;
    const mime = target.endsWith('.png') ? 'image/png' : /\.jpg$/i.test(target)?'image/jpeg':/\.mp4$/i.test(target)?'video/mp4':/\.wav$/i.test(target) ? 'audio/wav' : /\.mp3$/i.test(target) ? 'audio/mpeg' : /\.aac$/i.test(target) ? 'audio/aac' : 'application/octet-stream';
    if (range) { const m = range.match(/^bytes=(\d+)-(\d*)$/); core.assert(m, 'Invalid byte range.'); const start = +m[1], end = Math.min(m[2] ? +m[2] : stat.size - 1, stat.size - 1); core.assert(start <= end, 'Invalid range.'); res.writeHead(206, { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end-start+1 }); return fs.createReadStream(target, { start, end }).pipe(res); }
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' }); return fs.createReadStream(target).pipe(res);
  }
  return send(res, 404, { error: 'Unknown route.' });
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && origin !== 'null' && origin !== 'file://' && ![`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`].includes(origin)) {console.error('Rejected panel origin:',origin);return send(res, 403, { error: 'Only the local panel may access this service.' });}
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-RIXU-Token'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try { await route(req, res, new URL(req.url, `http://127.0.0.1:${PORT}`)); }
  catch (error) { if (!res.headersSent) send(res, 400, { error: error.message }); else res.end(); }
});
server.listen(PORT, '127.0.0.1', () => console.log(`RIXU companion ready on http://127.0.0.1:${PORT}. Open the Premiere panel.`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
