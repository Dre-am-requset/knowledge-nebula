@echo off
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -m nebula serve --demo
) else (
  python -m nebula serve --demo
)
if errorlevel 1 pause
