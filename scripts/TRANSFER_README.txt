RIXU 0.4.3 - Windows friend transfer (Premiere 26.2)

This package includes the SFX library and all its media subfolders, the 16
measured reference trims, saved library measurements and the SUPERMODE rules.
It does not contain the sender's projects, videos, account sessions or tokens.
It is a development build with a setup script, not a self-contained executable.

1. Extract the WHOLE ZIP to a permanent writable folder, for example
   C:\RIXU. Do not run it inside the ZIP. Keep its assets and output folders.
2. Install Node.js 20+, 64-bit Python 3.11, and FFmpeg/FFprobe on PATH.
   Install Europa Grotesk SH Medium using your own font installation.
   Times New Roman Bold Italic and Premiere's Basic Title.mogrt are required.
   Adobe templates and font files are not included.
3. Install and sign in to your own Codex or Claude CLI. The sender's login
   is not transferred. Planner account usage is charged to your own account.
4. Close Premiere and run Install RIXU.cmd. The script checks prerequisites,
   verifies the included media, updates library paths for your extraction
   folder and creates a fresh local Python environment. It downloads Python
   packages and a roughly 780 MB sound-matching model. Internet and several
   GB of additional free disk space are needed. Setup can be rerun on failure.
5. For this unsigned development build, run Enable RIXU Development.cmd once.
   It sets Adobe CEP 12 PlayerDebugMode to 1 for your current Windows user;
   that permits unsigned CEP 12 extensions, including this panel. This is a
   separate explicit step, not performed by the installer. It does not change
   Creative Cloud sign-in. No Adobe subscription or login is provided.
6. Start Premiere; open Window > Extensions > RIXU Assistant. In Planner
   connection, select your installed CLI and test its connection.
7. Open your sequence, choose an SRT and press Analyse & apply. English SRT
   can be exported using Premiere transcription. Hinglish uses supplied SRT.
   First custom sound matching can take longer while local embeddings rebuild.
8. Inspect the sequence copy and save the project. Keep RIXU's generated
   output files: Premiere links to its generated graphics and audio media.

RIXU starts with Premiere, not Windows sign-in. Start RIXU.cmd is a recovery
option. SUPERMODE edits for this transfer live in skill\supermode; this copy
does not replace another profile in your .codex folder. If you move the whole
RIXU folder, rerun Install RIXU.cmd before using it. Existing Premiere projects
may also need their generated media relinked after a move.

Verified on the sender's Windows/Premiere 26.2 setup. This transfer's dependency
installation and live Premiere use still need a first-run check on your laptop.

If Windows blocks the downloaded scripts, use the ZIP's Properties > Unblock
before extracting it. If a managed PowerShell policy still blocks setup, use
your administrator's approved installation process; the installer does not
bypass execution policy.
