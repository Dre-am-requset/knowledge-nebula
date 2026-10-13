"""Serve the bundled UI and local API, bound to loopback only."""
import json
import sqlite3
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .store import Conflict

WEB = Path(__file__).resolve().parent.parent / 'web'
STATIC = {'/': 'index.html', '/archive': 'archive.html', '/atlas.css': 'atlas.css',
          '/atlas.js': 'atlas.js', '/galaxy3d.js': 'galaxy3d.js', '/fragments.js': 'fragments.js',
          '/vendor/three.module.min.js': 'vendor/three.module.min.js',
          '/vendor/three.core.min.js': 'vendor/three.core.min.js', '/vendor/OrbitControls.js': 'vendor/OrbitControls.js'}


class Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, store, **kwargs):
        self.store = store
        super().__init__(*args, **kwargs)

    def log_message(self, *_):
        pass

    def local_host(self):
        return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')

    def respond(self, content, status=200, mime='application/json'):
        body = json.dumps(content, ensure_ascii=False).encode('utf-8') if mime == 'application/json' else content
        self.send_response(status)
        self.send_header('Content-Type', mime + '; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.local_host():
            return self.respond({'error': 'Only local hosts are allowed'}, 403)
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        params = {key: values[0] for key, values in parse_qs(parsed.query).items()}
        try:
            if path in STATIC:
                mime = 'application/javascript' if path.endswith('.js') else 'text/css' if path.endswith('.css') else 'text/html'
                return self.respond((WEB / STATIC[path]).read_bytes(), mime=mime)
            if path == '/api/health':
                return self.respond({'app': 'knowledge-nebula', 'ready': True})
            if path == '/api/version':
                with self.store.connect() as db:
                    metadata = self.store.metadata(db)
                return self.respond({'generation': metadata.get('generation'), 'atoms_generation': metadata.get('generation')})
            if path == '/api/update-status':
                with self.store.connect() as db:
                    metadata = self.store.metadata(db)
                return self.respond({'running': False, 'loop_active': False, 'phase': 'idle', 'groups': [],
                                     'last_result': 'success', 'last_published_at': metadata.get('updated_at'),
                                     'last_error': None, 'next_run_at': None})
            if path == '/api/atlas':
                return self.respond(self.store.atlas(params.get('chat', '')))
            if path == '/api/atoms':
                return self.respond(self.store.catalog(params))
            if path.startswith('/api/atom/'):
                return self.respond(self.store.atom(path.removeprefix('/api/atom/')))
            if path.startswith('/api/atom-history/'):
                return self.respond(self.store.history(path.removeprefix('/api/atom-history/')))
            if path == '/api/learning':
                return self.respond(self.store.learning())
            if path in ('/api/knowledge/search', '/api/search'):
                return self.respond(self.store.search(params, raw=params.get('raw') == '1'))
            if path == '/api/cards':
                return self.respond(self.store.search(dict(params, kind='knowledge')))
            if path.startswith('/api/doc/'):
                offset = max(0, min(100000, int(params.get('offset', 0))))
                return self.respond(self.store.document(path.removeprefix('/api/doc/'), offset))
            if path in ('/api/topic-sources', '/api/topic-messages'):
                return self.respond(self.store.topic_sources(params, messages=path.endswith('messages')))
            if path == '/api/links':
                return self.respond([])
            if path == '/api/stats':
                atlas = self.store.atlas()
                with self.store.connect() as db:
                    sources = self.store.objects(db, 'sources', active=False)
                groups = []
                for identity, group in atlas['groups'].items():
                    members = [s for s, active in sources.values() if active and s['chat'] == identity]
                    groups.append({'id': identity, 'name': group['name'], 'messages': len(members),
                                   'latest': max((s['time'] for s in members), default=''), 'recalled': sum(s['withdrawn'] for s in members)})
                return self.respond({'app': 'knowledge-nebula', 'groups': groups, 'indexed': [], 'links': [], 'build': {}})
            return self.respond({'error': 'Page not found'}, 404)
        except KeyError as error:
            self.respond({'error': str(error)}, 404)
        except (TypeError, ValueError) as error:
            self.respond({'error': str(error)}, 400)
        except sqlite3.Error:
            self.respond({'error': 'Local storage is temporarily unavailable'}, 503)

    def do_POST(self):
        if (not self.local_host() or self.headers.get('Origin') != 'http://' + self.headers.get('Host', '')
                or self.headers.get('Content-Type', '').split(';')[0] != 'application/json'):
            return self.respond({'error': 'Only same-origin JSON requests from the local page are allowed'}, 403)
        path = urlparse(self.path).path
        route = path.removeprefix('/api/atoms/')
        if not path.startswith('/api/atoms/') or route not in ('state', 'edit', 'merge', 'split', 'learning'):
            return self.respond({'error': 'Operation not found'}, 404)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 1200000:
                raise ValueError('Invalid request length')
            data = json.loads(self.rfile.read(length))
            return self.respond(self.store.mutate(route, data))
        except Conflict as error:
            self.respond({'error': str(error)}, 409)
        except KeyError as error:
            self.respond({'error': str(error)}, 404)
        except (ValueError, TypeError) as error:
            self.respond({'error': str(error)}, 400)
        except sqlite3.Error:
            self.respond({'error': 'Save failed; keep your current input and check local storage'}, 503)


def make_server(store, port=8768):
    return ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, store=store))


def serve(store, port=8768):
    with make_server(store, port) as server:
        print(f'Knowledge Nebula: http://127.0.0.1:{server.server_port}/', flush=True)
        print('Keep this process running. Press Ctrl+C to stop.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
