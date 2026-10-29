"""Install a transfer's path templates without editing the sender's working files."""
import argparse
import hashlib
import json
from pathlib import Path

TOKEN = '@@RIXU_ROOT@@'


def relocate(value, root):
    if isinstance(value, str):
        return value.replace(TOKEN, root.as_posix())
    if isinstance(value, list):
        return [relocate(item, root) for item in value]
    if isinstance(value, dict):
        return {relocate(key, root): relocate(item, root) for key, item in value.items()}
    return value


def install(root):
    root = root.resolve()
    manifest = json.loads((root / 'transfer-manifest.json').read_text(encoding='utf-8'))
    for item in manifest['media']:
        source = (root / item['path']).resolve()
        if not source.is_relative_to(root) or not source.is_file():
            raise ValueError('Missing transfer file: ' + item['path'])
        with source.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if source.stat().st_size != item['bytes'] or digest != item['sha256']:
            raise ValueError('Damaged transfer file: ' + item['path'])
    templates = root / 'transfer/templates'
    for source in templates.rglob('*'):
        if not source.is_file():
            continue
        destination = root / source.relative_to(templates)
        destination.parent.mkdir(parents=True, exist_ok=True)
        text = source.read_text(encoding='utf-8')
        if source.suffix == '.json':
            text = json.dumps(relocate(json.loads(text), root), ensure_ascii=False, indent=2)
        else:
            text = text.replace(TOKEN, root.as_posix())
        # Both the rules and instructions are editable; preserve repeat-setup edits.
        if destination in [root / 'skill/supermode/profile.json', root / 'skill/supermode/SKILL.md'] and destination.exists():
            current = destination.read_text(encoding='utf-8')
            previous = root / 'transfer/installed-root.txt'
            old_root = previous.read_text(encoding='utf-8') if previous.exists() else root.as_posix()
            text = current.replace(old_root, root.as_posix())
            if source.suffix == '.json':
                text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
        destination.write_text(text, encoding='utf-8')
    profile = json.loads((root / 'skill/supermode/profile.json').read_text(encoding='utf-8'))
    paths = [item['path'] for item in profile['referenceStyle']['palette']]
    assets = json.loads((root / 'library-audit/earshot-library-analysis.json').read_text(encoding='utf-8'))['assets']
    paths.extend(item['path'] for item in assets)
    missing = [p for p in paths if not Path(p).is_file()]
    if missing:
        raise ValueError('Relocated library has missing files: ' + str(missing[:3]))
    (root / 'transfer/installed-root.txt').write_text(root.as_posix(), encoding='utf-8')
    print(f"Verified {len(manifest['media'])} recordings/trims; relocated {len(assets)} analysed assets.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    install(parser.parse_args().root)
