#!/bin/sh
# Starts the Jarvis PC companion, which lets Jarvis open your apps and control media on this computer.
# It listens on 127.0.0.1 only. See docs/COMPANION.md.
cd "$(dirname "$0")"
exec python3 companion/jarvis_companion.py "$@"
