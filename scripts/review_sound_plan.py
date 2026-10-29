"""Check recorded SFX against the cached sequence mix without changing voice/music."""
import argparse,json,subprocess,math,wave
from pathlib import Path
import numpy as np
RATE=48000
def decode(path):
 result=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-vn','-ac','2','-ar',str(RATE),'-f','f32le','pipe:1'],capture_output=True,check=True)
 return np.frombuffer(result.stdout,dtype='<f4').reshape(-1,2).copy()
def db(value):return 20*math.log10(max(float(value),1e-9))
def rms(data):return math.sqrt(float(np.mean(np.square(data,dtype=np.float64)))) if len(data) else 0
def write(path,data):
 with wave.open(str(path),'wb') as out:out.setnchannels(2);out.setsampwidth(2);out.setframerate(RATE);out.writeframes((np.clip(data,-1,1)*32767).astype('<i2').tobytes())
def review(base,sounds,quiet,folder):
 folder.mkdir(parents=True,exist_ok=True);stem=np.zeros_like(base);cache={};rows=[];kept=[];skipped=[]
 order=sorted(enumerate(sounds),key=lambda pair:({'hook':0,'payoff':0,'build':1,'support':2}.get(pair[1].get('role'),2),pair[1]['time']))
 for index,source in order:
  s=dict(source);start=round(s['start']*RATE);duration=min(round(s['duration']*RATE),len(base)-start)
  if duration<=0:skipped.append({'time':s['time'],'reason':'Outside the analysed video.'});continue
  overlap=[q for q in quiet if s['start']<q['end'] and (start+duration)/RATE>q['start']]
  if any(q['start']<=s['time'] for q in overlap):skipped.append({'time':s['time'],'reason':'The recorded build would cover an intentional reset before its anchor.'});continue
  if overlap:duration=min(duration,round(min(q['start'] for q in overlap)*RATE)-start)
  if s['path'] not in cache:cache[s['path']]=decode(s['path'])
  offset=round(s.get('sourceIn',0)*RATE);audio=cache[s['path']][offset:offset+duration].copy();duration=len(audio);end=start+duration
  if not duration:continue
  window=base[max(0,round((s['time']-.2)*RATE)):min(len(base),round((s['time']+.2)*RATE))]
  bed=db(rms(window));raw=db(rms(audio));gain=s['gainDb'];target=bed-({'high':4,'medium':7,'low':10}.get(s.get('energy'),7))
  if bed>-45:gain=min(gain,target-raw)
  fixed=base[start:end]+stem[start:end];linear=10**(gain/20);bound=np.maximum(.84,np.abs(base[start:end]))
  if np.any(np.abs(fixed+audio*linear)>bound):
   lo,hi=0.,linear
   for _ in range(28):
    mid=(lo+hi)/2
    if np.all(np.abs(fixed+audio*mid)<=bound):lo=mid
    else:hi=mid
   linear=lo;gain=db(linear)
  if gain < -60:skipped.append({'time':s['time'],'reason':'Insufficient headroom above the original mix.'});continue
  if duration<round(s['duration']*RATE) or offset+duration<len(cache[s['path']]):
   fade=min(round(.008*RATE),duration);audio[-fade:]*=np.linspace(1,0,fade)[:,None]
   asset=folder/f'tail-trim-{index}.wav';write(asset,audio);s['originalPath']=s.get('originalPath',s['path']);s['path']=str(asset.resolve());s['sourceIn']=0
  s['duration']=duration/RATE;s['gainDb']=math.floor(gain*10000)/10000;stem[start:end]+=audio*(10**(s['gainDb']/20));kept.append((index,s));rows.append({'time':s['time'],'role':s.get('role'),'energy':s.get('energy'),'baseRmsDb':round(bed,2),'gainBeforeDb':source['gainDb'],'gainAfterDb':s['gainDb']})
 mix=base+stem;write(folder/'sfx-track.wav',stem);write(folder/'mix-review.wav',mix)
 return {'sounds':[s for _,s in sorted(kept)],'skipped':skipped,'levels':rows,'basePeakDbfs':round(db(np.max(np.abs(base))),3),'mixPeakDbfs':round(db(np.max(np.abs(mix))),3),'newClippedSamples':int(np.count_nonzero((np.abs(mix)>1)&(np.abs(base)<=1))),'quietIntervals':quiet,'notes':['RMS checks use the rendered mixed base, not an isolated speech stem.','Measurements do not establish taste or retention.']}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path);a=p.parse_args();data=json.loads(a.input.read_text(encoding='utf-8'));result=review(decode(data['base']),data['sounds'],data.get('quiet',[]),a.output);(a.output/'sound-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'sounds':len(result['sounds']),'skipped':len(result['skipped']),'mixPeakDbfs':result['mixPeakDbfs'],'newClippedSamples':result['newClippedSamples']}))
