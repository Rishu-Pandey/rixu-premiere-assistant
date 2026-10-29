"""Read-only recursive media audit. Writes reports outside the source library."""

import argparse
import concurrent.futures
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess


AUDIO = {'.wav', '.aac', '.mp3', '.m4a', '.aif', '.aiff', '.flac', '.ogg'}
VIDEO = {'.mp4', '.mov', '.webm'}
RULES = {
    'whoosh': r'whoosh|swoosh|swish|sweep',
    'impact': r'\bhits?\b|impact|explosion|blast|braam|thud|punch',
    'click': r'click|shutter|\btick\b',
    'pop': r'\bpop\b|bubble',
    'beep': r'beep|bleep|\bding\b|\bbell\b',
    'ui': r'user.interface|notification|interface|\bui\b',
    'glitch': r'glitch|distort|analog',
    'electrical': r'electric|neon|buzz|transmission|signal|pulse',
    'noise': r'noise|static|hiss',
    'ambience': r'ambien|room.tone|crowd|wind|rain|water',
    'riser': r'ris(er|ing)|swell|suckback|reverse',
    'transition': r'transition',
    'foley': r'asmr|foley|paper|pencil|writing|footstep|metal|camera',
}


def scan(root):
    files, folders, issues = [], [root], []
    queue = [root]
    while queue:
        folder = queue.pop()
        try:
            with os.scandir(folder) as entries:
                for entry in entries:
                    try:
                        info = entry.stat(follow_symlinks=False)
                        if entry.is_symlink() or getattr(info, 'st_file_attributes', 0) & 0x400:
                            issues.append({'path': entry.path, 'reason': 'reparse point skipped'})
                        elif entry.is_dir(follow_symlinks=False):
                            child = Path(entry.path)
                            folders.append(child)
                            queue.append(child)
                        elif entry.is_file(follow_symlinks=False):
                            files.append(Path(entry.path))
                    except OSError as error:
                        issues.append({'path': entry.path, 'reason': str(error)})
        except OSError as error:
            issues.append({'path': str(folder), 'reason': str(error)})
    return sorted(files), sorted(folders), issues


def seconds(value):
    try:
        number = float(value)
        return number if math.isfinite(number) and number >= 0 else None
    except (ValueError, TypeError):
        return None


