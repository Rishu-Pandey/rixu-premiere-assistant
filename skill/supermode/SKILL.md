---
name: supermode
description: "Run the user's Premiere SRT workflow with layout-aware native text, context-specific emphasis and recorded SFX that build purposeful highs with quiet contrast."
---

# SUPERMODE

Read [profile.json](profile.json). It contains the measured reference defaults;
[reference-style-summary.json](reference-style-summary.json) records their source.
[cadence-reference-summary.json](cadence-reference-summary.json) records the expanded sound study.
The panel is one workflow: choose SRT, then Analyse & apply. Keep only CLI
connection settings in the panel. The user does not want styling, animation,
layout, track, language or density controls.

## Captions

Use the supplied SRT for English or Hinglish, preserving its wording and timing.
English SRT can be exported from Premiere's native transcription. Do not replace
it with another ASR, request Adobe sign-in changes, or ask for a language choice.

Export the open sequence XML and a low-quality preview. The selected Codex or
Claude CLI analyses sampled frames; cuts and closer refinement locate full/split
changes. Do not substitute manual analysis through chat or Computer Use.
Unresolved layout intervals stop placement rather than receiving a guessed layout.

Split each crossing cue at the exact layout boundary, in either direction.
Full-screen captions sit in the lower third at the learned position; split-screen
captions are centred directly on the actual horizontal divider. Cue-only SRT has
no word timing: repeat its text across split pieces and record that limitation.

Deliver native editable Premiere text on two newly appended topmost video tracks:
normal words below, highlighted words above. PNGs are panel previews only.
Captions appear at full opacity immediately: no fade, pop or entrance animation.
Use Europa Grotesk Medium for regular words and larger white Times New Roman Bold
Italic for emphasis. Read continuous sentences before deciding. Select specific
occurrences of meaningful claims, names, contrasts, negations and figures using
caption IDs and word indices, with a reason. No percentage quota, global keyword
list, historical vocabulary, capitalization or word-length fallback. Keep the
smallest meaningful phrase; the same word can deserve emphasis in one occurrence
and remain normal elsewhere. Preserve the decision across a layout split.

## SFX

Use only D:\Asset\SFX and its subfolders. The learned palette contains measured
trims of recordings actually used in the reference edits, with their original
clip gains. Reusing those exact reference sources is direct user-style evidence;
a weak generic CLAP family query must not be presented as a strong semantic match.
Use local Real SFX/Earshot evidence for new candidates, measured onset/peak timing,
non-silent assets and preserved tails. Never synthesize or fetch external effects.

Use the full transcript and analysed visual events to plan a hook, justified
builds and payoffs, and quieter support/explanation. Name the purpose of every
cue. Let a charging/rising recording build to a reveal and a short accent resolve
it when justified. Align measured peaks/onsets to supplied event times. Reserve
stronger moments for important claims and surprises; low support and deliberate
gaps create contrast. The latest user instruction is a denser pass with an
intentional audible high near every three-second target throughout the video.
Choose meaningful supplied event times near those targets; vary reveals, charging
builds, short accents and changes of texture. Add purposeful support between highs.
Use the cadence policy in profile.json: roughly 55 clips/minute, a 45/minute
minimum and 70/minute safety ceiling, with no high gap exceeding 3.6 seconds.
These are user pacing requirements, not claims of what all references already do.
The expanded audit covers 21 finished render/project pairs: median 26.82 SFX/min,
with the densest at 56.84/min. Do not keep the old 29/min ceiling or treat three
seconds as a minimum spacing that permits long empty gaps. No repeating family
cycle or blanket loudness. Keep dialogue intelligible and vary fitting sources.
Avoid duplicating existing effects or counting voice/music attacks as SFX.
Retention is an editing aim; do not promise a metric without viewer analytics.

Allocate separate SFX lanes automatically so overlapping decays do not cause most
cues to be discarded. Keep dialogue, music and existing clip timing intact. Report
unmatched cues and material shortfalls in density instead of claiming a full mix.
Model tags and scores do not establish taste or human listening approval.
Validate cadence after resolving actual recorded assets and gain/headroom checks.
Missing high windows stop application; report them instead of claiming compliance.
Sound-only revisions preserve the approved caption layers, clone the completed
sequence and replace only RIXU-generated audio on its existing sound lanes.

## Application and updates

Apply to a sequence copy. Replace only previous RIXU-generated captions/SFX on
that copy. Reject changed sequence/picture/rules, duplicate runs and unsupported
operations. Keep the original project and reference files unchanged.

The live skill and profile remain editable as files, or can be revised on request.
To relearn from more references, use the workspace's read-only style analysis
scripts and validate the resulting measurements before changing defaults.
