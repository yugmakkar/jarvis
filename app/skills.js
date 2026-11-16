/* Skills: turns a command sentence into an action + a reply.
 *
 * Every skill returns { say, card?, sleep? }:
 *   say   - what Jarvis speaks (keep it short; long speech feels slow)
 *   card  - optional data for the Display panel: { title, big?, text?, rows?, list?, link?, until? }
 *           (until = a timestamp; the panel shows a live countdown to it)
 *   also  - optional { text, lang }: a second phrase spoken in another language (used by translate)
 *   sleep - true if Jarvis should NOT keep listening for a follow-up
 *
 * To add a skill, add one entry to ROUTES: a regex and a function. First match wins.
 */
const Skills = (() => {
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem('jarvis.' + k)) ?? d; } catch { return d; } },
    set(k, v) { localStorage.setItem('jarvis.' + k, JSON.stringify(v)); },
    // Everything Jarvis has saved on this device, and a way to wipe it. Nothing is stored anywhere else.
    all() { const out = {}; for (const k of Object.keys(localStorage)) if (k.startsWith('jarvis.') && store.get(k.slice(7)) != null) out[k.slice(7)] = store.get(k.slice(7)); return out; },
    erase() { for (const k of Object.keys(localStorage)) if (k.startsWith('jarvis.')) localStorage.removeItem(k); },
  };
  const sir = () => store.get('name', 'sir');
  const titleCase = text => text.replace(/\b[a-z]/g, c => c.toUpperCase());

  /* ---------------- wake word ---------------- */
  // Speech recognisers regularly mishear "Jarvis", so the default wake word accepts its common mis-hearings.
  // A custom wake word (Settings) is matched exactly.
  const HEARD_AS = "jarvis's|jarvis|jarvish|jarvas|jarves|jarvus|jarvi|jervis|javis|jarbis|charvis|travis|jar vis";
  const wakeWords = () => { const w = String(store.get('wake', 'jarvis')).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim(); return !w || w === 'jarvis' ? HEARD_AS : w; };

  // Is this sentence addressed to the assistant?
  //   null  -> no, ignore it        ''  -> just the wake word, start listening
  //   'xyz' -> the command, whether it came after the wake word ("Jarvis, time") or before it ("what time is it, Jarvis")
  function wake(transcript) {
    const text = transcript.toLowerCase().trim();
    const m = text.match(new RegExp('^(.*?)\\b(?:hey |ok |okay |hi )?(?:' + wakeWords() + ')\\b[,.!?]*\\s*(.*)$'));
    if (!m) return null;
    const before = m[1].replace(/\b(hey|ok|okay|hi|um|uh)\b|[,.!?]/g, ' ').trim(), after = m[2].trim();
    return after || (before.split(/\s+/).length >= 2 ? before : '');
  }

  async function getJSON(url, headers, timeoutMs = 8000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers, signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(timer); }
  }
  const sentences = (text, n) => text.split(/(?<=[.!?])\s+/).slice(0, n).join(' ');

  /* ---------------- web data ---------------- */

  const WMO = [[0, 'clear skies'], [2, 'partly cloudy'], [3, 'overcast'], [48, 'fog'], [57, 'drizzle'], [67, 'rain'],
    [77, 'snow'], [82, 'rain showers'], [86, 'snow showers'], [99, 'thunderstorms']];
  const sky = code => (WMO.find(([max]) => code <= max) || [0, 'unsettled'])[1];

  function locate() {
    return new Promise((ok, fail) => navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(p => ok(p.coords), fail, { timeout: 6000 })
      : fail());
  }

  async function weather(city) {
    let place, lat, lon;
    city = city || store.get('city');
    if (city) {
      const geo = await getJSON('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(city));
      const hit = geo.results && geo.results[0];
      if (!hit) return { say: `I couldn't find a place called ${city}, ${sir()}.` };
      ({ latitude: lat, longitude: lon } = hit);
      place = hit.name + (hit.country_code ? ', ' + hit.country_code : '');
    } else {
      try { ({ latitude: lat, longitude: lon } = await locate()); place = 'your location'; }
      catch { return { say: `Which city, ${sir()}? Try "weather in Delhi", or tell me "my city is Delhi".` }; }
    }
    const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code' +
      '&daily=temperature_2m_max,temperature_2m_min&timezone=auto');
    const c = w.current, temp = Math.round(c.temperature_2m), desc = sky(c.weather_code);
    return {
      say: `It's ${temp} degrees with ${desc} in ${place}. Feels like ${Math.round(c.apparent_temperature)}.`,
      card: {
        title: 'Weather · ' + place, big: temp + '°C', text: desc,
        rows: [['Feels like', Math.round(c.apparent_temperature) + '°C'], ['Humidity', c.relative_humidity_2m + '%'],
          ['Wind', Math.round(c.wind_speed_10m) + ' km/h'],
          ['High / Low', Math.round(w.daily.temperature_2m_max[0]) + '° / ' + Math.round(w.daily.temperature_2m_min[0]) + '°']],
      },
    };
  }

  async function wiki(query) {
    const s = await getJSON('https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&origin=*&srsearch=' +
      encodeURIComponent(query));
    const title = s.query && s.query.search[0] && s.query.search[0].title;
    if (!title) return null;
    const p = await getJSON('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_')));
    if (!p.extract) return null;
    return {
      say: sentences(p.extract, 2).length > 220 ? sentences(p.extract, 1) : sentences(p.extract, 2),   // keep speech brief
      card: { title: p.title, text: sentences(p.extract, 4),
        link: p.content_urls && { href: p.content_urls.desktop.page, text: 'Read on Wikipedia' } },
    };
  }

  async function news() {
    const ids = await getJSON('https://hacker-news.firebaseio.com/v0/topstories.json');
    const items = await Promise.all(ids.slice(0, 5).map(id => getJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
    const titles = items.filter(Boolean).map(i => i.title);
    return { say: `Top tech stories right now. ${titles.slice(0, 3).join('. ')}.`, card: { title: 'Tech headlines', list: titles } };
  }

  async function define(word) {
    try {
      const d = await getJSON('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word));
      const m = d[0].meanings[0];
      return { say: `${word}: ${m.definitions[0].definition}`,
        card: { title: `${d[0].word} · ${m.partOfSpeech}`, text: m.definitions[0].definition } };
    } catch (err) {
      if (err.message !== 'HTTP 404') throw err;   // 404 = unknown word; anything else is a real failure
      return { say: `I have no definition for ${word}, ${sir()}.` };
    }
  }

  async function joke() {
    const j = await getJSON('https://icanhazdadjoke.com/', { Accept: 'application/json' });
    return { say: j.joke, card: { title: 'Humour module', text: j.joke } };
  }

  /* ---------------- local tasks ---------------- */

  const SITES = { youtube: 'https://www.youtube.com', google: 'https://www.google.com', gmail: 'https://mail.google.com',
    mail: 'https://mail.google.com', maps: 'https://maps.google.com', github: 'https://github.com',
    wikipedia: 'https://www.wikipedia.org', netflix: 'https://www.netflix.com', spotify: 'https://open.spotify.com',
    whatsapp: 'https://web.whatsapp.com', twitter: 'https://x.com', x: 'https://x.com', reddit: 'https://www.reddit.com',
    instagram: 'https://www.instagram.com', linkedin: 'https://www.linkedin.com', amazon: 'https://www.amazon.com' };

  function openUrl(url, say) {
    const win = window.open(url, '_blank');
    if (win) { win.opener = null; return { say }; }
    // Browsers block tabs opened without a click, which is exactly what a voice command is.
    return { say: `The browser blocked the new tab, ${sir()}. Allow pop-ups for this page, or use the link on the display.`,
      card: { title: 'Blocked pop-up', link: { href: url, text: url } } };
  }

  function openSite(name) {
    const key = name.toLowerCase().replace(/^the\s+|\s+website$|\.com$/g, '').trim();
    const url = SITES[key] || (/\.[a-z]{2,}$/.test(key) ? 'https://' + key.replace(/\s+/g, '') : `https://www.${key.replace(/\s+/g, '')}.com`);
    return openUrl(url, `Opening ${key}.`);
  }

  /* ---------------- timers and reminders ---------------- */
  // One list for both, saved on the device, so a reminder survives a reload or restarting the app.

  const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60, ninety: 90, half: 0.5 };
  const SECONDS = { second: 1, sec: 1, minute: 60, min: 60, hour: 3600 };
  const amountOf = word => Number(String(word).replace(/,/g, '')) || WORDS[word] || 0;
  const SPAN = '(?:\\d+(?:\\.\\d+)?|[a-z-]+) ?(?:second|sec|minute|min|hour)s?';   // "10 minutes", "half hour"
  const WHEN = '(in ' + SPAN + '|at \\d{1,2}(?::\\d{2})? ?(?:a\\.?m\\.?|p\\.?m\\.?)?)';
  const clock = at => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  let host = null, ticker = 0;

  // The UI calls attach(ctx) once. From then on, due reminders are announced through ctx.announce.
  function attach(ctx) {
    host = ctx;
    if (!ticker) ticker = setInterval(tick, 1000);
    tick();
  }
  function tick() {
    if (!host) return;
    const now = Date.now(), all = store.get('reminders', []), due = all.filter(r => r.at <= now);
    if (!due.length) return;
    store.set('reminders', all.filter(r => r.at > now));
    for (const r of due) {
      const missed = now - r.at > 60000 ? ' you missed' : '';
      const say = r.timer ? `Your ${r.text} timer is complete, ${sir()}.` : `A reminder${missed}, ${sir()}: ${r.text}.`;
      host.announce(say, { title: r.timer ? 'Timer' : 'Reminder', big: r.timer ? 'Done' : undefined, text: r.text });
      try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Jarvis', { body: r.timer ? r.text + ' timer complete' : r.text }); } catch { /* notifications are optional */ }
    }
  }
  function schedule(at, text, isTimer) {
    store.set('reminders', [...store.get('reminders', []), { at, text, timer: !!isTimer }].sort((x, y) => x.at - y.at));
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission(); } catch { /* optional */ }
  }

  function timer(amount, unit) {
    const n = amountOf(amount);
    if (!n) return { say: `For how long, ${sir()}?` };
    const label = `${n} ${{ sec: 'second', min: 'minute' }[unit] || unit}${n === 1 ? '' : 's'}`;
    const at = Date.now() + n * SECONDS[unit] * 1000;
    schedule(at, label, true);
    return { say: `Timer set for ${label}.`, card: { title: 'Timer · ' + label, until: at } };
  }

  // "in 10 minutes" or "at 5:30 pm" -> a timestamp, or null if it cannot be understood
  function parseWhen(text) {
    let m = text.match(/^in (\d+(?:\.\d+)?|[a-z-]+) ?(second|sec|minute|min|hour)s?$/);
    if (m) { const n = amountOf(m[1]); return n ? Date.now() + n * SECONDS[m[2]] * 1000 : null; }
    m = text.match(/^at (\d{1,2})(?::(\d{2}))? ?(a\.?m\.?|p\.?m\.?)?$/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] || 0), half = m[3] && m[3][0];
    if (h > 23 || min > 59 || (half && h > 12)) return null;
    if (half === 'p' && h < 12) h += 12;
    if (half === 'a' && h === 12) h = 0;
    // "at 5" with no am/pm means the next 5 o'clock, morning or evening
    const midnight = new Date().setHours(0, 0, 0, 0);
    const hours = half || h >= 12 ? [h, h + 24] : [h, h + 12, h + 24];
    return hours.map(x => midnight + (x * 60 + min) * 60000).find(t => t > Date.now());
  }

  function remind(rest) {
    const first = rest.match(new RegExp('^' + WHEN + ' (?:to |that )?(.+)$'));                 // "in 10 minutes to stretch"
    const last = first ? null : rest.match(new RegExp('^(?:to |that )?(.+) ' + WHEN + '$'));   // "to stretch in 10 minutes"
    const when = first ? first[1] : last && last[2], what = first ? first[2] : last && last[1];
    const at = when && parseWhen(when);
    if (!at) return { say: `When, ${sir()}? Try "remind me in 20 minutes to stretch" or "remind me at 5 pm to call home".` };
    schedule(at, what, false);
    return { say: `I'll remind you at ${clock(at)}: ${what}.`, card: { title: 'Reminder · ' + clock(at), text: what, until: at } };
  }

  function listReminders() {
    const all = store.get('reminders', []);
    if (!all.length) return { say: 'Nothing is scheduled.' };
    const lines = all.map(r => `${clock(r.at)} · ${r.timer ? r.text + ' timer' : r.text}`);
    return { say: `You have ${all.length} scheduled. Next at ${clock(all[0].at)}: ${all[0].timer ? 'a timer' : all[0].text}.`, card: { title: 'Scheduled', list: lines } };
  }

  /* ---------------- conversions ---------------- */

  const UNIT_TABLE = {   // every size is in the dimension's base unit
    length: { 'millimeter|millimetre|mm': .001, 'centimeter|centimetre|cm': .01, 'meter|metre|m': 1, 'kilometer|kilometre|km': 1000,
      'inch|in': .0254, 'foot|feet|ft': .3048, 'yard|yd': .9144, 'mile|mi': 1609.344 },
    mass: { 'milligram|mg': 1e-6, 'gram|g': .001, 'kilogram|kilo|kg': 1, 'ounce|oz': .0283495, 'pound|lb': .453592, 'tonne|ton': 1000 },
    volume: { 'milliliter|millilitre|ml': .001, 'liter|litre|l': 1, 'teaspoon|tsp': .00492892, 'tablespoon|tbsp': .0147868,
      'cup': .236588, 'pint': .473176, 'gallon': 3.78541 },
    data: { 'byte': 1, 'kilobyte|kb': 1e3, 'megabyte|mb': 1e6, 'gigabyte|gb': 1e9, 'terabyte|tb': 1e12 },
    time: { 'second': 1, 'minute': 60, 'hour': 3600, 'day': 86400, 'week': 604800 },
  };
  const UNITS = {};
  for (const [dim, table] of Object.entries(UNIT_TABLE))
    for (const [names, size] of Object.entries(table))
      for (const name of names.split('|')) UNITS[name] = { dim, size, label: names.split('|')[0] };
  const TEMPS = { celsius: 'C', centigrade: 'C', c: 'C', fahrenheit: 'F', f: 'F', kelvin: 'K', k: 'K' };
  const CURRENCIES = { dollar: 'USD', buck: 'USD', rupee: 'INR', euro: 'EUR', pound: 'GBP', yen: 'JPY', yuan: 'CNY', dirham: 'AED',
    franc: 'CHF', won: 'KRW', peso: 'MXN', 'canadian dollar': 'CAD', 'australian dollar': 'AUD', 'singapore dollar': 'SGD', 'us dollar': 'USD' };
  const lookup = (table, word) => { const w = word.replace(/^degrees? /, ''); return table[w] || table[w.replace(/s$/, '')] || table[w.replace(/es$/, '')]; };
  const currencyOf = word => lookup(CURRENCIES, word) || (/^[a-z]{3}$/.test(word) && !lookup(UNITS, word) ? word.toUpperCase() : undefined);
  const tidy = v => String(+v.toPrecision(6));
  const plural = (label, n) => (n === 1 ? label : label === 'foot' ? 'feet' : label === 'inch' ? 'inches' : label + 's');

  async function convert(amount, from, to) {
    const n = amountOf(amount);
    if (!n && Number(amount) !== 0) return null;
    const a = lookup(UNITS, from), b = lookup(UNITS, to), ta = lookup(TEMPS, from), tb = lookup(TEMPS, to);
    if (ta && tb) {
      const celsius = ta === 'C' ? n : ta === 'F' ? (n - 32) * 5 / 9 : n - 273.15;
      const out = tidy(tb === 'C' ? celsius : tb === 'F' ? celsius * 9 / 5 + 32 : celsius + 273.15);
      return { say: `${n} degrees ${ta} is ${out} degrees ${tb}.`, card: { title: 'Conversion', big: `${out} °${tb}`, text: `${n} °${ta}` } };
    }
    if (a && b && a.dim === b.dim) {
      const out = tidy(n * a.size / b.size);
      return { say: `${n} ${plural(a.label, n)} is ${out} ${plural(b.label, Number(out))}.`,
        card: { title: 'Conversion', big: `${out} ${plural(b.label, Number(out))}`, text: `${n} ${plural(a.label, n)}` } };
    }
    const ca = currencyOf(from), cb = currencyOf(to);
    if (!ca || !cb) return null;   // not something we can convert: let other skills try
    const data = await getJSON(`https://api.frankfurter.dev/v1/latest?base=${ca}&symbols=${cb}`);
    const out = (n * data.rates[cb]).toFixed(2);
    return { say: `${n} ${ca} is ${out} ${cb}.`, card: { title: 'Currency · rates of ' + data.date, big: `${out} ${cb}`, text: `${n} ${ca}` } };
  }

  /* ---------------- translate ---------------- */

  const LANGS = { spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', dutch: 'nl', russian: 'ru', turkish: 'tr',
    arabic: 'ar', hindi: 'hi', bengali: 'bn', punjabi: 'pa', gujarati: 'gu', marathi: 'mr', tamil: 'ta', telugu: 'te', urdu: 'ur',
    japanese: 'ja', korean: 'ko', chinese: 'zh-CN' };

  async function translate(phrase, language) {
    const lang = LANGS[language];
    if (!lang) return { say: `I can't translate into ${language} yet, ${sir()}.` };
    const data = await getJSON(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(phrase)}&langpair=en|${lang}`);
    const out = data.responseData && data.responseData.translatedText;
    if (!out) return { say: `I couldn't translate that, ${sir()}.` };
    return { say: `In ${titleCase(language)}:`, also: { text: out, lang }, card: { title: `English → ${titleCase(language)}`, big: out, text: phrase } };
  }

  /* ---------------- daily briefing ---------------- */

  async function briefing() {
    const now = new Date();
    const parts = [`Good ${partOfDay()}, ${sir()}. It's ${clock(now)} on ${now.toLocaleDateString([], { weekday: 'long' })}.`];
    const list = [now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })];
    // Each section is optional: one failing service must not sink the whole briefing.
    if (store.get('city')) { try { const w = await weather(); parts.push(w.say); list.push(w.say); } catch { /* skip weather */ } }
    try { const n = await news(); parts.push(`In tech: ${n.card.list.slice(0, 2).join('. ')}.`); list.push(...n.card.list.slice(0, 3)); } catch { /* skip news */ }
    const pending = store.get('reminders', []).filter(r => !r.timer), notes = store.get('notes', []);
    if (pending.length) { parts.push(`You have ${pending.length} reminder${pending.length > 1 ? 's' : ''}, the next at ${clock(pending[0].at)}.`); list.push(...pending.map(r => `${clock(r.at)} · ${r.text}`)); }
    if (notes.length) parts.push(`And ${notes.length} note${notes.length > 1 ? 's' : ''} on file.`);
    if (!store.get('city')) parts.push('Tell me "my city is" and a place, and I will include the weather.');
    return { say: parts.join(' '), card: { title: 'Briefing', list } };
  }

  function myData() {
    const data = store.all(), keys = Object.keys(data);
    if (!keys.length) return { say: `Nothing, ${sir()}. I have stored no data about you.` };
    const rows = keys.map(k => [k, Array.isArray(data[k]) ? `${data[k].length} item${data[k].length === 1 ? '' : 's'}` : String(data[k])]);
    return { say: `Only what is on the display, ${sir()}, and it is stored on this device alone. Open Settings to erase it.`, card: { title: 'Stored on this device', rows } };
  }

  function math(text) {
    const expr = text.toLowerCase()
      .replace(/what is|what's|calculate|compute|how much is|equals?|[?=,]/g, ' ')
      .replace(/plus/g, '+').replace(/minus/g, '-').replace(/times|multiplied by|x(?=\s*\d)/g, '*')
      .replace(/divided by|over/g, '/').replace(/to the power of/g, '**').replace(/squared/g, '**2')
      .replace(/percent of/g, '/100*').trim();
    if (!/^[\d\s+\-*/().]+$/.test(expr) || !/\d\s*[+\-*/]/.test(expr)) return null;   // not arithmetic
    try {
      const v = evaluate(expr);
      if (!Number.isFinite(v)) return null;
      const out = String(+v.toFixed(6));
      return { say: `That's ${out}.`, card: { title: 'Calculation', big: out, text: expr } };
    } catch { return null; }
  }

  // A tiny arithmetic parser. Text is never evaluated as code: the Content-Security-Policy forbids it,
  // and spoken or typed text must not be able to run as code.
  function evaluate(src) {
    const tok = src.match(/\d+\.?\d*|\*\*|[+\-*/()]/g) || [];
    let i = 0;
    const atom = () => {
      const t = tok[i++];
      if (t === '(') { const v = sum(); if (tok[i++] !== ')') throw new Error('unbalanced'); return v; }
      if (t === '-') return -atom();
      if (t === '+') return atom();
      if (t === undefined || !/^\d/.test(t)) throw new Error('unexpected');
      return parseFloat(t);
    };
    const power = () => { const base = atom(); return tok[i] === '**' ? (i++, base ** power()) : base; };
    const product = () => { let v = power(); while (tok[i] === '*' || tok[i] === '/') v = tok[i++] === '*' ? v * power() : v / power(); return v; };
    const sum = () => { let v = product(); while (tok[i] === '+' || tok[i] === '-') v = tok[i++] === '+' ? v + product() : v - product(); return v; };
    const v = sum();
    if (i < tok.length) throw new Error('trailing');
    return v;
  }

  /* ---------------- optional local AI brain (Ollama) ---------------- */
  // If the user runs Ollama (free, https://ollama.com) on this machine, open-ended questions go to it.
  // It is addressed at localhost only, so prompts never leave the computer. Without it, Jarvis uses Wikipedia.

  const OLLAMA = 'http://localhost:11434';
  const PERSONA = 'You are Jarvis, a concise, dry-witted assistant. Your reply is spoken aloud: answer in at most two short sentences, no markdown, no lists.';
  let model = null;
  const history = [];   // short conversation memory, kept in RAM only

  async function probeBrain() {
    try {
      const tags = await getJSON(OLLAMA + '/api/tags', undefined, 1500);
      const names = (tags.models || []).map(m => m.name);
      const chosen = store.get('model');
      model = names.includes(chosen) ? chosen : names[0] || null;
    } catch { model = null; }
    return model;
  }
  const brain = () => model ? 'local · ' + model.slice(0, 16) : 'built-in skills';

  async function askBrain(text) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60000);
    try {
      const r = await fetch(OLLAMA + '/api/chat', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: PERSONA }, ...history, { role: 'user', content: text }] }) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const answer = (await r.json()).message.content.trim();
      history.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
      history.splice(0, Math.max(0, history.length - 8));
      return { say: answer, card: { title: 'Local AI · ' + model, text: answer } };
    } finally { clearTimeout(timer); }
  }

  async function systemRows() {
    const rows = [['Network', navigator.onLine ? 'online' : 'offline']];
    const c = navigator.connection;
    if (c && c.effectiveType) rows.push(['Link', `${c.effectiveType} · ${c.downlink} Mbps`]);
    if (navigator.getBattery) {
      try { const b = await navigator.getBattery(); rows.push(['Power', Math.round(b.level * 100) + '%' + (b.charging ? ' ⚡' : '')]); } catch {}
    }
    if (navigator.hardwareConcurrency) rows.push(['Cores', String(navigator.hardwareConcurrency)]);
    if (navigator.deviceMemory) rows.push(['Memory', '≥ ' + navigator.deviceMemory + ' GB']);
    return rows;
  }

  const notesCard = () => ({ title: 'Notes', list: store.get('notes', []) });
  const partOfDay = () => { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; };

  /* ---------------- router ---------------- */

  const ROUTES = [
    [/^(stop|quiet|silence|cancel|never ?mind|shut up)$/, (m, ctx) => { ctx.stopSpeaking(); return { say: '', sleep: true }; }],
    [/^(go to sleep|sleep|stop listening|mute|goodbye|bye)$/, (m, ctx) => { ctx.setMuted(true); return { say: `Going quiet, ${sir()}. Click the core to wake me.`, sleep: true }; }],
    [/^(help|what can you do|commands)\b/, () => ({ say: 'I can brief you on your day, check weather, look things up, set timers and reminders, convert units and currency, translate, take notes and open websites.',
      card: { title: 'Capabilities', list: EXAMPLES } })],
    [/^(good morning|brief me|briefing|daily briefing|my briefing|what did i miss|how is my day)$/, briefing],
    [/^(hi|hello|hey|good (morning|afternoon|evening))\b/, () => ({ say: `Good ${partOfDay()}, ${sir()}. How can I help?` })],
    [/^(thanks|thank you)\b/, () => ({ say: `Always a pleasure, ${sir()}.`, sleep: true })],
    [/^use (?:the )?model (.+)$/, async m => { store.set('model', m[1].replace(/\s+/g, '')); return { say: (await probeBrain()) ? `Local brain online, using ${model}.` : 'I cannot reach a local model. Is Ollama running?' }; }],
    [/^(?:my name is|call me) (.+)$/, m => { const name = titleCase(m[1]); store.set('name', name); return { say: `Understood. I'll call you ${name}.` }; }],
    [/^my city is (.+)$/, m => { const city = titleCase(m[1]); store.set('city', city); return { say: `Noted. ${city} is now your home city.` }; }],
    [/what do you (know|remember|store|have) (about|on) me|^(show )?my data$/, myData],
    [/\b(what|tell).*\btime\b|^time$/, () => { const t = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return { say: `It's ${t}.`, card: { title: 'Time', big: t } }; }],
    [/\b(what|tell).*\b(date|day)\b|^(date|today)$/, () => { const d = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return { say: `Today is ${d}.`, card: { title: 'Date', text: d } }; }],
    [/\b(?:weather|temperature|forecast)\b(?:.*?\b(?:in|at|for) (.+))?/, m => weather(m[1] && m[1].replace(/\b(today|right now|now)\b/g, '').trim())],
    [/^(?:cancel|clear|delete|stop) (?:all |my |the )*(?:reminders?|timers?|alarms?)$/, () => { store.set('reminders', []); return { say: 'All timers and reminders cancelled.', sleep: true }; }],
    [/timer (?:for |of )?(\d+(?:\.\d+)?|[a-z-]+) ?(second|sec|minute|min|hour)s?/, m => timer(m[1], m[2])],
    [/^(?:remind me|set a reminder|set an alarm|wake me up?) (.+)$/, m => remind(m[1])],
    [/\b(reminders|timers|alarms|scheduled)\b/, listReminders],
    [/^(?:convert |what is |what's |how much is )?(\d[\d,.]*|an?|one|half) (.+?) (?:to|in|into) (.+)$/, m => convert(m[1], m[2], m[3])],
    [/^how many (.+?) (?:are |is )?in (\d[\d,.]*|an?|one) (.+)$/, m => convert(m[2], m[3], m[1])],
    [/^translate (.+?) (?:to|into|in) ([a-z]+)$|^how do (?:you|i) say (.+?) in ([a-z]+)$/, m => translate(m[1] || m[3], m[2] || m[4])],
    [/^(flip|toss) a coin$/, () => { const side = Math.random() < 0.5 ? 'Heads' : 'Tails'; return { say: side + '.', card: { title: 'Coin', big: side } }; }],
    [/^roll (a |the )?(dice|die)$/, () => { const n = 1 + Math.floor(Math.random() * 6); return { say: `You rolled a ${n}.`, card: { title: 'Dice', big: String(n) } }; }],
    [/^(?:take a note|note|remember)(?: that)? (.+)$/, m => { store.set('notes', [...store.get('notes', []), m[1]]); return { say: 'Noted.', card: notesCard() }; }],
    [/^(clear|delete) (my |all )?notes$/, () => { store.set('notes', []); return { say: 'Notes cleared.' }; }],
    [/\bnotes\b/, () => { const n = store.get('notes', []); return n.length ? { say: `You have ${n.length} note${n.length > 1 ? 's' : ''}. ${n.join('. ')}.`, card: notesCard() } : { say: 'You have no notes.' }; }],
    [/^play (.+?)(?: on youtube)?$/, m => openUrl('https://www.youtube.com/results?search_query=' + encodeURIComponent(m[1]), `Pulling up ${m[1]} on YouTube.`)],
    [/^(?:search(?: the web)?(?: for)?|google|look up) (.+)$/, m => openUrl('https://www.google.com/search?q=' + encodeURIComponent(m[1]), `Searching for ${m[1]}.`)],
    [/^(?:open|launch|go to) (.+)$/, m => openSite(m[1])],
    [/\b(news|headlines)\b/, news],
    [/^(?:define|what does) (.+?)(?: mean)?$|^(?:meaning|definition) of (.+)$/, m => define(m[1] || m[2])],
    [/\bjoke\b/, joke],
    [/\b(system|status|diagnostics|battery)\b/, async () => { const rows = await systemRows();
      return { say: `All systems nominal, ${sir()}. ${rows.map(r => r.join(' ')).slice(0, 2).join(', ')}.`, card: { title: 'Diagnostics', rows } }; }],
  ];

  const EXAMPLES = ['Brief me', 'Weather in Mumbai', 'Who is Alan Turing', 'Remind me in 10 minutes to stretch', 'Convert 100 dollars to rupees',
    'Translate good morning to Spanish', 'How many grams in a pound', 'What is 18 times 24', 'Tech news', 'Play lo-fi music', 'What do you know about me'];

  async function handle(raw, ctx) {
    if (ctx && !host) attach(ctx);
    const text = raw.toLowerCase().trim().replace(new RegExp('^(?:hey |ok |okay |hi )?(?:' + wakeWords() + ')\\b[,.!?]*\\s*'), '')
      .replace(/^(please |can you |could you |would you )+|( please)?[.?!]*$/g, '').trim();
    if (!text) return { say: `Yes, ${sir()}?` };
    try {
      for (const [pattern, run] of ROUTES) {
        const m = text.match(pattern);
        if (!m) continue;
        const reply = await run(m, ctx);
        if (reply) return reply;   // a skill may return null to say "not mine", and the next one gets a try
      }
      const sum = math(text);
      if (sum) return sum;
      // Anything unrecognised is a question. Plain "who is / what is" goes to Wikipedia (fast, sourced);
      // everything else goes to the local AI brain when one is running.
      const factual = /^(who|what|where) (is|are|was|were) |^tell me about |^(search )?wikipedia /.test(text);
      const topic = text.replace(/^(who|what|where) (is|are|was|were) |^tell me about |^(search )?wikipedia (for )?/, '').replace(/^(a|an|the) /, '');
      if (model && !factual) return await askBrain(text);
      return (await wiki(topic)) || (model && await askBrain(text)) || { say: `I'm afraid I don't have anything on that, ${sir()}.` };
    } catch (err) {
      console.error(err);
      return { say: `I couldn't reach that service, ${sir()}. Check the connection and try again.` };
    }
  }

  return { handle, wake, attach, systemRows, probeBrain, brain, settings: store, examples: EXAMPLES };
})();
