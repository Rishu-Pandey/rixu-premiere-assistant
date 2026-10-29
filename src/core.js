'use strict';
const crypto = require('node:crypto');
const TICKS = 254016000000;

function assert(value, message) { if (!value) throw new Error(message); }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function frame(seconds, fps) { return Math.round(Number(seconds) * fps); }
function timecode(value) {
  const match = String(value).trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  assert(match && +match[2] < 60 && +match[3] < 60, `Invalid SRT timestamp: ${value}`);
  return +match[1] * 3600 + +match[2] * 60 + +match[3] + +match[4].padEnd(3, '0') / 1000;
}
function parseSrt(input, offset = 0) {
  assert(Number.isFinite(offset) && offset >= 0, 'SRT offset must be non-negative seconds.');
  const blocks = String(input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0]?.trim())) lines.shift();
    const timing = lines.shift()?.split(/\s*-->\s*/);
    assert(timing?.length === 2, `SRT cue ${cues.length + 1} is missing its time range.`);
    const start = timecode(timing[0]) + offset, end = timecode(timing[1].split(/\s+/)[0]) + offset;
    const text = lines.join(' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    assert(end > start && text, `Invalid or empty SRT cue ${cues.length + 1}.`);
    cues.push({ id: `srt-${cues.length + 1}`, start, end, text, timing: 'cue-only' });
  }
  assert(cues.length > 0, 'The SRT file contains no captions.');
  return cues.sort((a, b) => a.start - b.start);
}
function srtTime(seconds) {
  let ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000); ms %= 3600000;
  const m = Math.floor(ms / 60000); ms %= 60000;
  const s = Math.floor(ms / 1000); ms %= 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
