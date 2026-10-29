$ErrorActionPreference = 'Stop'
$rixuTransferRoot = Split-Path -Parent $PSScriptRoot
Write-Output 'Preparing RIXU and the included SFX library for this laptop.'
foreach ($rixuCommand in @('node', 'ffmpeg', 'ffprobe')) {
  if (-not (Get-Command $rixuCommand -ErrorAction SilentlyContinue)) {
    throw "Install $rixuCommand and make it available on PATH, then reopen this installer. See READ ME FIRST.txt."
  }
}
$rixuNodeVersion = & node -p 'Number(process.versions.node.split(".")[0])'
if ($LASTEXITCODE -ne 0 -or [int]$rixuNodeVersion -lt 20) { throw 'Node.js 20 or newer is required.' }
$rixuPython = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
  $rixuPython = & py -3.11 -c 'import sys; print(sys.executable)' 2>$null
  if ($LASTEXITCODE -ne 0) { $rixuPython = $null }
}
if (-not $rixuPython -and (Get-Command python -ErrorAction SilentlyContinue)) {
  $rixuPython = & python -c 'import sys; print(sys.executable if sys.version_info[:2] == (3,11) else "")'
  if ($LASTEXITCODE -ne 0) { $rixuPython = $null }
}
if (-not $rixuPython) { throw 'Install 64-bit Python 3.11, then reopen this installer.' }
$rixuUserFont = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts\EUROPAGROTESKSH-MED.OTF'
$rixuSystemFont = Join-Path $env:WINDIR 'Fonts\EUROPAGROTESKSH-MED.OTF'
if (-not (Test-Path -LiteralPath $rixuUserFont) -and -not (Test-Path -LiteralPath $rixuSystemFont)) {
  throw 'Install the Europa Grotesk SH Medium font before setup. Font files are not included in the transfer.'
}
$rixuTimes = Join-Path $env:WINDIR 'Fonts\timesbi.ttf'
if (-not (Test-Path -LiteralPath $rixuTimes)) { throw 'Times New Roman Bold Italic is required.' }
$rixuTitle = Get-ChildItem -Path (Join-Path $env:ProgramFiles 'Adobe\Adobe Premiere Pro *\Essential Graphics\Basic Title.mogrt') -ErrorAction SilentlyContinue
$rixuUserTitle = Join-Path $env:APPDATA 'Adobe\Common\Motion Graphics Templates\Basic Title.mogrt'
if (-not $rixuTitle -and -not (Test-Path -LiteralPath $rixuUserTitle)) { throw 'The installed Premiere Basic Title.mogrt was not found.' }
$rixuEnvPython = Join-Path $rixuTransferRoot '.tools\earshot-env\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $rixuEnvPython)) {
  & $rixuPython -m venv (Join-Path $rixuTransferRoot '.tools\earshot-env')
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the local Python environment.' }
}
$env:PYTHONUTF8 = '1'
& $rixuEnvPython (Join-Path $PSScriptRoot 'relocate_transfer.py')
if ($LASTEXITCODE -ne 0) { throw 'Transfer integrity or path setup failed.' }
$rixuReady = Join-Path $rixuTransferRoot 'transfer\dependencies-ready.txt'
if (-not (Test-Path -LiteralPath $rixuReady)) {
  Write-Output 'Installing local audio-analysis dependencies. Internet is required; this can take several minutes.'
  & $rixuEnvPython -m pip install -r (Join-Path $rixuTransferRoot 'transfer\requirements.txt') (Join-Path $rixuTransferRoot '.tools\earshot')
  if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed. Check the message above and rerun setup.' }
  $env:EARSHOT_HOME = Join-Path $rixuTransferRoot '.tools\earshot-cache'
  Write-Output 'Downloading the pinned sound-matching model (approximately 780 MB).'
  & $rixuEnvPython -c 'from earshot.models import hub; s=hub.ensure("laion/larger_clap_general"); print(s.state); assert s.local'
  if ($LASTEXITCODE -ne 0) { throw 'Sound model setup failed. Check the internet connection and rerun setup.' }
  & $rixuEnvPython -c 'import numpy, PIL, earshot, torch, transformers; print("Audio and caption dependencies ready.")'
  if ($LASTEXITCODE -ne 0) { throw 'Dependency validation failed.' }
  Set-Content -LiteralPath $rixuReady -Value 'Dependencies and sound-matching model installed.'
}
Write-Output 'Transfer setup complete. The panel will use its own local SUPERMODE profile.'
