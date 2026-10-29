const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('Sound review preserves the base, prevents new clipping and respects quiet intervals',()=>{
 const python=path.resolve(__dirname,'../.tools/earshot-env/Scripts/python.exe');
 const code=String.raw`
import sys,tempfile
from pathlib import Path
import numpy as np
sys.path.insert(0,'scripts')
import review_sound_plan as r
rate=r.RATE;t=np.arange(rate)/rate
base=np.repeat((.6*np.sin(2*np.pi*220*t))[:,None],2,axis=1).astype('float32');base[40000]=1.03;before=base.copy()
recording=np.repeat((.8*np.sin(2*np.pi*330*t))[:,None],2,axis=1).astype('float32')
r.decode=lambda path:recording
sound={'path':'transport-fixture.wav','time':0,'start':0,'duration':.2,'gainDb':6,'role':'payoff','energy':'high'}
with tempfile.TemporaryDirectory() as tmp:
 result=r.review(base,[sound,{**sound,'time':.6,'start':.6}], [{'start':.5,'end':.9,'reason':'Let the explanation breathe.'}],Path(tmp))
 assert np.array_equal(base,before)
 assert result['newClippedSamples']==0
 assert len(result['sounds'])==1 and len(result['skipped'])==1
 assert result['sounds'][0]['gainDb']<sound['gainDb']
 assert (Path(tmp)/'sfx-track.wav').is_file() and (Path(tmp)/'mix-review.wav').is_file()
print('headroom, base preservation and quiet verified')
`;
 const result=spawnSync(python,['-X','utf8','-c',code],{cwd:path.resolve(__dirname,'..'),windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);
});
