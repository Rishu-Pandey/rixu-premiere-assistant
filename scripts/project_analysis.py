"""Prepare local XML/proxy analysis assets. No transcription or model inference here."""
import argparse,gzip,json,math,os,subprocess,sys,xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path
from PIL import Image,ImageDraw,ImageChops,ImageStat

def prepare(folder):
    snapshot=json.loads((folder/'snapshot.json').read_text(encoding='utf-8'))
    project=Path(snapshot.get('projectPath',''))
    if project.is_file():
        data=project.read_bytes()
        if data[:2]==b'\x1f\x8b':data=gzip.decompress(data)
        ET.fromstring(data)
        (folder/'saved-project.xml').write_bytes(data)
    program=Path(os.environ.get('ProgramFiles','C:/Program Files'))/'Adobe'
    presets=sorted(program.glob('Adobe Premiere Pro */CEP/extensions/com.adobe.frameio.v4/assets/epr/Match Source - Adaptive Low Bitrate.epr'))
    preset=Path(os.environ['RIXU_ANALYSIS_PRESET']) if os.environ.get('RIXU_ANALYSIS_PRESET') else presets[-1] if presets else None
    if not preset or not preset.is_file():raise ValueError('No installed H.264 analysis preset. Set RIXU_ANALYSIS_PRESET to a local Adobe .epr preset.')
    # Preserve Adobe's exporter data exactly. Downscale the resulting draft locally;
    # editing opaque EPR match-source data causes some Premiere builds to refuse it.
    import shutil
    shutil.copyfile(preset,folder/'preview.epr')
    return {'preset':str(folder/'preview.epr'),'width':270,'height':480}

