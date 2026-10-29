"""Create a visual caption acceptance fixture; no synthetic audio."""
import json
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont
from render_captions import render

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'output/demo'
OUT.mkdir(parents=True, exist_ok=True)
rules = json.loads((ROOT/'skill/supermode/profile.json').read_text(encoding='utf-8'))
captions = []
for i,(layout,y,start,end) in enumerate([('full',1574,1,2),('split',960,2,4),('full',1574,4,5)]):
    captions.append({'id':f'demo-{i}','text':'Revenue grew 25%','runs':[{'text':'Revenue','emphasis':True,'sizeScale':1.4},{'text':'grew','emphasis':False,'sizeScale':1},{'text':'25%','emphasis':True,'sizeScale':1.4}], 'layout':layout,'x':540,'y':y,'fontSize':64,'start':start,'end':end,'style':'animated'})
graphics = render({'width':1080,'height':1920,'captions':captions},rules,OUT/'graphics')
font=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf',48)
sheet=Image.new('RGB',(1140,750),'#11151d')
for i,c in enumerate(graphics):
    image=Image.new('RGBA',(1080,1920),'#172436')
    draw=ImageDraw.Draw(image)
    if c['layout']=='split':
        draw.rectangle((0,0,1080,960),fill='#214452');draw.rectangle((0,960,1080,1920),fill='#332a4e');draw.line((0,960,1080,960),fill='#8ba2aa',width=4)
    draw.text((80,140),'UPPER PICTURE' if c['layout']=='split' else 'FULL SCREEN',font=font,fill='#9faebf')
    if c['layout']=='split':draw.text((80,1600),'LOWER PICTURE',font=font,fill='#a79eb7')
    image=Image.alpha_composite(image,Image.open(c['path']))
    image.convert('RGB').save(OUT/f'frame-{i}.png')
    sheet.paste(image.convert('RGB').resize((340,604)),(20+i*380,70))
draw=ImageDraw.Draw(sheet);small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',22)
for i,label in enumerate(['1–2s · Lower third','2–4s · On the divider','4–5s · Lower third']):draw.text((20+i*380,25),label,font=small,fill='white')
draw.text((20,700),'One caption split exactly at layout changes. Important words are larger.',font=small,fill='#b9c3d3')
sheet.save(OUT/'caption-layout-preview.png')
(OUT/'graphics.json').write_text(json.dumps(graphics,indent=2),encoding='utf-8')
(OUT/'demo.srt').write_text('1\n00:00:01,000 --> 00:00:05,000\nRevenue grew 25%\n',encoding='utf-8')
print(OUT)
