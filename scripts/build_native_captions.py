"""Compile editable Premiere-authored text graphics using the installed Adobe title.

No image is used as timeline text. PNGs are panel previews only. Both native
layers carry the same text geometry; per-character visibility separates normal
words from larger highlights without shifting the remaining words.
"""
import argparse,base64,copy,gzip,io,json,os,re,struct,uuid,zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import ImageFont
from render_captions import font_path

def installed_template():
    candidates=sorted((Path(os.environ.get('ProgramFiles','C:/Program Files'))/'Adobe').glob('Adobe Premiere Pro */Essential Graphics/Basic Title.mogrt'))
    candidates.append(Path.home()/'AppData/Roaming/Adobe/Common/Motion Graphics Templates/Basic Title.mogrt')
    for p in [*reversed(candidates[:-1]),candidates[-1]]:
        if p.is_file():return p
    raise ValueError('Adobe Basic Title.mogrt is required for editable Premiere text. No PNG fallback is used.')

def layout(caption,rules):
    limit=rules['captions']['maxWidth']*caption['canvasWidth'];factor=1
    for _ in range(12):
        lines=[];line=[];current=0
        for run in caption['runs']:
            size=max(12,round(caption['fontSize']*run['sizeScale']*factor));font_name=rules['emphasis'].get('font',rules['captions']['font']) if run['emphasis'] else rules['captions']['font'];font=ImageFont.truetype(font_path(font_name),size)
            width=font.getlength(run['text']);space=font.getlength(' ')
            if line and current+space+width>limit:lines.append(line);line=[];current=0
            line.append((run,font,width,space));current+=width+space
        if line:lines.append(line)
        if len(lines)<=2 and all(sum(x[2]+x[3] for x in row)-row[-1][3]<=limit for row in lines):break
        factor*=.86
    if len(lines)>2:raise ValueError('Caption too long for two editable text lines: '+caption['id'])
    leading=max(font.size for row in lines for _,font,_,_ in row)*1.25
    text='';spans=[];top=1e9;bottom=-1e9
    for row_index,row in enumerate(lines):
        if row_index:text+='\r'
        for i,(run,font,_,_) in enumerate(row):
            if i:text+=' '
            start=len(text.encode('utf-16-le'))//2;text+=run['text'];end=len(text.encode('utf-16-le'))//2
            spans.append({'start':start,'end':end,'size':font.size,'emphasis':run['emphasis'],'font':rules['emphasis'].get('font',rules['captions']['font']) if run['emphasis'] else rules['captions']['font']})
            box=font.getbbox(run['text'],anchor='ls');top=min(top,row_index*leading+box[1]);bottom=max(bottom,row_index*leading+box[3])
    return {'text':text,'spans':spans,'leading':leading,'baselineOffset':-(top+bottom)/2}

def document(seed,spec,rules,role):
    # Premiere adds mLeading to its automatic line advance. Supplying our
    # preview's full line height here would double the multiline spacing.
    result=copy.deepcopy(seed);p=result['mTextParam'];style=p['mStyleSheet'];style['mText']=spec['text'];p['mLeading']=0;p['mAlignment']=2
    aliases={'Arial Bold':'Arial-BoldMT','Arial':'ArialMT','Segoe UI Bold':'SegoeUI-Bold','Segoe UI':'SegoeUI','Times New Roman Bold Italic':'TimesNewRomanPS-BoldItalicMT'}
    fonts=list(dict.fromkeys(aliases.get(s['font'],s['font']) for s in spec['spans']))
    style['mFontName']={'mParamValues':[[s['start'],aliases.get(s['font'],s['font'])] for s in spec['spans']]}
    style['mFontSize']={'mParamValues':[[s['start'],s['size']] for s in spec['spans']]}
    color=int((rules['emphasis']['color'] if role=='highlight' else rules['captions']['color']).lstrip('#'),16)
    style['mFillColor']={'mParamValues':[[0,color]]};style['mStrokeColor']={'mParamValues':[[0,int(rules['captions']['outline'].lstrip('#'),16)]]}
    visible=[[s['start'],(s['emphasis'] if role=='highlight' else not s['emphasis'])] for s in spec['spans']]
    style['mFillVisible']={'mParamValues':visible};style['mStrokeVisible']={'mParamValues':visible};style['mStrokeWidth']={'mParamValues':[[0,rules['captions']['outlineWidth']]]}
    p['mShadowVisible']=False;return result,fonts

