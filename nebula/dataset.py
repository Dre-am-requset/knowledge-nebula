"""Portable JSON contract. No account, model or database service is required."""
import hashlib
import json
import re
from datetime import datetime, timezone

KINDS = {'method', 'experience', 'prompt', 'code', 'resource', 'question'}
STATES = {'unread', 'read', 'to_learn', 'mastered'}
ATOM_ID = re.compile(r'(?:a_|m_)[a-f0-9]{30,32}')


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(encoded(value).encode('utf-8')).hexdigest()


def atom_id(value):
    return value if ATOM_ID.fullmatch(value) else 'a_' + hashlib.sha256(value.encode('utf-8')).hexdigest()[:30]


def text(value, name, limit=50000, empty=False):
    if not isinstance(value, str) or len(value) > limit or not empty and not value.strip():
        raise ValueError(f'{name} must be a non-empty string of at most {limit} characters')
    return value


def identity(value):
    value = text(value, 'id', 120)
    if not re.fullmatch(r'[A-Za-z0-9_.:-]+', value):
        raise ValueError('IDs may contain ASCII letters, numbers, _, -, . and :')
    return value


def collection(value, name):
    if not isinstance(value, list) or len(value) > 100000:
        raise ValueError(f'{name} must be a list with at most 100000 items')
    if any(not isinstance(item, dict) for item in value):
        raise ValueError(f'{name} items must be objects')
    ids = [identity(item.get('id')) for item in value]
    if len(set(ids)) != len(ids):
        raise ValueError(f'Duplicate IDs in {name}')
    return value


