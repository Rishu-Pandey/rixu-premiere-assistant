# RIXU Premiere Assistant — SUPERMODE 0.4.3

1. Open Premiere and **Window → Extensions → RIXU Assistant**. The companion starts automatically.
2. Open the sequence and choose its **SRT** in the panel.
3. Press **Analyse & apply**. The result opens as a sequence copy. Save the Premiere project when reviewed.

The panel has one editing workflow. Font, animation, language, layout, track and density controls have been removed. A collapsed **Planner connection** section selects the installed Codex or Claude CLI. CLI mode uses that CLI's existing sign-in; no API key is required. Codex is currently selected on this computer.

English and Hinglish both use the supplied SRT. English SRT can come from Premiere's own transcription. The separate native transcription helper is not required for this workflow, and Adobe account/developer settings are unchanged. SRT wording and timing are preserved. A cue crossing a layout change repeats its text across its split pieces because ordinary SRT does not contain individual word timestamps.

The tool exports project/sequence XML and a low-quality preview, then the selected CLI analyses sampled picture frames and refines uncertain boundaries. It detects full/split layouts and cut frames automatically. Uncertain intervals stop placement; **Resume saved analysis** can refine them without repeating completed matching sheets. Audio analysis stays local.

Reopening the panel restores the last run and reconnects to its progress. The SRT request, frame classifications, generated text and sound plan are saved locally. If Premiere crashes or its panel session restarts, pending host work is released and the run becomes resumable. **Resume saved captions & SFX** reuses the prepared plan without uploading/classifying frames again or requiring another SRT selection. Placement uses batches of four clips with a checkpoint after each batch. A lost reply can be replayed without duplicating the same clips. Recovery checks the current project against the analysed picture and dialogue; changed timelines stop placement. The sequence copy still needs to be saved in Premiere to survive an application crash; if an unsaved copy disappears, the tool reconstructs it from the saved plan and matching original sequence.

Captions are **editable native Premiere text**, with normal and highlighted words on two newly appended topmost video tracks. Captions appear immediately at full opacity: **no fade or entrance animation**. Full-screen placement uses the learned lower-third position, and split captions are centred on the actual divider. Captions split and change position at each detected layout boundary. PNGs are panel previews only.

The defaults were learned from 51 unique project files and six matched finished technology edits, selected from 214 indexed MP4s in `C:\Users\rishu\OneDrive\Documents`. Project timelines provide caption frequency, source clips and gains; 72 sampled rendered frames independently confirm typography. Local Earshot reports review all six reference soundtracks. Reference files were read only.

- Normal: white **Europa Grotesk Medium**, about 100 px at 1080-wide.
- Emphasis: larger white **Times New Roman Bold Italic**, about 1.6×. The CLI chooses specific word occurrences using the full transcript and records a reason for each. No percentage quota, global keyword list, capitalization or word-length fallback. Repeated words may receive different treatment in different claims.
- Full-screen centre: about 67.2% of frame height, matching the reference lower third. Split-screen centre follows the detected divider.
- SFX pacing: the latest user preference is a high point approximately **every three seconds**, with denser builds and support. The default targets roughly 55 SFX/minute, with a 45/minute floor and 70/minute cap. The planner chooses meaningful supplied times near each target and repairs missing windows; the resolved recordings must also pass the cadence audit, with no high gap above 3.6 seconds. These values replace the previous minimum-three-second spacing and 29/minute ceiling. They are editing requirements, not measured retention results.

The expanded local audit reads 21 duration-matched finished render/project pairs from the indexed Documents files. Median SFX density is 26.82/minute and the densest reference is 56.84/minute. Project clip starts/gains distinguish SFX from speech/music, while local Earshot measurements check the mixed renders. The requested recurring three-second highs are a new preference; the references are not assumed to be viral or to demonstrate retention without audience analytics. See `output/style-learning/cadence-audit.json`.

Sound-only revisions clone the completed owned sequence, retain its caption layers and existing track allocation, and replace only RIXU-generated SFX on the copied sound lanes. This avoids rebuilding approved text when adjusting sound design. Cadence and level-review results are saved with the plan.

Each semantic plan includes `semanticDesign` with indexed highlight decisions, cue roles/energy/groups and quiet intervals. When a cached preview is available, the tool renders a separate recorded-SFX WAV and mixed review WAV, checks their RMS levels against the existing base, reduces effect gains where necessary to avoid new clipping, and bounds tails to the video or quiet reset with a short audio tail fade. Original voice/music clips and gains are preserved. These envelope checks use the mixed base rather than an isolated speech stem. Whole-mix loudness, speech masking and taste still need review; the tool does not infer retention from audio measurements.

SFX come only from `D:\Asset\SFX` and its subfolders. Sixteen measured trims reuse recordings and clip gains found in the reference edits. Exact historical use is direct style evidence; weak generic CLAP queries for those recordings are not presented as strong semantic matches. New candidates use the indexed Earshot matching threshold. Natural overlaps use three automatically appended SFX lanes instead of dropping most overlapping cues. Existing library effects count toward pacing. Dialogue, music and unrelated graphics remain intact; previous RIXU-generated media is replaced only on the sequence copy.

The live skill remains at `%USERPROFILE%\.codex\skills\supermode`. Its `SKILL.md`, `profile.json` and reference summary can be updated as files or on request. Keep the workspace's `output/style-learning/palette` and generated run folders with the project media.

## Installation and validation

Run **Install RIXU.cmd** after updating files, then reopen the panel. Windows, Node.js 20+, Python/Pillow and Premiere are required. The installed Adobe Basic Title template and the two caption fonts must be available. CEP developer loading must already be enabled; this installer does not change security settings.

The installer registers an invisible CEP launcher for Premiere's application activation event. It starts the companion silently when Premiere launches, even with the editing panel closed. Opening the RIXU panel also starts the companion if needed. There is no Windows sign-in startup entry; installation removes the earlier RIXU shortcut. **Start RIXU.cmd** remains a manual recovery option. This uses Adobe's documented [invisible extension startup mechanism](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md#invisible-html-extensions). Restart Premiere once after installing this update to load the new launcher.

The source archive excludes runtime tokens, CLI credentials, model caches, reference footage and licensed SFX media. It is configured for this computer, not a self-contained installer. Another computer needs its own library catalogue, installed fonts and regenerated local reference palette.

`npm test` runs the software contract tests without sending footage to an external AI account. Live validation uses owned test sequences and preserves the user's open sequence. See `VALIDATION.md` and `output/style-learning/style-summary.json`. The host adapter is exercised on Premiere 26.2; other releases need their own checks. The broader action API remains available in source, while the panel exposes the requested SRT workflow only.
