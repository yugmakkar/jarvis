# Privacy

Short version: Jarvis has no server, no accounts, no analytics and no cookies. The project's authors cannot see anything you say or type, because nothing is ever sent to them.

This page lists everything that does leave your device, so you can judge for yourself.

## What stays on your device

- Your notes, the name you ask Jarvis to call you, your home city and your chosen AI model. These are kept in your browser's `localStorage` for the page.
- The conversation log on screen. It is held in memory and disappears when you close the tab.
- Conversation history with a local AI model. Also memory only.

To erase everything, clear site data for the page in your browser settings, or say "clear notes" for notes alone.

## What leaves your device, and when

Jarvis contacts a service only when you ask for the thing that service provides.

| Service | Contacted when | What is sent |
|---|---|---|
| Open-Meteo (`api.open-meteo.com`, `geocoding-api.open-meteo.com`) | You ask about weather | The city name. If you name no city and allow location access, your coordinates |
| Wikipedia (`en.wikipedia.org`) | You ask who or what something is | Your search words |
| Hacker News (`hacker-news.firebaseio.com`) | You ask for news | Nothing about you |
| Free Dictionary API (`api.dictionaryapi.dev`) | You ask for a definition | The word |
| icanhazdadjoke (`icanhazdadjoke.com`) | You ask for a joke | Nothing about you |
| Ollama (`localhost:11434`) | You have a local AI model running | Your question, to your own computer only |

As with any web request, each service sees your IP address. No API keys, user IDs or cookies are sent, and the page sends no referrer.

When you say "open ...", "search for ..." or "play ...", Jarvis opens that site in a new tab. From then on you are on that site, under its own privacy policy.

## How this is enforced

The app page carries a Content-Security-Policy that names the hosts above. The browser refuses any connection to a host that is not on the list, and refuses to run any script that is not one of the project's own files. A bug or a malicious change would have to edit that list in `app/index.html` to send data anywhere else, and that edit would be plain to see in the source.

You can verify this yourself: open the browser's developer tools, go to the Network tab, and use Jarvis. You will see requests to the hosts in the table and nothing else.

## Voice: the one thing Jarvis does not control

Jarvis uses the speech recognition built into your browser. In Chrome and Edge that feature works by sending microphone audio to the browser maker's speech service (Google or Microsoft) to be turned into text. Jarvis never receives or stores the audio, only the resulting text, but the audio does leave your device while the microphone is on.

If that matters to you:

- Click the core or the MIC button to mute. Typed commands use no speech service.
- Say "go to sleep" to mute by voice.
- Spoken replies use voices installed on your device. Some browsers also offer online voices; Jarvis prefers whichever is listed first among its favourites, which you can change in `app/jarvis.js`.

Fully on-device speech recognition is a goal for a later version.

## The hosted version and GitHub

If you use Jarvis at `yugmakkar.github.io`, the files are served by GitHub Pages, and GitHub logs visitor IP addresses as any web host does. Running your own copy from `localhost` avoids that.

## The landing page

The landing page loads no third-party scripts, fonts or media; everything is bundled and served from the same place. Its demo console uses the same skills and the same allow-list as the app, and contacts a service only when you run a command.

## Reporting a problem

If you find a way Jarvis sends data that this page does not describe, please open an issue at https://github.com/yugmakkar/jarvis/issues.