def normalize(data):
    if not isinstance(data, dict) or data.get('version') != 1:
        raise ValueError('Dataset must be an object with version: 1')
    result = {'version': 1, 'label': text(data.get('label'), 'label', 200),
              'generated_at': stamp(), 'demo': data.get('demo') is True}
    for name in ('groups', 'categories', 'topics', 'sources', 'atoms', 'cards', 'paths'):
        result[name] = collection(data.get(name, []), name)
    groups = {g['id']: g for g in result['groups']}
    categories = {c['id']: c for c in result['categories']}
    for group in groups.values():
        text(group.get('name'), 'group.name', 200)
    for category in categories.values():
        text(category.get('name'), 'category.name', 200)
        if not isinstance(category.get('color'), str) or not re.fullmatch(r'#[a-fA-F0-9]{6}', category['color']):
            raise ValueError('Category colors must be #RRGGBB')
        category.setdefault('description', '')
        if 'position' in category and (not isinstance(category['position'], list) or len(category['position']) != 3
                                       or any(type(x) not in (int, float) or not -500 <= x <= 500 for x in category['position'])):
            raise ValueError('Category position must contain three numbers between -500 and 500')
    if 'unclassified' not in categories:
        fallback = {'id': 'unclassified', 'name': '待归类', 'color': '#7d8da7', 'description': '尚未指定主题的资料'}
        result['categories'].append(fallback)
        categories['unclassified'] = fallback
    topics = {t['id']: t for t in result['topics']}
    for topic in topics.values():
        text(topic.get('name'), 'topic.name', 200)
        if not isinstance(topic.get('category'), str) or topic['category'] not in categories:
            raise ValueError(f'Unknown category in topic {topic["id"]}')
    sources = {s['id']: s for s in result['sources']}
    for source in sources.values():
        text(source.get('title'), 'source.title', 300)
        text(source.get('body'), 'source.body', 500000, empty=True)
        if not isinstance(source.get('chat'), str) or source['chat'] not in groups:
            raise ValueError(f'Unknown group in source {source["id"]}')
        source.setdefault('sender', '资料作者')
        source.setdefault('time', stamp())
        source.setdefault('url', '')
        source.setdefault('kind', 'document')
        source.setdefault('withdrawn', False)
        text(source['time'], 'source.time', 40)
        text(source['sender'], 'source.sender', 200)
        text(source['url'], 'source.url', 2000, empty=True)
        if not isinstance(source['withdrawn'], bool):
            raise ValueError('source.withdrawn must be a boolean')

    def provenance(item):
        ids = item.get('source_ids')
        if not isinstance(ids, list) or not ids or any(not isinstance(sid, str) or sid not in sources for sid in ids):
            raise ValueError(f'{item["id"]} must reference at least one included source')
        if not isinstance(item.get('topic'), str) or item['topic'] not in topics and item['topic'] != 'unclassified':
            raise ValueError(f'Unknown topic in {item["id"]}')
        ids = list(dict.fromkeys(ids))
        item.update(message_ids=ids, source_documents=ids,
                    source_hashes={sid: digest(sources[sid]) for sid in ids},
                    chats=sorted({sources[sid]['chat'] for sid in ids}),
                    authors=sorted({sources[sid]['sender'] for sid in ids}),
                    first=min(sources[sid]['time'] for sid in ids), last=max(sources[sid]['time'] for sid in ids))

    for atom in result['atoms']:
        atom['external_id'] = atom['id']
        atom['id'] = atom_id(atom['id'])
        text(atom.get('title'), 'atom.title', 160)
        text(atom.get('body'), 'atom.body')
        text(atom.get('summary', atom['body'][:240]), 'atom.summary', 1000)
        atom.setdefault('summary', atom['body'][:240])
        if atom.get('kind', 'method') not in KINDS:
            raise ValueError('Unknown atom kind')
        score = atom.get('importance', 50)
        if type(score) is not int or not 0 <= score <= 100:
            raise ValueError('Importance must be an integer between 0 and 100')
        provenance(atom)
        atom.setdefault('kind', 'method')
        atom.setdefault('importance', 50)
        atom.setdefault('importance_reasons', ['导入资料指定的阅读优先级'])
        atom.setdefault('priority_author', False)
        atom.setdefault('origin', 'imported')
        atom.setdefault('status', 'rule_extract')
        atom.setdefault('boundary', '请结合出处、适用条件和记录时间使用。星间距离不表示语义相似度。')
        atom.setdefault('created_at', stamp())
    if len({a['id'] for a in result['atoms']}) != len(result['atoms']):
        raise ValueError('Atom IDs collide after normalization')
    for card in result['cards']:
        text(card.get('title'), 'card.title', 200)
        text(card.get('summary'), 'card.summary', 1000)
        provenance(card)
        card.setdefault('origin', 'curated')
        card.setdefault('references', [])
        card.setdefault('template', None)
        if not isinstance(card.get('sections'), list) or not card['sections']:
            raise ValueError('Each summary card needs sections')
        for section in card['sections']:
            if not isinstance(section, dict):
                raise ValueError('Card sections must be objects')
            text(section.get('heading'), 'section.heading', 200)
            if 'text' in section:
                text(section['text'], 'section.text', empty=True)
            if 'items' in section and (not isinstance(section['items'], list) or any(not isinstance(x, str) for x in section['items'])):
                raise ValueError('Section items must be strings')
        if card['template'] is not None:
            text(card['template'], 'card.template')
        if not isinstance(card['references'], list) or any(not isinstance(x, dict) or not isinstance(x.get('url'), str)
                                                         or not isinstance(x.get('title'), str) for x in card['references']):
            raise ValueError('Card references need title and url')
    cards = {c['id'] for c in result['cards']}
    for path in result['paths']:
        text(path.get('title'), 'path.title', 200)
        text(path.get('description'), 'path.description', 2000, empty=True)
        if not isinstance(path.get('steps'), list):
            raise ValueError('Learning path needs steps')
        for step in path['steps']:
            if not isinstance(step, dict) or not isinstance(step.get('card'), str) or step['card'] not in cards:
                raise ValueError('Learning steps must reference included cards')
            for key in ('title', 'exercise', 'question', 'explanation'):
                text(step.get(key), 'step.' + key, 2000)
            options = step.get('options')
            if not isinstance(options, list) or not options or any(not isinstance(o, str) for o in options):
                raise ValueError('Learning steps need text options')
            if type(step.get('answer')) is not int or not 0 <= step['answer'] < len(options):
                raise ValueError('Invalid learning quiz answer')
            if type(step.get('minutes')) is not int or step['minutes'] < 1:
                raise ValueError('Invalid learning duration')
    return result
