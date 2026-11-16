/* global Reactor, Skills */
import { useEffect, useRef, useState } from 'react';
import DecryptedText from './reactbits/DecryptedText.jsx';
import ShinyText from './reactbits/ShinyText.jsx';
import SpotlightCard from './reactbits/SpotlightCard.jsx';
import StarBorder from './reactbits/StarBorder.jsx';
import CountUp from './reactbits/CountUp.jsx';
import DotGrid from './reactbits/DotGrid.jsx';

const REPO = 'https://github.com/yugmakkar/jarvis';
const ACCENT = '#4fd8ff';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- content ---------- */

// Scripted lines for the demo reel. They are labelled "simulated" on the page; the moment a
// visitor types or clicks a suggestion, the console switches to the real skills and live data.
const REEL = [
  ['Jarvis, weather in Tokyo', "It's 14 degrees with clear skies in Tokyo. Feels like 12."],
  ['Jarvis, who is Ada Lovelace', 'Ada Lovelace was an English mathematician, known for her work on the Analytical Engine.'],
  ['Jarvis, what is 18 times 24', "That's 432."],
  ['Jarvis, set a timer for ten minutes', 'Timer set for 10 minutes.'],
];
const TRY = ['Weather in Mumbai', 'Who is Alan Turing', 'Tech news', 'Define serendipity', 'What is 18 times 24', 'Tell me a joke'];

const CAPABILITIES = [
  ['Wakes to its name', 'Say "Jarvis" and it listens. It answers out loud, then stays attentive for a few seconds so follow-ups feel like conversation.'],
  ['Live answers from the web', 'Weather anywhere, Wikipedia knowledge, tech headlines and dictionary definitions, fetched the moment you ask.'],
  ['Gets small things done', 'Timers, notes, maths, the time, opening sites and searches. The everyday errands you would rather say than type.'],
  ['A brain that stays home', 'Run a free local model with Ollama and open questions are answered on your own hardware. Nothing is sent to a cloud AI.'],
  ['Installs like an app', 'One click in Chrome or Edge puts it in its own window with its own icon. The interface loads offline.'],
  ['Yours to rewire', 'Every skill is one line: a pattern and a function. No framework, no build step, about 650 lines of JavaScript you can read in a sitting.'],
];

const CONNECTIONS = [
  ['Open-Meteo', 'You ask about weather', 'The city name, or your coordinates if you allow location'],
  ['Wikipedia', 'You ask who or what something is', 'Your search words'],
  ['Hacker News', 'You ask for headlines', 'Nothing about you'],
  ['Free Dictionary API', 'You ask for a definition', 'The word'],
  ['icanhazdadjoke', 'You ask for a joke', 'Nothing about you'],
  ['Ollama on localhost', 'Optional local AI brain', 'Your question, to your own computer only'],
];

const STEPS = [
  ['Get the code', 'git clone https://github.com/yugmakkar/jarvis.git', 'Or download the ZIP from GitHub. You need Python 3, which is free, for the tiny local server.'],
  ['Start it', 'cd jarvis && start.bat', 'On macOS or Linux run ./start.sh instead. Jarvis opens at localhost:5173 in your browser.'],
  ['Install it', 'Address bar → Install J.A.R.V.I.S.', 'Chrome and Edge show an install icon in the address bar. After that it launches from your Start menu or dock.'],
];

/* ---------- small pieces ---------- */

const Arrow = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12 12 4M5.5 4H12v6.5" />
  </svg>
);
const GitHubMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 .2a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.33.66.07-.52.28-.87.5-1.07-1.77-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 .2Z" />
  </svg>
);

function ReactorCanvas({ stateRef, className, label }) {
  const ref = useRef(null);
  useEffect(() => { Reactor.mount(ref.current, () => ({ state: stateRef.current })); }, [stateRef]);
  return <canvas ref={ref} className={className} role="img" aria-label={label} />;
}

function CopyLine({ text, copyable = true }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  return (
    <div className="code">
      <code>{text}</code>
      {copyable && <button type="button" onClick={copy} aria-label={`Copy: ${text}`}>{copied ? 'Copied' : 'Copy'}</button>}
    </div>
  );
}

/* ---------- the console: demo reel until touched, then the real thing ---------- */

