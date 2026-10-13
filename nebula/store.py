"""SQLite store with durable overlays, audited revisions and source-change guards."""
import copy
import json
import sqlite3
import uuid
from collections import Counter
from contextlib import contextmanager
from pathlib import Path

from .dataset import ATOM_ID, STATES, digest, encoded, normalize, stamp, text


class Conflict(ValueError):
    pass


class Store:
    def __init__(self, path):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS objects (
                    kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
                    first_payload TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
                    PRIMARY KEY(kind,id));
                CREATE TABLE IF NOT EXISTS records (
                    kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
                    revision INTEGER NOT NULL, PRIMARY KEY(kind,id));
                CREATE TABLE IF NOT EXISTS history (
                    number INTEGER PRIMARY KEY, id TEXT NOT NULL, action TEXT NOT NULL,
                    payload TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS history_id ON history(id,number);
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
            ''')

    @contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            if write:
                db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def objects(db, kind, active=True):
        sql = 'SELECT id,payload,active FROM objects WHERE kind=?' + (' AND active=1' if active else '')
        return {r['id']: (json.loads(r['payload']), bool(r['active'])) for r in db.execute(sql, (kind,))}

    @staticmethod
    def metadata(db):
        return {r['key']: json.loads(r['payload']) for r in db.execute('SELECT * FROM meta')}

    @staticmethod
    def set_meta(db, key, value):
        db.execute('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload', (key, encoded(value)))

    def publish(self, db):
        self.set_meta(db, 'generation', uuid.uuid4().hex)
        self.set_meta(db, 'updated_at', stamp())

    def import_data(self, data, replace=False):
        data = normalize(copy.deepcopy(data))
        changed_sources = 0
        with self.connect(write=True) as db:
            for kind in ('groups', 'categories', 'topics', 'sources', 'atoms', 'cards', 'paths'):
                if replace:
                    db.execute('UPDATE objects SET active=0 WHERE kind=?', (kind,))
                for value in data[kind]:
                    prior = db.execute('SELECT payload FROM objects WHERE kind=? AND id=?', (kind, value['id'])).fetchone()
                    if kind == 'sources' and prior and prior['payload'] != encoded(value):
                        changed_sources += 1
                        db.execute('INSERT INTO history(id,action,payload,created_at) VALUES (?,?,?,?)',
                                   ('source:' + value['id'], 'source_changed', encoded({'before': json.loads(prior['payload']), 'after': value}), stamp()))
                    if kind == 'atoms' and prior:
                        value['created_at'] = json.loads(prior['payload']).get('created_at', value['created_at'])
                    db.execute('INSERT INTO objects(kind,id,payload,first_payload,active) VALUES (?,?,?,?,1) '
                               'ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload,active=1',
                               (kind, value['id'], encoded(value), encoded(value)))
            self.set_meta(db, 'dataset_label', data['label'])
            self.set_meta(db, 'demo', data['demo'])
            self.set_meta(db, 'last_import_at', stamp())
            self.publish(db)
        return {'imported': {kind: len(data[kind]) for kind in ('sources', 'atoms', 'cards')},
                'changed_sources': changed_sources, 'mode': 'replace' if replace else 'merge'}

    @staticmethod
    def records(db, kind):
        return {r['id']: {'value': json.loads(r['payload']), 'revision': r['revision']}
                for r in db.execute('SELECT * FROM records WHERE kind=?', (kind,))}

    @staticmethod
    def changed(item, sources):
        hashes = item.get('source_hashes', {})
        return not hashes or any(sid not in sources or not sources[sid][1] or sources[sid][0].get('withdrawn')
                                 or digest(sources[sid][0]) != expected for sid, expected in hashes.items())

    def all_atoms(self, db):
        bases = self.objects(db, 'atoms', active=False)
        edits = self.records(db, 'edit')
        states = self.records(db, 'state')
        sources = self.objects(db, 'sources', active=False)
        result = {}
        for identity, (base, active) in bases.items():
            if active or identity in edits or identity in states:
                result[identity] = base
                if not active:
                    base.update(hidden=True, source_retired=True)
        for identity, overlay in edits.items():
            if 'custom' in overlay['value']:
                result[identity] = copy.deepcopy(overlay['value']['custom'])
            if identity in result:
                result[identity].update({k: v for k, v in overlay['value'].items() if k != 'custom'})
                result[identity]['edit_revision'] = overlay['revision']
        for identity, atom in result.items():
            user = states.get(identity, {})
            atom.update(user=user.get('value', {}), user_revision=user.get('revision', 0))
            atom.setdefault('edit_revision', 0)
            if atom.get('source_retired'):
                atom['hidden'] = True
            if self.changed(atom, sources):
                atom.update(status='needs_review', body='', summary='来源已变化或撤回，请重新核对原文后整理。')
        return result

    @staticmethod
    def compact(atom):
        keys = ('id', 'title', 'summary', 'topic', 'kind', 'importance', 'importance_reasons', 'priority_author',
                'status', 'origin', 'chats', 'first', 'last', 'created_at', 'hidden', 'user', 'user_revision', 'edit_revision', 'parents')
        return {key: atom[key] for key in keys if key in atom}

    def catalog(self, params):
        with self.connect() as db:
            found = []
            q, state = params.get('q', '').lower(), params.get('state', '')
            for atom in self.all_atoms(db).values():
                if bool(atom.get('hidden')) != (state == 'hidden'):
                    continue
                if params.get('chat') and params['chat'] not in atom['chats']:
                    continue
                if any(params.get(key) and params[key] != atom[key] for key in ('topic', 'kind')):
                    continue
                if q and q not in (atom['title'] + ' ' + atom['summary'] + ' ' + atom['body'] + ' '.join(atom['authors'])).lower():
                    continue
                if params.get('start') and atom['last'][:10] < params['start'] or params.get('end') and atom['first'][:10] > params['end']:
                    continue
                user = atom['user']
                if state == 'favorite' and not user.get('favorite') or state in STATES and user.get('state', 'unread') != state:
                    continue
                if state == 'pending' and atom['status'] not in ('unresolved', 'needs_review'):
                    continue
                found.append(atom)
            found.sort(key=lambda a: (a['created_at'] if state == 'new' else a['importance'], a['last'], a['id']), reverse=True)
            return {'results': [self.compact(a) for a in found], 'total': len(found),
                    'build': self.metadata(db), 'settings': {'ocr_enabled': False}}

    def atom(self, identity):
        with self.connect() as db:
            atoms = self.all_atoms(db)
            if identity not in atoms:
                raise KeyError('Knowledge item not found')
            atom = atoms[identity]
            sources = self.objects(db, 'sources', active=False)
            atom['sources'] = [self.source_message(sources[sid][0], db) for sid in atom['message_ids']
                               if sid in sources and sources[sid][1] and not sources[sid][0].get('withdrawn')]
            atom['documents'] = [{'id': sid, 'title': sources[sid][0]['title'], 'url': sources[sid][0]['url']}
                                 for sid in atom['source_documents'] if sid in sources and sources[sid][1]
                                 and not sources[sid][0].get('withdrawn')]
            members = set(atom['message_ids'])
            atom['related'] = [{'id': other['id'], 'title': other['title'], 'relation': '同一资料'} for other in atoms.values()
                               if other['id'] != identity and not other.get('hidden') and members.intersection(other['message_ids'])][:8]
            return atom

    def source_message(self, source, db):
        groups = self.objects(db, 'groups', active=False)
        return {'id': source['id'], 'sender': source['sender'], 'chat': source['chat'], 'time': source['time'],
                'name': groups.get(source['chat'], ({'name': source['chat']}, True))[0]['name'],
                'body': source['body'], 'content': source['body'], 'url': source['url'], 'type': source['kind']}

    def cards(self, db):
        sources = self.objects(db, 'sources', active=False)
        return [dict(card, review_status='needs_review' if self.changed(card, sources) else 'ready')
                for card, _ in self.objects(db, 'cards').values()]

    @staticmethod
    def card_body(card):
        bits = [card['title'], card['summary']]
        for section in card['sections']:
            bits.append(section['heading'])
            bits.extend(section.get('items', []))
            bits.append(section.get('text', ''))
        bits.append(card.get('template') or '')
        return '\n\n'.join(bit for bit in bits if bit)

    def document(self, identity, offset=0):
        with self.connect() as db:
            sources = self.objects(db, 'sources', active=False)
            if identity.startswith('knowledge:'):
                card = next((c for c in self.cards(db) if 'knowledge:' + c['id'] == identity), None)
                if card is None:
                    raise KeyError('Summary not found')
                ids = card['message_ids']
                available = [sid for sid in ids if sid in sources and sources[sid][1] and not sources[sid][0].get('withdrawn')]
                card['source_documents'] = [{'id': sid, 'title': sources[sid][0]['title'], 'first': sources[sid][0]['time']}
                                            for sid in available]
                if card['review_status'] != 'ready':
                    card.update(sections=[], template=None, summary='来源已变化，经验总结待复核。')
                card.update(id=identity, kind='knowledge', body=self.card_body(card), source_total=len(available), offset=offset,
                            has_more=offset + 30 < len(available), sources=[self.source_message(sources[sid][0], db)
                                                                         for sid in available[offset:offset + 30]])
                return card
            if identity not in sources or not sources[identity][1] or sources[identity][0].get('withdrawn'):
                raise KeyError('Source unavailable')
            source = sources[identity][0]
            return dict(source, first=source['time'], last=source['time'], name=self.source_message(source, db)['name'],
                        tags=[], sources=[self.source_message(source, db)] if offset == 0 else [],
                        source_total=1, offset=offset, has_more=False)

    def atlas(self, chat=''):
        with self.connect() as db:
            meta = self.metadata(db)
            sources = {sid: s for sid, (s, _) in self.objects(db, 'sources').items() if not s.get('withdrawn')}
            atoms = [a for a in self.all_atoms(db).values() if not a.get('hidden')]
            topics = [t for t, _ in self.objects(db, 'topics').values()]
            categories = [c for c, _ in self.objects(db, 'categories').values()]
            cards = self.cards(db)
            groups = {key: dict(group, active_messages=0, source_documents=0) for key, (group, _) in self.objects(db, 'groups').items()}
            source_votes = {sid: Counter() for sid in sources}
            for atom in atoms:
                for sid in atom['message_ids']:
                    if sid in source_votes:
                        source_votes[sid][atom['topic']] += 1
            main = {sid: votes.most_common(1)[0][0] if votes else 'unclassified' for sid, votes in source_votes.items()}
            category_of = {t['id']: t['category'] for t in topics}
            for source in sources.values():
                if source['chat'] in groups:
                    groups[source['chat']]['active_messages'] += 1
                    groups[source['chat']]['source_documents'] += 1
            selected = {sid: s for sid, s in sources.items() if not chat or s['chat'] == chat}
            for topic in topics:
                matches = {sid for a in atoms if a['topic'] == topic['id'] for sid in a['message_ids'] if sid in selected}
                topic.update(messages=len(matches), documents=len(matches), primary_messages=sum(main[sid] == topic['id'] for sid in selected),
                             cards=[c['id'] for c in cards if c['topic'] == topic['id']])
            for category in categories:
                category.update(messages=sum(category_of.get(main[sid], 'unclassified') == category['id'] for sid in selected))
            metadata = [{key: c[key] for key in ('id', 'topic', 'title', 'summary', 'review_status', 'chats', 'first', 'last', 'origin')} for c in cards]
            unknown = sum(t == 'unclassified' for t in main.values())
            return {'generation': meta.get('generation'), 'checked_at': meta.get('updated_at', stamp()), 'categories': categories,
                    'topics': topics, 'cards': metadata, 'groups': groups, 'paths': [p for p, _ in self.objects(db, 'paths').values()],
                    'filtered_group': {'id': chat, 'name': groups[chat]['name']} if chat in groups else None, 'edges': [],
                    'totals': {'stored_messages': len(sources), 'active_messages': len(sources), 'source_documents': len(sources),
                               'classified_messages': len(sources) - unknown, 'unclassified_messages': unknown,
                               'thread_context_assignments': 0, 'curated_cards': len(cards), 'automatic_cards': 0},
                    'method': '主题来自导入资料的明确标签；亮度来自条目的阅读重要度。没有向量检索或自动模型调用。' +
                              ('当前为项目自编的公开演示资料。' if meta.get('demo') else '当前为用户导入的本地资料。')}

    def search(self, params, raw=False):
        q, chat = params.get('q', '').lower(), params.get('chat', '')
        topic, kind = params.get('topic', ''), params.get('kind', '')
        page = max(1, min(10000, int(params.get('page', 1))))
        with self.connect() as db:
            results, summary_count = [], 0
            if not raw and kind in ('', 'knowledge'):
                for card in self.cards(db):
                    if card['review_status'] != 'ready' or chat and chat not in card['chats'] or topic and topic != card['topic']:
                        continue
                    if q and q not in self.card_body(card).lower():
                        continue
                    results.append({'id': 'knowledge:' + card['id'], 'card_id': card['id'], 'kind': 'knowledge', 'title': card['title'],
                                    'excerpt': card['summary'], 'summary': card['summary'], 'chat': card['chats'][0], 'topic': card['topic'],
                                    'sources': len(card['message_ids']), 'first': card['first'], 'last': card['last'], 'tags': []})
                summary_count = len(results)
            if kind != 'knowledge':
                for source, _ in self.objects(db, 'sources').values():
                    if source.get('withdrawn') or chat and source['chat'] != chat or kind and kind != source['kind']:
                        continue
                    if params.get('start') and source['time'][:10] < params['start'] or params.get('end') and source['time'][:10] > params['end']:
                        continue
                    if q and q not in (source['title'] + ' ' + source['body']).lower():
                        continue
                    results.append(dict(source, excerpt=source['body'][:330], tags=[], sources=1, first=source['time'], last=source['time']))
            return {'results': results[(page - 1) * 20:page * 20], 'total': len(results), 'page': page, 'knowledge_matches': summary_count}

    def topic_sources(self, params, messages=False):
        with self.connect() as db:
            sources = self.objects(db, 'sources')
            ids = {sid for a in self.all_atoms(db).values() if not a.get('hidden') and a['topic'] == params.get('topic')
                   for sid in a['message_ids']}
            matches = []
            for sid in sorted(ids):
                if sid not in sources:
                    continue
                source = sources[sid][0]
                if source.get('withdrawn') or params.get('chat') and params['chat'] != source['chat']:
                    continue
                name = self.source_message(source, db)['name']
                if messages:
                    item = self.source_message(source, db)
                    item['labels'] = [{'topic': params['topic'], 'basis': 'imported', 'clues': ['导入时明确标记主题']}]
                else:
                    item = dict(source, name=name, first=source['time'], last=source['time'], excerpt=source['body'][:240])
                matches.append(item)
            page = max(1, min(10000, int(params.get('page', 1))))
            return {'results': matches[(page - 1) * 20:page * 20], 'total': len(matches), 'page': page}

    def learning(self):
        with self.connect() as db:
            return self.records(db, 'learning').get('learning', {'value': {'done': [], 'notes': {}}, 'revision': 0})

    def write_record(self, db, kind, identity, patch, revision, action):
        old = db.execute('SELECT payload,revision FROM records WHERE kind=? AND id=?', (kind, identity)).fetchone()
        current = old['revision'] if old else 0
        if type(revision) is not int or revision != current:
            raise Conflict('另一处已修改此记录，请重新打开后保存；当前输入请保留。')
        previous = json.loads(old['payload']) if old else {}
        value = dict(previous, **patch)
        db.execute('INSERT INTO records VALUES (?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision',
                   (kind, identity, encoded(value), current + 1))
        db.execute('INSERT INTO history(id,action,payload,created_at) VALUES (?,?,?,?)',
                   (identity, action, encoded({'before': previous, 'after': value, 'revision': current + 1}), stamp()))
        self.publish(db)
        return {'revision': current + 1, 'value': value}

    def mutate(self, route, data):
        if not isinstance(data, dict):
            raise ValueError('JSON request must be an object')
        with self.connect(write=True) as db:
            if route == 'learning':
                notes, done = data.get('notes', {}), data.get('done', [])
                if not isinstance(notes, dict) or not isinstance(done, list) or len(notes) > 100 or len(done) > 100:
                    raise ValueError('Invalid learning data')
                if any(not isinstance(k, str) or not isinstance(v, str) or len(v) > 10000 for k, v in notes.items()) or any(not isinstance(x, str) for x in done):
                    raise ValueError('Learning notes and step IDs must be strings')
                return self.write_record(db, 'learning', 'learning', {'notes': notes, 'done': done}, data.get('revision', 0), route)
            identity = data.get('id')
            if not isinstance(identity, str) or not ATOM_ID.fullmatch(identity):
                raise ValueError('Invalid atom ID')
            atoms = self.all_atoms(db)
            if identity not in atoms:
                raise KeyError('Knowledge item not found')
            atom = atoms[identity]
            if route == 'state':
                fields = {k: data[k] for k in ('note', 'state', 'favorite') if k in data}
                if 'note' in fields:
                    text(fields['note'], 'note', 10000, empty=True)
                if 'state' in fields and fields['state'] not in STATES or 'favorite' in fields and not isinstance(fields['favorite'], bool):
                    raise ValueError('Invalid learning state')
                return self.write_record(db, 'state', identity, fields, data.get('revision', 0), route)
            if route in ('merge', 'split'):
                return self.restructure(db, route, data, atoms)
            if route != 'edit':
                raise ValueError('Unknown mutation')
            fields = {k: data[k] for k in ('title', 'summary', 'body', 'annotation', 'hidden', 'topic') if k in data}
            for key, maximum in (('title', 160), ('summary', 1000), ('body', 50000), ('annotation', 10000)):
                if key in fields:
                    text(fields[key], key, maximum, empty=key in ('summary', 'annotation'))
            if 'topic' in fields and fields['topic'] not in self.objects(db, 'topics') and fields['topic'] != 'unclassified':
                raise ValueError('Unknown topic')
            if 'hidden' in fields and not isinstance(fields['hidden'], bool):
                raise ValueError('hidden must be a boolean')
            if 'body' in fields or 'summary' in fields:
                if atom['status'] == 'needs_review':
                    if data.get('acknowledge_sources') is not True:
                        raise Conflict('来源已变化，请核对当前原文并勾选“已核对更新后的来源”。')
                    sources = self.objects(db, 'sources')
                    if any(sid not in sources or sources[sid][0].get('withdrawn') for sid in atom['message_ids']):
                        raise Conflict('部分来源已撤回或不可用，请先导入有效来源后再整理。')
                    hashes = {sid: digest(sources[sid][0]) for sid in atom['message_ids']}
                else:
                    hashes = atom['source_hashes']
                fields.update(source_hashes=hashes, origin='manual_curated', status='curated')
            return self.write_record(db, 'edit', identity, fields, data.get('revision', 0), route)

    def restructure(self, db, route, data, atoms):
        parents = [atoms[data['id']]]
        if route == 'merge':
            other = data.get('other')
            if other not in atoms or other == data['id']:
                raise ValueError('Choose a different existing atom')
            parents.append(atoms[other])
        bodies = data.get('parts') if route == 'split' else [data.get('body')]
        if not isinstance(bodies, list) or not (2 if route == 'split' else 1) <= len(bodies) <= 12:
            raise ValueError('Split needs 2–12 complete parts')
        for body in bodies:
            text(body, 'body')
            if len(body.strip()) < 12:
                raise ValueError('Each part must contain at least 12 characters')
        if any(p['status'] == 'needs_review' for p in parents):
            raise Conflict('来源已变化，请先核对来源。')
        title = text(data.get('title', parents[0]['title']), 'title', 140)
        revisions = data.get('revisions', {})
        if not isinstance(revisions, dict):
            raise ValueError('Expected parent revisions')
        for parent in parents:
            self.write_record(db, 'edit', parent['id'], {'hidden': True, 'transformed': route}, revisions.get(parent['id']), route)
        created = []
        for index, body in enumerate(bodies):
            custom = copy.deepcopy(parents[0])
            identity = 'm_' + uuid.uuid4().hex
            custom.update(id=identity, title=title + (f'（{index + 1}）' if route == 'split' else ''), body=body, summary=body[:240],
                          hidden=False, origin='manual_curated', status='curated', parents=[p['id'] for p in parents], created_at=stamp())
            for key in ('message_ids', 'source_documents', 'chats', 'authors'):
                custom[key] = sorted({v for p in parents for v in p[key]})
            custom['source_hashes'] = {k: v for p in parents for k, v in p['source_hashes'].items()}
            for key in ('user', 'user_revision', 'edit_revision', 'related', 'sources', 'documents'):
                custom.pop(key, None)
            self.write_record(db, 'edit', identity, {'custom': custom}, 0, route)
            created.append(identity)
        return {'ids': created, 'note': '原条目隐藏保留，个人笔记与版本历史仍可查看。'}

    def history(self, identity):
        with self.connect() as db:
            return [{'id': r['number'], 'action': r['action'], 'at': r['created_at'], 'value': json.loads(r['payload'])}
                    for r in db.execute('SELECT * FROM history WHERE id=? ORDER BY number DESC LIMIT 50', (identity,))]
