$ErrorActionPreference = 'Stop'
$rixuRoot = (Split-Path -Parent $PSScriptRoot)
$rixuIsTransfer = Test-Path -LiteralPath (Join-Path $rixuRoot 'transfer-manifest.json')
if ($rixuIsTransfer) { & (Join-Path $PSScriptRoot 'setup-transfer.ps1') }
$rixuSkill = Join-Path $env:USERPROFILE '.codex\skills\supermode'
if (-not $rixuIsTransfer -and -not (Test-Path -LiteralPath $rixuSkill)) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $rixuSkill) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $rixuRoot 'skill\supermode') -Destination $rixuSkill -Recurse
}
& (Join-Path $PSScriptRoot 'start.ps1')
# Migrate the old login launcher to Premiere's own startup extension.
$rixuStartupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'RIXU Assistant.lnk'
if (Test-Path -LiteralPath $rixuStartupLink) {
  $rixuShell = New-Object -ComObject WScript.Shell
  $rixuOldShortcut = $rixuShell.CreateShortcut($rixuStartupLink)
  if ($rixuOldShortcut.Arguments.Contains((Join-Path $PSScriptRoot 'start.ps1'))) {
    Remove-Item -LiteralPath $rixuStartupLink
    Write-Output 'Removed the previous RIXU Windows sign-in shortcut.'
  }
}
$rixuConnection = Get-Content -LiteralPath (Join-Path $rixuRoot 'runtime\connection.json') -Raw | ConvertFrom-Json
$rixuExtension = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.rixu.premiere.panel'
if (Test-Path -LiteralPath $rixuExtension) {
  $rixuManifestPath = Join-Path $rixuExtension 'CSXS\manifest.xml'
  if (-not (Test-Path -LiteralPath $rixuManifestPath) -or -not ((Get-Content -LiteralPath $rixuManifestPath -Raw).Contains('com.rixu.premiere.panel'))) { throw 'Existing destination is not the RIXU panel. Nothing was overwritten.' }
}
New-Item -ItemType Directory -Path $rixuExtension -Force | Out-Null
Copy-Item -Path (Join-Path $rixuRoot 'panel\*') -Destination $rixuExtension -Recurse -Force
$rixuBridge = @{url=$rixuConnection.url; token=$rixuConnection.token; extension=$rixuExtension; launcher=(Join-Path $PSScriptRoot 'start.ps1'); powershell=(Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')}
$rixuBridgeJs = 'window.RIXU_CONNECTION = ' + ($rixuBridge | ConvertTo-Json -Compress) + ';'
[IO.File]::WriteAllText((Join-Path $rixuExtension 'bridge-config.js'),$rixuBridgeJs,[Text.UTF8Encoding]::new($false))
$rixuUxpJs = 'window.RIXU_CONNECTION = ' + (@{url=$rixuConnection.url;token=$rixuConnection.token} | ConvertTo-Json -Compress) + ';'
[IO.File]::WriteAllText((Join-Path $rixuRoot 'uxp-native\connection.js'),$rixuUxpJs,[Text.UTF8Encoding]::new($false))
Write-Output ('Installed CEP panel: ' + $rixuExtension)
if ($rixuIsTransfer) {
  Write-Output 'Restart Premiere, open RIXU Assistant, and choose your own Codex or Claude CLI under Planner connection.'
  Write-Output 'Use an SRT for captions; the optional native transcription helper is not required.'
} else {
  Write-Output ('Native transcription helper: ' + (Join-Path $rixuRoot 'uxp-native\manifest.json'))
  Write-Output 'Load the native helper through Adobe UXP Developer Tools. Existing CEP developer settings were not changed.'
}
