# Making Jarvis yours

Everything here is done by editing files in `app/`. There is no build step: save the file and reload the page.

## Add a skill

Open `app/skills.js` and find the `ROUTES` list. Each entry is a pattern and a function. The first pattern that matches the command wins, so put specific patterns above general ones.

```js
[/^flip a coin$/, () => ({ say: Math.random() < 0.5 ? 'Heads.' : 'Tails.' })],
```

The function receives the regex match and returns an object:

| Field | Meaning |
|---|---|
| `say` | What Jarvis speaks. Keep it to a sentence or two |
| `card` | Optional panel content: `{ title, big, text, rows, list, link }` |
| `sleep` | `true` if Jarvis should not wait for a follow-up |

Commands arrive lower-cased, with the wake word, "please" and trailing punctuation already removed.

### A skill that fetches data

Use the `getJSON` helper, which adds a timeout. Then add the host to the allow-list, or the browser will block the request.

```js
[/\b(cat fact)\b/, async () => {
  const data = await getJSON('https://catfact.ninja/fact');
  return { say: data.fact, card: { title: 'Cat fact', text: data.fact } };
}],
```

In `app/index.html`, add `https://catfact.ninja` to `connect-src` inside the Content-Security-Policy tag. If you also want the skill to work in the landing page's demo console, add it to the `CONNECT` list in `site/vite.config.js`. Then list the new service in `docs/PRIVACY.md` so your users know about it.

## Change the wake word

In `app/jarvis.js`, edit `extractWakeCommand`. It receives each sentence the microphone hears and returns:

- `null` if the sentence was not meant for the assistant
- `''` if it was only the wake word
- the command text, if a command followed the wake word

Speech recognisers often mishear names ("Travis", "service"), so accepting a few close spellings makes the assistant more responsive, at the price of occasionally waking when it should not. Also update the matching pattern at the top of `handle` in `app/skills.js`, which strips the wake word from typed commands.

## Change the voice and personality

- **Voice:** `pickVoice` in `app/jarvis.js` holds a list of preferred voice names, tried in order. Run `speechSynthesis.getVoices()` in the browser console to see what your system offers.
- **Speed and pitch:** `u.rate` and `u.pitch` in `speak`.
- **How he addresses you:** say "call me Tony", or change the default in `sir()` in `app/skills.js`.
- **Local AI persona:** the `PERSONA` text in `app/skills.js` is the system prompt sent to the local model.
- **Follow-up window:** `FOLLOW_UP_MS` at the top of `app/jarvis.js`.

## Change the look

- **Colours:** the variables at the top of `app/styles.css`. `--accent` changes per state through the `body[data-state=...]` rules beneath them.
- **The core:** `app/reactor.js`. `RINGS` describes each ring (radius, width, segment count, spin speed) and `COLORS` sets the colour for each state.
- **Name and icon:** `app/manifest.webmanifest` and the images in `app/icons/`.

## Publish your own copy

1. Fork the repository on GitHub.
2. In your fork, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push a change to `main`. The workflow builds the site and publishes it at `https://<your-username>.github.io/<repo-name>/`.
4. Replace `yugmakkar/jarvis` in `site/src/App.jsx`, `README.md` and the docs with your own repository name.

GitHub Pages is free for public repositories.

## After changing files in the installed app

The installed app caches its files so it can open offline. It fetches fresh copies whenever you are online, so a reload picks up your changes. If you add new files, list them in `SHELL` in `app/sw.js` and bump the `CACHE` name.
