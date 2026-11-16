# Privacy

Short version: Jarvis has no server, no accounts, no analytics and no cookies. The project's authors cannot see anything you say or type, because nothing is ever sent to them.

This page lists everything that does leave your device, so you can judge for yourself.

## What stays on your device

- Your notes, reminders and timers, the name you ask Jarvis to call you, your home city, and your settings (wake word, voice, speed, AI model). These are kept in your browser's `localStorage` for the page.
- The conversation log on screen. It is held in memory and disappears when you close the tab.
- Conversation history with a local AI model. Also memory only.

To see everything that is stored, ask "what do you know about me". To erase it all, open **Settings** and choose **Erase all my data**. Say "clear notes" or "cancel all reminders" to remove just those.

## What leaves your device, and when

Jarvis contacts a service only when you ask for the thing that service provides.

| Service | Contacted when | What is sent |
|---|---|---|
| Open-Meteo (`api.open-meteo.com`, `geocoding-api.open-meteo.com`) | You ask about weather | The city name. If you name no city and allow location access, your coordinates |
| Wikipedia (`en.wikipedia.org`) | You ask a factual question, or for "something interesting" | Your question, as search words |
| Hacker News (`hacker-news.firebaseio.com`) | You ask for news | Nothing about you |
| Free Dictionary API (`api.dictionaryapi.dev`) | You ask for a definition | The word |
| Frankfurter (`api.frankfurter.dev`) | You convert currency | The two currency codes, not the amount |
| MyMemory (`api.mymemory.translated.net`) | You ask for a translation | The phrase you want translated |
| icanhazdadjoke (`icanhazdadjoke.com`) | You ask for a joke | Nothing about you |
| SomaFM radio (`ice2.somafm.com`, `ice4.somafm.com`, `ice6.somafm.com`, `ice1.somafm.com`) | You ask Jarvis to play music | Nothing about you. The station streams to your browser like any web radio |
| SomaFM (`somafm.com`) | You ask "what's playing" | The station name |
| Ollama (`localhost:11434`) | You have a local AI model running | Your question, to your own computer only |

As with any web request, each service sees your IP address. No API keys, user IDs or cookies are sent, and the page sends no referrer.

Unit conversion, maths, timers, reminders and notes are handled entirely on your device and contact nothing.

If you allow notifications, reminders also appear as system notifications. These are created by your own browser and involve no push service.

When you say "open ...", "search for ..." or "play ...", Jarvis opens that site in a new tab. From then on you are on that site, under its own privacy policy.

## The AI brain

Questions that no built-in skill covers are answered by the best of these that is available. All three are free.

1. **Ollama**, if you run it on this computer. Your question goes to `localhost` only.
2. **Chrome's built-in AI** (Gemini Nano), if you turn it on in **Settings**. The model runs inside Chrome on your computer, so your questions are never sent anywhere. Turning it on makes Chrome download the model once, a few gigabytes, from Google. That download is made by Chrome, not by this page, and nothing is billed. It needs Chrome 148 or later, about 22 GB of free disk space, and either a GPU with more than 4 GB of memory or 16 GB of RAM.
3. **Wikipedia**, otherwise. Jarvis searches it and reads out the sentence that best answers your question.

For factual questions, Jarvis also looks the topic up on Wikipedia when an AI is on, and gives the AI those facts along with your question. The search words go to Wikipedia; the AI itself stays on your computer.

No model is trained on what you say. The conversation is kept in memory for follow-up questions and is gone when you close the tab.

## Music

"Play some music", "play jazz" and similar start SomaFM radio inside Jarvis. SomaFM is free, listener-supported internet radio with no adverts and no account. The page may only play audio from the four SomaFM stream hosts in the table above; that list is enforced by the browser like the rest of the allow-list. Streaming uses your internet data while music plays. "Play ... on YouTube" opens YouTube in a new tab instead.

## How this is enforced

The app page carries a Content-Security-Policy that names the hosts above: one list for data (`connect-src`) and one for audio (`media-src`). The browser refuses any connection to a host that is not on the list, and refuses to run any script that is not one of the project's own files. A bug or a malicious change would have to edit that list in `app/index.html` to send data anywhere else, and that edit would be plain to see in the source.

An automated test in `tests/` fails the build if the code contacts a host that is missing from the allow-list or from this page.

You can verify this yourself: open the browser's developer tools, go to the Network tab, and use Jarvis. You will see requests to the hosts in the table and nothing else.

## Voice

Jarvis uses the speech recognition built into your browser. Jarvis itself never receives or stores audio, only the resulting text. Where the browser turns your speech into text depends on the browser:

| Systems panel shows | What happens to your voice |
|---|---|
| Recognition: **on this device** | Audio is processed on your computer and never leaves it. Jarvis asks the browser for this with `processLocally`, which the browser must honour or refuse with an error |
| Recognition: **downloading pack** | The browser is downloading its speech model for on-device use. Until it finishes, the online service below is used (or nothing, in "on this device only" mode) |
| Recognition: **online service** | Microphone audio is sent to the browser maker's speech service (Google for Chrome, Microsoft for Edge) to be turned into text |
| Recognition: **off** | No speech recognition runs |

On-device recognition needs Chrome 139 or later on Windows, macOS or Linux. The first time, the browser downloads an English speech model from its maker. That download is made by the browser, not by this page, so it does not appear in the allow-list. Other browsers currently use the online service.

You choose in **Settings → Speech recognition**:

- **On this device when possible** (default): on-device where the browser supports it, the online service otherwise.
- **On this device only**: if the browser cannot recognise speech on the device, voice input stays off and no audio is sent anywhere. Type your commands instead.
- **Browser's online service**: always use the online service. Pick this if the on-device download misbehaves in your browser.

If on-device recognition stops working while Jarvis is running, Jarvis says so out loud before switching to the online service, and in "on this device only" mode turns voice input off instead.

You can check for yourself: in on-device mode, turn off your Wi-Fi and say the wake word. Jarvis still hears you.

Other ways to keep the microphone quiet:

- Click the core or the MIC button to mute. Typed commands use no speech service.
- Say "go to sleep" to mute by voice.
- Spoken replies use voices installed on your device. Some browsers also offer online voices; choose a voice in Settings.

## The hosted version and GitHub

If you use Jarvis at `yugmakkar.github.io`, the files are served by GitHub Pages, and GitHub logs visitor IP addresses as any web host does. Running your own copy from `localhost` avoids that.

## The landing page

The landing page loads no third-party scripts, fonts or media; everything is bundled and served from the same place. Its demo console uses the same skills and the same allow-list as the app, and contacts a service only when you run a command.

## Reporting a problem

If you find a way Jarvis sends data that this page does not describe, please open an issue at https://github.com/yugmakkar/jarvis/issues.
