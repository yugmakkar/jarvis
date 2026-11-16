#!/usr/bin/env python3
"""Jarvis companion: lets the Jarvis web page do a few named things on this computer.

A web page cannot open desktop apps or press media keys; the browser forbids it. This small program,
which you run yourself, listens on 127.0.0.1 only and performs a fixed list of actions for a paired
Jarvis page:

    open_app      an app from YOUR list (apps.json in the companion folder). The page sends a name, never a path.
    open_folder   Downloads, Documents, Desktop, Pictures, Music, Videos or your home folder
    media         the play/pause, next and previous media keys
    volume        system volume up, down, or mute
    lock          lock the computer

Security model (details in docs/COMPANION.md):
    * Bound to 127.0.0.1. Requests whose Host header is not 127.0.0.1/localhost are refused (DNS rebinding).
    * Only the Jarvis origins listed below may call it. By default that is the copy on http://localhost:5173.
      The hosted copy is allowed only if you start the companion with --allow-hosted.
    * Pairing: a 6-digit code is printed in this window. It works once, and five wrong guesses replace it.
      Pairing gives the page a random token, valid only for the origin that paired. Only its hash is stored.
    * The first time a page asks for each kind of action, you approve it here, in this window.
    * No shell is ever used, no arguments are passed to apps, and nothing is sent anywhere.

Standard library only. Python 3.8 or later.
"""
import argparse
import hashlib
import hmac
import json
import os
import platform
import secrets
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = '1.0.0'
PORT = 8765
LOCAL_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']
HOSTED_ORIGIN = 'https://yugmakkar.github.io'
MAX_BODY = 4096
MAX_PAIR_TRIES = 5

ACTIONS = {   # what the approval prompt says each action type allows
    'open_app': 'open apps from your list (apps.json)',
    'open_folder': 'open your personal folders (Downloads, Documents, ...)',
    'media': 'press the play/pause, next and previous media keys',
    'volume': 'change the system volume',
    'lock': 'lock this computer',
}
FOLDERS = {'downloads': 'Downloads', 'documents': 'Documents', 'desktop': 'Desktop', 'pictures': 'Pictures',
           'photos': 'Pictures', 'music': 'Music', 'videos': 'Videos', 'home': ''}
MEDIA_KEYS = ('playpause', 'next', 'previous')
VOLUME = ('up', 'down', 'mute')

SYSTEM = platform.system()   # 'Windows', 'Darwin' or 'Linux'


def default_apps():
    """The starting apps.json. Users add their own entries: "spotify": "C:\\\\Users\\\\me\\\\...\\\\Spotify.exe"."""
    if SYSTEM == 'Windows':
        return {'notepad': 'notepad.exe', 'calculator': 'calc.exe', 'paint': 'mspaint.exe',
                'file explorer': 'explorer.exe', 'task manager': 'taskmgr.exe'}
    if SYSTEM == 'Darwin':
        return {'calculator': 'Calculator', 'notes': 'Notes', 'music': 'Music', 'safari': 'Safari', 'terminal': 'Terminal'}
    return {}


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


# ---------------------------------------------------------------- doing things

