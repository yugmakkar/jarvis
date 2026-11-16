/* Core: hears (SpeechRecognition), decides (Skills.handle), speaks (speechSynthesis), and draws the reactor. */
(() => {
  const $ = id => document.getElementById(id);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const FOLLOW_UP_MS = 8000;   // after a reply, keep listening this long without needing the wake word

  let state = 'offline';       // offline | standby | listening | thinking | speaking | muted
  let muted = false, micBlocked = false;
  let rec = null, recRunning = false;
  let armedUntil = 0, armTimer = 0;   // "armed" = next sentence is a command, no wake word needed
  let deafUntil = 0;                  // ignore the mic briefly after speaking so Jarvis doesn't hear himself
  let turn = 0;                       // increments per command; stale async replies check it and bail out
  let analyser = null, audioCtx = null, voice = null;

  /* ---------------- state + UI ---------------- */

  function setState(s) {
    state = s;
    music.duck(s === 'listening' || s === 'thinking' || s === 'speaking');   // quieter while he listens or talks
    document.body.dataset.state = s;
    $('statePill').textContent = s.toUpperCase();
  }
  const idle = () => setState(muted ? 'muted' : Date.now() < armedUntil ? 'listening' : 'standby');

  function arm(ms = FOLLOW_UP_MS) {
    armedUntil = Date.now() + ms;
    clearTimeout(armTimer);
    armTimer = setTimeout(idle, ms + 50);
    idle();
  }

  function log(who, text) {
    const row = document.createElement('div');
    row.className = who;
    row.textContent = text;
    $('log').prepend(row);
    while ($('log').children.length > 40) $('log').lastChild.remove();
  }

  // Cards are built with textContent only: web data must never be inserted as HTML.
  function showCard(c) {
    const el = document.createElement('div');
    el.className = 'card';
    const add = (tag, text, cls) => { const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; el.append(n); return n; };
    add('h3', c.title);
    if (c.big) add('div', c.big, 'big');
    if (c.until) countdown(add('div', '', 'big'), c.until);
    if (c.text) add('p', c.text);
    if (c.rows) { const dl = add('dl', ''); for (const [k, v] of c.rows) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; dl.append(dt, dd); } }
    if (c.list) { const ol = add('ol', ''); for (const item of c.list) { const li = document.createElement('li'); li.textContent = item; ol.append(li); } }
    if (c.link && /^https:\/\//.test(c.link.href)) { const a = add('a', c.link.text); a.href = c.link.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    $('cards').replaceChildren(el);
  }

  function countdown(node, until) {   // live m:ss display; stops when time is up or the card is replaced
    const paint = () => {
      const left = Math.max(0, Math.round((until - Date.now()) / 1000)), pad = n => String(n).padStart(2, '0');
      node.textContent = left >= 3600 ? `${Math.floor(left / 3600)}:${pad(Math.floor(left % 3600 / 60))}:${pad(left % 60)}` : `${Math.floor(left / 60)}:${pad(left % 60)}`;
      return left;
    };
    paint();
    const timer = setInterval(() => { if (!paint() || !node.isConnected) clearInterval(timer); }, 500);
  }

  /* ---------------- music (free SomaFM radio; the stream hosts are the only audio sources the CSP allows) ---------------- */

  const music = (() => {
    const audio = new Audio();
    audio.preload = 'none';
    let id = null, urls = [], tried = 0, level = Number(Skills.settings.get('musicVolume', 0.6)), ducked = false;
    const apply = () => { audio.volume = Math.max(0, Math.min(1, level * (ducked ? 0.25 : 1))); };
    audio.addEventListener('error', () => {   // a stream host dropped mid-play: move to the next one
      if (id && !audio.paused && ++tried < urls.length) { audio.src = urls[tried]; audio.play().catch(() => {}); }
    });
    return {
      // Resolves true when sound is playing, 'click' if the browser wants a click first, false if no host answered.
      async play(station) {
        id = station; urls = Skills.streamUrls(station); apply();
        for (tried = 0; tried < urls.length; tried++) {
          audio.src = urls[tried];
          try { await audio.play(); return true; } catch (err) { if (err && err.name === 'NotAllowedError') return 'click'; }
        }
        id = null;
        return false;
      },
      pause() { audio.pause(); },
      async resume() { if (!id) return false; try { await audio.play(); return true; } catch { return false; } },
      setVolume(v) { level = Math.max(0.05, Math.min(1, v)); Skills.settings.set('musicVolume', level); apply(); },
      duck(on) { ducked = on; apply(); },
      get volume() { return level; },
      get station() { return audio.paused ? null : id; },
    };
  })();

  /* ---------------- speaking ---------------- */

  function pickVoice() {
    if (!window.speechSynthesis) return;
    const all = speechSynthesis.getVoices();
    voice = all.find(v => v.name === Skills.settings.get('voice')) || null;   // the user's choice in Settings wins
    if (voice) return;
    const wanted = [/Google UK English Male/, /Microsoft (Ryan|George|Thomas)/, /en-GB/, /^en/];
    for (const w of wanted) { const v = all.find(v => w.test(v.name) || w.test(v.lang)); if (v) { voice = v; return; } }
  }

  function chirp() {   // short acknowledgement tone; much quicker than saying "Yes, sir?"
    if (!audioCtx) return;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime;
    o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1320, t + 0.12);
    g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.2);
  }

  function speak(text, lang) {   // lang is set only for translations, so they are pronounced by a matching voice
    $('caption').textContent = text;
    if (!text || !window.speechSynthesis || !Skills.settings.get('speech', true)) return Promise.resolve();
    return new Promise(resolve => {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (lang) { u.lang = lang; const match = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())); if (match) u.voice = match; }
      else if (voice) u.voice = voice;
      u.rate = Number(Skills.settings.get('rate', 1.05)) || 1.05; u.pitch = 0.9;
      let finished = false;
      const done = () => { if (finished) return; finished = true; clearTimeout(guard); deafUntil = Date.now() + 400; resolve(); };
      const guard = setTimeout(done, 25000);   // some browsers never fire onend
      u.onend = u.onerror = done;
      setState('speaking');
      speechSynthesis.speak(u);
    });
  }

  /* ---------------- the command loop ---------------- */

  const ctx = {
    stopSpeaking() { if (window.speechSynthesis) speechSynthesis.cancel(); },
    setMuted,
    music,
    async announce(say, card) {   // for things that happen later, like a timer finishing
      const id = ++turn;
      if (card) showCard(card);
      log('ai', say);
      await speak(say);
      if (id === turn) idle();
    },
  };

  async function run(text) {
    const id = ++turn;
    $('heard').textContent = '';
    log('you', text);
    setState('thinking');
    const reply = await Skills.handle(text, ctx);
    if (id !== turn) return;            // a newer command arrived while we were fetching
    if (reply.card) showCard(reply.card);
    if (reply.say) { log('ai', reply.say); await speak(reply.say); }
    if (reply.also && id === turn) { log('ai', reply.also.text); await speak(reply.also.text, reply.also.lang); }
    if (id !== turn) return;
    if (reply.sleep) { armedUntil = 0; idle(); } else arm();
  }

  function onHeard(text) {
    if (!text) return;
    const wake = Skills.wake(text);
    const armed = Date.now() < armedUntil;
    if (wake === null && !armed) { $('heard').textContent = text; return; }   // background chatter
    const command = wake === null ? text : wake;
    if (command) run(command);
    else { chirp(); $('caption').textContent = 'Listening…'; arm(); }
  }

  /* ---------------- hearing ---------------- */

  // hearing.mode: 'local' = audio never leaves the device; 'cloud' = the browser's online speech service; 'off'.
  let hearing = { mode: 'off', lang: 'en-US' };
  let failures = 0;   // consecutive errors with no speech heard; grows the restart delay so errors cannot loop

  function startRecognition(mode, lang) {
    if (rec) { rec.onend = rec.onerror = rec.onresult = null; try { rec.abort(); } catch { /* not running */ } rec = null; recRunning = false; }
    hearing = { mode, lang };
    refreshSystems();
    if (mode === 'off') return;
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    if (mode === 'local') rec.processLocally = true;   // the browser must not send audio anywhere
    rec.onresult = e => {
      failures = 0;
      if (state === 'speaking' || state === 'thinking' || Date.now() < deafUntil) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) onHeard(t); else interim += t + ' ';
      }
      if (interim) $('heard').textContent = interim;
    };
    rec.onerror = e => {
      const next = Hearing.onError(e.error, hearing.mode, Skills.settings.get('voiceMode', 'prefer'));
      if (next === 'retry') { failures++; return; }
      if (next === 'blocked') {
        micBlocked = true; startRecognition('off', lang); setMuted(true);
        $('caption').textContent = 'Microphone access is blocked. Allow it in the address bar, or type commands below.';
      } else if (next === 'cloud') {
        startRecognition('cloud', lang);
        log('ai', 'On-device speech recognition failed, so I am using the browser’s online speech service.');
      } else {
        startRecognition('off', lang); setMuted(true);
        $('caption').textContent = 'On-device speech recognition is unavailable here, so voice input is off. Type your commands below.';
      }
    };
    // The browser stops recognition after a silence; restarting makes it "always on".
    // After repeated errors (offline, no speech service) wait longer between attempts: 250 ms up to 30 s.
    rec.onend = () => { recRunning = false; if (!muted) setTimeout(listen, Math.min(30000, 250 * 2 ** failures)); };
    listen();
  }

  function listen() {
    if (!rec || recRunning || muted) return;
    try { rec.start(); recRunning = true; } catch { /* already started */ }
  }

  // Picks local / cloud / off from the browser's abilities and the user's setting. If an on-device pack can be
  // downloaded, the browser fetches it in the background and Jarvis switches to it when it is ready.
  async function setUpHearing() {
    const setting = Skills.settings.get('voiceMode', 'prefer');
    const choice = await Hearing.choose(SR, { navLang: navigator.language, setting });
    startRecognition(micBlocked ? 'off' : choice.mode, choice.lang);
    if (hearing.mode === 'off' && !muted) setMuted(true);
    if (!choice.installable || micBlocked) return choice;
    hearing.installing = true; refreshSystems();
    Hearing.install(SR, choice.installable).then(ok => {
      hearing.installing = false;
      if (ok && Skills.settings.get('voiceMode', 'prefer') !== 'cloud') {
        const wasOff = hearing.mode === 'off';
        startRecognition('local', choice.installable);
        if (wasOff && muted && !micBlocked) setMuted(false);   // "on-device only" kept the mic off until now
        ctx.announce('On-device speech recognition is ready. What you say no longer leaves this computer.'); }
      else refreshSystems();
    });
    return choice;
  }

  function setMuted(m) {
    muted = m;
    $('micBtn').setAttribute('aria-pressed', String(m));
    if (m) { armedUntil = 0; if (rec && recRunning) rec.abort(); }
    else if (!rec && SR && state !== 'offline') { micBlocked = false; setUpHearing(); }   // was off: try again
    else { micBlocked = false; listen(); }
    if (state !== 'speaking' && state !== 'thinking') idle();
  }

  async function initAudio() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.75;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
    } catch { micBlocked = true; }
  }

  /* ---------------- reactor (drawing lives in reactor.js, shared with the landing page) ---------------- */

  const canvas = $('orb');
  Reactor.mount(canvas, () => ({ state, analyser, muted }));

  /* ---------------- side panels ---------------- */

  function tick() {
    const now = new Date();
    $('clock').textContent = now.toLocaleTimeString([], { hour12: false });
    $('date').textContent = now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
  }
  async function refreshSystems() {
    const rows = [['Wake word', Skills.settings.get('wake', 'jarvis')], ['Voice input', !SR ? 'unsupported' : micBlocked ? 'blocked' : muted ? 'muted' : 'active'],
      ['Recognition', hearing.installing ? 'downloading pack' : Hearing.label(hearing.mode)],
      ['Voice output', window.speechSynthesis ? (voice ? voice.name.replace(/Microsoft |Google /, '').slice(0, 18) : 'default') : 'none'],
      ['Brain', Skills.brain()],
      ['Music', music.station ? Skills.stationName(music.station) : 'off'],
      ...await Skills.systemRows()];
    $('sys').replaceChildren(...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; return [dt, dd];
    }));
  }
  tick(); setInterval(tick, 1000);
  refreshSystems(); setInterval(refreshSystems, 5000);

  for (const example of Skills.examples) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = example;
    b.onclick = () => run(example);
    $('chips').append(b);
  }

  /* ---------------- wiring ---------------- */

  $('cmdForm').addEventListener('submit', e => {
    e.preventDefault();
    const text = $('cmdInput').value.trim();
    $('cmdInput').value = '';
    if (text) { past.push(text); cursor = past.length; run(text); }
  });
  // Arrow up / down recalls earlier commands, like a terminal.
  const past = []; let cursor = 0;
  $('cmdInput').addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' && cursor > 0) { e.preventDefault(); $('cmdInput').value = past[--cursor]; }
    else if (e.key === 'ArrowDown') { cursor = Math.min(past.length, cursor + 1); $('cmdInput').value = past[cursor] || ''; }
  });

  // Push-to-talk: tap Space (when not typing) and speak a command without the wake word.
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat || state === 'offline' || $('settings').open || /INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) return;
    e.preventDefault();
    if (state === 'speaking') { turn++; ctx.stopSpeaking(); }
    if (muted) setMuted(false);
    chirp(); $('caption').textContent = 'Listening…'; arm();
  });

  /* ---------------- settings (everything is saved in this browser only) ---------------- */

  function openSettings() {
    const s = Skills.settings;
    $('setName').value = s.get('name', '');
    $('setCity').value = s.get('city', '');
    $('setWake').value = s.get('wake', 'jarvis');
    $('setRate').value = s.get('rate', 1.05);
    $('setSpeech').checked = s.get('speech', true);
    $('setRecog').value = s.get('voiceMode', 'prefer');
    showAiStatus();
    const voices = window.speechSynthesis ? speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)) : [];
    $('setVoice').replaceChildren(new Option('Automatic', ''), ...voices.map(v => new Option(`${v.name} (${v.lang})`, v.name)));
    $('setVoice').value = s.get('voice', '');
    $('settings').showModal();
  }
  $('settingsBtn').addEventListener('click', openSettings);

  // Chrome's built-in AI: free and on-device. Chrome downloads the model once, and only after this click.
  const AI_TEXT = {
    available: ['On. Questions are answered by an AI model running on this computer.', ''],
    downloadable: ['Off. Chrome can download its free on-device model (a one-time download of a few gigabytes, so use Wi-Fi). Nothing is billed, and questions never leave this computer.', 'Turn on built-in AI'],
    downloading: ['Chrome is downloading the model. This can take a while; Jarvis keeps working meanwhile.', ''],
    unavailable: ['This computer or Chrome version can\u2019t run Chrome\u2019s built-in AI. It needs Chrome 148 or later, about 22 GB free disk space, and a GPU with over 4 GB of memory or 16 GB of RAM. Ollama is a free alternative.', ''],
    unsupported: ['This browser has no built-in AI. In Chrome 148 or later you can turn it on here. Ollama is a free alternative.', ''],
  };
  async function showAiStatus() {
    const st = await Brain.chromeStatus();
    const [text, button] = AI_TEXT[st] || AI_TEXT.unavailable;
    $('aiStatus').textContent = Skills.brain().startsWith('Ollama') ? `Using Ollama (${Skills.brain().slice(9)}). ${text}` : text;
    $('aiBtn').hidden = !button; $('aiBtn').textContent = button;
  }
  $('aiBtn').addEventListener('click', async () => {
    $('aiBtn').disabled = true;
    $('aiStatus').textContent = 'Starting the download in Chrome\u2026';
    try {
      await Brain.enableChrome(Skills.persona(), loaded => { $('aiStatus').textContent = `Downloading the on-device model: ${Math.round(loaded * 100)}%`; });
      refreshSystems();
      ctx.announce('Built-in AI is on. Ask me anything, and the answer is worked out on this computer.');
      $('settings').close();
    } catch (err) {
      $('aiStatus').textContent = 'Chrome could not start its built-in AI: ' + (err && err.message || err);
    } finally { $('aiBtn').disabled = false; }
  });
  $('cancelBtn').addEventListener('click', () => $('settings').close());
  $('settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const s = Skills.settings, text = id => $(id).value.trim();
    s.set('name', text('setName') || null);   // null = "not set", so the default applies again
    s.set('city', text('setCity') || null);
    s.set('wake', text('setWake').toLowerCase() || null);
    s.set('voice', $('setVoice').value || null);
    s.set('rate', Number($('setRate').value));
    s.set('speech', $('setSpeech').checked);
    const recogChanged = $('setRecog').value !== s.get('voiceMode', 'prefer');
    s.set('voiceMode', $('setRecog').value === 'prefer' ? null : $('setRecog').value);
    $('settings').close();
    let note = '';
    if (recogChanged && SR && state !== 'offline') {
      micBlocked = false; muted = false; $('micBtn').setAttribute('aria-pressed', 'false');
      const c = await setUpHearing();
      note = hearing.mode === 'local' ? ' Speech recognition now runs on this device.'
        : c.installable ? ' Downloading on-device speech recognition.'
        : hearing.mode === 'off' ? ' On-device speech recognition is not available in this browser, so voice input is off.' : '';
    }
    pickVoice(); refreshSystems();
    ctx.announce(`Settings saved. I answer to ${s.get('wake', 'jarvis')}.${note}`);
  });
  $('eraseBtn').addEventListener('click', () => {
    if (!confirm('Erase everything Jarvis has saved on this device (name, city, notes, reminders, settings)? This cannot be undone.')) return;
    Skills.settings.erase();
    pickVoice(); refreshSystems();
    $('settings').close();
    ctx.announce('All stored data has been erased.');
  });
  $('micBtn').addEventListener('click', () => setMuted(!muted));
  canvas.addEventListener('click', () => {
    if (state === 'speaking') { turn++; ctx.stopSpeaking(); idle(); }   // click the core to interrupt
    else setMuted(!muted);
  });

  // Service worker = the app shell is cached, so the installed app opens instantly and offline.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  if (!SR) $('bootNote').textContent = 'This browser has no speech recognition, so voice input is off. Typed commands still work. Use Chrome or Edge for voice.';

  $('initBtn').addEventListener('click', async () => {
    $('boot').classList.add('gone');
    await Promise.all([initAudio(), Skills.probeBrain(), Brain.chromeStatus()]);
    setState('standby');
    const choice = SR && !micBlocked ? await setUpHearing() : (setMuted(true), { mode: 'off' });
    refreshSystems();
    const h = new Date().getHours();
    const where = choice.mode === 'local' ? ' Speech recognition runs on this device.'
      : choice.installable ? ' I am downloading on-device speech recognition in the background.' : '';
    const hello = `Good ${h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}. All systems online.` +
      (hearing.mode !== 'off' ? ` Say ${Skills.settings.get('wake', 'jarvis')}, followed by a command.${where}`
        : SR && !micBlocked && choice.reason !== 'unsupported' ? ' On-device speech recognition is not available in this browser, and you chose not to use an online service, so type your commands.'
        : ' Voice input is unavailable, so type your commands.');
    const id = ++turn;
    log('ai', hello);
    await speak(hello);
    if (id === turn) idle();
    Skills.attach(ctx);   // start the reminder clock; anything that came due while Jarvis was closed is announced now
  }, { once: true });
})();
