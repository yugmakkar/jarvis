/* Decides where speech is turned into text: on this device, by the browser maker's speech service, or nowhere.

   Settings → "Speech recognition" (stored as `voiceMode`):
     prefer  On this device when the browser can; otherwise the browser's online service. (default)
     only    On this device only. If that is impossible, voice input stays off and nothing is sent.
     cloud   Always the browser's online service (for browsers where the on-device download misbehaves).

   On-device recognition uses SpeechRecognition.available() / install() and `processLocally`
   (Chrome 139 and later). The language pack is downloaded by the browser itself, not by this page. */
const Hearing = (() => {
  const CHECK_TIMEOUT_MS = 5000, INSTALL_TIMEOUT_MS = 90000;

  // Resolves to the promise's value, or to 'timeout'. Some browsers never settle install().
  function withTimeout(promise, ms) {
    let timer;
    const late = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), ms); });
    return Promise.race([Promise.resolve(promise).catch(() => 'error'), late]).finally(() => clearTimeout(timer));
  }

  // Languages to try, best first. A regional English (en-IN, en-GB) may have no on-device pack when en-US does.
  function candidates(navLang) {
    const out = /^en\b/i.test(navLang || '') ? [navLang] : [];
    if (!out.includes('en-US')) out.push('en-US');
    return out;
  }

  const hasLocalApi = SR => !!SR && typeof SR.available === 'function';

  /* Returns { mode: 'local' | 'cloud' | 'off', lang, reason, installable? }.
     installable is the language whose pack could be downloaded; the caller decides when to call install(). */
  async function choose(SR, { navLang, setting = 'prefer', timeoutMs = CHECK_TIMEOUT_MS } = {}) {
    const langs = candidates(navLang);
    if (!SR) return { mode: 'off', lang: langs[0], reason: 'unsupported' };
    const fallback = reason => setting === 'only' ? { mode: 'off', lang: langs[0], reason } : { mode: 'cloud', lang: langs[0], reason };
    if (setting === 'cloud') return { mode: 'cloud', lang: langs[0], reason: 'chosen' };
    if (!hasLocalApi(SR)) return fallback('no-local-api');
    let installable = null;
    for (const lang of langs) {
      const status = await withTimeout(SR.available({ langs: [lang], processLocally: true }), timeoutMs);
      if (status === 'available') return { mode: 'local', lang, reason: 'available' };
      if ((status === 'downloadable' || status === 'downloading') && !installable) installable = lang;
    }
    return { ...fallback(installable ? 'downloadable' : 'no-local'), installable };
  }

  // Downloads the on-device pack. Resolves true only if the browser confirms success in time.
  async function install(SR, lang, timeoutMs = INSTALL_TIMEOUT_MS) {
    if (!SR || typeof SR.install !== 'function') return false;
    return (await withTimeout(SR.install({ langs: [lang], processLocally: true }), timeoutMs)) === true;
  }

  /* What to do when recognition reports an error while running. Returns one of:
       'blocked'  the user refused the microphone
       'cloud'    on-device failed; fall back to the online service
       'off'      on-device failed and the user allows nothing else
       'retry'    a passing problem (silence, network); restart after a pause */
  function onError(code, mode, setting) {
    // processLocally=true with no usable pack fires service-not-allowed or language-not-supported (Web Speech API spec).
    if (mode === 'local' && (code === 'service-not-allowed' || code === 'language-not-supported')) return setting === 'only' ? 'off' : 'cloud';
    if (code === 'not-allowed' || code === 'service-not-allowed') return 'blocked';
    if (code === 'language-not-supported' || code === 'audio-capture') return 'off';
    return 'retry';
  }

  const label = mode => ({ local: 'on this device', cloud: 'online service', off: 'off' })[mode] || mode;

  return { choose, install, onError, candidates, label };
})();
