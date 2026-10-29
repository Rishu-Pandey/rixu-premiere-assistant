"""Use Real SFX's decoder/measurements for audio-bearing video containers and an omitted re-export."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'library-audit'
sys.path.insert(0, str(Path.home() / '.codex/skills/real-sfx/scripts'))
from common import analyse_sound

catalog = json.loads((OUT / 'sfx-library-catalog.json').read_text(encoding='utf-8'))
index = json.loads((OUT / 'real-sfx-index.json').read_text(encoding='utf-8'))
known = {r['path'].lower() for r in index['sounds']}
pending = [r for r in catalog['assets'] if r.get('has_audio') and r['path'].lower() not in known]
result_path = OUT / 'real-sfx-extra-measurements.json'
results = json.loads(result_path.read_text(encoding='utf-8')) if result_path.exists() else {}
pending = [r for r in pending if r['path'] not in results]
with ThreadPoolExecutor(max_workers=2) as pool:
    jobs = {pool.submit(analyse_sound, r['path']): r for r in pending}
    for job in as_completed(jobs):
        row = jobs[job]
        try:
            value = job.result()
            results[row['path']] = value or {'error': 'No decoded samples'}
        except Exception as error:
            results[row['path']] = {'error': str(error)}
        result_path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')
        print('Measured '+row['relative_path'], flush=True)
print(json.dumps({'extra_records': len(results), 'errors': sum('error' in r for r in results.values()),
                  'near_silent_files': [p for p,r in results.items() if r.get('peak_db',0) < -70]}, indent=2))
