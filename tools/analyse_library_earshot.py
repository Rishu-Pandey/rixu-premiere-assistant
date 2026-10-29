"""Local, resumable Earshot semantic analysis of the recursively audited library."""
from collections import Counter
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'library-audit'
os.environ.setdefault('EARSHOT_HOME', str(ROOT / '.tools' / 'earshot-cache'))
os.environ.setdefault('EARSHOT_THREADS', '3')
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

QUERIES = {
    'caption_pop': 'a short soft rounded pop sound',
    'caption_click': 'a single short dry click sound',
    'transition_whoosh': 'a fast smooth air whoosh sound',
    'soft_impact': 'a short soft low thump sound',
    'heavy_impact': 'a deep heavy cinematic impact sound',
    'notification': 'a short clear notification chime sound',
    'glitch': 'a short digital electronic glitch sound',
    'riser': 'a rising cinematic swell sound',
    'typing': 'a mechanical keyboard typing sound',
    'paper': 'a paper page turning and rustling sound',
    'room_tone': 'a steady quiet indoor room tone sound',
}
SHORTLIST_MAX_SECONDS = {
    'caption_pop': 1.5, 'caption_click': 1.0, 'transition_whoosh': 3.0,
    'soft_impact': 2.0, 'heavy_impact': 6.0, 'notification': 3.0,
    'glitch': 3.0, 'riser': 15.0, 'typing': 30.0, 'paper': 10.0,
}


def dump(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False), encoding='utf-8')


