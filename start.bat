@echo off
rem Starts Jarvis on http://localhost:5173 and opens it in your default browser.
rem (The microphone only works on http://localhost, not when opening index.html directly.)
cd /d "%~dp0"
start "" http://localhost:5173/app/
python -m http.server 5173 --bind 127.0.0.1
