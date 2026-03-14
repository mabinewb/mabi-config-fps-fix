@echo off
setlocal
cd /d "%~dp0"
py -3 mabi_fps_fix_tool.py
if errorlevel 1 python mabi_fps_fix_tool.py
endlocal