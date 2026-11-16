// Tests for app/hearing.js: deciding whether speech is recognised on the device, by an online service, or not at all.
// A fake SpeechRecognition stands in for the browser, so these run anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../app/hearing.js', import.meta.url), 'utf8');

function load() {
  const sandbox = { setTimeout, clearTimeout, Promise };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE + '\nthis.Hearing = Hearing;', sandbox);
  return sandbox.Hearing;
}

// status: { 'en-US': 'available', ... }; install: what install() resolves to, or 'hang'.
function fakeSR(status = {}, install = true) {
  const SR = function () {};
  SR.calls = [];
  SR.available = async ({ langs, processLocally }) => { SR.calls.push(['available', langs[0], processLocally]); return status[langs[0]] || 'unavailable'; };
  SR.install = ({ langs }) => { SR.calls.push(['install', langs[0]]); return install === 'hang' ? new Promise(() => {}) : Promise.resolve(install); };
  return SR;
}

test('uses on-device recognition when the language pack is installed', async () => {
  const H = load(), SR = fakeSR({ 'en-US': 'available' });
  const c = await H.choose(SR, { navLang: 'en-US' });
  assert.equal(c.mode, 'local');
  assert.equal(c.lang, 'en-US');
  assert.deepEqual(SR.calls[0], ['available', 'en-US', true]);
});

test('falls back from a regional English to en-US for on-device', async () => {
  const H = load(), SR = fakeSR({ 'en-IN': 'unavailable', 'en-US': 'available' });
  const c = await H.choose(SR, { navLang: 'en-IN' });
  assert.deepEqual([c.mode, c.lang], ['local', 'en-US']);
});

test('a downloadable pack is offered for install, using the online service meanwhile', async () => {
  const H = load(), SR = fakeSR({ 'en-US': 'downloadable' });
  const c = await H.choose(SR, { navLang: 'en-US' });
  assert.deepEqual([c.mode, c.installable], ['cloud', 'en-US']);
  assert.equal(await H.install(SR, c.installable), true);
});

test('"on device only" keeps voice off rather than using an online service', async () => {
  const H = load();
  assert.equal((await H.choose(fakeSR({}), { navLang: 'en-US', setting: 'only' })).mode, 'off');
  const pending = await H.choose(fakeSR({ 'en-US': 'downloadable' }), { navLang: 'en-US', setting: 'only' });
  assert.deepEqual([pending.mode, pending.installable], ['off', 'en-US']);
  // A browser without the on-device API at all
  const old = function () {};
  assert.equal((await H.choose(old, { navLang: 'en-US', setting: 'only' })).mode, 'off');
  assert.equal((await H.choose(old, { navLang: 'en-US' })).mode, 'cloud');
});

test('"online service" never asks about on-device', async () => {
  const H = load(), SR = fakeSR({ 'en-US': 'available' });
  assert.equal((await H.choose(SR, { navLang: 'en-US', setting: 'cloud' })).mode, 'cloud');
  assert.equal(SR.calls.length, 0);
});

test('no speech recognition at all means off', async () => {
  assert.equal((await load().choose(undefined, { navLang: 'en-US' })).mode, 'off');
});

test('an install that never finishes times out instead of hanging', async () => {
  const H = load(), SR = fakeSR({}, 'hang');
  const started = Date.now();
  assert.equal(await H.install(SR, 'en-US', 50), false);
  assert.ok(Date.now() - started < 1000);
});

test('a failed install or a throwing check counts as unavailable', async () => {
  const H = load();
  assert.equal(await H.install(fakeSR({}, false), 'en-US'), false);
  const SR = fakeSR(); SR.available = async () => { throw new Error('boom'); };
  assert.equal((await H.choose(SR, { navLang: 'en-US' })).mode, 'cloud');
});

test('errors while listening map to the right next step', () => {
  const H = load();
  // On-device stopped working: fall back, unless the user allows nothing else
  assert.equal(H.onError('service-not-allowed', 'local', 'prefer'), 'cloud');
  assert.equal(H.onError('language-not-supported', 'local', 'only'), 'off');
  // The same code from the online service means the user refused the microphone
  assert.equal(H.onError('service-not-allowed', 'cloud', 'prefer'), 'blocked');
  assert.equal(H.onError('not-allowed', 'local', 'prefer'), 'blocked');
  // Passing problems retry (with a growing delay in jarvis.js)
  for (const code of ['no-speech', 'network', 'aborted']) assert.equal(H.onError(code, 'cloud', 'prefer'), 'retry');
});

test('jarvis.js turns on processLocally for on-device mode and backs off on repeated errors', () => {
  const js = readFileSync(new URL('../app/jarvis.js', import.meta.url), 'utf8');
  assert.match(js, /if \(mode === 'local'\) rec\.processLocally = true/);
  assert.match(js, /250 \* 2 \*\* failures/);
});