def build_manifest(folder):
    s=json.loads((folder/'snapshot.json').read_text(encoding='utf-8'));fps=float(s['fps'])
    tree=ET.parse(folder/'sequence.xml');seq=tree.getroot().find('.//sequence')
    if seq is None:raise ValueError('Exported XML has no sequence.')
    xml_clips=[]
    for track_index,track in enumerate(seq.findall('./media/video/track')):
        for c in track.findall('clipitem'):
            if c.findtext('enabled','TRUE').upper()=='FALSE':continue
            start=int(c.findtext('start','-1'));end=int(c.findtext('end','-1'))
            if start>=0 and end>start:
                effects=[{'name':e.findtext('name',''),'parameters':[{'name':p.findtext('name',p.findtext('parameterid','')),'xml':ET.tostring(p,encoding='unicode')[:1000]} for p in e.findall('parameter')]} for e in c.findall('./filter/effect')]
                xml_clips.append({'name':c.findtext('name',''),'track':track_index,'startFrame':start,'endFrame':end,'effects':effects})
    # Live start/end values also preserve edit boundaries omitted by XML translators.
    end_frame=round(max(c['end'] for c in s['video'])*fps)
    boundaries=sorted({0,end_frame,*[max(0,min(end_frame,c[k])) for c in xml_clips for k in ['startFrame','endFrame']],*[round(c[k]*fps) for c in s['video'] for k in ['start','end']]})
    intervals=[];probes=[]
    for index,(a,b) in enumerate(zip(boundaries,boundaries[1:])):
        if b<=a:continue
        interval={'id':index,'startFrame':a,'endFrame':b,'clips':[{'name':c['name'],'track':c['track'],'effects':c['effects']} for c in xml_clips if c['startFrame']<=a<c['endFrame']]}
        intervals.append(interval)
        # Inspect both sides and the interior, plus 1-second samples in long opaque clips.
        samples=sorted({a,min(b-1,a+1),(a+b-1)//2,max(a,b-2),b-1,*[f for f in range(a,b,max(1,round(fps)))]})
        for frame in samples:probes.append({'id':len(probes),'interval':index,'frame':frame,'time':frame/fps})
    result={'fps':fps,'endFrame':end_frame,'sequenceName':s['sequenceName'],'intervals':intervals,'probes':probes,'xmlClipCount':len(xml_clips)}
    (folder/'manifest.json').write_text(json.dumps(result,indent=2),encoding='utf-8');return result

def sheets(folder,refine=False):
    manifest=json.loads((folder/'refinement-input.json').read_text(encoding='utf-8')) if refine else build_manifest(folder);preview=folder/'preview.mp4'
    if not preview.is_file() or preview.stat().st_size<100:raise ValueError('Premiere did not produce a preview render.')
    info=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height,duration,r_frame_rate','-of','json',str(preview)],text=True))['streams'][0]
    if int(info['height'])>640 or int(info['width'])>640:
        original=folder/'preview-native.mp4'
        preview.rename(original)
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(original),'-vf','scale=-2:480','-c:v','libx264','-preset','veryfast','-crf','32','-c:a','aac','-b:a','48k',str(preview)],check=True)
        info=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height,duration,r_frame_rate','-of','json',str(preview)],text=True))['streams'][0]
    if abs(float(Fraction(info['r_frame_rate']))-manifest['fps'])>1e-4:raise ValueError('Preview frame rate differs from the sequence. Use a matching-source Adobe preset.')
    expected=manifest['endFrame']/manifest['fps']
    if abs(float(info.get('duration',0))-expected)>max(.2,2/manifest['fps']):raise ValueError('Preview duration does not match the analysed sequence. Analysis stopped.')
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(preview),'-vn','-ac','1','-ar','16000',str(folder/'dialogue.wav')],check=True)
    frames=folder/('refine-frames' if refine else 'frames');frames.mkdir(exist_ok=True)
    # Stream decoded frames with bounded memory; long select expressions exceed
    # FFmpeg's expression-depth limit on timelines with many edit points.
    height=480 if refine else 288
    width=max(2,round(int(info['width'])/int(info['height'])*height/2)*2)
    frame_bytes=width*height*3;wanted={p['frame'] for p in manifest['probes']}
    with (folder/'frame-decode.log').open('wb') as log:
        proc=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-i',str(preview),'-an','-vf',f'scale={width}:{height}','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE,stderr=log)
        number=0;saved=0;previous=None;scene_cuts=[]
        while True:
            data=proc.stdout.read(frame_bytes)
            if not data:break
            if len(data)!=frame_bytes:proc.kill();raise ValueError('Incomplete preview frame.')
            current=Image.frombytes('RGB',(width,height),data)
            small=current.resize((24,32))
            if previous is not None:
                difference=sum(ImageStat.Stat(ImageChops.difference(previous,small)).mean)/(3*255)
                if difference>.18:scene_cuts.append(number)
            previous=small
            if number in wanted:
                saved+=1;current.save(frames/('frame-%05d.jpg'%saved),quality=85)
            number+=1
        if proc.wait()!=0:raise ValueError('Preview frame decode failed; see frame-decode.log.')
    extracted=[frames/('frame-%05d.jpg'%i) for i in range(1,saved+1)]
    if len(extracted)!=len(manifest['probes']):raise ValueError('Preview frame count mismatch; no layout guesses were made.')
    pages=[];batch=12 if refine else 24;columns=4 if refine else 6;tile_w=274 if refine else 168;tile_h=512 if refine else 320
    for offset in range(0,len(extracted),batch):
        rows=math.ceil(min(batch,len(extracted)-offset)/columns);canvas=Image.new('RGB',(columns*tile_w,rows*tile_h),'#111111');draw=ImageDraw.Draw(canvas)
        for j,file in enumerate(extracted[offset:offset+batch]):
            image=Image.open(file);image.thumbnail((tile_w-4,tile_h-30));x=(j%columns)*tile_w+(tile_w-image.width)//2;y=(j//columns)*tile_h
            canvas.paste(image,(x,y+26));p=manifest['probes'][offset+j]
            draw.text(((j%columns)*tile_w+3,y+4),'ID %d | %.3fs'%(p['id'],p['time']),fill='white')
        target=folder/(('refine-sheet-' if refine else 'sheet-')+'%03d.jpg'%(len(pages)+1));canvas.save(target,quality=86)
        pages.append({'path':str(target),'probes':manifest['probes'][offset:offset+batch]})
    manifest['sceneCuts']=scene_cuts;manifest['sheets']=pages;manifest['render']={'width':info['width'],'height':info['height'],'duration':float(info['duration'])}
    (folder/('refinement-manifest.json' if refine else 'manifest.json')).write_text(json.dumps(manifest,indent=2),encoding='utf-8');return {'sheets':len(pages),'probes':len(extracted),'render':manifest['render']}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['prepare','sheets','refine']);parser.add_argument('folder',type=Path);args=parser.parse_args()
    try:print(json.dumps(prepare(args.folder) if args.mode=='prepare' else sheets(args.folder,args.mode=='refine')))
    except Exception as error:print(str(error),file=sys.stderr);raise SystemExit(1)
