@echo off
setlocal
cd /d "%~dp0"

where pyinstaller >nul 2>nul
if errorlevel 1 (
    echo pyinstaller가 설치되어 있지 않습니다.
    echo 먼저 다음 명령으로 설치하세요:
    echo   .venv\Scripts\python.exe -m pip install pyinstaller
    exit /b 1
)

del /q /f dist\MabiConfigXmlTool.exe >nul 2>nul
pyinstaller --noconfirm --clean mabiconfig_tool.spec
if errorlevel 1 exit /b 1

echo.
echo 빌드 완료: dist\MabiConfigXmlTool.exe
endlocal
