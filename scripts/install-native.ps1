$ErrorActionPreference='Stop'
$rixuRoot=Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'start.ps1')
& python (Join-Path $PSScriptRoot 'package_native.py')
if($LASTEXITCODE -ne 0){throw 'Could not prepare the local native helper package.'}
$rixuUpia='C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe'
if(-not(Test-Path -LiteralPath $rixuUpia)){throw 'Adobe Unified Plugin Installer Agent is missing. Install or repair Adobe Creative Cloud desktop.'}
$rixuMessages=& $rixuUpia /install (Join-Path $rixuRoot 'runtime\rixu-native-local.ccx') 2>&1
$rixuCode=$LASTEXITCODE
$rixuText=$rixuMessages -join [Environment]::NewLine
Write-Output $rixuText
# Adobe UPIA sometimes exits 0 even when it prints an installation failure.
if($rixuText -match 'status\s*=\s*-631'){throw 'Adobe requires Creative Cloud desktop sign-in. Sign in yourself and run Install Native Helper.cmd again.'}
if($rixuCode -ne 0 -or $rixuText -match '(?i)Failed to install|status\s*=\s*-\d+') {throw ('Adobe did not install the helper. Installer process code: '+$rixuCode)}
Write-Output 'Open Premiere > Window > UXP Plugins > RIXU Native Transcription. Keep that panel loaded while running English SUPERMODE.'
