// Tests for the assistant's brain (app/skills.js). Run with:  node --test tests/
//
// skills.js is a plain browser script, so each test loads it into a sandbox with a fake
// localStorage and a fake fetch that returns canned answers. No test touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const SOURCE = read('app/skills.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Canned replies, matched by a piece of the URL. Order matters: the first match wins.
const FAKE = {
  'geocoding-api.open-meteo.com': { results: [{ name: 'Mumbai', country_code: 'IN', latitude: 19, longitude: 72 }] },
  'api.open-meteo.com': {
    current: { temperature_2m: 29.4, apparent_temperature: 32, relative_humidity_2m: 60, wind_speed_10m: 12, weather_code: 0 },
    daily: { temperature_2m_max: [33], temperature_2m_min: [24] },
  },
  'w/api.php': { query: { search: [{ title: 'Alan Turing' }] } },
  'page/summary': { title: 'Alan Turing', extract: 'Alan Turing was an English mathematician. He was influential.',
    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Alan_Turing' } } },
  'topstories.json': [1, 2, 3, 4, 5],
  '/item/': { title: 'A headline' },
  'dictionaryapi.dev': [{ word: 'serendipity', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A happy accident.' }] }] }],
  'icanhazdadjoke.com': { joke: 'A joke.' },
  'frankfurter.dev': { date: '2026-11-16', rates: { INR: 90, USD: 1.25 } },
  'mymemory': { responseData: { translatedText: 'buenos días' } },
};

function boot(saved = {}, { offline = false } = {}) {
  // A storage object whose only enumerable keys are the stored items, like the real localStorage.
  const localStorage = {};
  Object.defineProperties(localStorage, {
    getItem: { value: k => (k in localStorage ? localStorage[k] : null) },
    setItem: { value: (k, v) => { localStorage[k] = String(v); } },
    removeItem: { value: k => { delete localStorage[k]; } },
  });
  for (const [k, v] of Object.entries(saved)) localStorage['jarvis.' + k] = JSON.stringify(v);

  const calls = [], said = [], opened = [];
  const fetch = async url => {
    calls.push(String(url));
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
  });
  vm.runInContext(SOURCE + '\n;globalThis.__skills = Skills;', sandbox);
  const Skills = sandbox.__skills;
  const ctx = { stopSpeaking() {}, setMuted() {}, announce: say => said.push(say) };
  return { Skills, ask: text => Skills.handle(text, ctx), ctx, calls, said, opened };
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
  await ask('play lo-fi music');
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
