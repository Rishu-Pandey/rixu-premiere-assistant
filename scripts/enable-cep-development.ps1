$ErrorActionPreference = 'Stop'
# Optional, explicit setup for this unsigned CEP 12 development extension.
# This is not run by Install RIXU.cmd and does not change Adobe sign-in.
$rixuCepKey = 'HKCU:\Software\Adobe\CSXS.12'
New-Item -Path $rixuCepKey -Force | Out-Null
New-ItemProperty -LiteralPath $rixuCepKey -Name 'PlayerDebugMode' -Value '1' -PropertyType String -Force | Out-Null
Write-Output 'Enabled unsigned CEP 12 extensions for the current Windows user. Restart Premiere.'
