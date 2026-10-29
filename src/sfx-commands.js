'use strict';

// These forms have an explicit position; unknown or compound instructions stay with the planner.
function parseSfxInstruction(text) {
  const value = String(text || '').trim().replace(/[.!]$/, '');
  let m = value.match(/^(?:start|begin|open)\s+(?:the\s+(?:sequence|video)\s+)?with\s+(.+)$/i);
  let start = 0;
  if (!m) {
    m = value.match(/^(?:add|place|insert|play)\s+(.+?)\s+at\s+(?:the\s+)?(start|beginning|\d+(?:\.\d+)?\s*(?:s|seconds?))$/i);
    if (!m) return null;
    start = /^(start|beginning)$/i.test(m[2]) ? 0 : parseFloat(m[2]);
  }
  let query = m[1].replace(/^(?:the|a|an)\s+/i, '').replace(/\s+(?:sound(?:\s+effect)?|sfx)$/i, '').replace(/^["']|["']$/g, '').trim();
  if (!Number.isFinite(start) || !query || query.length > 250 || /\b(?:and|then|after|before)\b|[;\n]/i.test(query)) return null;
  // An opening command must name a sound, not imply a picture edit.
  if (!/\b(?:sound|sfx|whoosh|swoosh|click|pop|chime|riser|impact|charge|charging|shutter|glitch|beep|ding)\b/i.test(m[1])) return null;
  return { query, start };
}

function tokens(text) {
  return (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(w => !['the','a','an','sound','sounds','effect','effects','sfx'].includes(w))
    .map(w => w.length > 4 ? w.replace(/(?:ing|ed|s)$/, '').replace(/e$/, '') : w);
}

function namedMatches(query, assets) {
  const wanted = [...new Set(tokens(query))];
  if (!wanted.length) return [];
  return assets.filter(a => {
    const name = new Set(tokens(a.relative_path));
    return wanted.every(w => name.has(w));
  }).sort((a,b) => tokens(a.relative_path).length - tokens(b.relative_path).length || a.relative_path.localeCompare(b.relative_path));
}

module.exports = { parseSfxInstruction, namedMatches };
