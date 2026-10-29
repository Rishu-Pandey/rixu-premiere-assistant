"""Build an allowlisted friend transfer, including recursively copied SFX media."""
import hashlib
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = Path(r'D:\Asset\SFX')
TOKEN = '@@RIXU_ROOT@@'
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
DEST = ROOT / f'dist/RIXU-{VERSION}-Windows-with-SFX.zip'
AUDITS = ['earshot-library-analysis.json', 'real-sfx-index.json', 'real-sfx-extra-measurements.json']


def template(value):
    if isinstance(value, str):
        value = value.replace('\\', '/')
        for source, target in [(LIBRARY.as_posix(), TOKEN + '/assets/SFX'), (ROOT.as_posix(), TOKEN)]:
            value = re.sub(re.escape(source), lambda _: target, value, flags=re.I)
        return value
    if isinstance(value, list):
        return [template(item) for item in value]
    if isinstance(value, dict):
        return {template(key): template(item) for key, item in value.items()}
    return value


def build():
    DEST.parent.mkdir(exist_ok=True)
    partial = DEST.with_suffix('.zip.partial')
    media = []
    with zipfile.ZipFile(partial, 'w', zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
        def add(source, destination):
            archive.write(source, destination)

        def text(destination, value):
            archive.writestr(destination, value)

        for folder in ['src', 'panel', 'web', 'tests', 'uxp-native']:
            for source in (ROOT / folder).rglob('*'):
                if source.is_file() and source.name not in {'connection.js', 'bridge-config.js', '.uxprc'} and '__pycache__' not in source.parts:
                    add(source, source.relative_to(ROOT).as_posix())
        runtime_scripts = ['build_native_captions.py', 'earshot_worker.py', 'project_analysis.py', 'render_captions.py', 'review_sound_plan.py', 'install.ps1', 'start.ps1', 'setup-transfer.ps1', 'relocate_transfer.py', 'enable-cep-development.ps1']
        for name in runtime_scripts:
            add(ROOT / 'scripts' / name, 'scripts/' + name)
        for name in ['package.json', 'Install RIXU.cmd', 'Start RIXU.cmd', 'Enable RIXU Development.cmd']:
            add(ROOT / name, name)
        earshot = ROOT / '.tools/earshot'
        for source in (earshot / 'earshot').rglob('*'):
            if source.is_file() and '__pycache__' not in source.parts:
                add(source, '.tools/earshot/' + source.relative_to(earshot).as_posix())
        for name in ['LICENSE', 'README.md', 'pyproject.toml']:
            add(earshot / name, '.tools/earshot/' + name)
        for source, base, prefix in [(p, LIBRARY, 'assets/SFX') for p in LIBRARY.rglob('*') if p.is_file() and p.name.lower() not in {'desktop.ini', '.ds_store'} and p.suffix.lower() != '.lnk'] + [(p, ROOT, '') for p in (ROOT / 'output/style-learning/palette').glob('*.wav')]:
            destination = '/'.join(part for part in [prefix, source.relative_to(base).as_posix()] if part)
            with source.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            media.append({'path': destination, 'bytes': source.stat().st_size, 'sha256': digest})
            add(source, destination)
        for name in AUDITS:
            value = template(json.loads((ROOT / 'library-audit' / name).read_text(encoding='utf-8')))
            text('transfer/templates/library-audit/' + name, json.dumps(value, ensure_ascii=False, indent=2))
        profile = template(json.loads((ROOT / 'skill/supermode/profile.json').read_text(encoding='utf-8')))
        text('transfer/templates/skill/supermode/profile.json', json.dumps(profile, ensure_ascii=False, indent=2))
        instructions = (ROOT / 'skill/supermode/SKILL.md').read_text(encoding='utf-8').replace(str(LIBRARY), TOKEN + '/assets/SFX')
        instructions = instructions.replace('[reference-style-summary.json](reference-style-summary.json) records their source.', 'the original reference study supplied those defaults.')
        text('transfer/templates/skill/supermode/SKILL.md', instructions)
        # Aggregate cadence statistics contain no reference project paths or media.
        add(ROOT / 'skill/supermode/cadence-reference-summary.json', 'skill/supermode/cadence-reference-summary.json')
        from importlib.metadata import version
        requirements = [f'{name}=={version(name)}' for name in ['numpy', 'scipy', 'soundfile', 'soxr', 'librosa', 'pyloudnorm', 'scikit-learn', 'pillow', 'matplotlib', 'torch', 'transformers', 'huggingface-hub']]
        text('transfer/requirements.txt', '\n'.join(requirements) + '\n')
        text('transfer-manifest.json', json.dumps({'product': 'RIXU', 'version': VERSION, 'platform': 'Windows', 'testedPremiere': '26.2', 'media': media}, ensure_ascii=False, indent=2))
        add(ROOT / 'scripts/TRANSFER_README.txt', 'READ ME FIRST.txt')
    partial.replace(DEST)
    print(json.dumps({'archive': str(DEST), 'bytes': DEST.stat().st_size, 'mediaFiles': len(media), 'sourceMediaBytes': sum(item['bytes'] for item in media)}))


if __name__ == '__main__':
    build()