def inspect(path, root, ffprobe):
    relative = path.relative_to(root)
    search = re.sub(r'[_\-]+', ' ', str(relative).lower())
    record = {
        'path': str(path), 'relative_path': str(relative),
        'folder': str(relative.parent), 'extension': path.suffix.lower(),
        'container_kind': 'audio' if path.suffix.lower() in AUDIO else 'video',
        'name_folder_tags': [tag for tag, pattern in RULES.items() if re.search(pattern, search)],
        'tags_basis': 'filename and folder rules; not verified by listening',
        'possible_multi_sound_pack': bool(re.search(r'\b\d+\b.*(?:sfx|sound|effect)', path.stem, re.I)),
    }
    try:
        record['bytes'] = path.stat().st_size
        digest = hashlib.sha256()
        with path.open('rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(block)
        record['sha256'] = digest.hexdigest()
        result = subprocess.run(
            [ffprobe, '-v', 'error', '-show_entries',
             'format=duration:stream=index,codec_type,codec_name,sample_rate,channels,duration',
             '-of', 'json', str(path)],
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        if result.returncode:
            record['probe_error'] = result.stderr.strip()[:400]
            return record
        metadata = json.loads(result.stdout)
        streams = metadata.get('streams', [])
        audio = [s for s in streams if s.get('codec_type') == 'audio']
        record['has_audio'] = bool(audio)
        record['audio_streams'] = audio
        record['duration_seconds'] = seconds(metadata.get('format', {}).get('duration'))
        if record['duration_seconds'] is None:
            durations = [seconds(s.get('duration')) for s in streams]
            record['duration_seconds'] = max((d for d in durations if d is not None), default=None)
        record['sfx_candidate'] = bool(audio)
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        record['probe_error'] = str(error)
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    root, output = args.root.resolve(strict=True), args.output.resolve()
    if output == root or root in output.parents:
        raise SystemExit('Output must be outside the source library.')
    ffprobe = shutil.which('ffprobe')
    if not ffprobe:
        raise SystemExit('ffprobe is required for the metadata audit.')
    output.mkdir(parents=True, exist_ok=True)
    files, folders, issues = scan(root)
    media = [p for p in files if p.suffix.lower() in AUDIO | VIDEO]
    ignored = [str(p.relative_to(root)) for p in files if p.suffix.lower() not in AUDIO | VIDEO]
    print(f'Found {len(media)} media files across {len(folders)-1} nested folders.', flush=True)
    records = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        jobs = [pool.submit(inspect, path, root, ffprobe) for path in media]
        for job in concurrent.futures.as_completed(jobs):
            records.append(job.result())
            if len(records) % 100 == 0:
                print(f'Inspected {len(records)}/{len(media)} media files.', flush=True)
    records.sort(key=lambda row: row['relative_path'].lower())
    grouped = defaultdict(list)
    for record in records:
        if record.get('sha256'):
            grouped[record['sha256']].append(record['relative_path'])
    duplicates = [paths for paths in grouped.values() if len(paths) > 1]
    folder_rows = []
    for folder in folders:
        relative = str(folder.relative_to(root))
        children = [r for r in records if folder == Path(r['path']).parent or folder in Path(r['path']).parents]
        direct = [r for r in records if r['folder'] == relative]
        folder_rows.append({
            'folder': relative, 'direct_media_files': len(direct),
            'subtree_media_files': len(children),
            'audio_candidates_in_subtree': sum(bool(r.get('sfx_candidate')) for r in children),
            'name_folder_tags': dict(Counter(t for r in children for t in r['name_folder_tags'])),
        })
    errors = [r for r in records if r.get('probe_error')]
    summary = {
        'root': str(root), 'scan_time_utc': datetime.now(timezone.utc).isoformat(),
        'nested_folder_count': len(folders)-1, 'total_files': len(files),
        'media_files': len(records), 'audio_container_files': sum(r['container_kind'] == 'audio' for r in records),
        'video_container_files': sum(r['container_kind'] == 'video' for r in records),
        'files_with_audio': sum(bool(r.get('has_audio')) for r in records),
        'video_files_without_audio': [r['relative_path'] for r in records if r['container_kind'] == 'video' and r.get('has_audio') is False],
        'extensions': dict(Counter(p.suffix.lower() for p in files)),
        'exact_duplicate_groups': len(duplicates),
        'redundant_exact_duplicate_files': sum(len(g)-1 for g in duplicates),
        'probe_error_count': len(errors), 'scan_issues': issues, 'ignored_files': ignored,
        'analysis_scope': 'Recursive paths, metadata, SHA-256 duplicates and provisional filename/folder tags. No listening, speech transcription, onset detection or perceptual audio classification.',
    }
    catalog = {'summary': summary, 'folders': folder_rows, 'duplicate_groups': duplicates, 'assets': records}
    catalog_path = output / 'sfx-library-catalog.json'
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
    lines = [
        'SFX LIBRARY RECURSIVE AUDIT', str(root), '',
        f'{len(folders)-1} nested folders; {len(files)} total files; {len(records)} media files.',
        f"{summary['audio_container_files']} audio files; {summary['video_container_files']} video files.",
        f"{summary['files_with_audio']} files contain an audio stream; {len(errors)} probe errors.",
        f"{len(duplicates)} exact duplicate groups; {summary['redundant_exact_duplicate_files']} redundant copies.",
        '', 'FOLDER COVERAGE (direct files / files including descendants)',
    ]
    lines.extend(f"{r['folder']}: {r['direct_media_files']} / {r['subtree_media_files']}" for r in folder_rows)
    lines += ['', 'VIDEO FILES WITHOUT AN AUDIO STREAM']
    lines.extend(summary['video_files_without_audio'] or ['None'])
    lines += ['', 'EXACT DUPLICATES (same SHA-256; originals left unchanged)']
    lines.extend(' = '.join(g) for g in duplicates)
    lines += ['', 'METADATA ERRORS']
    lines.extend(f"{r['relative_path']}: {r['probe_error']}" for r in errors)
    if not errors:
        lines.append('None')
    lines += ['', 'LIMITS', summary['analysis_scope'], '',
              'Tags are search suggestions, not verified descriptions of the sound.',
              'Video containers with audio can be audio-only placement candidates after import validation.',
              'Possible multi-sound packs need segment boundaries and audition before automatic use.',
              'Metadata success does not certify decoding, audio quality or Premiere compatibility.',
              'No original files were changed and no media was uploaded.',
              '', 'CATALOG', str(catalog_path)]
    (output / 'SFX_LIBRARY_AUDIT.txt').write_text('\n'.join(lines)+'\n', encoding='utf-8')
    assert len(records) + len(ignored) == len(files)
    assert folder_rows[0]['subtree_media_files'] == len(records)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
