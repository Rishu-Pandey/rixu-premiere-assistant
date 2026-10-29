"""Create local reference sheets and Earshot reports without modifying references."""
import argparse,collections,json,os,subprocess,sys
from pathlib import Path
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[1]
os.environ.setdefault('EARSHOT_HOME',str(ROOT/'.tools/earshot-cache'));os.environ.setdefault('EARSHOT_OFFLINE','1');os.environ.setdefault('EARSHOT_THREADS','3');os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY','1')

def prepare(folder):
    projects=json.loads((folder/'projects.json').read_text(encoding='utf-8'));matches=json.loads((folder/'matched-references.json').read_text(encoding='utf-8'))
    names=['free_LLM','arena_skill_claude_Rahul','fruit-fly-brain-raw-video-raw-master','Claude_plugins_raw','tavus_raw_','Alpha-earth-current-cut-current-cut-master']
    refs=[]
    for name in names:
        candidates=[m for m in matches if m['sequence']==name and abs(m['renderDuration']-m['duration'])<.15]
        if not candidates:continue
        match=candidates[0];project=next(p for p in projects if Path(p['path']).name==match['project'] and any(s['name']==name for s in p.get('sequences',[])));s=next(s for s in project['sequences'] if s['name']==name)
        index=len(refs);out=folder/f'reference-{index}';out.mkdir(exist_ok=True);samples=[]
        for font in ['EuropaGroteskSH-Med','TimesNewRomanPS-BoldItalicMT']:
            captions=[c for c in s['captions'] if font in c['strings'] and 0<=c['start']<s['duration'] and c['end']>c['start']]
            for i in range(min(6,len(captions))):
                c=captions[min(len(captions)-1,int((i+.5)*len(captions)/6))];samples.append({'time':(c['start']+c['end'])/2})
        if not samples:samples=[{'time':(i+.5)*s['duration']/12} for i in range(12)]
        samples.sort(key=lambda p:p['time']);canvas=Image.new('RGB',(4*274,3*512),'#111111');draw=ImageDraw.Draw(canvas)
        for i,row in enumerate(samples):
            row['id']=i;file=out/f'frame-{i}.jpg';subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',str(row['time']),'-i',match['render'],'-frames:v','1','-vf','scale=270:480',str(file)],check=True)
            x=(i%4)*274;y=(i//4)*512;canvas.paste(Image.open(file),(x+2,y+28));draw.text((x+3,y+5),f"ID {i} | {row['time']:.3f}s",fill='white')
        sheet=out/'sheet.jpg';canvas.save(sheet,quality=92)
        cues=[{'time':c['start'],'label':c['name']} for c in s['sfx']];(out/'cues.json').write_text(json.dumps(cues),encoding='utf-8')
        refs.append({'id':index,'project':project['path'],'sequence':name,'render':match['render'],'duration':s['duration'],'sheet':str(sheet.resolve()),'frames':samples,'sfx':s['sfx'],'captions':s['captions'],'cues':str((out/'cues.json').resolve())})
    (folder/'selected-references.json').write_text(json.dumps(refs,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'referenceSheets':len(refs)}))

def listen(folder):
    from earshot import api
    refs=json.loads((folder/'selected-references.json').read_text(encoding='utf-8'));report=[]
    for ref in refs:
        dest=folder/f"reference-{ref['id']}"/'earshot.json'
        if dest.is_file():data=json.loads(dest.read_text(encoding='utf-8'))
        else:
            print('Analysing audio: '+ref['sequence'],flush=True)
            data=api.timeline(ref['render'],cues=ref['cues'],detail='low');dest.write_text(json.dumps(data,ensure_ascii=False,indent=2,default=lambda x:x.tolist() if hasattr(x,'tolist') else str(x)),encoding='utf-8')
        report.append({'sequence':ref['sequence'],'report':str(dest.resolve())})
    (folder/'earshot-references.json').write_text(json.dumps(report,indent=2),encoding='utf-8')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['prepare','listen']);p.add_argument('folder',type=Path);a=p.parse_args();prepare(a.folder) if a.mode=='prepare' else listen(a.folder)
