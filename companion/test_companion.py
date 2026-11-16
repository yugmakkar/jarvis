"""Tests for the companion. Run with:  python -m unittest discover companion

Each test starts a real server on a free port with a temporary folder and a recording executor,
so nothing on this computer is opened, pressed or locked."""
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

import jarvis_companion as jc

GOOD = 'http://localhost:5173'


class CompanionTest(unittest.TestCase):
    def setUp(self, interactive=True):
        self.dir = tempfile.TemporaryDirectory()
        self.lines = []
        self.executor = jc.RecordingExecutor()
        self.state = jc.State(self.dir.name, jc.LOCAL_ORIGINS, self.executor, interactive, say=lambda *a, **k: self.lines.append(' '.join(map(str, a))))
        Path(self.dir.name, 'apps.json').write_text(json.dumps({'Notepad': 'notepad.exe', 'spotify': 'C:/Apps/Spotify.exe'}))
        self.server = jc.make_server(self.state, 0)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.dir.cleanup()

    def call(self, method, path, body=None, origin=GOOD, token=None, host=None, ctype='application/json'):
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        headers = {'Host': host or f'127.0.0.1:{self.port}'}
        if origin:
            headers['Origin'] = origin
        if token:
            headers['Authorization'] = 'Bearer ' + token
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers['Content-Type'] = ctype
        conn.request(method, path, body=data, headers=headers)
        r = conn.getresponse()
        raw = r.read()
        out = json.loads(raw) if raw else None
        conn.close()
        return r.status, out, dict(r.getheaders())

    def pair(self):
        status, out, _ = self.call('POST', '/pair', {'code': self.state.code})
        self.assertEqual(status, 200)
        return out['token']

    # -- who may talk to it

    def test_foreign_or_missing_origin_is_refused(self):
        for origin in ('https://evil.example', 'http://localhost:9999', None):
            status, out, _ = self.call('GET', '/status', origin=origin)
            self.assertEqual((status, out['error']), (403, 'origin_not_allowed'), origin)

    def test_hosted_site_needs_the_flag(self):
        status, _, _ = self.call('GET', '/status', origin=jc.HOSTED_ORIGIN)
        self.assertEqual(status, 403)

    def test_bad_host_header_is_refused(self):   # DNS rebinding: evil.example resolving to 127.0.0.1
        status, out, _ = self.call('GET', '/status', host='evil.example')
        self.assertEqual((status, out['error']), (403, 'bad_host'))

    def test_preflight_names_only_the_allowed_origin(self):
        status, _, headers = self.call('OPTIONS', '/action')
        self.assertEqual(status, 204)
        self.assertEqual(headers['Access-Control-Allow-Origin'], GOOD)
        self.assertIn('Authorization', headers['Access-Control-Allow-Headers'])

    def test_post_must_be_json(self):
        status, out, _ = self.call('POST', '/pair', {'code': '1'}, ctype='text/plain')
        self.assertEqual((status, out['error']), (415, 'json_only'))

    # -- pairing

    def test_status_before_and_after_pairing(self):
        self.assertFalse(self.call('GET', '/status')[1]['paired'])
        token = self.pair()
        self.assertTrue(self.call('GET', '/status', token=token)[1]['paired'])

    def test_pairing_code_works_once(self):
        code = self.state.code
        self.assertEqual(self.call('POST', '/pair', {'code': code})[0], 200)
        self.assertEqual(self.call('POST', '/pair', {'code': code})[0], 401)

    def test_wrong_codes_lock_out_the_code(self):
        code = self.state.code
        wrong = '000000' if code != '000000' else '111111'
        for _ in range(jc.MAX_PAIR_TRIES):
            self.assertEqual(self.call('POST', '/pair', {'code': wrong})[0], 401)
        self.assertNotEqual(self.state.code, code, 'a new code replaces the guessed one')
        self.assertEqual(self.call('POST', '/pair', {'code': code})[0], 401)

    def test_token_is_stored_only_as_a_hash(self):
        token = self.pair()
        saved = Path(self.dir.name, 'config.json').read_text()
        self.assertNotIn(token, saved)
        self.assertIn(jc.sha(token), saved)

    def test_token_is_bound_to_the_origin_that_paired(self):
        token = self.pair()
        status, out, _ = self.call('GET', '/apps', token=token, origin='http://127.0.0.1:5173')
        self.assertEqual((status, out['error']), (401, 'not_paired'))

    def test_no_or_wrong_token_cannot_act(self):
        self.pair()
        for token in (None, 'not-the-token'):
            status, out, _ = self.call('POST', '/action', {'action': 'lock'}, token=token)
            self.assertEqual((status, out['error']), (401, 'not_paired'))
        self.assertEqual(self.executor.done, [])

    # -- actions

    def test_first_use_asks_and_does_nothing_until_allowed(self):
        token = self.pair()
        status, out, _ = self.call('POST', '/action', {'action': 'volume', 'name': 'up'}, token=token)
        self.assertEqual((status, out['error']), (403, 'needs_approval'))
        self.assertEqual(self.executor.done, [])
        self.assertTrue(any('change the system volume' in l for l in self.lines), 'the question is shown in the window')
        self.state.answer('y')
        status, out, _ = self.call('POST', '/action', {'action': 'volume', 'name': 'up'}, token=token)
        self.assertEqual(status, 200)
        self.assertEqual(self.executor.done, [('volume', 'up')])
        # approval is remembered, and only for that kind of action
        self.assertIn('volume', json.loads(Path(self.dir.name, 'config.json').read_text())['approved'])
        self.assertEqual(self.call('POST', '/action', {'action': 'lock'}, token=token)[1]['error'], 'needs_approval')

    def test_denied_approval_executes_nothing(self):
        token = self.pair()
        self.call('POST', '/action', {'action': 'lock'}, token=token)
        self.state.answer('n')
        self.assertEqual(self.call('POST', '/action', {'action': 'lock'}, token=token)[1]['error'], 'needs_approval')
        self.assertEqual(self.executor.done, [])

    def test_apps_come_only_from_the_users_list(self):
        token = self.pair()
        self.state.approved.add('open_app')
        self.assertEqual(self.call('POST', '/action', {'action': 'open_app', 'name': 'Spotify'}, token=token)[0], 200)
        self.assertEqual(self.executor.done, [('open_app', 'C:/Apps/Spotify.exe')])
        for name in ('cmd', 'powershell', 'C:/Windows/System32/cmd.exe', '../notepad'):
            status, out, _ = self.call('POST', '/action', {'action': 'open_app', 'name': name}, token=token)
            self.assertEqual((status, out['error']), (404, 'not_listed'), name)
        self.assertEqual(len(self.executor.done), 1)

    def test_apps_list_reports_names_not_paths(self):
        token = self.pair()
        out = self.call('GET', '/apps', token=token)[1]
        self.assertEqual(out['apps'], ['notepad', 'spotify'])
        self.assertNotIn('Spotify.exe', json.dumps(out))

    def test_unknown_actions_and_values_are_rejected(self):
        token = self.pair()
        self.state.approved.update(jc.ACTIONS)
        for body, error in (({'action': 'run', 'name': 'rm -rf'}, 'unknown_action'), ({'action': 'media', 'name': 'eject'}, 'unknown_key'),
                            ({'action': 'volume', 'name': 'max'}, 'unknown_direction'), ({'action': 'open_folder', 'name': 'windows'}, 'unknown_folder')):
            self.assertEqual(self.call('POST', '/action', body, token=token)[1]['error'], error, body)
        self.assertEqual(self.executor.done, [])

    def test_without_a_console_nothing_new_is_allowed(self):
        self.tearDown()
        self.setUp(interactive=False)
        token = self.pair()
        status, out, _ = self.call('POST', '/action', {'action': 'media', 'name': 'next'}, token=token)
        self.assertEqual((status, out['error']), (403, 'not_approved'))

    def test_unpair_forgets_pages_and_approvals(self):
        token = self.pair()
        self.state.approved.add('volume')
        self.state.forget()
        self.assertEqual(self.call('POST', '/action', {'action': 'volume', 'name': 'up'}, token=token)[0], 401)


if __name__ == '__main__':
    unittest.main()
