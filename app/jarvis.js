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

  /* ---------------- wake word ---------------- */

  // Decides whether a heard sentence is addressed to Jarvis.
  // Returns null  -> not for us, ignore it
  //         ''    -> just the wake word ("Jarvis"), so start listening for a command
  //         'xyz' -> the command that followed the wake word
  // TODO(human): make this robust to how the recogniser actually mishears "Jarvis".
  function extractWakeCommand(transcript) {
    const m = transcript.toLowerCase().match(/\bjarvis\b[,.!?]?\s*(.*)$/);
    return m ? m[1].trim() : null;
  }

  /* ---------------- state + UI ---------------- */

  function setState(s) {
    state = s;
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
    if (c.text) add('p', c.text);
    if (c.rows) { const dl = add('dl', ''); for (const [k, v] of c.rows) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; dl.append(dt, dd); } }
    if (c.list) { const ol = add('ol', ''); for (const item of c.list) { const li = document.createElement('li'); li.textContent = item; ol.append(li); } }
    if (c.link && /^https:\/\//.test(c.link.href)) { const a = add('a', c.link.text); a.href = c.link.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    $('cards').replaceChildren(el);
  }

  /* ---------------- speaking ---------------- */

  function pickVoice() {
    const all = speechSynthesis.getVoices();
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

  function speak(text) {
    $('caption').textContent = text;
    if (!text || !window.speechSynthesis) return Promise.resolve();
    return new Promise(resolve => {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = 1.05; u.pitch = 0.9;
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
    if (id !== turn) return;
    if (reply.sleep) { armedUntil = 0; idle(); } else arm();
  }

  function onHeard(text) {
    if (!text) return;
    const wake = extractWakeCommand(text);
    const armed = Date.now() < armedUntil;
    if (wake === null && !armed) { $('heard').textContent = text; return; }   // background chatter
    const command = wake === null ? text : wake;
    if (command) run(command);
    else { chirp(); $('caption').textContent = 'Listening…'; arm(); }
  }

  /* ---------------- hearing ---------------- */

  function startRecognition() {
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = /^en/.test(navigator.language) ? navigator.language : 'en-US';
    rec.onresult = e => {
      if (state === 'speaking' || state === 'thinking' || Date.now() < deafUntil) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) onHeard(t); else interim += t + ' ';
      }
      if (interim) $('heard').textContent = interim;
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        micBlocked = true; setMuted(true);
        $('caption').textContent = 'Microphone access is blocked. Allow it in the address bar, or type commands below.';
      }
    };
    // The browser stops recognition after a silence; restarting makes it "always on".
    rec.onend = () => { recRunning = false; if (!muted) setTimeout(listen, 250); };
    listen();
  }

  function listen() {
    if (!rec || recRunning || muted) return;
    try { rec.start(); recRunning = true; } catch { /* already started */ }
  }

  function setMuted(m) {
    muted = m;
    $('micBtn').setAttribute('aria-pressed', String(m));
    if (m) { armedUntil = 0; if (rec && recRunning) rec.abort(); }
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
    const rows = [['Voice input', !SR ? 'unsupported' : micBlocked ? 'blocked' : muted ? 'muted' : 'active'],
      ['Voice output', window.speechSynthesis ? (voice ? voice.name.replace(/Microsoft |Google /, '').slice(0, 18) : 'default') : 'none'],
      ['Brain', Skills.brain()],
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
    if (text) run(text);
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
    await Promise.all([initAudio(), Skills.probeBrain()]);
    setState('standby');
    if (SR && !micBlocked) startRecognition(); else setMuted(true);
    refreshSystems();
    const h = new Date().getHours();
    const hello = `Good ${h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}. All systems online.` +
      (SR && !micBlocked ? ' Say Jarvis, followed by a command.' : ' Voice input is unavailable, so type your commands.');
    const id = ++turn;
    log('ai', hello);
    await speak(hello);
    if (id === turn) idle();
  }, { once: true });
})();
