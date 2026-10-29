const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');
test('Native caption payloads preserve Unicode, complementary layers and fresh binary identities',()=>{
 const script=String.raw`
import sys,tempfile,json,zipfile,io,gzip,base64,struct,uuid,xml.etree.ElementTree as E
from pathlib import Path
sys.path.insert(0,'scripts')
from build_native_captions import build,installed_template
rules=json.loads(Path('skill/supermode/profile.json').read_text(encoding='utf-8'))
plan={'width':1080,'height':1920,'captions':[{'id':'unicode-proof','start':0,'end':1,'fontSize':64,'x':540,'y':960,'runs':[{'text':'Revenue','sizeScale':1,'emphasis':False},{'text':'₹5,000','sizeScale':1.4,'emphasis':True},{'text':'😀','sizeScale':1,'emphasis':False}]}]}
original=installed_template().read_bytes()
with tempfile.TemporaryDirectory() as tmp:
 clips=build(plan,rules,Path(tmp));assert [c['role'] for c in clips]==['normal','highlight']
 docs=[];hashes=[];uids=[]
 for c in clips:
  assert c['delivery']=='premiere_text' and c['path'].endswith('.mogrt')
  with zipfile.ZipFile(c['path']) as z:
   d=json.loads(z.read('definition.json'));assert d['authorApp']=='ppro'
   with zipfile.ZipFile(io.BytesIO(z.read('project.prgraphic'))) as inner:
    root=E.fromstring(gzip.decompress(inner.read(next(n for n in inner.namelist() if n.endswith('.prproj')))))
  assert any(e.get('ObjectUID')==d['sourceInfoLocalized']['en_US']['id'] for e in root.iter('Sequence'))
  p=next(e for e in root.iter('ArbVideoComponentParam') if e.findtext('Name')=='Source Text').find('StartKeyframeValue')
  b=base64.b64decode(p.text);assert struct.unpack('<Q',b[:8])[0]==len(b)-8
  assert b[-2:]!=b'\0\0'
  h=uuid.UUID(p.get('BinaryHash'));assert int.from_bytes(h.bytes[-4:],'big')==len(b)+12
  hashes.append(str(h));uids.append(d['sourceInfoLocalized']['en_US']['id'])
  textdoc=json.loads(b[8:].decode('utf-16-le'))['mTextParam'];assert textdoc['mLeading']==0
  docs.append(textdoc['mStyleSheet'])
 assert docs[0]['mText']==docs[1]['mText']=='Revenue ₹5,000 😀'
 assert docs[0]['mFontSize']['mParamValues']==[[0,64],[8,90],[15,64]]
 for a,b in zip(docs[0]['mFillVisible']['mParamValues'],docs[1]['mFillVisible']['mParamValues']):assert a[0]==b[0] and a[1]!=b[1]
 assert len(set(hashes))==2 and len(set(uids))==2
 assert all(c['animateEntrance'] for c in clips)
 plan['captions'].append({**plan['captions'][0],'id':'continuation','originId':'unicode-proof','start':1,'end':2,'y':1574})
 pieces=build(plan,rules,Path(tmp)/'split')
 assert all(not c['animateEntrance'] for c in pieces if c['id']=='continuation')
 assert installed_template().read_bytes()==original
print('native text compiler verified')
`;
 const r=spawnSync(process.env.RIXU_PYTHON||'python',['-c',script],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',windowsHide:true});
 assert.equal(r.status,0,r.stderr||r.stdout);
});
