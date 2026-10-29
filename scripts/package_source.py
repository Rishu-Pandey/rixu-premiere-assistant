"""Package local source without tokens, model caches or the user's audio library."""
from pathlib import Path
import zipfile
import json
ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
DEST=ROOT/f'dist/rixu-premiere-assistant-{VERSION}.zip'
DEST.parent.mkdir(exist_ok=True)
folders=['src','panel','web','uxp-native','scripts','tests','tools','skill','library-audit']
files=['README.md','VALIDATION.md','package.json','requirements.json','Start RIXU.cmd','Install RIXU.cmd','Install Native Helper.cmd','Enable Adobe UXP.cmd','PREMIERE_AI_PROPOSAL.txt','CAPTIONS_SFX_PROPOSAL.txt','.gitignore']
excluded={'connection.js','bridge-config.js'}
with zipfile.ZipFile(DEST,'w',zipfile.ZIP_DEFLATED) as archive:
    for folder in folders:
        for source in (ROOT/folder).rglob('*'):
            if source.is_file() and source.name not in excluded and '__pycache__' not in source.parts:
                archive.write(source,source.relative_to(ROOT))
    for file in files:
        source=ROOT/file
        if source.exists():archive.write(source,file)
    preview=ROOT/'output/demo/caption-layout-preview.png'
    if preview.exists():archive.write(preview,'preview/caption-layout-preview.png')
    for file in ['live-smoke-report.json','live-actions-report.json','final-host-inspection.json','live-named-sfx-plan-report.json','live-cli-planner-report.json','live-cli-panel-report.json','live-project-analysis-report.json','live-native-text-report.json','live-native-caption-repair-report.json','live-simple-workflow-report.json','live-crash-recovery-report.json','live-semantic-style-report.json','live-dense-sfx-report.json']:
        source=ROOT/'output/demo'/file
        if source.exists():archive.write(source,'validation/'+file)
    cadence=ROOT/'output/style-learning/cadence-audit.json'
    if cadence.exists():archive.write(cadence,'validation/reference-cadence-audit.json')
print(DEST)