class SystemExecutor:
    """Performs actions on this computer. Every method takes only validated, fixed values."""

    def open_app(self, target):
        if SYSTEM == 'Windows':
            os.startfile(target)                                    # ShellExecute: no shell, no arguments
        elif SYSTEM == 'Darwin':
            subprocess.Popen(['open', '-a', target])
        else:
            subprocess.Popen([target], start_new_session=True)

    def open_folder(self, path):
        if SYSTEM == 'Windows':
            os.startfile(str(path))
        else:
            subprocess.Popen(['open' if SYSTEM == 'Darwin' else 'xdg-open', str(path)])

    def _keys(self, vk, times=1):                                   # Windows virtual-key presses
        import ctypes
        user32 = ctypes.windll.user32
        for _ in range(times):
            user32.keybd_event(vk, 0, 0, 0)
            user32.keybd_event(vk, 0, 2, 0)                         # 2 = KEYEVENTF_KEYUP

    def media(self, key):
        if SYSTEM == 'Windows':
            self._keys({'playpause': 0xB3, 'next': 0xB0, 'previous': 0xB1}[key])
        elif SYSTEM == 'Linux':
            subprocess.run(['playerctl', {'playpause': 'play-pause', 'next': 'next', 'previous': 'previous'}[key]], check=True)
        else:
            raise RuntimeError('media keys are not supported on macOS yet')

    def volume(self, direction):
        if SYSTEM == 'Windows':
            self._keys({'up': 0xAF, 'down': 0xAE, 'mute': 0xAD}[direction], 1 if direction == 'mute' else 5)   # 5 x 2% = 10%
        elif SYSTEM == 'Darwin':
            script = {'up': 'set volume output volume ((output volume of (get volume settings)) + 10)',
                      'down': 'set volume output volume ((output volume of (get volume settings)) - 10)',
                      'mute': 'set volume output muted (not (output muted of (get volume settings)))'}[direction]
            subprocess.run(['osascript', '-e', script], check=True)
        else:
            arg = {'up': '+10%', 'down': '-10%', 'mute': 'toggle'}[direction]
            subprocess.run(['pactl', 'set-sink-mute' if direction == 'mute' else 'set-sink-volume', '@DEFAULT_SINK@', arg], check=True)

    def lock(self):
        if SYSTEM == 'Windows':
            import ctypes
            ctypes.windll.user32.LockWorkStation()
        elif SYSTEM == 'Darwin':
            subprocess.run(['pmset', 'displaysleepnow'], check=True)
        else:
            subprocess.run(['loginctl', 'lock-session'], check=True)


class RecordingExecutor:
    """Does nothing but remember what it was asked. Used by --dry-run and the tests."""

    def __init__(self):
        self.done = []

    def __getattr__(self, name):
        if name not in ('open_app', 'open_folder', 'media', 'volume', 'lock'):
            raise AttributeError(name)
        return lambda *args: self.done.append((name, *[str(a) for a in args]))


# ---------------------------------------------------------------- state: pairing, approvals, the app list

