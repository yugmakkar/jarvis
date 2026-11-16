/* Skills: turns a command sentence into an action + a reply.
 *
 * Every skill returns { say, card?, sleep? }:
 *   say   - what Jarvis speaks (keep it short; long speech feels slow)
 *   card  - optional data for the Display panel: { title, big?, text?, rows?, list?, link? }
 *   sleep - true if Jarvis should NOT keep listening for a follow-up
 *
 * To add a skill, add one entry to ROUTES: a regex and a function. First match wins.
 */
const Skills = (() => {
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem('jarvis.' + k)) ?? d; } catch { return d; } },
    set(k, v) { localStorage.setItem('jarvis.' + k, JSON.stringify(v)); },
  };
  const sir = () => store.get('name', 'sir');

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

  const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
  const UNIT = { second: 1, minute: 60, hour: 3600 };
  function timer(amount, unit, ctx) {
    const n = Number(amount) || WORDS[amount];
    if (!n) return { say: `For how long, ${sir()}?` };
    const label = `${n} ${unit}${n === 1 ? '' : 's'}`;
    setTimeout(() => ctx.announce(`${sir()}, your ${label} timer is complete.`, { title: 'Timer', big: 'Done', text: label }),
      n * UNIT[unit] * 1000);
    return { say: `Timer set for ${label}.`, card: { title: 'Timer running', big: label } };
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

  // A tiny arithmetic parser. We never use eval(): the Content-Security-Policy forbids it,
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
    [/^(help|what can you do|commands)\b/, () => ({ say: 'I can check weather, look things up, read headlines, define words, do maths, set timers, take notes and open websites.',
      card: { title: 'Capabilities', list: EXAMPLES } })],
    [/^(hi|hello|hey|good (morning|afternoon|evening))\b/, () => ({ say: `Good ${partOfDay()}, ${sir()}. How can I help?` })],
    [/^(thanks|thank you)\b/, () => ({ say: `Always a pleasure, ${sir()}.`, sleep: true })],
    [/^use (?:the )?model (.+)$/, async m => { store.set('model', m[1].replace(/\s+/g, '')); return { say: (await probeBrain()) ? `Local brain online, using ${model}.` : 'I cannot reach a local model. Is Ollama running?' }; }],
    [/^(?:my name is|call me) (.+)$/, m => { store.set('name', m[1]); return { say: `Understood. I'll call you ${m[1]}.` }; }],
    [/^my city is (.+)$/, m => { store.set('city', m[1]); return { say: `Noted. ${m[1]} is now your home city.` }; }],
    [/\b(what|tell).*\btime\b|^time$/, () => { const t = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return { say: `It's ${t}.`, card: { title: 'Time', big: t } }; }],
    [/\b(what|tell).*\b(date|day)\b|^(date|today)$/, () => { const d = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return { say: `Today is ${d}.`, card: { title: 'Date', text: d } }; }],
    [/\b(?:weather|temperature|forecast)\b(?:.*?\b(?:in|at|for) (.+))?/, m => weather(m[1] && m[1].replace(/\b(today|right now|now)\b/g, '').trim())],
    [/timer (?:for |of )?(\d+|[a-z]+) (second|minute|hour)s?/, (m, ctx) => timer(m[1], m[2], ctx)],
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

  const EXAMPLES = ['Weather in Mumbai', 'Who is Alan Turing', 'Tech news', 'What is 18 times 24', 'Set a timer for 10 seconds',
    'Define serendipity', 'Remember to call mom', 'Open YouTube', 'Tell me a joke', 'System status'];

  async function handle(raw, ctx) {
    const text = raw.toLowerCase().trim().replace(/^(hey |ok |okay )?jarvis[,.!]?\s*/, '')
      .replace(/^(please |can you |could you |would you )+|( please)?[.?!]*$/g, '').trim();
    if (!text) return { say: `Yes, ${sir()}?` };
    try {
      for (const [pattern, run] of ROUTES) {
        const m = text.match(pattern);
        if (m) return await run(m, ctx);
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

  return { handle, systemRows, probeBrain, brain, examples: EXAMPLES };
})();
