"""Summarise measured library evidence without inventing listening judgments."""
from collections import Counter
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'library-audit'


def read(name):
    return json.loads((OUT / name).read_text(encoding='utf-8'))


def main():
    catalog, measured = read('sfx-library-catalog.json'), read('real-sfx-index.json')
    sounds = measured['sounds']
    extras = read('real-sfx-extra-measurements.json') if (OUT / 'real-sfx-extra-measurements.json').exists() else {}
    all_measured = sounds + [{'path': p, **v} for p,v in extras.items() if 'error' not in v]
    risks = [r for r in all_measured if r.get('lr_corr', 1) < -0.75]
    padded = [r for r in all_measured if r.get('duration', 0)-r.get('active_dur', r.get('duration', 0)) > 1]
    measured_paths = {r['path'].lower() for r in sounds}
    omitted = [r['relative_path'] for r in catalog['assets'] if r['container_kind'] == 'audio' and r['path'].lower() not in measured_paths]
    semantic = read('earshot-library-analysis.json') if (OUT / 'earshot-library-analysis.json').exists() else None
    descriptions = read('earshot-descriptions.json') if (OUT / 'earshot-descriptions.json').exists() else {}
    mono_checks = read('earshot-mono-check.json') if (OUT / 'earshot-mono-check.json').exists() else []
    duration_by_path = {r['path'].lower(): r.get('duration') for r in all_measured}
    duration_differences = [
        {'path': r['path'], 'container_reported_seconds': r['duration_seconds'],
         'decoded_seconds': duration_by_path[r['path'].lower()]}
        for r in catalog['assets'] if r.get('has_audio') and r.get('duration_seconds') is not None
        and duration_by_path.get(r['path'].lower()) is not None
        and abs(r['duration_seconds']-duration_by_path[r['path'].lower()]) > 0.25
    ]
    summary = {
        'recursive_inventory': catalog['summary'],
        'real_sfx': {'input_audio_files': catalog['summary']['audio_container_files'],
            'index_records': len(sounds), 'records_with_measurements': sum('peak_db' in r for r in sounds),
            'extra_measurement_records': len(extras), 'total_measured_audio_bearing_files': len(all_measured),
            'omitted_by_index_deduplication': omitted,
            'roles_are_name_catalog_derived': True,
            'primary_roles': dict(Counter(r['role'] for r in sounds)),
            'trailing_padding_over_one_second_count': len(padded),
            'strong_negative_stereo_correlation_count': len(risks),
            'mono_risks': [{'path': r['path'], 'lr_correlation': r['lr_corr'], 'measurement_reference_channel': r.get('mono_ref')} for r in risks]},
        'earshot': {'coverage': semantic['coverage'] if semantic else 'not yet complete',
            'representative_descriptions': len(descriptions),
            'description_errors': [p for p,r in descriptions.items() if 'error' in r],
            'shortlists': semantic['shortlists'] if semantic else {}},
        'project_sound_design_review': 'Not performed: no specific edit/video/mix has been supplied.',
        'earshot_mono_checks': mono_checks,
        'container_vs_decoded_duration_differences_over_250ms': duration_differences,
    }
    (OUT / 'sound-design-summary.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding='utf-8')
    lines = [
        'SOUND-DESIGN LIBRARY ANALYSIS - REAL SFX + EARSHOT',
        'Prepared for the captions/SFX Premiere assistant, 28 October 2026.',
        'Source library: D:\\Asset\\SFX (recursive, original files preserved)', '',
        'COVERAGE',
        f"All {catalog['summary']['nested_folder_count']} nested folders inventoried; {catalog['summary']['media_files']} media files.",
        f"{catalog['summary']['audio_container_files']} audio-container files and {catalog['summary']['video_container_files']} video-container files; {catalog['summary']['files_with_audio']} contain audio.",
        f"Real SFX scanned {catalog['summary']['audio_container_files']} audio files and produced {len(sounds)} measurement records,",
        f'dropping {len(omitted)} entries through its name/duration/level re-export heuristic.',
        'That heuristic is separate from the audit\'s SHA-256 exact-duplicate check.',
        f'Supplementary Real SFX measurements cover {len(extras)} extra files (audio in video and the omitted entry).',
        f'Total files with retained waveform measurements: {len(all_measured)}.',
    ]
    if semantic:
        c = semantic['coverage']
        lines += [f"Earshot: {c['files_with_evidence']}/{c['audio_bearing_files']} audio-bearing files processed;",
                  f"{c['analysed_unique_contents']}/{c['unique_contents']} unique contents analysed; exact duplicates reuse evidence.",
                  f"{c['files_with_semantic_descriptions']} files have sound descriptions; {len(c['near_silent_excluded_files'])} effectively silent files are flagged and excluded from sound matching.",
                  f'{len(descriptions)} representative files have describe/AST/measurement reports.']
    else:
        lines += ['Earshot semantic analysis has not completed. No semantic matching result is claimed yet.']
    lines += ['', 'FOLDER COVERAGE (direct media / media including descendants)']
    lines.extend(f"{r['folder']}: {r['direct_media_files']} / {r['subtree_media_files']}" for r in catalog['folders'])
    lines += ['', 'MEASURED FINDINGS',
        f'{len(padded)} indexed sounds have over 1 second between file duration and measured active end.',
        'Use audible duration and preserve the decay when preparing an insertion; file length alone is insufficient.',
        f'{len(risks)} indexed sounds have stereo correlation below -0.75.',
        'These may lose level in mono; keep an explicit mono-safe handling option and validate the result.']
    lines.extend(f"  {Path(r['path']).relative_to(Path('D:/Asset/SFX'))}: correlation {r['lr_corr']:+.2f}" for r in risks)
    if mono_checks:
        lines += ['Earshot cross-check: the flagged files lose the following RMS level when L/R are averaged to mono',
                  '(relative to their stereo-channel RMS; this is a signal measurement, not a taste judgment):']
        lines.extend(f"  {Path(r['path']).name}: {r['mono_sum_rms_change_db']:+.2f} dB" for r in mono_checks)
    lines += [f"{catalog['summary']['exact_duplicate_groups']} exact duplicate groups were found; originals were not deleted.",
              'Files without audio streams, excluded from matching: '+', '.join(catalog['summary']['video_files_without_audio']),
              'Some files are bundled collections; candidate segments need their own attack/tail checks.',
              'Real SFX role counts below use name/catalog rules, not semantic validation:',
              ', '.join(f'{k}={v}' for k,v in Counter(r['role'] for r in sounds).most_common())]
    lines += [f'{len(duration_differences)} files have container-reported duration differing from decoded duration by over 250 ms.',
              'Shortlist duration limits use decoded waveform duration, not estimated container metadata.']
    if omitted:
        lines += ['Entry omitted by Real SFX re-export heuristic: '+', '.join(omitted)]
    if semantic:
        lines += ['', 'EARSHOT SOUND MATCHES - SHORTLISTS, NOT A HUMAN TASTE VERDICT',
            'Queries describe the sound itself. These are description-match z statistics, not probabilities.',
            'Strong >=3; plausible 2.5 to <3; weak 2 to <2.5; below 2 is not a match.',
            'Caption and transition lists apply stated file-duration limits; long-pack trims are separate.']
        for key, rows in semantic['shortlists'].items():
            limit = semantic.get('shortlist_duration_limits_seconds', {}).get(key)
            lines += ['', key + (f' (whole-file duration <= {limit:g}s)' if limit else '')]
            for r in rows[:3]:
                lines.append(f"  z {r['z']:+.3f} [{r['verdict']}] {r['relative_path']}")
        lines += ['', 'REPRESENTATIVE CROSS-CHECKS']
        for path, result in descriptions.items():
            lines += [str(Path(path).relative_to(Path('D:/Asset/SFX'))),
                      result.get('summary', 'Analysis error: '+result.get('error', 'unknown'))]
    lines += ['', 'HOW THIS CHANGES THE TOOL DESIGN',
        '1. Keep nested paths and exact source identity in the searchable local index.',
        '2. Use names/folders for triage, then semantic description scores and measured duration/shape.',
        '3. Find a clean segment inside a long recording; keep source in/out and onset/arrival/peak anchors.',
        '4. Place sounds from this library automatically according to the instruction and density rules.',
        '5. Preserve dialogue; assess level, masking, repetition and mono playback in the actual mix.',
        '6. Store your replacements/favourites as explicit preferences, not inferred taste scores.',
        '7. Leave an unsupported or unmatched cue empty and report it. Do not invent a library file.',
        '', 'LIMITS',
        'This is a library analysis, not a critique of a particular edited film.',
        'No specific edit/video/mix has been supplied for sync-to-picture, dialogue masking or pacing assessment.',
        'Earshot does not transcribe English/Hinglish; captions need a separate transcription/alignment component.',
        'Long-file semantic evidence averages up to six 10-second windows; it does not cover every instant.',
        'Short one-shot model labels can be uncertain. Listen to candidates in context before judging taste.',
        'Audio models do not verify licensing, provenance, or that a sound is artistically suitable.',
        'No generated sounds, external UI pack, media upload, or source-library edit was used.',
        '', 'SKILLS AND EVIDENCE',
        'Real SFX: C:\\Users\\rishu\\.codex\\skills\\real-sfx\\SKILL.md',
        'Earshot: C:\\Users\\rishu\\.codex\\skills\\earshot\\SKILL.md',
        'Sources: https://github.com/Clipwing/skills and https://github.com/Leonxlnx/earshot',
        'Real SFX measurements: real-sfx-index.json',
        'Supplementary video/audio measurements: real-sfx-extra-measurements.json',
        'Earshot per-file evidence: earshot-library-analysis.json and earshot-evidence.jsonl',
        'Representative descriptions: earshot-descriptions.json',
        'Earshot stereo/mono cross-check: earshot-mono-check.json',
        'Real SFX waveform/spectrogram sheet inspected: whoosh-candidates.png',
        'Original recursive inventory and hashes: sfx-library-catalog.json',
        '', 'All report paths above are relative to this library-audit folder.',
    ]
    (OUT / 'SOUND_DESIGN_FINDINGS.txt').write_text('\n'.join(lines)+'\n', encoding='utf-8')
    print(json.dumps({'real_sfx_records':len(sounds),'semantic_coverage':summary['earshot']['coverage'],
                      'descriptions':len(descriptions),'report':str(OUT/'SOUND_DESIGN_FINDINGS.txt')},indent=2))


if __name__ == '__main__':
    main()
