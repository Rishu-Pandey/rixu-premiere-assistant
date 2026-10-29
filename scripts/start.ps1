$ErrorActionPreference = 'Stop'
$rixuStartLock = New-Object System.Threading.Mutex($false, 'Local\RIXUCompanion48163')
$rixuOwnsLock = $false
try {
try { $rixuOwnsLock = $rixuStartLock.WaitOne(45000) } catch [System.Threading.AbandonedMutexException] { $rixuOwnsLock = $true }
if (-not $rixuOwnsLock) { throw 'Another RIXU launch is still running. Retry shortly.' }
$rixuRoot = Split-Path -Parent $PSScriptRoot
if (Test-Path -LiteralPath (Join-Path $rixuRoot 'transfer-manifest.json')) {
  $rixuTransferPython = Join-Path $rixuRoot '.tools\earshot-env\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath (Join-Path $rixuRoot 'transfer\dependencies-ready.txt'))) { throw 'Run Install RIXU.cmd to finish transfer setup first.' }
  $env:RIXU_SUPERMODE_DIR = Join-Path $rixuRoot 'skill\supermode'
  $env:RIXU_PYTHON = $rixuTransferPython
  $env:RIXU_EARSHOT_PYTHON = $rixuTransferPython
}
$rixuRuntime = Join-Path $rixuRoot 'runtime'
New-Item -ItemType Directory -Path $rixuRuntime -Force | Out-Null
$rixuHealthy = $false
try { $rixuStatus = Invoke-RestMethod -Uri 'http://127.0.0.1:48163/health' -TimeoutSec 2; $rixuHealthy = $rixuStatus.service -eq 'rixu-premiere-assistant' } catch {}
if (-not $rixuHealthy) {
  $rixuNode = (Get-Command node -ErrorAction Stop).Source
  $rixuServer = Join-Path $rixuRoot 'src\server.js'
  $rixuProcess = Start-Process -FilePath $rixuNode -ArgumentList @('"' + $rixuServer + '"') -WorkingDirectory $rixuRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $rixuRuntime 'server.log') -RedirectStandardError (Join-Path $rixuRuntime 'server-error.log')
  Set-Content -LiteralPath (Join-Path $rixuRuntime 'server.pid') -Value $rixuProcess.Id
  for ($rixuAttempt=0; $rixuAttempt -lt 30; $rixuAttempt++) {
    Start-Sleep -Milliseconds 250
    try { $rixuStatus = Invoke-RestMethod -Uri 'http://127.0.0.1:48163/health' -TimeoutSec 1; if ($rixuStatus.service -eq 'rixu-premiere-assistant') { $rixuHealthy=$true; break } } catch {}
  }
}
if (-not $rixuHealthy) { throw 'Companion did not start. Read runtime/server-error.log.' }
Write-Output 'RIXU companion is running. Open Window > Extensions > RIXU Assistant in Premiere.'
} finally {
  if ($rixuOwnsLock) { $rixuStartLock.ReleaseMutex() }
  $rixuStartLock.Dispose()
}
