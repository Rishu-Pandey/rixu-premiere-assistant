"""Render transparent styled caption graphics; source text/runs remain editable in the panel plan."""
import argparse
import json
import os
from pathlib import Path
import re
from PIL import Image, ImageDraw, ImageFont


def font_path(name):
    fonts = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
    aliases = {'Arial Bold': 'arialbd.ttf', 'Arial': 'arial.ttf', 'Segoe UI Bold': 'segoeuib.ttf', 'Segoe UI': 'segoeui.ttf','Times New Roman Bold Italic':'timesbi.ttf','TimesNewRomanPS-BoldItalicMT':'timesbi.ttf','EuropaGroteskSH-Med':str(Path.home()/'AppData/Local/Microsoft/Windows/Fonts/EUROPAGROTESKSH-MED.OTF')}
    candidate = fonts / aliases.get(name, name)
    if candidate.is_file():
        return str(candidate)
    if name == 'EuropaGroteskSH-Med' and (fonts / 'EUROPAGROTESKSH-MED.OTF').is_file():
        return str(fonts / 'EUROPAGROTESKSH-MED.OTF')
    if (fonts / 'arialbd.ttf').is_file():
        return str(fonts / 'arialbd.ttf')
    raise ValueError('No compatible caption font found. Choose an installed TTF font.')


def render(plan, rules, output):
    width, height = int(plan['width']), int(plan['height'])
    if not (16 <= width <= 8192 and 16 <= height <= 8192):
        raise ValueError('Unsupported sequence frame size.')
    output.mkdir(parents=True, exist_ok=True)
    result = []
    for caption in plan['captions']:
        canvas = Image.new('RGBA', (width, height))
        draw = ImageDraw.Draw(canvas)
        factor = 1.0
        max_width = width * rules['captions']['maxWidth']
        runs = caption['runs']
        # Two-line layout; shrink together if unusually long words or SRT phrases need it.
        for _ in range(12):
            lines, line, current = [], [], 0
            for run in runs:
                size = max(12, round(caption['fontSize'] * run['sizeScale'] * factor))
                font = ImageFont.truetype(font_path(rules['emphasis'].get('font',rules['captions']['font']) if run['emphasis'] else rules['captions']['font']), size)
                word_width = draw.textlength(run['text'], font=font)
                space = draw.textlength(' ', font=font)
                if line and current + space + word_width > max_width:
                    lines.append(line); line, current = [], 0
                line.append((run, font, word_width, space)); current += word_width + space
            if line:
                lines.append(line)
            if len(lines) <= 2 and all(sum(r[2]+r[3] for r in ln)-ln[-1][3] <= max_width for ln in lines):
                break
            factor *= .86
        if len(lines) > 2:
            raise ValueError(f"Caption too long for two lines: {caption['id']}. Split or shorten its grouping.")
        heights = [max(font.size for _,font,_,_ in line) * 1.25 for line in lines]
        y = caption['y'] - sum(heights)/2
        outline = max(1, round(rules['captions']['outlineWidth'] * width / 1080 * factor))
        for line, line_height in zip(lines, heights):
            x = caption['x'] - (sum(r[2]+r[3] for r in line)-line[-1][3])/2
            for run,font,word_width,space in line:
                color = rules['emphasis']['color'] if run['emphasis'] else rules['captions']['color']
                draw.text((x, y+line_height/2), run['text'], font=font, fill=color, stroke_width=outline,
                          stroke_fill=rules['captions']['outline'], anchor='lm')
                x += word_width+space
            y += line_height
        file_path = output / (re.sub(r'[^A-Za-z0-9_-]', '_', caption['id'])+'.png')
        canvas.save(file_path)
        result.append({**caption, 'path': str(file_path.resolve())})
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding='utf-8'))
    rendered = render(data['plan'], data['rules'], args.output)
    (args.output / 'graphics.json').write_text(json.dumps(rendered, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'graphics': len(rendered), 'manifest': str((args.output/'graphics.json').resolve())}))


if __name__ == '__main__':
    main()
