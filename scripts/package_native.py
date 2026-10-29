"""Build a machine-local CCX for Adobe UPIA; includes this companion's local connection."""
import json
from pathlib import Path
import zipfile

ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'uxp-native'
cfg=json.loads((ROOT/'runtime/connection.json').read_text(encoding='utf-8'))
manifest=json.loads((source/'manifest.json').read_text(encoding='utf-8'))
if isinstance(manifest['host'],list):manifest['host']=manifest['host'][0]
target=ROOT/'runtime/rixu-native-local.ccx'
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('manifest.json',json.dumps(manifest,indent=2))
    archive.writestr('connection.js','window.RIXU_CONNECTION = '+json.dumps({'url':cfg['url'],'token':cfg['token']})+';')
    for name in ['index.html','main.js']:
        archive.write(source/name,name)
print(target)
