const ppro = require('premierepro');
const { entrypoints } = require('uxp');
const cfg = window.RIXU_CONNECTION;
let busy = false;
const status = message => { document.getElementById('status').textContent = message; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(route, data) {
  const response = await fetch(cfg.url + route, { method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-RIXU-Token': cfg.token }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Companion request failed.'); return result;
}
async function findSources(project, paths) {
  const wanted = new Set(paths.map(p => p.toLowerCase())), found = new Map();
  const root = await project.getRootItem(), queue = await root.getItems();
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]; let clip = null;
    try { clip = ppro.ClipProjectItem.cast(item); } catch (_) {}
    if (clip) {
      if (await clip.isSequence()) continue;
      let path = ''; try { path = await clip.getMediaFilePath(); } catch (_) {}
      if (wanted.has(path.toLowerCase())) found.set(path.toLowerCase(), { item: clip, path });
    } else {
      let folder = null; try { folder = ppro.FolderItem.cast(item); } catch (_) {}
      if (folder) queue.push(...await folder.getItems());
    }
  }
  return found;
}
async function exportExisting(item) {
  try { const raw = await ppro.Transcript.exportToJSON(item); const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return value?.segments?.some(s => s.words?.length) ? value : null;
  } catch (_) { return null; }
}
async function transcribe(data) {
  const project = await ppro.Project.getActiveProject(); if (!project) throw new Error('Open a Premiere project.');
  if (!ppro.Transcript?.transcribeClipProjectItem || !ppro.Transcript?.exportToJSON) throw new Error('This Premiere build does not expose native transcription/export.');
  const sources = await findSources(project, data.paths), transcripts = [];
  for (const requested of data.paths) {
    const source = sources.get(requested.toLowerCase()); if (!source) throw new Error('Dialogue source is missing or nested: ' + requested);
    status('Native transcription: ' + source.item.name);
    let transcript = await exportExisting(source.item);
    if (!transcript) {
      if (ppro.Transcript.isLanguagePackAvailable && !await ppro.Transcript.isLanguagePackAvailable('en-US')) throw new Error('Premiere’s English transcription language pack is missing. Install it in Premiere’s Text panel, then retry.');
      const success = await ppro.Transcript.transcribeClipProjectItem(source.item, { language: 'en-US' });
      if (success === false) throw new Error('Premiere transcription failed. Check the English language pack and source audio.');
      for (let attempt = 0; attempt < 90; attempt++) { transcript = await exportExisting(source.item); if (transcript) break; await sleep(2000); }
    }
    if (!transcript) throw new Error('Premiere did not return completed transcript words. Native transcription may still be running.');
    transcripts.push({ path: source.path, transcript });
  }
  return { provider: 'premiere_native', transcripts };
}
async function poll() {
  if (busy || !cfg) return;
  busy = true;
  try {
    const job = await request('/bridge/poll?kind=uxp');
    if (job) {
      try { if (job.command !== 'transcribe_native') throw new Error('Unsupported native command.');
        const result = await transcribe(job.data); await request('/bridge/result', { id: job.id, result }); status('Native transcript ready.');
      } catch (error) { await request('/bridge/result', { id: job.id, error: error.message }); status(error.message); }
    }
  } catch (error) { status('Local companion offline: ' + error.message); }
  finally { busy = false; }
}
async function hello() { if (!cfg) { status('Run scripts/install.ps1 to configure this helper.'); return; }
  try { await request('/bridge/hello', { kind: 'uxp', version: ppro.Application?.version || 'native API' }); if (!busy) status('Connected. English transcription is ready.'); } catch (_) {} }
entrypoints.setup({ panels: { nativeBridge: { show() { hello(); } } } });
setInterval(hello, 3000); setInterval(poll, 700); hello();