class State:
    def __init__(self, home, origins, executor, interactive, say=print):
        self.home = Path(home)
        self.home.mkdir(parents=True, exist_ok=True)
        self.config_path, self.apps_path = self.home / 'config.json', self.home / 'apps.json'
        cfg = self._read(self.config_path, {})
        self.tokens = cfg.get('tokens', {})          # origin -> sha256(token)
        self.approved = set(cfg.get('approved', []))  # action types the user allowed
        if not self.apps_path.exists():
            self.apps_path.write_text(json.dumps(default_apps(), indent=2), encoding='utf-8')
        self.origins, self.executor, self.interactive, self.say = set(origins), executor, interactive, say
        self.lock, self.pending = threading.Lock(), []
        self.new_code()

    @staticmethod
    def _read(path, default):
        try:
            return json.loads(Path(path).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return default

    def save(self):
        tmp = self.config_path.with_suffix('.tmp')
        tmp.write_text(json.dumps({'tokens': self.tokens, 'approved': sorted(self.approved)}, indent=2), encoding='utf-8')
        os.replace(tmp, self.config_path)

    def apps(self):
        """Read on every request, so edits to apps.json apply without a restart."""
        raw = self._read(self.apps_path, {})
        return {str(k).strip().lower(): str(v) for k, v in raw.items() if isinstance(v, str) and v.strip()} if isinstance(raw, dict) else {}

    def new_code(self):
        self.code, self.failures = f'{secrets.randbelow(10 ** 6):06d}', 0
        self.say(f'\n  Pairing code: {self.code}   (type it into Jarvis: Settings, PC companion)\n')

    def pair(self, origin, code):
        with self.lock:
            if hmac.compare_digest(str(code), self.code):
                token = secrets.token_urlsafe(32)
                self.tokens[origin] = sha(token)
                self.save()
                self.say(f'  Paired with {origin}.')
                self.new_code()                                     # the code works once
                return token
            self.failures += 1
            if self.failures >= MAX_PAIR_TRIES:
                self.say('  Too many wrong pairing codes. Here is a new one.')
                self.new_code()
            return None

    def authorized(self, origin, header):
        token = header[7:] if header and header.startswith('Bearer ') else ''
        stored = self.tokens.get(origin)
        return bool(token and stored and hmac.compare_digest(stored, sha(token)))

    def approval(self, kind):
        """'yes' if allowed, 'pending' if the user has just been asked, 'no' if nobody can be asked."""
        if kind in self.approved:
            return 'yes'
        if not self.interactive:
            return 'no'
        with self.lock:
            if kind not in self.pending:
                self.pending.append(kind)
                if len(self.pending) == 1:
                    self._ask()
        return 'pending'

    def _ask(self):
        self.say(f'\n  Jarvis wants to {ACTIONS[self.pending[0]]}. Allow? Type y or n, then Enter: ', end='')

    def answer(self, line):
        with self.lock:
            if not self.pending:
                return False
            kind = self.pending.pop(0)
            if line.strip().lower() in ('y', 'yes'):
                self.approved.add(kind)
                self.save()
                self.say(f'  Allowed: {ACTIONS[kind]}. Ask Jarvis again.')
            else:
                self.say('  Not allowed. Jarvis will ask again if you repeat the command.')
            if self.pending:
                self._ask()
            return True

    def forget(self):
        with self.lock:
            self.tokens, self.approved = {}, set()
            self.save()

    # -- one action, already authorised. Returns (status, body).
    def act(self, kind, name):
        if kind not in ACTIONS:
            return 400, {'error': 'unknown_action'}
        if kind == 'open_app':
            apps = self.apps()
            if name not in apps:
                return 404, {'error': 'not_listed', 'apps': sorted(apps)}
            arg = apps[name]
        elif kind == 'open_folder':
            if name not in FOLDERS:
                return 404, {'error': 'unknown_folder', 'folders': sorted(FOLDERS)}
            arg = folder_path(name)
        elif kind == 'media':
            if name not in MEDIA_KEYS:
                return 400, {'error': 'unknown_key'}
            arg = name
        elif kind == 'volume':
            if name not in VOLUME:
                return 400, {'error': 'unknown_direction'}
            arg = name
        else:
            arg = None
        decision = self.approval(kind)
        if decision != 'yes':
            return 403, {'error': 'needs_approval' if decision == 'pending' else 'not_approved'}
        try:
            fn = getattr(self.executor, kind)
            fn() if arg is None else fn(arg)
        except Exception as err:                                  # report, never crash the server
            return 500, {'error': 'failed', 'detail': str(err)[:200]}
        self.say(f'  Did: {kind}{" " + name if name else ""}')
        return 200, {'ok': True}


def folder_path(name):
    home = Path.home()
    if not FOLDERS[name]:
        return home
    for candidate in (home / FOLDERS[name], home / 'OneDrive' / FOLDERS[name]):   # Windows may redirect to OneDrive
        if candidate.exists():
            return candidate
    return home / FOLDERS[name]


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = 'JarvisCompanion/' + VERSION
    state = None   # set by make_server

    def log_message(self, *args):   # quiet: this window is for pairing and approvals
        pass

    def _checks(self):
        """Returns the origin if the request may proceed, else sends 403 and returns None."""
        port = self.server.server_address[1]
        if self.headers.get('Host', '') not in (f'127.0.0.1:{port}', f'localhost:{port}'):
            self._send(403, {'error': 'bad_host'})
            return None
        origin = self.headers.get('Origin', '')
        if origin not in self.state.origins:
            self._send(403, {'error': 'origin_not_allowed'})
            return None
        return origin

    def _send(self, code, body, origin=None):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        if origin:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        origin = self._checks()
        if not origin:
            return
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.send_header('Access-Control-Max-Age', '600')
        if self.headers.get('Access-Control-Request-Private-Network') == 'true':
            self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        origin = self._checks()
        if not origin:
            return
        auth = self.state.authorized(origin, self.headers.get('Authorization'))
        if self.path == '/status':
            return self._send(200, {'name': 'jarvis-companion', 'version': VERSION, 'paired': auth}, origin)
        if self.path == '/apps':
            if not auth:
                return self._send(401, {'error': 'not_paired'}, origin)
            return self._send(200, {'apps': sorted(self.state.apps()), 'folders': sorted(FOLDERS),
                                    'actions': sorted(ACTIONS), 'system': SYSTEM}, origin)
        self._send(404, {'error': 'not_found'}, origin)

    def do_POST(self):
        origin = self._checks()
        if not origin:
            return
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            return self._send(415, {'error': 'json_only'}, origin)   # forces a CORS preflight for every call
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = -1
        if not 0 <= length <= MAX_BODY:
            return self._send(413, {'error': 'too_large'}, origin)
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
            assert isinstance(body, dict)
        except (ValueError, AssertionError):
            return self._send(400, {'error': 'bad_json'}, origin)

        if self.path == '/pair':
            token = self.state.pair(origin, str(body.get('code', '')).strip())
            return self._send(200, {'token': token}, origin) if token else self._send(401, {'error': 'wrong_code'}, origin)
        if self.path == '/action':
            if not self.state.authorized(origin, self.headers.get('Authorization')):
                return self._send(401, {'error': 'not_paired'}, origin)
            code, out = self.state.act(str(body.get('action', '')), str(body.get('name', '')).strip().lower())
            return self._send(code, out, origin)
        self._send(404, {'error': 'not_found'}, origin)


def make_server(state, port=PORT):
    handler = type('BoundHandler', (Handler,), {'state': state})
    return ThreadingHTTPServer(('127.0.0.1', port), handler)


# ---------------------------------------------------------------- console

def main(argv=None):
    p = argparse.ArgumentParser(description='Jarvis companion: lets your Jarvis page open apps and control media on this computer.')
    p.add_argument('--port', type=int, default=PORT)
    p.add_argument('--allow-hosted', action='store_true', help=f'also accept the hosted Jarvis at {HOSTED_ORIGIN}')
    p.add_argument('--allow-origin', action='append', default=[], metavar='URL', help='also accept another Jarvis origin, such as your fork')
    p.add_argument('--home', default=os.environ.get('JARVIS_COMPANION_HOME') or str(Path.home() / '.jarvis-companion'),
                   help='folder for apps.json and the pairing record')
    p.add_argument('--dry-run', action='store_true', help='print actions instead of performing them')
    args = p.parse_args(argv)

    origins = LOCAL_ORIGINS + ([HOSTED_ORIGIN] if args.allow_hosted else []) + [o.rstrip('/') for o in args.allow_origin]
    say = lambda *a, **k: print(*a, **k, flush=True)
    executor = RecordingExecutor() if args.dry_run else SystemExecutor()
    interactive = sys.stdin is not None and sys.stdin.isatty()
    say(f'Jarvis companion {VERSION}{" (dry run: nothing is really done)" if args.dry_run else ""}')
    state = State(args.home, origins, executor, interactive, say)
    try:
        server = make_server(state, args.port)
    except OSError as err:
        say(f'Could not listen on 127.0.0.1:{args.port}: {err}. Is the companion already running?')
        return 1
    say(f'  Listening on http://127.0.0.1:{args.port} for: {", ".join(origins)}')
    say(f'  Your app list: {state.apps_path}  (edit it to add apps; changes apply at once)')
    say('  Commands: y / n answer a question, "code" new pairing code, "unpair" forget every page, "quit" stop.')
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        quit_asked = False
        if interactive:
            for line in sys.stdin:
                cmd = line.strip().lower()
                if state.answer(cmd):
                    continue
                if cmd == 'code':
                    state.new_code()
                elif cmd == 'unpair':
                    state.forget()
                    say('  Forgot every paired page and every approval.')
                elif cmd in ('quit', 'exit', 'q'):
                    quit_asked = True
                    break
                elif cmd:
                    say('  Commands: code, unpair, quit.')
        if not quit_asked:
            # No console (or its input closed; on Windows the null device even claims to be one): keep serving,
            # but nobody can approve new kinds of action now, so those are refused.
            state.interactive = False
            threading.Event().wait()
    except KeyboardInterrupt:
        pass
    server.shutdown()
    say('Companion stopped.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
