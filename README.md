# Jarvis

A free, open-source voice assistant that wakes to its name, answers out loud and pulls live answers from the web. It runs in your browser, on your own computer.

**[Live site and demo](https://yugmakkar.github.io/jarvis/)** · **[Open the assistant](https://yugmakkar.github.io/jarvis/app/)**

- **Free for everyone.** No account, no API key, no subscription. Every data source is a free public API.
- **Private.** There is no Jarvis server. Your notes and settings stay in your browser, and in recent Chrome your voice is recognised on your own computer. See [docs/PRIVACY.md](docs/PRIVACY.md).
- **Small.** The assistant is about 1,400 lines of plain JavaScript with no framework and no build step.
- **Tested.** An automated test suite runs before every deployment.
- **Yours.** Fork it, rename it, add skills. See [docs/CUSTOMIZE.md](docs/CUSTOMIZE.md).

## What it can do

| Say or type | What happens |
|---|---|
| "Good morning" / "Brief me" | A spoken briefing: time, weather, top headlines, your reminders |
| "Jarvis, weather in Mumbai" | Current conditions and today's high and low |
| "How far is the Moon" / "Why is the sky blue" / "Who won the 2022 World Cup" | The sentence that answers it, found on Wikipedia, with the source on the display |
| "Write me a poem about rain" / "Help me plan a trip to Goa" | Answered by an AI running on your computer, once you turn one on (see below) |
| "Tech news" | The top stories on Hacker News |
| "Define serendipity" | A dictionary definition |
| "What is 18 times 24" | Arithmetic |
| "Set a timer for 10 minutes" | A timer with a live countdown that announces itself when done |
| "Remind me at 5 pm to call home" / "Remind me in 20 minutes to stretch" | A reminder that survives closing and reopening the app |
| "Convert 100 dollars to rupees" | Live exchange rates |
| "How many grams in a pound" / "5 miles to km" / "100 celsius to fahrenheit" | Unit conversion, done on your device |
| "Translate good morning to Spanish" | Translation into 20 languages, spoken in that language |
| "Play some music" / "Play lo-fi" / "Play jazz" / "What's playing" / "Volume down" / "Stop the music" | Free SomaFM radio, played inside Jarvis. "Play ... on YouTube" searches YouTube instead |
| "Days until Christmas" / "Tell me something interesting" / "How are you" | What you would expect |
| "Remember to call mom" / "What are my notes" | Notes saved on your device |
| "Open YouTube" / "Search for pasta recipes" | Opens the site or a Google search in a new tab |
| "What time is it" / "System status" / "Tell me a joke" | What you would expect |
| "Open Spotify" / "Open my downloads folder" / "Next song" / "Volume up" / "Lock the computer" | Controls your computer, with the optional [PC companion](docs/COMPANION.md) |
| "What do you know about me" | Shows everything saved on your device |
| "Cancel all reminders" / "Go to sleep" | Clears the schedule / mutes the microphone until you click the core |

After Jarvis answers, he keeps listening for about 8 seconds, so follow-up commands do not need the wake word. Click the core to interrupt him or to mute and unmute the microphone. Tap **Space** to talk without saying the wake word, and press the up arrow in the command box to recall earlier commands.

### Settings

Click **SETTINGS** in the top bar to change what Jarvis calls you, your home city, the wake word, the voice and its speed, where speech is recognised, or to turn spoken replies off. **Erase all my data** removes everything Jarvis has saved on the device. No code needed.

## Run it on your computer

You need a Chromium browser (Chrome or Edge) for voice, and Python 3 for the tiny local web server. Both are free.

```bash
git clone https://github.com/yugmakkar/jarvis.git
cd jarvis
```

Then start it:

- **Windows:** double-click `start.bat`
- **macOS / Linux:** run `./start.sh`

Jarvis opens at `http://localhost:5173/app/`. Click **INITIALIZE** and allow the microphone.

A local server is needed because browsers only grant microphone access to `https://` pages and to `localhost`. Opening `app/index.html` directly as a file will not work for voice.

### Install it as an app

In Chrome or Edge, with Jarvis open, click the install icon at the right of the address bar and choose **Install**. Jarvis then has its own window, its own icon, and launches from the Start menu or dock. You can also install it straight from the [hosted version](https://yugmakkar.github.io/jarvis/app/) without cloning anything.

The installed interface loads offline. Skills that fetch web data need a connection.

### The AI brain

Out of the box, Jarvis answers factual questions by finding the right sentence on Wikipedia. For conversation, writing and problem solving, turn on an AI that runs on your own computer. Both options are free, and your questions never leave the machine.

**Chrome's built-in AI (easiest).** In Chrome 148 or later, open **SETTINGS** and click **Turn on built-in AI**. Chrome downloads its on-device model (Gemini Nano) once, which takes a few gigabytes of disk and data, so use Wi-Fi. It needs about 22 GB of free disk space and either a GPU with more than 4 GB of memory or 16 GB of RAM. The Systems panel then shows `Brain: Chrome AI, on device`.

**Ollama (most capable).** Install [Ollama](https://ollama.com) and pull a model:

```bash
ollama pull llama3.2
```

When Ollama is running, Jarvis detects it at start-up and uses it ahead of Chrome's AI. The Systems panel shows `Brain: Ollama` when it is active. Say "use model llama3.2" to pick between installed models.

If you use the hosted version rather than a local copy, Ollama must be told to accept requests from that page. Set the environment variable `OLLAMA_ORIGINS=https://yugmakkar.github.io` and restart Ollama.

## Browser support

| | Voice input | Where speech is recognised | Spoken replies | Typed commands |
|---|---|---|---|---|
| Chrome 139+ (desktop) | Yes | On your device (after a one-time model download by the browser) | Yes | Yes |
| Edge, older Chrome | Yes | Usually the browser maker's online service | Yes | Yes |
| Safari | Partial | Depends on the system | Yes | Yes |
| Firefox | No | | Yes | Yes |

The Systems panel shows which one is in use. To never send audio anywhere, choose **On this device only** in Settings. See [docs/PRIVACY.md](docs/PRIVACY.md#voice).

Opening sites by voice may be stopped by the pop-up blocker the first time, because a voice command is not a click. Allow pop-ups for the page once.

### Optional: control your computer

On its own, Jarvis is a web page, so the browser stops it from launching desktop programs or pressing media keys. The free [PC companion](docs/COMPANION.md) adds exactly that, and no more: it opens apps from a list you write, opens your personal folders, presses play/pause/next, changes the volume and locks the screen. Double-click `start-companion.bat` (or run `./start-companion.sh`), then pair it in **SETTINGS** with the code in its window. It listens on your computer only, and you approve each kind of action the first time.

## What it cannot do

Even with the companion, Jarvis cannot run arbitrary programs or commands, change system settings, or read your files. The companion offers a fixed menu of actions and refuses everything else. Without the companion, the browser sandbox keeps Jarvis inside its page.

## Project layout

```
app/        The assistant. Plain HTML, CSS and JavaScript. This is all you need to run Jarvis.
  jarvis.js   Voice loop: hearing, deciding, speaking
  hearing.js  Chooses on-device or online speech recognition
  brain.js    Answers open questions: the Wikipedia answer finder and Chrome's built-in AI
  skills.js   Every command, as a list of pattern + function pairs
  reactor.js  The animated core
  sw.js       Offline cache for the installed app
site/       The landing page (React + Vite). Only needed if you want to change the website.
companion/  The optional PC companion (Python, no dependencies) and its tests
tests/      Automated tests for the skills and the privacy allow-list
docs/       Privacy notes and the customisation guide
```

To work on the landing page:

```bash
cd site
npm install
npm run dev
```

## Tests

```bash
node --test tests/
```

The companion has its own tests: `python -m unittest discover companion`.

The tests need only Node.js 20 or newer, with nothing to install. They load the skills into a sandbox with a fake network, so they are fast and never contact a real service. One test fails if the code talks to a server that is missing from the allow-list or from the privacy notes.

Pushing to `main` runs the tests, and only if they pass rebuilds and publishes the site through the workflow in `.github/workflows/pages.yml`.

## Credits and licence

MIT licensed, see [LICENSE](LICENSE). Data from [Open-Meteo](https://open-meteo.com), [Wikipedia](https://www.wikipedia.org), [Hacker News](https://news.ycombinator.com), the [Free Dictionary API](https://dictionaryapi.dev), [Frankfurter](https://frankfurter.dev), [MyMemory](https://mymemory.translated.net) and [icanhazdadjoke](https://icanhazdadjoke.com). Music is [SomaFM](https://somafm.com), free listener-supported radio; if you enjoy it, they accept donations. The landing page uses components from [React Bits](https://reactbits.dev), which carry their own licence (see `site/src/reactbits/README.md`).

This is a fan-made project and is not affiliated with Marvel or Disney.
