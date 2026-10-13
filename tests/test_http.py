import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from nebula.demo import make_demo
from nebula.server import make_server
from nebula.store import Store


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.directory.name) / 'app.sqlite')
        self.store.import_data(make_demo())
        self.server = make_server(self.store, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        self.identity = self.store.catalog({})['results'][0]['id']

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def call(self, path, data=None, headers=None):
        request = urllib.request.Request(self.url + path, data=json.dumps(data).encode('utf-8') if data is not None else None,
                                         headers=headers or {})
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, response.headers, response.read()

    def test_static_data_and_sources_available_without_external_services(self):
        status, headers, body = self.call('/')
        self.assertEqual(status, 200)
        self.assertIn(b'Knowledge Nebula', body)
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        _, _, body = self.call('/api/atoms')
        self.assertEqual(json.loads(body)['total'], 288)
        _, _, body = self.call('/api/doc/' + urllib.parse.quote('knowledge:prompt-brief', safe=''))
        self.assertEqual(json.loads(body)['source_total'], 1)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.call('/data/app.sqlite')
        self.assertEqual(error.exception.code, 404)

    def test_same_origin_save_revision_conflict_and_version_publication(self):
        before = json.loads(self.call('/api/version')[2])['generation']
        headers = {'Content-Type': 'application/json', 'Origin': self.url}
        _, _, body = self.call('/api/atoms/state', {'id': self.identity, 'revision': 0, 'note': '保存到本机'}, headers)
        self.assertEqual(json.loads(body)['revision'], 1)
        self.assertNotEqual(json.loads(self.call('/api/version')[2])['generation'], before)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.call('/api/atoms/state', {'id': self.identity, 'revision': 0, 'note': '冲突'}, headers)
        self.assertEqual(error.exception.code, 409)
        self.assertEqual(self.store.atom(self.identity)['user']['note'], '保存到本机')

    def test_foreign_host_and_cross_origin_writes_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.call('/api/health', headers={'Host': 'untrusted.example'})
        self.assertEqual(error.exception.code, 403)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.call('/api/atoms/state', {'id': self.identity, 'favorite': True}, {'Content-Type': 'application/json', 'Origin': 'https://untrusted.example'})
        self.assertEqual(error.exception.code, 403)
        self.assertEqual(self.store.atom(self.identity)['user_revision'], 0)

    def test_malformed_query_and_non_object_write_are_handled(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.call('/api/knowledge/search?page=oops')
        self.assertEqual(error.exception.code, 400)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.call('/api/atoms/state', [], {'Content-Type': 'application/json', 'Origin': self.url})
        self.assertEqual(error.exception.code, 400)


if __name__ == '__main__':
    unittest.main()
