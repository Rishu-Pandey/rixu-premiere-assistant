"""Learn measured defaults and reusable recorded SFX trims from the user's edits."""
import collections,hashlib,json,math,os,re,statistics,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
os.environ.setdefault('EARSHOT_HOME',str(ROOT/'.tools/earshot-cache'));os.environ.setdefault('EARSHOT_OFFLINE','1');os.environ.setdefault('EARSHOT_THREADS','3')
QUERIES={'whoosh':'a fast smooth air whoosh sound','pop':'a short soft rounded pop sound','click':'a single short dry click sound','impact':'a short soft low thump sound','riser':'a rising cinematic swell sound','glitch':'a short digital electronic glitch sound','notification':'a short clear notification chime sound','typing':'a mechanical keyboard typing sound'}
def family(s):
    for f,pattern in [('riser','charg|riser|rising|swell'),('whoosh','whoosh|swoosh|swish|sweep|transition'),('glitch','glitch'),('typing','keyboard|typing|typewriter'),('click','click|shutter|snap'),('notification','chime|ding|notification|bell|beep|shine|shining|collect|money|coin'),('pop','pop|bubble'),('impact','impact|thump|hit|boom')]:
        if re.search(pattern,s,re.I):return f
    return 'whoosh'
def main(folder):
    refs=json.loads((folder/'selected-references.json').read_text(encoding='utf-8'));assets=json.loads((ROOT/'library-audit/earshot-library-analysis.json').read_text(encoding='utf-8'))['assets'];by_name={Path(a['path']).name.lower():a for a in assets if Path(a['path']).is_file()}
    fractions=[];rates=[];gaps=[];gains=[];counts=collections.Counter();roles=collections.Counter();words=collections.Counter();uses=collections.defaultdict(list);full_y=[];glyphs={'normal':[],'highlight':[]}
    for ref in refs:
        normal=hot=0
        for c in ref['captions']:
            if 'EuropaGroteskSH-Med' in c['strings']:normal+=1
            if 'TimesNewRomanPS-BoldItalicMT' in c['strings']:
                hot+=1
                if c['strings'] and 'TimesNewRoman' not in c['strings'][-1]:words.update(re.findall(r"[\w%]+",c['strings'][-1].lower()))
        if normal+hot:fractions.append(hot/(normal+hot))
        rates.append(60*len(ref['sfx'])/ref['duration']);times=sorted(c['start'] for c in ref['sfx']);gaps.extend(b-a for a,b in zip(times,times[1:]) if b-a>.08)
        for c in ref['sfx']:
            name=Path(c['paths'][0]).name.lower() if c['paths'] else c['name'].lower();counts[name]+=1;uses[name].append(c);roles[family(name)]+=1;gains.extend(c['gainDb'][:1])
        visual=json.loads((folder/f"reference-{ref['id']}"/'visual-style.json').read_text(encoding='utf-8'))
        for f in visual['frames']:
            if not f['captionVisible'] or f['confidence']<.8:continue
            if f['role'] in glyphs:glyphs[f['role']].append(f['glyphHeightRatio'])
            if f['layout']=='full' and f['centerY']>.6:full_y.append(f['centerY'])
    frac=statistics.median(fractions);rate=statistics.median(rates);cycle=[]
    for f,n in roles.most_common():cycle.extend([f]*max(1,round(n/sum(roles.values())*12)))
    # Interleave families instead of repeating each category in a long block.
    interleaved=[]
    while cycle:
        remaining=collections.Counter(cycle)
        for f,_ in remaining.most_common():interleaved.append(f);cycle.remove(f)
    out=folder/'palette';out.mkdir(exist_ok=True);palette=[];missing=[]
    from earshot import api,vocab
    for name,count in counts.most_common(16):
        if name not in by_name:missing.append(name);continue
        asset=by_name[name];cs=uses[name];prototype=min(cs,key=lambda c:abs((c['end']-c['start'])-statistics.median(x['end']-x['start'] for x in cs)));start=max(0,prototype.get('sourceIn',0));duration=min(4,max(.08,prototype['end']-prototype['start']));target=out/(hashlib.sha256((asset['path']+str(start)+str(duration)).encode()).hexdigest()[:16]+'.wav')
        if not target.is_file():subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',str(start),'-i',asset['path'],'-t',str(duration),'-vn','-ar','48000','-ac','2','-af','afade=t=out:st='+str(max(0,duration-.008))+':d=0.008','-c:a','pcm_s24le',str(target)],check=True)
        try:
            m=api.measure(str(target),light=True)
            if m['peak_dbfs']<-55:continue
            palette.append({'path':str(target.resolve()),'originalPath':asset['path'],'relativePath':asset['relative_path'],'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'duration':m['duration'],'activeDuration':m['duration'],'peakTime':m['peak_at'],'onset':m['attack_at'],'peakDb':m['peak_dbfs'],'referenceGainDb':statistics.median(c['gainDb'][0] for c in cs if c['gainDb']),'family':family(name),'referenceUses':count,'referenceMatch':True,'sourceIn':start,'measurement':m,'description':asset['top_terms'][0]['description'] if asset['top_terms'] else ''})
            print('Measured reference trim: '+name,flush=True)
        except Exception as e:missing.append(name+': '+str(e))
    if palette:
        v=vocab.get();scores=v.calibrate(vocab.embed_files([p['path'] for p in palette]),v.embed_text(list(QUERIES.values())))
        for i,p in enumerate(palette):p['queryEvidence']={f:{'query':q,'z':round(float(scores['z_q'][i,j]),3)} for j,(f,q) in enumerate(QUERIES.items())}
    style={'learned':True,'referenceCount':len(refs),'highlightFraction':round(frac,3),'highlightWords':dict(words.most_common(150)),'sfxPerMinute':round(rate,2),'sfxMinGap':round(max(.2,min(.6,sorted(gaps)[int(len(gaps)*.1)])),3),'sfxLanes':3,'familyCounts':dict(roles),'familyCycle':interleaved,'preferredSounds':dict(counts),'palette':palette}
    report={'referenceRenders':len(refs),'projectFilesScanned':len(json.loads((folder/'projects.json').read_text(encoding='utf-8'))),'normalFont':'EuropaGroteskSH-Med','highlightFont':'TimesNewRomanPS-BoldItalicMT','highlightWordFractionByReference':fractions,'sfxPerMinuteByReference':rates,'sfxMedianPerMinute':rate,'regularGlyphHeightRatio':statistics.median(glyphs['normal']),'highlightGlyphHeightRatio':statistics.median(glyphs['highlight']),'fullCaptionCenter':statistics.median(full_y),'sourceGainMedianDb':statistics.median(gains) if gains else -10,'paletteTrims':len(palette),'missingPreferredAssets':missing,'note':'Caption frequency comes from project caption blocks; sampled renders independently confirm typography. Render samples were balanced by role, so are not used to estimate frequency. Earshot mixed-audio attacks include speech and music; SFX density comes from used project clips after excluding music.'}
    (folder/'learned-style.json').write_text(json.dumps(style,ensure_ascii=False,indent=2),encoding='utf-8');(folder/'style-summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':main(Path(sys.argv[1] if len(sys.argv)>1 else 'output/style-learning'))
