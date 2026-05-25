@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$desktop=[Environment]::GetFolderPath('Desktop'); $target=(Resolve-Path '后台启动智云AI助手.vbs').Path; $shortcut=Join-Path $desktop '智云AI助手.lnk'; $ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut($shortcut); $s.TargetPath=$target; $s.WorkingDirectory=(Get-Location).Path; $s.Description='启动智云 AI 学习助手'; $s.Save(); Write-Host ('Created: ' + $shortcut)"
pause
