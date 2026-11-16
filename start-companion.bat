@echo off
rem Starts the Jarvis PC companion, which lets Jarvis open your apps and control media on this computer.
rem It listens on 127.0.0.1 only. See docs\COMPANION.md.
cd /d "%~dp0"
python companion\jarvis_companion.py %*
pause
