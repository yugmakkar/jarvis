// Tests for the assistant's brain (app/skills.js). Run with:  node --test tests/
//
// skills.js is a plain browser script, so each test loads it into a sandbox with a fake
// localStorage and a fake fetch that returns canned answers. No test touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
// brain.js loads before skills.js in the page, so the sandbox loads them in the same order.
const SOURCE = read('app/brain.js') + '\n' + read('app/skills.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Canned replies, matched by a piece of the URL. Order matters: the first match wins.
const FAKE = {
  'geocoding-api.open-meteo.com': { results: [{ name: 'Mumbai', country_code: 'IN', latitude: 19, longitude: 72 }] },
  'api.open-meteo.com': {
    current: { temperature_2m: 29.4, apparent_temperature: 32, relative_humidity_2m: 60, wind_speed_10m: 12, weather_code: 0 },
    daily: { temperature_2m_max: [33], temperature_2m_min: [24] },
  },
  'onthisday': { selected: [{ year: 1969, text: 'Apollo 11 lands on the Moon.', pages: [{ content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Apollo_11' } } }] }] },
  'w/api.php': { query: { pages: {
    1: { index: 1, title: 'Alan Turing', fullurl: 'https://en.wikipedia.org/wiki/Alan_Turing', extract: 'Alan Turing was an English mathematician and computer scientist. He was highly influential in the development of theoretical computer science.' },
  } } },
  'somafm.com/songs': { songs: [{ title: 'Sweet Apathy', artist: 'Zero Cult' }] },
  'topstories.json': [1, 2, 3, 4, 5],
  '/item/': { title: 'A headline' },
  'dictionaryapi.dev': [{ word: 'serendipity', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A happy accident.' }] }] }],
  'icanhazdadjoke.com': { joke: 'A joke.' },
  'frankfurter.dev': { date: '2026-11-16', rates: { INR: 90, USD: 1.25 } },
  'mymemory': { responseData: { translatedText: 'buenos días' } },
};

function boot(saved = {}, { offline = false, extra = {}, companion = null } = {}) {
  // A storage object whose only enumerable keys are the stored items, like the real localStorage.
  const localStorage = {};
  Object.defineProperties(localStorage, {
    getItem: { value: k => (k in localStorage ? localStorage[k] : null) },
    setItem: { value: (k, v) => { localStorage[k] = String(v); } },
    removeItem: { value: k => { delete localStorage[k]; } },
  });
  for (const [k, v] of Object.entries(saved)) localStorage['jarvis.' + k] = JSON.stringify(v);

  const calls = [], said = [], opened = [];
  const fetch = async (url, init = {}) => {
    calls.push(String(url));
    if (String(url).startsWith('http://127.0.0.1:8765')) {   // the PC companion: a fake one if the test provides it
      if (!companion) throw new Error('connection refused');
      const r = companion(String(url).slice(21), init);
      return { ok: r.status < 300, status: r.status, json: async () => r.data };
    }
    if (offline || String(url).includes('localhost')) throw new Error('network down');
    const key = Object.keys(FAKE).find(k => String(url).includes(k));
    if (!key) throw new Error('unexpected request: ' + url);
    return { ok: true, status: 200, json: async () => FAKE[key] };
  };
  const sandbox = vm.createContext({
    localStorage, fetch, AbortController, setTimeout, clearTimeout,
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); t.unref(); return t; },
    navigator: { onLine: true },
    window: { open: url => { opened.push(url); return {}; } },
    console: { error() {}, log() {} },
    ...extra,
  });
  vm.runInContext(SOURCE + '\n;globalThis.__skills = Skills; globalThis.__brain = Brain;', sandbox);
  const Skills = sandbox.__skills;
  const ctx = { stopSpeaking() {}, setMuted() {}, announce: say => said.push(say) };
  return { Skills, Brain: sandbox.__brain, ask: text => Skills.handle(text, ctx), ctx, calls, said, opened };
}

/* ---------------- wake word ---------------- */

test('wake word: recognises Jarvis and what the recogniser hears instead', () => {
  const { Skills } = boot();
  const cases = [
    ['Jarvis, what time is it', 'what time is it'],
    ['hey jarvis open youtube', 'open youtube'],
    ['Travis what is the weather', 'what is the weather'],     // common mis-hearing
    ['jervis tell me a joke', 'tell me a joke'],
    ['jar vis set a timer for five minutes', 'set a timer for five minutes'],
    ["Jarvis's tech news", 'tech news'],
    ['what time is it, Jarvis', 'what time is it'],            // wake word at the end
    ['um Jarvis play some jazz', 'play some jazz'],
    ['Jarvis', ''],
    ['hey Jarvis.', ''],
  ];
  for (const [heard, expected] of cases) assert.equal(Skills.wake(heard), expected, heard);
});

test('wake word: ignores speech that is not addressed to it', () => {
  const { Skills } = boot();
  for (const heard of ['what time is it', 'customer service is slow', 'the jar is on the shelf', 'pass the salt please'])
    assert.equal(Skills.wake(heard), null, heard);
});

test('wake word: a custom word from Settings replaces Jarvis', () => {
  const { Skills } = boot({ wake: 'friday' });
  assert.equal(Skills.wake('Friday, tech news'), 'tech news');
  assert.equal(Skills.wake('Jarvis, tech news'), null);
});

/* ---------------- local skills ---------------- */

test('maths', async () => {
  const { ask } = boot();
  const cases = [['what is 18 times 24', '432'], ['calculate (2 plus 3) times 4', '20'], ['what is 10 divided by 4', '2.5'],
    ['2 to the power of 10', '1024'], ['what is 15 percent of 200', '30'], ['7 minus 10', '-3']];
  for (const [q, a] of cases) assert.equal((await ask(q)).say, `That's ${a}.`, q);
});

test('maths never evaluates text as code', async () => {
  const { ask } = boot();
  for (const q of ['what is alert(1)', 'calculate process.exit()', 'what is 1; while(true){}'])
    assert.doesNotMatch((await ask(q)).say, /^That's/, q);
  for (const file of ['app/skills.js', 'app/jarvis.js', 'app/reactor.js', 'app/hearing.js'])
    assert.doesNotMatch(read(file), /\beval\(|\bFunction\(/, file + ' must not use eval or Function');
});

test('unit conversion is done locally, without the network', async () => {
  const { ask, calls } = boot();
  const cases = [['convert 5 miles to km', '8.04672 kilometers'], ['100 celsius to fahrenheit', '212 degrees F'],
    ['32 f in c', '0 degrees C'], ['how many grams in a pound', '453.592 grams'], ['10 pounds to kg', '4.53592 kilograms'],
    ['2 hours in minutes', '120 minutes'], ['1 foot to inches', '12 inches'], ['3 gb to mb', '3000 megabytes']];
  for (const [q, a] of cases) assert.ok((await ask(q)).say.includes(a), `${q} -> ${(await ask(q)).say}`);
  assert.equal(calls.length, 0);
});

test('currency conversion uses the rates service', async () => {
  const { ask, calls } = boot();
  assert.equal((await ask('convert 100 dollars to rupees')).say, '100 USD is 9000.00 INR.');
  assert.ok(calls[0].includes('base=USD&symbols=INR'));
  assert.equal((await ask('10 pounds to dollars')).say, '10 GBP is 12.50 USD.');   // "pounds" means money when paired with a currency
});

test('reminders: both word orders, clock times, listing and cancelling', async () => {
  const { ask, Skills } = boot();
  const saved = () => Skills.settings.get('reminders', []);

  await ask('remind me in 10 minutes to stretch');
  assert.equal(saved()[0].text, 'stretch');
  assert.ok(Math.abs(saved()[0].at - Date.now() - 600000) < 3000);

  await ask('remind me to call home in 2 hours');
  assert.equal(saved()[1].text, 'call home');
  assert.ok(Math.abs(saved()[1].at - Date.now() - 7200000) < 3000);

  await ask('remind me at 5:30 pm to leave');
  const leave = saved().find(r => r.text === 'leave');
  assert.equal(new Date(leave.at).getHours(), 17);
  assert.equal(new Date(leave.at).getMinutes(), 30);
  assert.ok(leave.at > Date.now());

  assert.match((await ask('what are my reminders')).say, /You have 3 scheduled/);
  assert.match((await ask('remind me to do something')).say, /^When/);     // no time given
  assert.equal(saved().length, 3);
  await ask('cancel all reminders');
  assert.equal(saved().length, 0);
});

test('a timer is announced when it finishes', async () => {
  const { ask, said } = boot();
  assert.equal((await ask('set a timer for 1 second')).say, 'Timer set for 1 second.');
  await sleep(2300);
  assert.equal(said.length, 1);
  assert.equal(said[0], 'Your 1 second timer is complete, sir.');
});

test('a reminder that came due while the app was closed is announced on start', () => {
  const { Skills, ctx, said } = boot({ reminders: [{ at: Date.now() - 3600000, text: 'take medicine', timer: false }] });
  Skills.attach(ctx);
  assert.equal(said[0], 'A reminder you missed, sir: take medicine.');
  assert.equal(Skills.settings.get('reminders').length, 0);
});

test('notes, name, and the "what do you know about me" data view', async () => {
  const { ask, Skills } = boot();
  assert.match((await ask('what do you know about me')).say, /^Nothing/);
  await ask('my name is tony stark');
  await ask('my city is new delhi');
  await ask('remember to buy milk');
  assert.equal(Skills.settings.get('name'), 'Tony Stark');
  assert.equal(Skills.settings.get('city'), 'New Delhi');
  assert.match((await ask('what are my notes')).say, /1 note\. to buy milk/);
  const view = await ask('what do you know about me');
  assert.equal(view.card.rows.length, 3);
  Skills.settings.erase();
  assert.match((await ask('what do you know about me')).say, /^Nothing/);
});

test('opening sites and searches', async () => {
  const { ask, opened } = boot();
  await ask('open youtube');
  await ask('search for pasta recipes');
  await ask('play lo-fi music on youtube');
  assert.equal(opened[0], 'https://www.youtube.com');
  assert.equal(opened[1], 'https://www.google.com/search?q=pasta%20recipes');
  assert.equal(opened[2], 'https://www.youtube.com/results?search_query=lo-fi%20music');
});

/* ---------------- skills that use the web (answers are canned) ---------------- */

test('weather, knowledge, news, dictionary, joke', async () => {
  const { ask } = boot();
  assert.equal((await ask('Jarvis, weather in Mumbai')).say, "It's 29 degrees with clear skies in Mumbai, IN. Feels like 32.");
  assert.match((await ask('who is Alan Turing')).say, /^Alan Turing was an English mathematician/);
  assert.match((await ask('tech news')).say, /^Top tech stories right now\. A headline/);
  assert.equal((await ask('define serendipity')).say, 'serendipity: A happy accident.');
  assert.equal((await ask('tell me a joke')).say, 'A joke.');
});

test('translation carries the language so it can be spoken correctly', async () => {
  const { ask } = boot();
  const reply = await ask('translate good morning to spanish');
  assert.equal(reply.also.text, 'buenos días');
  assert.equal(reply.also.lang, 'es');
  assert.match((await ask('translate hello to klingon')).say, /can't translate into klingon/);
});

test('daily briefing combines time, weather, news and reminders', async () => {
  const { ask } = boot({ city: 'Mumbai', reminders: [{ at: Date.now() + 3600000, text: 'call home', timer: false }] });
  const say = (await ask('brief me')).say;
  assert.match(say, /^Good (morning|afternoon|evening), sir/);
  assert.match(say, /29 degrees/);
  assert.match(say, /In tech: A headline/);
  assert.match(say, /You have 1 reminder/);
});

test('the briefing still works when every web service is down', async () => {
  const { ask } = boot({ city: 'Mumbai' }, { offline: true });
  assert.match((await ask('brief me')).say, /^Good (morning|afternoon|evening), sir/);
});

test('a failed service gives a spoken apology, not a crash', async () => {
  const { ask } = boot({}, { offline: true });
  assert.match((await ask('weather in Mumbai')).say, /couldn't reach that service/);
});

/* ---------------- privacy guarantees ---------------- */

test('every server the code contacts is on the allow-list and in the privacy notes', () => {
  const used = new Set([...SOURCE.matchAll(/getJSON\(\s*[`'"]https:\/\/([a-z0-9.-]+)/g)].map(m => m[1]));
  // Audio streams are a separate list (media-src): exactly the stream hosts named in skills.js.
  const streams = JSON.parse(SOURCE.match(/STREAM_HOSTS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  const media = read('app/index.html').match(/media-src ([^;"]+)/)[1].split(/\s+/).map(x => x.replace('https://', ''));
  assert.deepEqual([...media].sort(), [...streams].sort(), 'media-src must list exactly the stream hosts');
  for (const host of streams) assert.ok(read('docs/PRIVACY.md').includes(host), `${host} is not documented in docs/PRIVACY.md`);
  assert.ok(used.size >= 7, 'expected to find the web services in skills.js');
  const csp = read('app/index.html').match(/connect-src ([^;"]+)/)[1];
  const siteConfig = read('site/vite.config.js'), privacy = read('docs/PRIVACY.md');
  for (const host of used) {
    assert.ok(csp.includes('https://' + host), `${host} is missing from the allow-list in app/index.html`);
    assert.ok(siteConfig.includes('https://' + host), `${host} is missing from site/vite.config.js`);
    assert.ok(privacy.includes(host), `${host} is not documented in docs/PRIVACY.md`);
  }
  // ...and the allow-list contains nothing the code does not use.
  const allowed = csp.split(/\s+/).filter(x => x.startsWith('https://')).map(x => x.slice(8));
  for (const host of allowed) assert.ok(used.has(host), `${host} is allowed but never used`);
});

test('the installed app caches only files that exist', () => {
  const shell = read('app/sw.js').match(/const SHELL = \[([^\]]+)\]/)[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
  for (const file of shell.filter(f => f !== './'))
    assert.ok(existsSync(new URL('../app/' + file, import.meta.url)), file + ' is listed in sw.js but missing');
});

/* ---------------- music ---------------- */

function fakeMusic() {
  const log = [];
  return { log, music: {
    station: null, volume: 0.6,
    async play(id) { log.push(['play', id]); this.station = id; return true; },
    pause() { log.push(['pause']); this.station = null; },
    async resume() { log.push(['resume']); return true; },
    setVolume(v) { this.volume = Math.max(0.05, Math.min(1, v)); },
  } };
}

test('music plays inside Jarvis, and YouTube only when asked for', async () => {
  const { Skills, opened } = boot();
  const { log, music } = fakeMusic();
  const ctx = { stopSpeaking() {}, setMuted() {}, announce() {}, music };
  const ask = q => Skills.handle(q, ctx);
  assert.match((await ask('play some music')).say, /^Playing Groove Salad/);
  assert.match((await ask('play lo-fi')).say, /^Playing Fluid/);
  assert.match((await ask('play jazz')).say, /^Playing Sonic Universe/);
  assert.match((await ask('play coding music')).say, /^Playing DEF CON Radio/);
  assert.deepEqual(log.map(l => l[1]), ['groovesalad', 'fluid', 'sonicuniverse', 'defcon']);
  assert.equal(opened.length, 0, 'nothing opened in a new tab');
  // A particular song: radio plays, and the reply says how to get the song on YouTube
  assert.match((await ask('play bohemian rhapsody')).say, /can't play a particular song.*on YouTube/);
  assert.match((await ask("what's playing")).say, /Sweet Apathy by Zero Cult/);
  assert.match((await ask('next station')).say, /^Switching to/);
  await ask('volume up');
  assert.ok(music.volume > 0.6);
  await ask('stop the music');
  assert.equal(log.at(-1)[0], 'pause');
  await ask('play lo-fi on youtube');
  assert.equal(opened[0], 'https://www.youtube.com/results?search_query=lo-fi');
});

test('plain "stop" silences music as well as speech', async () => {
  const { Skills } = boot();
  const { log, music } = fakeMusic();
  await Skills.handle('play music', { stopSpeaking() {}, setMuted() {}, music });
  await Skills.handle('stop', { stopSpeaking() {}, setMuted() {}, music });
  assert.equal(log.at(-1)[0], 'pause');
});

test('the landing-page demo, which has no player, explains instead of failing', async () => {
  const { Skills } = boot();
  const r = await Skills.handle('play some jazz', { demo: true, stopSpeaking() {}, setMuted() {} });
  assert.match(r.say, /In the full app I would start Sonic Universe/);
});

/* ---------------- small talk and dates ---------------- */

test('small talk is answered instantly, without the network', async () => {
  const { ask, calls } = boot();
  for (const q of ['how are you', 'who are you', 'what is your name', 'are you there', 'you are awesome', 'good night'])
    assert.ok((await ask(q)).say.length > 5, q);
  assert.equal(calls.length, 0);
});

test('days until a holiday or a date', async () => {
  const { ask } = boot();
  assert.match((await ask('how many days until christmas')).say, /^(\d+ days? until christmas|That's today)/);
  assert.match((await ask('days until march 3rd')).say, /^(\d+ days? until march 3rd|That's today)/);
  assert.match((await ask('how long until 1 january')).say, /^(\d+ days? until 1 january|That's today)/);
});

test('"tell me something interesting" reads a moment from history', async () => {
  const { ask } = boot();
  assert.equal((await ask('tell me something interesting')).say, 'On this day in 1969, apollo 11 lands on the Moon.');
});

/* ---------------- the brain ---------------- */

test('open questions without an AI say how to get one, instead of a random article', async () => {
  const { ask, calls } = boot();
  assert.match((await ask('write me a poem about rain')).say, /needs a thinking brain.*Settings/);
  assert.match((await ask('what should i eat for dinner')).say, /needs a thinking brain/);
  assert.equal(calls.filter(c => c.includes('wikipedia')).length, 0, 'no pointless Wikipedia search');
});

test("Chrome's built-in AI answers when it is on, with Wikipedia facts in the prompt", async () => {
  const prompts = [];
  const LanguageModel = {
    availability: async () => 'available',
    create: async ({ initialPrompts }) => ({ prompt: async p => { prompts.push([initialPrompts[0].content, p]); return 'An AI answer.'; }, destroy() {} }),
  };
  const { Skills, Brain, ask, calls } = boot({}, { extra: { LanguageModel } });
  assert.equal(Skills.brain(), 'Wikipedia finder');
  assert.equal(await Brain.chromeStatus(), 'available');
  assert.equal(Skills.brain(), 'Chrome AI, on device');
  const fact = await ask('who is alan turing');
  assert.equal(fact.say, 'An AI answer.');
  assert.match(prompts[0][0], /^You are Jarvis/);
  assert.match(prompts[0][1], /Facts that may help[\s\S]*English mathematician[\s\S]*Question: who is alan turing/);
  assert.equal(fact.card.link.href, 'https://en.wikipedia.org/wiki/Alan_Turing', 'the answer cites its source');
  const searches = calls.length;
  assert.equal((await ask('write me a poem about rain')).say, 'An AI answer.');
  assert.equal(prompts[1][1], 'write me a poem about rain', 'creative requests go straight to the model');
  assert.equal(calls.length, searches, 'and need no web search');
});

test('without any AI, factual questions get the sentence that answers them', async () => {
  const { Brain } = boot();
  const pages = [
    { title: 'Australian Capital Territory', url: 'u1', text: 'The Australian Capital Territory (ACT), known as the Federal Capital Territory until 1938, is an internal territory of Australia. Canberra, the capital city of Australia, is situated within the territory.' },
    { title: 'Canberra', url: 'u2', text: 'Canberra is the capital city of Australia. Founded following the federation of the colonies of Australia, it is the largest inland city.' },
  ];
  assert.match(Brain.pick('what is the capital of australia', pages).say, /^Canberra/);
  const moon = [{ title: 'Moon', url: 'm', text: "The Moon is Earth's only natural satellite. It orbits at an average distance of 384,400 km (238,900 mi), about 30 times the diameter of Earth." }];
  assert.match(Brain.pick('how far is the moon', moon).say, /384,400 km/);
  assert.equal(Brain.kind('how far is the moon'), 'fact');
  for (const q of ['write me a poem', 'what should i eat for dinner', 'can you help me plan a trip', 'what do you think about cats'])
    assert.equal(Brain.kind(q), 'open', q);
  assert.equal(JSON.stringify(Brain.sentences('It is 3.5 km long. St. Louis is a city. Done.')), JSON.stringify(['It is 3.5 km long.', 'St. Louis is a city.', 'Done.']));   // JSON: arrays from the sandbox are another realm
});

/* ---------------- the PC companion ---------------- */

// A fake companion that behaves like companion/jarvis_companion.py: code 123456, token "tok", apps notepad and spotify.
function fakeCompanion({ approved = ['open_app', 'open_folder', 'media', 'volume', 'lock'] } = {}) {
  const done = [];
  const handler = (path, init) => {
    const authed = init.headers && init.headers.Authorization === 'Bearer tok';
    if (path === '/status') return { status: 200, data: { paired: !!authed } };
    if (path === '/apps') return authed ? { status: 200, data: { apps: ['notepad', 'spotify'] } } : { status: 401, data: { error: 'not_paired' } };
    const body = JSON.parse(init.body || '{}');
    if (path === '/pair') return body.code === '123456' ? { status: 200, data: { token: 'tok' } } : { status: 401, data: { error: 'wrong_code' } };
    if (!authed) return { status: 401, data: { error: 'not_paired' } };
    if (!approved.includes(body.action)) return { status: 403, data: { error: 'needs_approval' } };
    if (body.action === 'open_app' && !['notepad', 'spotify'].includes(body.name)) return { status: 404, data: { error: 'not_listed', apps: ['notepad', 'spotify'] } };
    done.push([body.action, body.name]);
    return { status: 200, data: { ok: true } };
  };
  return { handler, done };
}

test('companion: pairing stores the token, and the data view hides it', async () => {
  const fc = fakeCompanion();
  const { ask, Skills } = boot({}, { companion: fc.handler });
  assert.match((await ask('pair companion 000000')).say, /didn't work/);
  assert.match((await ask('pair companion 123456')).say, /^Paired with the companion/);
  assert.equal(Skills.companionLabel(), 'paired · 2 apps');
  const data = await ask('what do you know about me');
  assert.doesNotMatch(JSON.stringify(data), /\btok\b/);
  assert.match(JSON.stringify(data), /saved \(hidden\)/);
});

test('companion: opens listed apps, folders, media and volume; websites still open as websites', async () => {
  const fc = fakeCompanion();
  const { ask, Skills, opened } = boot({ companionToken: 'tok' }, { companion: fc.handler });
  await Skills.probeCompanion();
  assert.equal((await ask('open spotify')).say, 'Opening spotify.');
  assert.equal((await ask('launch the notepad app')).say, 'Opening notepad.');
  await ask('open youtube');                                  // not an app on the list: the website, as before
  assert.equal(opened[0], 'https://www.youtube.com');
  await ask('open my downloads folder');
  await ask('next song');
  await ask('pause the music');
  await ask('volume up');
  await ask('mute the sound');
  await ask('lock the computer');
  assert.deepEqual(fc.done, [['open_app', 'spotify'], ['open_app', 'notepad'], ['open_folder', 'downloads'], ['media', 'next'],
    ['media', 'playpause'], ['volume', 'up'], ['volume', 'mute'], ['lock', '']]);
});

test("companion: while Jarvis's radio plays, music words control the radio", async () => {
  const fc = fakeCompanion();
  const { Skills } = boot({ companionToken: 'tok' }, { companion: fc.handler });
  await Skills.probeCompanion();
  const { log, music } = fakeMusic();
  const ctx = { stopSpeaking() {}, setMuted() {}, music };
  await Skills.handle('play jazz', ctx);
  await Skills.handle('next song', ctx);
  await Skills.handle('volume up', ctx);
  await Skills.handle('pause the music', ctx);
  assert.deepEqual(fc.done, [], 'nothing went to the computer');
  assert.equal(log.at(-1)[0], 'pause');
  await Skills.handle('system volume up', ctx);               // "system" always means the computer
  assert.deepEqual(fc.done, [['volume', 'up']]);
});

test('companion: plain "mute" still means stop listening', async () => {
  const fc = fakeCompanion();
  let muted = false;
  const { Skills } = boot({ companionToken: 'tok' }, { companion: fc.handler });
  await Skills.handle('mute', { stopSpeaking() {}, setMuted: m => { muted = m; } });
  assert.equal(muted, true);
  assert.deepEqual(fc.done, []);
});

test('companion: helpful replies when it is missing, unpaired, unapproved or the app is unknown', async () => {
  assert.match((await boot().ask('lock the computer')).say, /needs the Jarvis companion/);
  const unpaired = boot({}, { companion: fakeCompanion().handler });
  assert.match((await unpaired.ask('lock the computer')).say, /not paired yet/);
  const strict = boot({ companionToken: 'tok' }, { companion: fakeCompanion({ approved: [] }).handler });
  assert.match((await strict.ask('lock the computer')).say, /approve that in the companion window/);
  const fc = fakeCompanion();
  const b = boot({ companionToken: 'tok' }, { companion: fc.handler });
  await b.Skills.probeCompanion();
  assert.match((await b.ask('open my documents')).say, /^Opening your documents folder/);
});

test('companion: the landing-page demo can never reach it', async () => {
  const fc = fakeCompanion();
  const { Skills, calls } = boot({ companionToken: 'tok' }, { companion: fc.handler });
  const demo = { demo: true, stopSpeaking() {}, setMuted() {} };
  assert.match((await Skills.handle('lock the computer', demo)).say, /works in the full app/);
  assert.match((await Skills.handle('pair companion 123456', demo)).say, /works in the full app/);
  assert.equal(calls.filter(c => c.includes('8765')).length, 0);
  assert.doesNotMatch(read('site/vite.config.js'), /8765/, 'the website is not allowed to contact the companion');
  assert.match(read('app/index.html'), /connect-src[^;]*http:\/\/127\.0\.0\.1:8765/, 'the app is');
  assert.match(read('docs/PRIVACY.md'), /127\.0\.0\.1:8765/);
});
