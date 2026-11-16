# The PC companion

Jarvis runs in a web page, and web pages are not allowed to open desktop apps, press media keys or lock the computer. The companion is a small, optional program you run on your own computer that does those few things when your Jarvis asks.

It is free, a single Python file with no dependencies (`companion/jarvis_companion.py`), and it never contacts the internet.

## Start it

You need Python 3, the same as for `start.bat`.

- **Windows:** double-click `start-companion.bat`
- **macOS / Linux:** run `./start-companion.sh`

A window opens and shows a **pairing code**. In Jarvis, open **SETTINGS**, type the code under **PC companion** and click **Pair**. You can also say "pair companion" followed by the six digits.

Keep the window open while you use Jarvis. Close it, or type `quit`, to stop the companion.

## What you can say

| Say | What happens |
|---|---|
| "Open Spotify" / "Launch notepad" | Opens an app from your app list |
| "Open my downloads folder" | Opens Downloads, Documents, Desktop, Pictures, Music, Videos or your home folder |
| "Pause the music" / "Resume" / "Next song" / "Previous track" | Presses the media keys, so it works with Spotify, YouTube, VLC and most players |
| "Volume up" / "Volume down" / "Mute the sound" | Changes the system volume |
| "Lock the computer" | Locks the screen |

When Jarvis's own radio is playing, "next song", "pause the music" and "volume up" control the radio instead. Say "system volume up" to change the computer's volume while the radio plays. Plain "mute" still means "stop listening".

## Your app list

Jarvis can open only the apps you list. The list is `apps.json` in the companion folder (`.jarvis-companion` in your home folder); the window shows its exact path. It starts with a few built-in apps. Add your own as `"name": "path"`:

```json
{
  "notepad": "notepad.exe",
  "calculator": "calc.exe",
  "spotify": "C:\\Users\\you\\AppData\\Roaming\\Spotify\\Spotify.exe",
  "vs code": "C:\\Users\\you\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"
}
```

On macOS use the app's name, such as `"Spotify"`. Changes apply at once; there is no need to restart. Afterwards, open Settings once (or reload Jarvis) so it learns the new names.

## Security

A program that lets a web page act on your computer must be careful, because any website you visit could try to talk to it. The companion defends itself like this:

- **Your computer only.** It listens on `127.0.0.1`, which other devices on your network cannot reach. It also refuses requests whose `Host` header is not `127.0.0.1` or `localhost`, which defeats DNS-rebinding attacks.
- **Your Jarvis only.** It answers only pages from the origins it was told to trust. By default that is the copy you run yourself at `http://localhost:5173`. Every other website is refused, and browsers enforce this through CORS.
- **Pairing.** Even a trusted page must pair first, using the code shown in the companion window. The code works once, and five wrong guesses replace it with a new one. Pairing gives the page a random token. The companion stores only a hash of it, and the token works only from the page that paired.
- **Your approval.** The first time Jarvis asks for each kind of action (opening apps, folders, media keys, volume, locking), the companion asks you in its window. Nothing happens until you type `y`. Your answers are remembered.
- **A fixed menu.** Jarvis can request only the five actions above. It sends a name, such as "spotify" or "downloads". The companion looks up the path in your own list, never runs a shell, and never passes arguments to an app. A request for anything else is refused.
- **The website cannot use it.** The landing page's demo console refuses companion commands, and its Content-Security-Policy does not allow it to contact the companion at all.

To forget every paired page and every approval, type `unpair` in the companion window. Saying "forget the companion" in Jarvis removes the token from that browser.

### Using it with the hosted Jarvis

By default the companion does not trust `https://yugmakkar.github.io`. To use it with the hosted copy, start it with:

```bash
python companion/jarvis_companion.py --allow-hosted
```

Chrome then asks once whether the page may access devices on your local network; allow it. Be aware of what this means: you are trusting whatever code is published at that address. Running your own copy from `localhost` keeps that decision in your hands. For your own fork, use `--allow-origin https://<your-name>.github.io` instead.

### Other options

- `--dry-run` prints what it would do without doing it. Useful for trying commands safely.
- `--port 8765` is the default port; the page expects it there.
- `--home FOLDER` keeps the app list and pairing record somewhere else.

## Platform notes

| | Windows | macOS | Linux |
|---|---|---|---|
| Apps, folders | Yes | Yes | Yes |
| Media keys | Yes | Not yet | With `playerctl` |
| Volume | Yes | Yes | With `pactl` (PulseAudio or PipeWire) |
| Lock | Yes | Sleeps the display | With `loginctl` |

## Tests

```bash
python -m unittest discover companion
```

The tests start a real companion on a free port with a temporary folder and a recorder in place of the real actions, so nothing on your computer is opened, pressed or locked.