def main():
    from earshot import api, vocab
    from earshot.match import verdict
    import numpy as np

    started = time.time()
    source = json.loads((OUT / 'sfx-library-catalog.json').read_text(encoding='utf-8'))
    candidates = [row for row in source['assets'] if row.get('has_audio')]
    base_measures = json.loads((OUT / 'real-sfx-index.json').read_text(encoding='utf-8'))['sounds']
    measures = {row['path'].lower(): row for row in base_measures}
    extra_path = OUT / 'real-sfx-extra-measurements.json'
    if extra_path.exists():
        measures.update({path.lower(): row for path,row in json.loads(extra_path.read_text(encoding='utf-8')).items()})
    unique = {}
    for row in candidates:
        unique.setdefault(row['sha256'], row)
    journal = OUT / 'earshot-evidence.jsonl'
    done = {}
    if journal.exists():
        for line in journal.read_text(encoding='utf-8').splitlines():
            try:
                row = json.loads(line)
                if 'error' not in row:
                    done[row['sha256']] = row
            except (ValueError, KeyError):
                pass
    done = {sha: result for sha, result in done.items() if sha in unique}
    print(f'Earshot: {len(candidates)} audio-bearing files; {len(unique)} exact-content identities; {len(done)} cached records.', flush=True)
    pending = [row for sha, row in unique.items() if sha not in done]
    print('Loading the calibrated vocabulary and CLAP model.', flush=True)
    v = vocab.get()
    query_keys = list(QUERIES)
    Q = v.embed_text(list(QUERIES.values()))
    print('Model ready. Analysing file audio in batches.', flush=True)
    for offset in range(0, len(pending), 8):
        batch = pending[offset:offset+8]
        try:
            embeddings = vocab.embed_files([row['path'] for row in batch])
        except Exception as error:
            print(f'Batch decode failed; retrying individually: {type(error).__name__}', flush=True)
            good, vectors = [], []
            for item in batch:
                try:
                    vectors.append(vocab.embed_file(item['path']))
                    good.append(item)
                except Exception as issue:
                    with journal.open('a', encoding='utf-8') as stream:
                        stream.write(json.dumps({'path': item['path'], 'sha256': item['sha256'], 'error': str(issue)}, ensure_ascii=False)+'\n')
            batch = good
            if not batch:
                continue
            embeddings = np.stack(vectors)
        calibrated = v.calibrate(embeddings, Q)
        for i, (item, vector) in enumerate(zip(batch, embeddings)):
            terms = v.top_terms(vector, k=8, exclude=('quality', 'production', *vocab.UNVALIDATED))
            result = {
                'path': item['path'], 'relative_path': item['relative_path'], 'sha256': item['sha256'],
                'model': 'laion/larger_clap_general',
                'sampling': 'Whole file up to 10 seconds; mean of up to six evenly spaced 10-second windows for longer files.',
                'top_terms': [{'description': t[0], 'category': t[1], 'z': round(float(t[2]), 3), 'verdict': verdict(float(t[2]))} for t in terms],
                'query_matches': {key: {'query': QUERIES[key], 'z': round(float(calibrated['z_q'][i,j]), 3),
                    'cosine': round(float(calibrated['cos_q'][i,j]), 4), 'verdict': verdict(float(calibrated['z_q'][i,j]))}
                    for j, key in enumerate(query_keys)},
            }
            done[item['sha256']] = result
            with journal.open('a', encoding='utf-8') as stream:
                stream.write(json.dumps(result, ensure_ascii=False, allow_nan=False)+'\n')
        print(f'Analysed {len(done)}/{len(unique)} unique audio contents ({time.time()-started:.0f}s).', flush=True)

    expanded = []
    for item in candidates:
        if item['sha256'] in done:
            row = dict(done[item['sha256']])
            row['evidence_source_path'] = row['path']
            row['path'], row['relative_path'], row['folder'] = item['path'], item['relative_path'], item['folder']
            row['exact_duplicate_reused'] = row['evidence_source_path'] != row['path']
            measured = measures.get(item['path'].lower(), {})
            row['measured_peak_dbfs'] = measured.get('peak_db')
            row['measured_duration_seconds'] = measured.get('duration')
            row['mono_compatibility_caution'] = measured.get('lr_corr', 1) < -0.75
            row['near_silent'] = measured.get('peak_db', 0) < -70
            if row['near_silent']:
                row['top_terms'] = []
                row['query_matches'] = {}
                row['status'] = 'near_silent_excluded_from_sound_matching'
            else:
                row['status'] = 'semantic_evidence'
            expanded.append(row)
    audible_unique = {}
    for row in expanded:
        if not row['near_silent']:
            audible_unique.setdefault(row['sha256'], row)
    shortlist = {}
    for key in query_keys:
        limit = SHORTLIST_MAX_SECONDS.get(key)
        eligible = [row for sha, row in audible_unique.items() if limit is None or
                    0 < (row.get('measured_duration_seconds') or 0) <= limit]
        ordered = sorted(eligible, key=lambda row: -row['query_matches'][key]['z'])[:5]
        shortlist[key] = [{'path': row['path'], 'relative_path': row['relative_path'],
                           'measured_duration_seconds': row['measured_duration_seconds'], **row['query_matches'][key],
                           'top_description': row['top_terms'][0]} for row in ordered]
    dump(OUT / 'earshot-library-analysis.json', {
        'tool': 'earshot 0.4.0', 'coverage': {'audio_bearing_files': len(candidates), 'files_with_evidence': len(expanded),
            'unique_contents': len(unique), 'analysed_unique_contents': len(done),
            'files_with_semantic_descriptions': sum(not row['near_silent'] for row in expanded),
            'near_silent_excluded_files': [row['relative_path'] for row in expanded if row['near_silent']]},
        'limits': ['Model descriptions and matching are evidence, not human taste judgments.',
            'z is a calibrated description-match statistic, not a probability.',
            'Long-file tags are sampled; individual candidate trims require additional analysis.',
            'No video edit was provided for cue timing, masking or final-mix critique.'],
        'shortlist_duration_limits_seconds': SHORTLIST_MAX_SECONDS,
        'shortlists': shortlist, 'assets': expanded,
    })
    print('Saved complete semantic index. Cross-checking representative files with describe/AST and measurements.', flush=True)
    representative = {}
    for row in expanded:
        if row['near_silent']:
            continue
        previous = representative.get(row['folder'])
        if previous is None or row['top_terms'][0]['z'] > previous['top_terms'][0]['z']:
            representative[row['folder']] = row
    for key in ('caption_pop', 'caption_click', 'transition_whoosh', 'soft_impact', 'notification'):
        if not shortlist[key]:
            continue
        top = shortlist[key][0]
        if top['verdict'] == 'no match':
            continue
        representative['query:'+key] = next(row for row in expanded if row['path'] == top['path'])
    descriptions_path = OUT / 'earshot-descriptions.json'
    descriptions = json.loads(descriptions_path.read_text(encoding='utf-8')) if descriptions_path.exists() else {}
    for key, row in representative.items():
        if row['path'] not in descriptions or 'error' in descriptions[row['path']]:
            try:
                descriptions[row['path']] = api.describe(row['path'])
            except Exception as error:
                descriptions[row['path']] = {'error': str(error), 'path': row['path']}
            dump(descriptions_path, descriptions)
        print(f'Described {key}: '+descriptions[row['path']].get('summary', descriptions[row['path']].get('error', '')), flush=True)
    print('Earshot library analysis complete.', flush=True)


if __name__ == '__main__':
    main()
