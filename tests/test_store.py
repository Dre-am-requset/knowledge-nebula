import copy
import json
import tempfile
import threading
import unittest
from pathlib import Path

from nebula.dataset import normalize
from nebula.demo import make_demo
from nebula.store import Conflict, Store


def minimal():
    return json.loads((Path(__file__).resolve().parents[1] / 'examples' / 'minimal.json').read_text(encoding='utf-8'))


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'knowledge.sqlite'
        self.store = Store(self.path)
        self.data = minimal()
        self.store.import_data(self.data)
        self.identity = self.store.catalog({})['results'][0]['id']

    def tearDown(self):
        self.directory.cleanup()

    def test_stable_repeated_import_and_personal_overlays(self):
        self.store.mutate('state', {'id': self.identity, 'revision': 0, 'note': '我的独立练习结果', 'favorite': True, 'state': 'read'})
        self.store.mutate('edit', {'id': self.identity, 'revision': 0, 'title': '人工标题', 'body': '这是人工核对后保存的完整正文，包含适用条件与出处。'})
        self.store.import_data(self.data)
        restarted = Store(self.path)
        atom = restarted.atom(self.identity)
        self.assertEqual(atom['title'], '人工标题')
        self.assertEqual(atom['user']['note'], '我的独立练习结果')
        self.assertEqual(atom['user_revision'], 1)
        self.assertEqual(atom['edit_revision'], 1)
        self.assertEqual(atom['status'], 'curated')
        self.assertEqual(restarted.catalog({})['total'], 1)
        self.assertEqual(len(restarted.history(self.identity)), 2)

    def test_source_changes_hide_stale_curation_and_allow_explicit_review(self):
        self.store.mutate('edit', {'id': self.identity, 'revision': 0, 'body': '旧人工正文包含当时的解释与实际依据。'})
        updated = copy.deepcopy(self.data)
        updated['sources'][0]['body'] += '\n补充：使用边界样本重新练习。'
        self.store.import_data(updated)
        stale = self.store.atom(self.identity)
        self.assertEqual(stale['status'], 'needs_review')
        self.assertEqual(stale['body'], '')
        self.assertIn('补充', stale['sources'][0]['body'])
        with self.assertRaises(Conflict):
            self.store.mutate('edit', {'id': self.identity, 'revision': 1, 'body': '未确认来源时不能保存成已精编。'})
        self.store.mutate('edit', {'id': self.identity, 'revision': 1, 'body': '新正文已核对更新后的边界样本要求。', 'acknowledge_sources': True})
        self.assertEqual(self.store.atom(self.identity)['status'], 'curated')
        with self.store.connect() as db:
            raw = db.execute("SELECT first_payload FROM objects WHERE kind='sources'").fetchone()[0]
            self.assertNotIn('补充', json.loads(raw)['body'])
        self.assertEqual(self.store.history('source:' + self.data['sources'][0]['id'])[0]['action'], 'source_changed')

    def test_withdrawn_source_stays_unavailable_and_notes_survive(self):
        self.store.mutate('state', {'id': self.identity, 'revision': 0, 'note': '笔记保留'})
        updated = copy.deepcopy(self.data)
        updated['sources'][0]['withdrawn'] = True
        self.store.import_data(updated)
        atom = self.store.atom(self.identity)
        self.assertEqual(atom['body'], '')
        self.assertEqual(atom['sources'], [])
        self.assertEqual(atom['user']['note'], '笔记保留')
        with self.assertRaises(KeyError):
            self.store.document(self.data['sources'][0]['id'])
        with self.assertRaises(Conflict):
            self.store.mutate('edit', {'id': self.identity, 'revision': 0, 'body': '不能仅用确认选项恢复撤回的来源。', 'acknowledge_sources': True})

    def test_replace_preserves_hidden_personal_records(self):
        self.store.mutate('state', {'id': self.identity, 'revision': 0, 'note': '保留这条读后记录'})
        empty = copy.deepcopy(self.data)
        empty.update(atoms=[], sources=[], cards=[], paths=[])
        self.store.import_data(empty, replace=True)
        self.assertEqual(self.store.catalog({})['total'], 0)
        hidden = self.store.catalog({'state': 'hidden'})
        self.assertEqual(hidden['total'], 1)
        self.assertEqual(hidden['results'][0]['user']['note'], '保留这条读后记录')

    def test_concurrent_revision_conflict_keeps_one_valid_write(self):
        barrier = threading.Barrier(2)
        outcomes = []
        def save(note):
            barrier.wait()
            try:
                self.store.mutate('state', {'id': self.identity, 'revision': 0, 'note': note})
                outcomes.append('saved')
            except Conflict:
                outcomes.append('conflict')
        threads = [threading.Thread(target=save, args=(str(index),)) for index in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertCountEqual(outcomes, ['saved', 'conflict'])
        self.assertEqual(self.store.atom(self.identity)['user_revision'], 1)

    def test_merge_is_atomic_and_keeps_parent_notes(self):
        two = copy.deepcopy(self.data)
        two['atoms'].append(dict(two['atoms'][0], id='practice-002', title='另一条练习方法'))
        self.store.import_data(two)
        other = next(a['id'] for a in self.store.catalog({})['results'] if a['id'] != self.identity)
        self.store.mutate('state', {'id': self.identity, 'revision': 0, 'note': '原条目笔记'})
        args = {'id': self.identity, 'other': other, 'body': '合并后仍然完整的知识与适用条件。', 'revisions': {self.identity: 0, other: 9}}
        with self.assertRaises(Conflict):
            self.store.mutate('merge', args)
        self.assertEqual(self.store.catalog({})['total'], 2)
        self.assertFalse(self.store.atom(self.identity).get('hidden', False))
        args['revisions'][other] = 0
        merged = self.store.mutate('merge', args)['ids'][0]
        self.assertEqual(self.store.catalog({})['total'], 1)
        self.assertEqual(self.store.atom(merged)['body'], args['body'])
        self.assertEqual(self.store.atom(self.identity)['user']['note'], '原条目笔记')
        split = self.store.mutate('split', {'id': merged, 'parts': ['第一份完整知识解释与适用条件。', '第二份完整知识解释与实际步骤。'], 'revisions': {merged: 1}})
        self.assertEqual(len(split['ids']), 2)
        self.assertEqual(self.store.catalog({})['total'], 2)

    def test_invalid_dataset_fails_before_any_partial_import(self):
        bad = copy.deepcopy(self.data)
        bad['atoms'][0]['source_ids'] = ['unknown-source']
        with self.assertRaises(ValueError):
            self.store.import_data(bad, replace=True)
        self.assertEqual(self.store.catalog({})['total'], 1)
        bad = copy.deepcopy(self.data)
        bad['atoms'].append(copy.deepcopy(bad['atoms'][0]))
        with self.assertRaises(ValueError):
            normalize(bad)

    def test_demo_search_cards_and_learning_survive_restart(self):
        self.store.import_data(make_demo(), replace=True)
        self.assertEqual(self.store.catalog({})['total'], 288)
        self.assertEqual(len(self.store.atlas()['topics']), 12)
        self.assertEqual(len(self.store.atlas()['cards']), 8)
        self.assertGreater(self.store.search({'q': '引用'})['total'], 0)
        self.assertEqual(self.store.document('knowledge:prompt-brief')['review_status'], 'ready')
        self.store.mutate('learning', {'revision': 0, 'done': ['prompt-brief'], 'notes': {'prompt-brief': '原创练习'}})
        self.assertEqual(Store(self.path).learning()['value']['notes']['prompt-brief'], '原创练习')


if __name__ == '__main__':
    unittest.main()
