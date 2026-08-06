@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -m repo_save_editor
) else (
    set "PYTHONPATH=%CD%\src"
    py -m repo_save_editor
)
endlocal
