"""Persistent local query scorer; cached audio embeddings, one model load per companion session."""
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault('EARSHOT_HOME', str(ROOT / '.tools/earshot-cache'))
os.environ.setdefault('EARSHOT_OFFLINE', '1')
os.environ.setdefault('EARSHOT_THREADS', '3')
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
sys.stdin.reconfigure(encoding='utf-8')

def main():
    import numpy as np
    from earshot import vocab
    from earshot.match import verdict
    assets = json.loads((ROOT/'library-audit/earshot-library-analysis.json').read_text(encoding='utf-8'))['assets']
    paths = sorted({a['path'] for a in assets if not a['near_silent'] and Path(a['path']).is_file()})
    # Logs and model diagnostics stay off the JSON-lines transport.
    transport = sys.stdout
    sys.stdout = sys.stderr
    v = vocab.get()
    vectors = vocab.embed_files(paths)
    cache = {}
    for line in sys.stdin:
        try:
            request = json.loads(line)
            query = request['query']
            if query not in cache:
                scores = v.calibrate(vectors, v.embed_text([query]))
                cache[query] = [{'path':p,'z':round(float(scores['z_q'][i,0]),3),
                                 'verdict':verdict(float(scores['z_q'][i,0])),'query':query} for i,p in enumerate(paths)]
            result = {'id':request['id'],'results':cache[query]}
        except Exception as error:
            result = {'id':request.get('id'), 'error':str(error)}
        transport.write(json.dumps(result, ensure_ascii=False)+'\n')
        transport.flush()

if __name__ == '__main__':
    main()
