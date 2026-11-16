# Jarvis

A free, open-source voice assistant that wakes to its name, answers out loud and pulls live answers from the web. It runs in your browser, on your own computer.

**[Live site and demo](https://yugmakkar.github.io/jarvis/)** · **[Open the assistant](https://yugmakkar.github.io/jarvis/app/)**

- **Free for everyone.** No account, no API key, no subscription. Every data source is a free public API.
- **Private.** There is no Jarvis server. Your notes and settings stay in your browser. See [docs/PRIVACY.md](docs/PRIVACY.md).
- **Small.** The assistant is about 650 lines of plain JavaScript with no framework and no build step.
- **Yours.** Fork it, rename it, add skills. See [docs/CUSTOMIZE.md](docs/CUSTOMIZE.md).

## What it can do

| Say or type | What happens |
|---|---|
| "Jarvis, weather in Mumbai" | Current conditions and today's high and low |
| "Who is Alan Turing" / "What is a black hole" | A short spoken answer from Wikipedia |
| "Tech news" | The top stories on Hacker News |
| "Define serendipity" | A dictionary definition |
| "What is 18 times 24" | Arithmetic |
| "Set a timer for 10 minutes" | A timer that announces itself when done |
| "Remember to call mom" / "What are my notes" | Notes saved on your device |
| "Open YouTube" / "Search for pasta recipes" / "Play lo-fi" | Opens the site, a Google search or a YouTube search |
| "What time is it" / "System status" / "Tell me a joke" | What you would expect |
| "Go to sleep" | Mutes the microphone until you click the core |

After Jarvis answers, he keeps listening for about 8 seconds, so follow-up commands do not need the wake word. Click the core to interrupt him or to mute and unmute the microphone.

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

### Optional: a local AI brain

Out of the box, open-ended questions are answered from Wikipedia. For real conversation, install [Ollama](https://ollama.com) (free) and pull a model:

```bash
ollama pull llama3.2
```

When Ollama is running, Jarvis detects it at start-up and sends anything that is not a built-in skill to the model on your own machine. The Systems panel shows `Brain: local` when it is active. Say "use model llama3.2" to pick between installed models.

If you use the hosted version rather than a local copy, Ollama must be told to accept requests from that page. Set the environment variable `OLLAMA_ORIGINS=https://yugmakkar.github.io` and restart Ollama.

## Browser support

| | Voice input | Spoken replies | Typed commands |
|---|---|---|---|
| Chrome, Edge (desktop) | Yes | Yes | Yes |
| Safari | Partial | Yes | Yes |
| Firefox | No | Yes | Yes |

Opening sites by voice may be stopped by the pop-up blocker the first time, because a voice command is not a click. Allow pop-ups for the page once.

## What it cannot do

Jarvis is a web page, so it cannot launch desktop programs, change system settings or read your files. That is a deliberate limit of the browser sandbox, and part of why it is safe to run.

## Project layout

```
app/        The assistant. Plain HTML, CSS and JavaScript. This is all you need to run Jarvis.
  jarvis.js   Voice loop: hearing, deciding, speaking
  skills.js   Every command, as a list of pattern + function pairs
  reactor.js  The animated core
  sw.js       Offline cache for the installed app
site/       The landing page (React + Vite). Only needed if you want to change the website.
docs/       Privacy notes and the customisation guide
```

To work on the landing page:

```bash
cd site
npm install
npm run dev
```

Pushing to `main` rebuilds and publishes the site through the workflow in `.github/workflows/pages.yml`.

## Credits and licence

MIT licensed, see [LICENSE](LICENSE). Data from [Open-Meteo](https://open-meteo.com), [Wikipedia](https://www.wikipedia.org), [Hacker News](https://news.ycombinator.com), the [Free Dictionary API](https://dictionaryapi.dev) and [icanhazdadjoke](https://icanhazdadjoke.com). The landing page uses components from [React Bits](https://reactbits.dev), which carry their own licence (see `site/src/reactbits/README.md`).

This is a fan-made project and is not affiliated with Marvel or Disney.
