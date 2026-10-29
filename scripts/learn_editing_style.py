"""Read-only reference inventory and Premiere timeline style measurements.

Reference projects/renders are never opened for editing or rewritten. Measurements
come from used timeline items, not every unused asset imported into a project.
"""
import argparse,base64,collections,concurrent.futures,gzip,hashlib,json,math,re,statistics,struct,subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

TICKS=254016000000

def formatted_strings(value):
    """Recover length-prefixed UTF-8 strings from Adobe's formatted-text block.

    This deliberately does not guess undocumented font sizes or colour fields.
    Rendered frames provide independent typography measurements.
    """
    blob=base64.b64decode(value or '');strings=[]
    for i in range(8,len(blob)-5):
        n=struct.unpack_from('<I',blob,i)[0]
        if not 0<n<2000 or i+4+n>=len(blob) or blob[i+4+n]!=0:continue
        try:
            s=blob[i+4:i+4+n].decode('utf-8')
            if s.isprintable() and s.strip() and any(c.isalnum() for c in s):strings.append(s)
        except UnicodeError:pass
    return strings

class Project:
    def __init__(self,path):
        self.path=Path(path);raw=self.path.read_bytes();self.digest=hashlib.sha256(raw).hexdigest()
        self.root=ET.fromstring(gzip.decompress(raw) if raw[:2]==b'\x1f\x8b' else raw)
        self.objects={e.get('ObjectID') or e.get('ObjectUID'):e for e in self.root if e.get('ObjectID') or e.get('ObjectUID')}
    def ref(self,e):
        return None if e is None else self.objects.get(e.get('ObjectRef') or e.get('ObjectURef'))
    def components(self,item):
        chain=self.ref(item.find('./ClipTrackItem/ComponentOwner/Components'))
        return [] if chain is None else [c for p in chain.findall('.//Component') if (c:=self.ref(p)) is not None]
    def params(self,component):
        return [p for e in component.findall('.//Params/Param') if (p:=self.ref(e)) is not None]
    def text(self,component):
        docs=[]
        for p in self.params(component):
            if p.findtext('Name')!='Source Text':continue
            value=p.find('StartKeyframeValue')
            if value is None or not value.text:continue
            try:
                raw=base64.b64decode(value.text);doc=json.loads(raw[8:].decode('utf-16-le').rstrip('\0'));mp=doc['mTextParam'];ss=mp['mStyleSheet']
                docs.append({'text':ss.get('mText',''),'fontSizes':ss.get('mFontSize',{}).get('mParamValues',[]),'fonts':ss.get('mFontName',{}).get('mParamValues',[]),'colors':ss.get('mFillColor',{}).get('mParamValues',[]),'alignment':mp.get('mAlignment')})
            except (ValueError,KeyError,UnicodeError):pass
        return docs
    def clip(self,item,track,kind):
        sub=self.ref(item.find('./ClipTrackItem/SubClip'));clip=self.ref(sub.find('Clip')) if sub is not None else None
        source=self.ref(clip.find('./Clip/Source')) if clip is not None else None
        media=self.ref(source.find('.//Media')) if source is not None else None
        paths=[] if media is None else [e.text for e in media if e.tag in ('ActualMediaFilePath','FilePath','MediaFileHistory0','RelativePath') and e.text]
        start=float(item.findtext('./ClipTrackItem/TrackItem/Start','0'))/TICKS;end=float(item.findtext('./ClipTrackItem/TrackItem/End','0'))/TICKS
        name=sub.findtext('Name','') if sub is not None else ''
        components=self.components(item);texts=[t for c in components for t in self.text(c)]
        level=[]
        if clip is not None:
            try:
                gain=float(clip.findtext('Gain','1'));level.append(round(20*math.log10(gain),2) if gain>0 else -96)
            except ValueError:pass
        for c in components:
            for p in self.params(c):
                if p.findtext('Name') not in ('Level','Volume'):continue
                value=p.findtext('StartKeyframe','').split(',')
                try:
                    v=float(value[1]);level.append(round(20*math.log10(v)+15,2) if v>0 else -96)
                except (IndexError,ValueError):pass
        tags=[e.text for e in item.iter() if e.tag in ('ESP.Tag','MZ.AudioCategorization.AudioCategorizationAdjustmentMode')]
        hint=(' '.join([name,*paths])).lower().replace('\\','/')
        sfx=kind=='audio' and ('/sfx/' in hint or '/sound effect' in hint or bool(re.search(r'whoosh|swoosh|riser|impact|sweep|shutter|click|glitch|charging|charge|pop\b|transition|hit\b|swish|notification|typing|bubble',hint)))
        if 'music' in tags or (end-start>12 and not re.search(r'riser|swell|ambien',hint)):sfx=False
        source_in=float(clip.findtext('./Clip/InPoint','0'))/TICKS if clip is not None else 0
        return {'id':item.get('ObjectID'),'track':track,'kind':kind,'start':start,'end':end,'sourceIn':source_in,'name':name,'paths':paths,'textLayers':texts,'componentNames':[c.findtext('MatchName',c.findtext('./Component/DisplayName','')) for c in components],'gainDb':level,'audioTags':tags,'sfx':sfx,'generated':name.startswith('RIXU ') or any('rixu_prmr/output/' in p.lower().replace('\\','/') for p in paths)}
    def sequences(self):
        result=[]
        for seq in self.root:
            if seq.tag!='Sequence':continue
            name=seq.findtext('Name','')
            if re.search(r'RIXU|SUPERMODE|Proxy Sequence',name,re.I):continue
            groups=[g for x in seq.findall('./TrackGroups/TrackGroup') for r in x if (g:=self.ref(r)) is not None and g.tag in ('VideoTrackGroup','AudioTrackGroup','DataTrackGroup')]
            clips=[];captions=[];width=height=0;fps=0
            for group in groups:
                kind='video' if group.tag=='VideoTrackGroup' else 'audio' if group.tag=='AudioTrackGroup' else 'caption'
                if kind=='video':
                    rect=group.findtext('FrameRect','0,0,0,0').split(',');width,height=int(rect[-2]),int(rect[-1]);fps=TICKS/float(group.findtext('./TrackGroup/FrameRate',str(TICKS/30)))
                for tr in group.findall('./TrackGroup/Tracks/Track'):
                    track=self.ref(tr)
                    if track is None:continue
                    for ref in track.findall('.//ClipItems/TrackItems/TrackItem'):
                        item=self.ref(ref)
                        if item is not None and item.tag=='CaptionDataClipTrackItem':
                            blocks=[b for x in item.findall('./BlockVector/BlockVectorItem') if (b:=self.ref(x)) is not None]
                            strings=[s for b in blocks for s in formatted_strings(b.findtext('FormattedTextData'))]
                            captions.append({'track':int(tr.get('Index','0')),'muted':track.findtext('.//Track/IsMuted','false')=='true','start':float(item.findtext('.//ClipTrackItem/TrackItem/Start','0'))/TICKS,'end':float(item.findtext('.//ClipTrackItem/TrackItem/End','0'))/TICKS,'strings':strings})
                        if item is not None and item.tag in ('VideoClipTrackItem','AudioClipTrackItem'):clips.append(self.clip(item,int(tr.get('Index','0')),kind))
            if not clips:continue
            video=[c for c in clips if c['kind']=='video' and not c['generated']];audio=[c for c in clips if c['kind']=='audio'];sfx=[c for c in audio if c['sfx']];text=[{**t,'start':c['start'],'end':c['end'],'track':c['track']} for c in video for t in c['textLayers']]
            duration=max((c['end'] for c in video),default=0)
            exports=[]
            for e in seq.iter():
                if not e.tag.startswith('ExportSettings.Info.'):continue
                try:
                    d=json.loads(e.text or '{}');out=d.get('OutPath','')
                    if out.lower().endswith('.mp4'):exports.append(out)
                except ValueError:pass
            result.append({'id':seq.get('ObjectUID'),'name':name,'width':width,'height':height,'fps':fps,'duration':duration,'exports':exports,'video':video,'audio':audio,'sfx':sfx,'texts':text,'captions':captions,'sfxPerMinute':60*len(sfx)/duration if duration else 0,'textWords':sum(len(t['text'].split()) for t in text)})
        return result

