/* Brain: answers questions that no built-in skill covers. Three tiers; skills.js uses the best one available.
 *
 *   1. Ollama on this computer, if the user runs it (lives in skills.js)
 *   2. Chrome's built-in AI (Gemini Nano). Runs on the device; Chrome downloads the model once, when the user asks.
 *   3. The answer finder: searches Wikipedia, then picks the sentence that actually answers the question.
 *
 * The finder runs for factual questions even when an AI tier is on: its sentences are handed to the AI as facts,
 * so a small on-device model answers from sources instead of from memory. Nothing here is "trained"; the
 * models are used as they are, and the finder is plain scoring you can read below. */
const Brain = (() => {
  /* ---------------- the answer finder ---------------- */

  const STOP = new Set(('a an the is are was were be been being am of in on at to for from by with about and or but do does did ' +
    'can could would should will shall i me my you your it its this that these those what who whom whose which when where why how ' +
    'much many tell please there their they them he she his her we our us as into than then so if not no just also very really ' +
    'know give show find get let explain describe define meaning mean some any one').split(' '));

  // Question patterns and the words a good answer to them tends to contain. `hint` is added to the search.
  const CUES = [
    { re: /\bhow (far|close)\b|\bdistance\b/, words: ['distance', 'km', 'kilometres', 'kilometers', 'miles', 'away', 'orbit'], hint: 'distance', number: true },
    { re: /\bhow (tall|high)\b|\bheight\b|\belevation\b/, words: ['height', 'metres', 'meters', 'feet', 'tall', 'elevation', 'high', 'm'], hint: 'height', number: true },
    { re: /\bhow (big|large)\b|\barea\b/, words: ['area', 'km2', 'square', 'size', 'largest'], number: true },
    { re: /\bhow (heavy|much does .* weigh)\b|\bweigh\b|\bmass\b/, words: ['mass', 'weight', 'kg', 'kilograms', 'tonnes', 'weighs'], number: true },
    { re: /\bhow old\b|\bage of\b/, words: ['born', 'age', 'aged', 'founded', 'old', 'years'], number: true },
    { re: /\bpopulation\b|\bhow many people\b/, words: ['population', 'inhabitants', 'million', 'billion', 'people', 'populous'], hint: 'population', number: true },
    { re: /\bhow (fast|quick)\b|\bspeed\b/, words: ['speed', 'km/h', 'mph', 'per', 'second', 'metres'], number: true },
    { re: /^when\b|\bwhat year\b/, words: ['built', 'founded', 'completed', 'opened', 'began', 'established', 'born', 'died', 'released', 'constructed', 'started'], year: true },
    { re: /\bcapital\b/, words: ['capital', 'city'] },
    { re: /\bwho (won|wins)\b|\bwinner\b|\bchampion/, words: ['won', 'winner', 'winners', 'champion', 'champions', 'crowned', 'winning', 'defeated', 'beat', 'title', 'final'] },
    { re: /\bceo\b|\bfounder\b|\bfounded\b|\bowner\b|\bleader\b|\bpresident\b|\bprime minister\b|\binvent/, words: ['ceo', 'chief', 'executive', 'founded', 'founder', 'led', 'president', 'minister', 'invented', 'owner', 'chairman'] },
    { re: /^why\b/, words: ['because', 'due', 'caused', 'causes', 'result', 'reason', 'since', 'so'] },
    { re: /^how (do|does|to|can|is|are)\b/, words: ['by', 'using', 'made', 'process', 'method', 'typically', 'usually'] },
  ];

  const words = text => (text.toLowerCase().match(/[a-z0-9]+(?:['’][a-z]+)?/g) || []).map(w => w.replace(/['’]s$/, ''));
  const stem = w => (w.length > 4 ? w.replace(/(ies|ers|er|es|s|ing|ed|ly)$/, '') : w);
  const keywords = question => [...new Set(words(question).filter(w => !STOP.has(w) && w.length > 1))];
  const cuesFor = question => CUES.filter(c => c.re.test(question.toLowerCase()));

  // "write me a poem", "what should i do", "can you help me plan" need a thinking model; Wikipedia can't answer them.
  const OPEN = /\b(write|compose|poem|story|essay|email|letter|song|lyrics|summari[sz]e|brainstorm|ideas?|suggest|recommend|advice|opinion|plan|imagine|pretend|rewrite|fix my|debug|code|review)\b|\b(should|shall) (i|we)\b|\b(can|could|would|will|do|are) you\b|\byour (favou?rite|opinion|view)\b|\bwhat do you think\b/;
  const QUESTION_WORDS = ['what', 'when', 'where', 'which', 'who', 'why', 'how', 'whats', 'tall', 'high', 'height', 'far', 'distance',
    'big', 'large', 'old', 'long', 'deep', 'fast', 'speed', 'light', 'sound', 'heavy', 'weigh', 'many', 'much', 'capital', 'population',
    'largest', 'biggest', 'smallest', 'tallest', 'longest', 'highest', 'deepest', 'fastest', 'oldest', 'currency', 'language',
    'president', 'founder', 'founded', 'invented', 'discovered', 'built', 'born', 'died', 'meaning', 'difference', 'between', 'explain'];
  const STARTERS = { wat: 'what', wats: 'whats', whta: 'what', waht: 'what', hw: 'how', hwo: 'how', wen: 'when', wher: 'where', whr: 'where', wy: 'why', whos: 'who is' };
  // A tiny edit distance (one insertion, deletion, substitution or neighbour swap), enough for question words.
  const oneEdit = (a, b) => {
    if (a === b || Math.abs(a.length - b.length) > 1) return false;
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  };
  function fixQuestion(question) {
    return question.toLowerCase().split(' ').map(w => {
      if (STARTERS[w]) return STARTERS[w];
      if (w.length < 3 || QUESTION_WORDS.includes(w) || STOP.has(w)) return w;
      const near = QUESTION_WORDS.filter(q => q.length > 2 && oneEdit(w, q));
      return near.length === 1 ? near[0] : w;   // only an unambiguous fix
    }).join(' ');
  }

  const kind = question => (OPEN.test(question.toLowerCase()) ? 'open' : 'fact');

  // Splits an extract into sentences without breaking "St. Louis", "c. 1890" or "3.5 km".
  function sentences(text) {
    return text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
      .map(s => s.trim()).filter(s => s.length > 2)
      .reduce((out, s) => { const prev = out[out.length - 1]; if (prev && /\b(?:[A-Z]|St|Mt|Dr|Mr|Mrs|Ms|c|ca|approx|no|vs|U\.S)\.$/.test(prev)) out[out.length - 1] = prev + ' ' + s; else out.push(s); return out; }, []);
  }

  // Scores every sentence of the top pages against the question and returns the best answer, or null.
  // pages: [{ title, url, text }] in search order.
  function pick(question, pages) {
    const keys = keywords(question).map(stem), cues = cuesFor(question);
    const cueWords = new Set(cues.flatMap(c => c.words).map(stem));
    const wantsNumber = cues.some(c => c.number), wantsYear = cues.some(c => c.year);
    let best = null;
    pages.forEach((page, pi) => {
      const titleStems = new Set(words(page.title).map(stem));
      sentences(page.text).slice(0, 12).forEach((sentence, si, all) => {
        const have = new Set(words(sentence).map(stem));
        let score = 0;
        for (const k of keys) if (have.has(k)) score += 2; else if (titleStems.has(k)) score += 0.75;   // the page itself is about it
        let cueHits = 0; for (const c of cueWords) if (have.has(c)) cueHits++;
        score += Math.min(3, cueHits * 1.5);
        if (wantsNumber && /\d/.test(sentence)) score += 1.5;
        if (wantsYear && /\b(1[0-9]{3}|20[0-9]{2})\b/.test(sentence)) score += 2.5;
        score -= si * 0.25 + pi * 0.6 + Math.max(0, sentence.length - 160) / 120;
        if (sentence.length < 25) score -= 2;
        if (!best || score > best.score) best = { score, sentence, page, next: all[si + 1] };
      });
    });
    if (!best || best.score < 1.5) return null;
    const say = best.sentence.length < 90 && best.next && best.next.length < 160 ? best.sentence + ' ' + best.next : best.sentence;
    return {
      say, title: best.page.title, url: best.page.url,
      // facts for an AI tier: the best sentence first, then the start of each page
      context: [best.sentence, ...pages.slice(0, 3).map(p => `${p.title}: ${sentences(p.text).slice(0, 3).join(' ')}`)].join('\n'),
    };
  }

  // One request: search Wikipedia and fetch the introduction of the top four results.
  async function lookup(question, getJSON, retried = false) {
    question = fixQuestion(question);
    const keys = keywords(question);
    if (!keys.length) return null;
    // Wikipedia's search ranks better with the whole question ("who won the 2022 world cup" finds football, not cricket),
    // plus a hint word for measurement questions ("how far is the moon" + "distance").
    const hints = cuesFor(question).map(c => c.hint).filter(h => h && !keys.includes(h));
    const query = [question.replace(/[?!.]+$/, ''), ...hints].join(' ');
    const data = await getJSON('https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&generator=search&gsrlimit=4' +
      '&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exlimit=4&gsrsearch=' + encodeURIComponent(query));
    const pages = Object.values((data.query && data.query.pages) || {}).sort((a, b) => a.index - b.index)
      .map(p => ({ title: p.title, url: p.fullurl, text: p.extract || '' })).filter(p => p.text);
    const found = pick(question, pages);
    if (!found && !retried) {   // nothing answered it: maybe misspelled, so ask Wikipedia's "did you mean" ("alen turnig")
      const s = await getJSON('https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srlimit=1&srinfo=suggestion&srsearch=' + encodeURIComponent(query));
      const suggestion = s.query && s.query.searchinfo && s.query.searchinfo.suggestion;
      return suggestion ? lookup(suggestion, getJSON, true) : null;
    }
    return found;
  }

  /* ---------------- Chrome's built-in AI (Prompt API) ---------------- */

  const OPTIONS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
  let session = null, sessionPersona = '', status = 'unsupported';

  // 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported'
  async function chromeStatus() {
    if (typeof LanguageModel === 'undefined') return (status = 'unsupported');
    try { status = await LanguageModel.availability(OPTIONS); } catch { status = 'unavailable'; }
    return status;
  }

  async function openSession(persona, onProgress) {
    if (session) { try { session.destroy(); } catch { /* already gone */ } }
    session = await LanguageModel.create({
      ...OPTIONS,
      initialPrompts: [{ role: 'system', content: persona }],
      monitor(m) { m.addEventListener('downloadprogress', e => onProgress && onProgress(e.loaded)); },
    });
    sessionPersona = persona;
    status = 'available';
    return session;
  }

  // Downloading the model needs a click (user activation), so Settings calls this from its button.
  async function enableChrome(persona, onProgress) {
    if (typeof LanguageModel === 'undefined') return false;
    await openSession(persona, onProgress);
    return true;
  }

  const chromeReady = () => status === 'available';

  async function askChrome(question, { persona, context } = {}) {
    if (!chromeReady()) return null;
    const prompt = context ? `Facts that may help (from Wikipedia):\n${context}\n\nQuestion: ${question}` : question;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!session || sessionPersona !== persona) await openSession(persona);
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 45000);
        try { return (await session.prompt(prompt, { signal: ctl.signal })).trim(); } finally { clearTimeout(timer); }
      } catch (err) {
        session = null;   // the conversation may have outgrown the model's context: start a fresh one and retry once
        if (attempt) throw err;
      }
    }
    return null;
  }

  return { kind, keywords, sentences, pick, lookup, fixQuestion, chromeStatus, enableChrome, chromeReady, askChrome };
})();