def build(plan,rules,output,template=None):
    output.mkdir(parents=True,exist_ok=True);template=template or installed_template()
    with zipfile.ZipFile(template) as source:
        entries={name:source.read(name) for name in source.namelist()}
        definition=json.loads(entries['definition.json'])
        with zipfile.ZipFile(io.BytesIO(source.read('project.prgraphic'))) as inner:
            project_name=next(n for n in inner.namelist() if n.endswith('.prproj'));raw=inner.read(project_name)
            root=ET.fromstring(gzip.decompress(raw) if raw[:2]==b'\x1f\x8b' else raw)
    param=next(e for e in root.iter('ArbVideoComponentParam') if e.findtext('Name')=='Source Text')
    blob=base64.b64decode(param.find('StartKeyframeValue').text);seed=json.loads(blob[8:].decode('utf-16-le').rstrip('\0'))
    clips=[];seen_origins=set()
    for caption in plan['captions']:
        spec=layout({**caption,'canvasWidth':plan['width']},rules)
        origin=caption.get('originId',caption['id']);entrance=origin not in seen_origins;seen_origins.add(origin)
        for role in ['normal','highlight']:
            if role=='highlight' and not any(s['emphasis'] for s in spec['spans']):continue
            tree=copy.deepcopy(root);param=next(e for e in tree.iter('ArbVideoComponentParam') if e.findtext('Name')=='Source Text')
            # Premiere's length-prefixed UTF-16 JSON has no trailing NUL. A NUL
            # makes the native text deserializer reject the graphics payload.
            doc,fonts=document(seed,spec,rules,role);encoded=json.dumps(doc,ensure_ascii=False,separators=(',',':')).encode('utf-16-le')
            payload=struct.pack('<Q',len(encoded))+encoded
            value=param.find('StartKeyframeValue');value.text=base64.b64encode(payload).decode()
            # This is Adobe's binary-block identity (12 unique bytes followed
            # by the block size including its 12-byte serialization header).
            value.set('BinaryHash',str(uuid.UUID(bytes=uuid.uuid4().bytes[:12]+struct.pack('>I',len(payload)+12))))
            for e in tree.iter('InstanceName'):
                if e.text=='Your Title Here':e.text=spec['text']
            d=copy.deepcopy(definition);d['capsuleID']=str(uuid.uuid4())
            # Native graphics are cached by project object UUID as well as the
            # outer capsule. Each caption must own its internal source objects.
            ids={e.attrib['ObjectUID']:str(uuid.uuid4()) for e in tree.iter() if 'ObjectUID' in e.attrib}
            for e in tree.iter():
                if e.tag in ('ClipID','BE.RushInspectorPanel.MogrtIdentifier') or (e.tag=='ID' and e.text and re.fullmatch(r'[0-9a-f-]{36}',e.text)):
                    ids[e.text]=str(uuid.uuid4())
            for e in tree.iter():
                for key in ('ObjectUID','ObjectURef'):
                    if e.attrib.get(key) in ids:e.attrib[key]=ids[e.attrib[key]]
                if e.text in ids:e.text=ids[e.text]
            for info in d['sourceInfoLocalized'].values():
                if info.get('id') in ids:info['id']=ids[info['id']]
            d['usedFontsLocalized']['en_US']=fonts
            d['clientControls']=[]
            inner=io.BytesIO()
            with zipfile.ZipFile(inner,'w',zipfile.ZIP_DEFLATED) as z:z.writestr(project_name,gzip.compress(ET.tostring(tree,encoding='utf-8',xml_declaration=True)))
            target=output/(re.sub('[^A-Za-z0-9_-]','_',caption['id'])+'-'+role+'.mogrt')
            with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
                for name,data in entries.items():
                    z.writestr(name,json.dumps(d,ensure_ascii=False) if name=='definition.json' else inner.getvalue() if name=='project.prgraphic' else data)
            clips.append({**caption,'path':str(target.resolve()),'role':role,'nativeText':spec['text'],'baselineOffset':spec['baselineOffset'],'animateEntrance':entrance,'delivery':'premiere_text','canvasWidth':plan['width'],'canvasHeight':plan['height']})
    (output/'text-layers.json').write_text(json.dumps(clips,ensure_ascii=False,indent=2),encoding='utf-8');return clips

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    data=json.loads(a.input.read_text(encoding='utf-8'));print(json.dumps({'textLayers':len(build(data['plan'],data['rules'],a.output))}))