def probe(row):
    try:
        d=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=codec_type,width,height,r_frame_rate:format=duration','-of','json',row['path']],text=True,encoding='utf-8',stderr=subprocess.DEVNULL,timeout=35))
        video=next(s for s in d['streams'] if s['codec_type']=='video')
        return {**row,'width':video['width'],'height':video['height'],'duration':float(d['format']['duration']),'audio':any(s['codec_type']=='audio' for s in d['streams'])}
    except Exception as e:return {**row,'error':type(e).__name__}

def inventory(input_file,folder):
    inv=json.loads(input_file.read_text(encoding='utf-8'));folder.mkdir(parents=True,exist_ok=True);projects=[];seen=set()
    for file in [p for v in inv.values() for p in v['projects']]:
        try:
            p=Project(file)
            if p.digest in seen:continue
            seen.add(p.digest);seqs=p.sequences();projects.append({'path':file,'sha256':p.digest,'sequences':seqs})
            print(json.dumps({'project':Path(file).name,'sequences':len(seqs),'textLayers':sum(len(s['texts']) for s in seqs),'sfxClips':sum(len(s['sfx']) for s in seqs)}),flush=True)
        except Exception as e:projects.append({'path':file,'error':str(e)})
    (folder/'projects.json').write_text(json.dumps(projects,ensure_ascii=False,indent=2),encoding='utf-8')
    rows=[p for v in inv.values() for p in v['renders']]
    old={r['path']:r for r in json.loads((folder/'renders.json').read_text(encoding='utf-8'))} if (folder/'renders.json').is_file() else {}
    def cached_probe(row):
        cached=old.get(row['path']);return cached if cached and all(row.get(k)==cached.get(k) for k in ('bytes','modified')) else probe(row)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:renders=list(pool.map(cached_probe,rows))
    (folder/'renders.json').write_text(json.dumps(renders,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'projects':len(projects),'renders':len(renders),'output':str(folder)}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('inventory',type=Path);p.add_argument('output',type=Path);a=p.parse_args();inventory(a.inventory,a.output)