function toSrt(cues) { return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n'); }
function wordsFromNative(transcript, clip) {
  assert(!clip.reversed && Math.abs((clip.speed || 1) - 1) < 0.00001,
    `Native transcript mapping currently requires normal-speed forward dialogue: ${clip.name}`);
  const words = [];
  for (const segment of transcript.segments || []) {
    for (const w of segment.words || []) {
      if (w.type === 'punctuation') { if (words.length) words[words.length - 1].text += w.text; continue; }
      if (typeof w.start !== 'number' || typeof w.duration !== 'number') continue;
      const start = clip.start + w.start - clip.inPoint;
      const end = start + w.duration;
      if (end <= clip.start || start >= clip.end || !String(w.text || '').trim()) continue;
      words.push({ text: String(w.text).trim(), start: Math.max(start, clip.start), end: Math.min(end, clip.end), eos: !!w.eos });
    }
  }
  return words;
}
function groupWords(words, maxWords = 5) {
  const cues = [], ordered = [...words].sort((a, b) => a.start - b.start); let group = [];
  function flush() {
    if (!group.length) return;
    cues.push({ id: `native-${cues.length + 1}`, start: group[0].start, end: group.at(-1).end,
      text: group.map(w => w.text).join(' '), words: group, timing: 'word-timed' }); group = [];
  }
  for (const word of ordered) {
    if (group.length && word.start - group.at(-1).end > 0.5) flush();
    group.push(word);
    if (group.length >= maxWords || word.eos || /[.!?]$/.test(word.text)) flush();
  }
  flush(); return cues;
}
function layoutsFromMarkers(markers, fps, defaultLayout = 'full', defaultDivider = 0.5) {
  const events = [{ frame: 0, layout: defaultLayout, divider: defaultDivider }];
  for (const marker of markers || []) {
    const m = String(marker.name || '').match(/^SUPERMODE:(FULL|SPLIT)(?:[:\s]+(0?\.\d+|\d+(?:\.\d+)?%?))?$/i);
    if (!m) continue;
    let divider = defaultDivider;
    if (m[2]) divider = m[2].endsWith('%') ? parseFloat(m[2]) / 100 : +m[2];
    assert(divider > 0.05 && divider < 0.95, 'Split divider must lie between 5% and 95% of frame height.');
    events.push({ frame: frame(marker.start, fps), layout: m[1].toLowerCase(), divider });
  }
  const byFrame = new Map(events.sort((a, b) => a.frame - b.frame).map(e => [e.frame, e]));
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}
function emphasize(text, rules, chosen = []) {
  const keywords = new Set([...(rules.keywords || []), ...chosen].map(x => String(x).toLocaleLowerCase()));
  const parts = String(text).match(/\S+/gu) || [];
  return parts.map(word => {
    const bare = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, '').toLocaleLowerCase();
    const important = (rules.figures !== false && /\p{N}/u.test(word)) || keywords.has(bare);
    return { text: word, emphasis: important, sizeScale: important ? rules.scale : 1 };
  });
}
function planCaptions(cues, snapshot, rules, options = {}) {
  const fps = Number(snapshot.fps), width = Number(snapshot.width), height = Number(snapshot.height);
  assert(fps > 0 && width > 0 && height > 0, 'A valid active sequence is required.');
  const layouts = layoutsFromMarkers(snapshot.markers, fps, options.defaultLayout || rules.layouts.default, rules.layouts.divider);
  const output = [], warnings = [];
  for (const cue of cues) {
    const startFrame = frame(cue.start, fps), endFrame = frame(cue.end, fps);
    assert(startFrame >= 0 && endFrame > startFrame, `Caption ${cue.id} is shorter than a frame or has invalid timing.`);
    const bounds = [startFrame, ...layouts.filter(e => e.frame > startFrame && e.frame < endFrame).map(e => e.frame), endFrame];
    if (bounds.length > 2 && !cue.words?.length) warnings.push(`${cue.id}: layout split repeats the SRT cue text; SRT has no word timestamps.`);
    for (let i = 0; i < bounds.length - 1; i++) {
      const a = bounds[i], b = bounds[i + 1];
      const layout = layouts.filter(e => e.frame <= a).at(-1) || layouts[0];
      const words = cue.words?.filter(w => frame(w.end, fps) > a && frame(w.start, fps) < b);
      if (cue.words && !words.length) continue;
      const text = words ? words.map(w => w.text).join(' ') : cue.text;
      const y = layout.layout === 'split' ? layout.divider : rules.layouts.fullY;
      output.push({ id: `${cue.id}-${i}`, originId: cue.id, startFrame: a, endFrame: b, start: a / fps, end: b / fps,
        text, words, runs: emphasize(text, rules.emphasis, options.keywords), layout: layout.layout,
        x: width / 2, y: Math.round(y * height), anchor: 'center', fontSize: Math.round(rules.captions.fontSize * width / 1080),
        style: 'standard', timing: cue.timing });
    }
  }
  return { captions: output, layouts, warnings, fps, width, height };
}
function selectSfxCues(captionPlan, markers, rules, instruction = '') {
  const intensity = rules.sfx.intensity || 'balanced';
  if (intensity === 'off') return [];
  const gaps = { sparse: 2.5, balanced: 1.3, lively: 0.7 };
  const minimumGap = gaps[intensity] || 1.3;
  const events = [];
  for (const m of markers || []) {
    const match = String(m.name || '').match(/^SFX:(.+)$/i);
    if (match) events.push({ time: Number(m.start), query: match[1].trim(), anchor: 'onset', reason: 'explicit marker', explicit: true });
  }
  const origins = new Set();
  const requestedWhoosh = /whoosh|swoosh|transition/i.test(instruction);
  for (const c of captionPlan.captions) {
    if (origins.has(c.originId)) continue;
    origins.add(c.originId);
    if (!c.runs.some(r => r.emphasis) && !/every caption|har caption/i.test(instruction)) continue;
    const emphasized = c.runs.find(r => r.emphasis)?.text;
    const word = c.words?.find(w => w.text === emphasized);
    events.push({ time: word?.start ?? c.start, query: 'a short soft rounded pop sound', anchor: 'onset', reason: word ? `emphasis: ${emphasized}` : 'caption entrance', explicit: false });
  }
  if (requestedWhoosh) for (const event of captionPlan.layouts.slice(1)) events.push({ time: event.frame / captionPlan.fps,
    query: 'a fast smooth air whoosh sound', anchor: 'peak', reason: 'layout change', explicit: false });
  events.sort((a, b) => a.time - b.time || Number(b.explicit) - Number(a.explicit));
  const spaced = [];
  for (const event of events) {
    if (event.explicit || !spaced.length || event.time - spaced.at(-1).time >= minimumGap) spaced.push(event);
  }
  return spaced;
}
const ACTIONS = Object.freeze({
  clone_sequence: 'Duplicate the active sequence',
  trim_selected: 'Trim selected linked clips by an explicit start/end amount',
  move_selected: 'Move selected linked clips by an explicit time offset',
  disable_selected: 'Enable or disable selected clips',
  rename_selected: 'Rename selected timeline clip instances',
  remove_selected: 'Remove selected clips; leave gaps or ripple explicitly',
  set_scale_selected: 'Set uniform Motion scale on selected video clips',
  set_volume_selected: 'Set clip volume by an explicit dB value',
  add_marker: 'Add a named marker at a specified timeline time',
  place_media: 'Place existing local media on specified tracks without rippling',
});
function validateActions(actions) {
  assert(Array.isArray(actions) && actions.length > 0 && actions.length <= 2000, 'Provide 1–2000 actions.');
  for (const a of actions) {
    assert(a && Object.hasOwn(ACTIONS, a.type), `Unsupported action: ${a?.type}`);
    if (a.type === 'trim_selected') {
      assert(['start', 'end'].includes(a.edge) && Number.isFinite(a.seconds) && a.seconds > 0, 'Trim needs start/end and a positive number of seconds.');
    }
    if (a.type === 'move_selected') assert(Number.isFinite(a.seconds), 'Move requires an explicit seconds offset.');
    if (a.type === 'set_scale_selected') assert(a.percent > 0 && a.percent <= 1000, 'Scale must be 0–1000%.');
    if (a.type === 'set_volume_selected') assert(Number.isFinite(a.db) && a.db >= -96 && a.db <= 12, 'Volume must be between -96 and +12 dB.');
    if (a.type === 'rename_selected') assert(typeof a.name === 'string' && a.name.trim(), 'Rename requires a name.');
    if (a.type === 'disable_selected') assert(typeof a.disabled === 'boolean', 'Enable/disable requires a boolean.');
    if (a.type === 'remove_selected') assert(typeof a.ripple === 'boolean', 'Remove requires an explicit ripple choice.');
    if (a.type === 'add_marker') assert(Number.isFinite(a.time) && a.time >= 0 && typeof a.name === 'string' && a.name.trim(), 'Marker needs a non-negative time and name.');
    if (a.type === 'place_media') assert(typeof a.path === 'string' && a.path && Number.isFinite(a.start) && a.start >= 0 && Number.isInteger(a.track) && a.track >= 0 && Number.isFinite(a.duration) && a.duration > 0 && ['audio','video'].includes(a.mediaType), 'Media placement needs path, mediaType, track, start and duration.');
  }
  return actions;
}
function parseInstruction(text) {
  const value = String(text).trim();
  let match;
  if (/^(duplicate|clone|copy) (the )?(active )?sequence\.?$/i.test(value)) return [{ type: 'clone_sequence' }];
  if ((match = value.match(/^trim\s+(?:the\s+)?(?:selected\s+)?(?:clips?\s+)?(?:by\s+)?([\d.]+)\s*(?:s|seconds?)\s+(?:from\s+(?:the\s+)?)?(start|end)\.?$/i))) return validateActions([{ type: 'trim_selected', seconds: +match[1], edge: match[2].toLowerCase() }]);
  if ((match = value.match(/^move\s+(?:the\s+)?(?:selected\s+)?(?:clips?\s+)?(?:by\s+)?(-?[\d.]+)\s*(?:s|seconds?)\.?$/i))) return validateActions([{ type: 'move_selected', seconds: +match[1] }]);
  if (/^(disable|mute) (the )?selected( clips?)?\.?$/i.test(value)) return [{ type: 'disable_selected', disabled: true }];
  if (/^enable (the )?selected( clips?)?\.?$/i.test(value)) return [{ type: 'disable_selected', disabled: false }];
  if ((match = value.match(/^rename (?:the )?selected(?: clips?)? (?:to )?["']?(.+?)["']?$/i))) return [{ type: 'rename_selected', name: match[1] }];
  if ((match = value.match(/^(?:set )?scale (?:the )?selected(?: clips?)?(?: to)? ([\d.]+)%?\.?$/i))) return validateActions([{ type: 'set_scale_selected', percent: +match[1] }]);
  if ((match = value.match(/^(?:set )?volume (?:of )?(?:the )?selected(?: clips?)?(?: to)? (-?[\d.]+)\s*dB\.?$/i))) return validateActions([{ type: 'set_volume_selected', db: +match[1] }]);
  if (/^(delete|remove) (the )?selected( clips?)? (leave gaps|without ripple)\.?$/i.test(value)) return [{ type: 'remove_selected', ripple: false }];
  if (/^(ripple delete|ripple remove) (the )?selected( clips?)?\.?$/i.test(value)) return [{ type: 'remove_selected', ripple: true }];
  return null;
}
function validateRules(r) {
  assert(r?.name === 'SUPERMODE' && r.version === 1, 'SUPERMODE profile version 1 is required.');
  assert(r.captions.english === 'premiere_native' && r.captions.hinglish === 'srt_required', 'English must use Premiere native transcription; Hinglish requires SRT.');
  assert(!r.captions.englishInput||['premiere_srt','connector'].includes(r.captions.englishInput),'Invalid English caption input preference.');
  assert(r.layouts.splitAnchor === 'divider_center', 'Split captions must be centred on the divider.');
  assert(r.layouts.divider >= .05 && r.layouts.divider <= .95 && r.layouts.fullY >= .67 && r.layouts.fullY <= .95, 'Invalid layout positions.');
  assert(r.captions.fontSize >= 16 && r.captions.fontSize <= 240 && r.captions.maxWords >= 1 && r.captions.maxWords <= 20, 'Invalid caption size/grouping.');
  assert(r.emphasis.scale >= 1.05 && r.emphasis.scale <= 2.5 && Array.isArray(r.emphasis.keywords), 'Important words must have a larger valid size.');
  assert(['full','split'].includes(r.layouts.default), 'Choose a full or split default layout.');
  assert(['off','sparse','balanced','lively'].includes(r.sfx.intensity), 'Invalid sound density.');
  assert(Number.isInteger(r.sfx.track) && r.sfx.track >= 0 && r.sfx.track < 100, 'Invalid SFX track.');
  assert(Number.isFinite(r.sfx.gainDb) && r.sfx.gainDb >= -96 && r.sfx.gainDb <= 0, 'SFX gain must be between -96 and 0 dB.');
  assert(Number.isFinite(r.sfx.maxDuration) && r.sfx.maxDuration > 0 && r.sfx.maxDuration <= 60, 'Invalid maximum sound duration.');
  assert(Number.isFinite(r.sfx.minimumMatchZ) && r.sfx.minimumMatchZ >= 0, 'Invalid semantic match threshold.');
  assert(typeof r.preserveOriginalSequence === 'boolean', 'Sequence preservation must be true or false.');
  return r;
}
module.exports = { TICKS, assert, digest, frame, parseSrt, toSrt, wordsFromNative, groupWords, layoutsFromMarkers,
  emphasize, planCaptions, selectSfxCues, ACTIONS, validateActions, parseInstruction, validateRules };
