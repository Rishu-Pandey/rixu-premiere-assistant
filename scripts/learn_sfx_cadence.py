"""Read all duration-matched finished references; separate project SFX timing from mixed audio."""
import os,json,statistics,subprocess,math,collections
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
os.environ.update(EARSHOT_HOME=str(ROOT/'.tools/earshot-cache'),EARSHOT_OFFLINE='1',EARSHOT_THREADS='3',HF_HUB_DISABLE_TELEMETRY='1')
from earshot import api
def percentile(values,p):return float(np.percentile(values,p)) if values else None
def audit(folder):
 projects=json.loads((folder/'projects.json').read_text(encoding='utf-8'));matches=json.loads((folder/'matched-references.json').read_text(encoding='utf-8'));seen=set();reports=[]
 for m in matches:
  file=Path(m['render']);key=str(file.resolve()).lower()
  if key in seen or not file.is_file() or abs(m['renderDuration']-m['duration'])>.2:continue
  candidates=[s for p in projects if Path(p['path']).name==m['project'] for s in p.get('sequences',[]) if s['name']==m['sequence']]
  if not candidates:continue
  seen.add(key);s=candidates[0];sounds=s['sfx'];duration=m['renderDuration'];times=sorted(c['start'] for c in sounds);gaps=[b-a for a,b in zip(times,times[1:])];bins=[sum(t>=start and t<start+3 for t in times) for start in np.arange(0,duration,3)]
  print('Reference audio: '+file.name,flush=True)
  raw=subprocess.run(['ffmpeg','-v','error','-i',str(file),'-vn','-ac','1','-ar','16000','-f','f32le','pipe:1'],capture_output=True,check=True).stdout
  audio=np.frombuffer(raw,dtype='<f4');block=3200;envelope=[20*math.log10(max(1e-9,float(np.sqrt(np.mean(audio[i:i+block].astype('float64')**2))))) for i in range(0,len(audio),block)]
  levels=api.measure(str(file),light=True)
  report={'render':str(file),'sequence':s['name'],'duration':duration,'sfxClips':len(sounds),'sfxPerMinute':round(60*len(sounds)/duration,2),'medianOnsetGap':percentile(gaps,50),'p90OnsetGap':percentile(gaps,90),'maxOnsetGap':max(gaps) if gaps else None,'threeSecondWindowCounts':bins,'windowCoverage':sum(n>0 for n in bins)/len(bins),'sourceGainsDb':[g for c in sounds for g in c['gainDb']],'familyCounts':dict(collections.Counter('build' if any(x in c['name'].lower() for x in ['riser','charging','swell']) else 'accent' for c in sounds)),'loudness':{k:levels.get(k) for k in ['lufs','true_peak_dbtp','lra_lu','clipped_samples']},'mixedRmsEnvelope200ms':envelope}
  reports.append(report)
 summary={'referenceCount':len(reports),'sourceProjects':len(projects),'medianSfxPerMinute':percentile([r['sfxPerMinute'] for r in reports],50),'livelyQuartileSfxPerMinute':percentile([r['sfxPerMinute'] for r in reports],75),'maxSfxPerMinute':max(r['sfxPerMinute'] for r in reports),'medianThreeSecondWindowCoverage':percentile([r['windowCoverage'] for r in reports],50),'requestedHighCadenceSeconds':3,'notes':['Source clip onsets, roles and gains come from project XML; mixed RMS/LUFS include voice and music and do not isolate SFX highs.','No audience analytics were supplied. These finished references are not labelled viral.','The three-second high cadence is the user request, not a claim that all past renders already achieved it.']}
 result={'summary':summary,'renders':reports};(folder/'cadence-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2,default=lambda v:v.item() if isinstance(v,np.generic) else str(v)),encoding='utf-8');print(json.dumps(summary))
if __name__=='__main__':audit(ROOT/'output/style-learning')