let uid = 0;
function useConsole() {
  const [lines, setLines] = useState([]);
  const [state, setStateValue] = useState('standby');
  const [live, setLive] = useState(false);
  const stateRef = useRef('standby'), liveRef = useRef(false), turn = useRef(0);
  const setState = s => { stateRef.current = s; setStateValue(s); };
  const push = (who, text) => { const id = ++uid; setLines(l => [...l.slice(-9), { id, who, text }]); return id; };

  useEffect(() => {
    let stop = false;
    (async () => {
      if (reducedMotion) {   // no auto-typing: show one finished exchange instead
        push('you', REEL[0][0]); push('ai', REEL[0][1]);
        return;
      }
      await sleep(1400);
      for (let i = 0; !stop && !liveRef.current; i = (i + 1) % REEL.length) {
        const [question, answer] = REEL[i];
        setState('listening');
        const id = push('you', '');
        for (let n = 1; n <= question.length; n++) {
          if (stop || liveRef.current) return;
          setLines(l => l.map(x => (x.id === id ? { ...x, text: question.slice(0, n) } : x)));
          await sleep(34);
        }
        setState('thinking'); await sleep(750);
        if (stop || liveRef.current) return;
        push('ai', answer); setState('speaking'); await sleep(2400);
        if (stop || liveRef.current) return;
        setState('standby'); await sleep(1300);
      }
    })();
    return () => { stop = true; };
  }, []);

  async function run(text) {
    if (!liveRef.current) { liveRef.current = true; setLive(true); setLines([]); }
    const id = ++turn.current;
    push('you', text);
    setState('thinking');
    const ctx = { stopSpeaking() {}, setMuted() {}, announce: say => push('ai', say) };
    const reply = await Skills.handle(text, ctx);
    if (id !== turn.current) return;
    push('ai', reply.say || 'Done.');
    if (reply.card && reply.card.rows) push('data', reply.card.rows.map(r => r.join(' ')).join('  ·  '));
    setState('speaking');
    await sleep(Math.min(3500, 900 + (reply.say || '').length * 18));
    if (id === turn.current) setState('standby');
  }

  return { lines, state, live, stateRef, run };
}

function Console({ con }) {
  const [value, setValue] = useState('');
  const logRef = useRef(null);
  useEffect(() => { logRef.current.scrollTop = logRef.current.scrollHeight; }, [con.lines]);
  const submit = e => { e.preventDefault(); const text = value.trim(); setValue(''); if (text) con.run(text); };
  return (
    <div className="console" data-state={con.state}>
      <div className="console__bar">
        <span className="console__state">
          <ReactorCanvas stateRef={con.stateRef} className="console__core" label="" />
          {con.state}
        </span>
        <span className="console__mode">{con.live ? 'Live · real data' : 'Demo reel · simulated'}</span>
      </div>
      <div className="console__log" ref={logRef} aria-live="polite">
        {con.lines.map(l => <p key={l.id} className={l.who}>{l.text}</p>)}
      </div>
      <div className="console__try">
        {TRY.map(t => <button key={t} type="button" onClick={() => con.run(t)}>{t}</button>)}
      </div>
      <form onSubmit={submit}>
        <input value={value} onChange={e => setValue(e.target.value)} placeholder="Type a command to run it for real" aria-label="Command" autoComplete="off" />
        <button type="submit" aria-label="Run command"><Arrow /></button>
      </form>
    </div>
  );
}

/* ---------- page ---------- */

