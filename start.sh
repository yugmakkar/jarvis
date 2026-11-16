#!/bin/sh
# Starts Jarvis on http://localhost:5173/app/ (macOS / Linux).
cd "$(dirname "$0")" || exit 1
(sleep 1; (open http://localhost:5173/app/ || xdg-open http://localhost:5173/app/) >/dev/null 2>&1) &
python3 -m http.server 5173 --bind 127.0.0.1
