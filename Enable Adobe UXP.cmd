@echo off
setlocal
cd /d "%~dp0"
echo This enables Adobe UXP developer mode for the native transcription helper.
echo Windows may ask you for administrator approval. Review that prompt yourself.
if not exist ".tools\uxp-cli\node_modules\@adobe\uxp-devtools-cli\src\uxp.js" (
  echo Adobe's local developer CLI is missing. Use Adobe UXP Developer Tools instead.
  pause
  exit /b 1
)
node ".tools\uxp-cli\node_modules\@adobe\uxp-devtools-cli\src\uxp.js" devtools enable
echo Return to the chat after this completes so the native helper can be loaded and tested.
pause