export default function App() {
  const con = useConsole();
  return (
    <>
      <header className="nav">
        <a className="wordmark" href="#top">jarvis<sup>mk1</sup></a>
        <nav aria-label="Sections">
          <a href="#demo">Demo</a><a href="#capabilities">Capabilities</a><a href="#privacy">Privacy</a><a href="#install">Install</a>
        </nav>
        <a className="nav__cta" href={REPO} target="_blank" rel="noopener noreferrer"><GitHubMark /> GitHub</a>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero__grid" aria-hidden="true">
            <DotGrid dotSize={2} gap={26} baseColor="#16222c" activeColor={ACCENT} proximity={130} glow={0.3} fade={0.5} clickShock={false} />
          </div>
          <div className="hero__copy">
            <p className="eyebrow">
              <ShinyText text="Open source · Free forever · Runs on your machine" color="#8fa9b6" shineColor="#ffffff" speed={4} />
            </p>
            <h1>
              <span className="line">
                Your own{' '}
                <DecryptedText text="Jarvis." animateOn="view" sequential speed={70} characters="01<>/\\[]{}#*+=" encryptedClassName="enc" />
              </span>
              <span className="line serif">Nobody else&rsquo;s.</span>
            </h1>
            <p className="sub">
              A voice assistant that wakes to its name, answers out loud and pulls live answers from the web.
              It runs in your browser, on your computer. No account, no API key, no bill.
            </p>
            <div className="actions">
              <StarBorder as="a" href="./app/" className="btn-primary" color={ACCENT} backgroundColor="#ffffff" textColor="#030508" radius={999} duration={5} glow={0.8}>
                Launch the live demo <Arrow />
              </StarBorder>
              <a className="btn-ghost" href={REPO} target="_blank" rel="noopener noreferrer"><GitHubMark /> Get the code</a>
            </div>
          </div>
          <div className="hero__core">
            <ReactorCanvas stateRef={con.stateRef} className="reactor" label="The Jarvis reactor core, animating as it listens, thinks and speaks" />
          </div>
          <dl className="strip">
            <div><dt><CountUp to={12} duration={1.4} /></dt><dd>built-in skills</dd></div>
            <div><dt><CountUp to={5} duration={1.4} /></dt><dd>free data sources</dd></div>
            <div><dt>0</dt><dd>trackers or cookies</dd></div>
            <div><dt>0</dt><dd>cost, for you or your users</dd></div>
          </dl>
        </section>

        <section id="demo" className="section demo">
          <div className="section__head">
            <p className="label">01 / Demo</p>
            <h2>Don&rsquo;t take our word. <span className="serif">Ask it something.</span></h2>
            <p>The reel in the console is scripted. Type anything, or pick a suggestion, and the console switches to the real skills with live data. In the full app you say it instead.</p>
            <a className="textlink" href="./app/">Open the full voice version <Arrow /></a>
          </div>
          <Console con={con} />
        </section>

        <section id="capabilities" className="section">
          <div className="section__head wide">
            <p className="label">02 / Capabilities</p>
            <h2>Everything an assistant should do. <span className="serif">Nothing it shouldn&rsquo;t.</span></h2>
          </div>
          <div className="cards">
            {CAPABILITIES.map(([title, body], i) => (
              <SpotlightCard key={title} className="card" spotlightColor="rgba(79, 216, 255, 0.22)" spotlightSize={280}>
                <span className="label">{String(i + 1).padStart(2, '0')}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </SpotlightCard>
            ))}
          </div>
        </section>

        <section id="privacy" className="section privacy">
          <div className="section__head">
            <p className="label">03 / Privacy</p>
            <h2>Private by construction, <span className="serif">not by promise.</span></h2>
            <p>There is no Jarvis server, so there is nowhere for your data to go. Notes, your name and your settings stay in your browser&rsquo;s storage on your device.</p>
            <p>The app ships with a browser-enforced allow-list. It can only contact the services in this table, and only when you ask for that thing.</p>
            <p className="fine">One honest caveat: in Chrome and Edge, turning speech into text is done by the browser maker&rsquo;s speech service, not by Jarvis. Mute the mic and type if you prefer; typed commands involve no speech service at all.</p>
            <a className="textlink" href={`${REPO}/blob/main/docs/PRIVACY.md`} target="_blank" rel="noopener noreferrer">Read the full privacy notes <Arrow /></a>
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Service</th><th>Contacted when</th><th>What is sent</th></tr></thead>
              <tbody>{CONNECTIONS.map(row => <tr key={row[0]}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>

        <section id="install" className="section">
          <div className="section__head wide">
            <p className="label">04 / Install</p>
            <h2>Three steps to your own copy. <span className="serif">Then make it yours.</span></h2>
          </div>
          <ol className="steps">
            {STEPS.map(([title, cmd, note], i) => (
              <li key={title}>
                <span className="label">Step {i + 1}</span>
                <h3>{title}</h3>
                <CopyLine text={cmd} copyable={i < 2} />
                <p>{note}</p>
              </li>
            ))}
          </ol>
          <p className="after">
            Want a different name, voice or skill? Fork it and edit one file.{' '}
            <a className="textlink" href={`${REPO}/blob/main/docs/CUSTOMIZE.md`} target="_blank" rel="noopener noreferrer">Read the customisation guide <Arrow /></a>
          </p>
        </section>
      </main>

      <footer className="footer">
        <span>MIT licensed. A fan-made open-source project, not affiliated with Marvel or Disney.</span>
        <a href={REPO} target="_blank" rel="noopener noreferrer"><GitHubMark /> yugmakkar/jarvis</a>
      </footer>
    </>
  );
}
