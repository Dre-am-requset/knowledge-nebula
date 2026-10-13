import importlib.util
import unittest
from pathlib import Path

from nebula.dataset import normalize

spec = importlib.util.spec_from_file_location('offline_feishu', Path(__file__).resolve().parents[1] / 'adapters' / 'feishu_json.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class AdapterTests(unittest.TestCase):
    def test_nested_text_and_post_export_without_auth_or_network(self):
        payload = {'data': {'items': [
            {'message_id': 'example-message-1', 'create_time': '1767225600000', 'thread_id': 'example-thread',
             'body': {'content': '{"text":"提示词需要写清任务、输入和输出格式，然后用一个小样本检查字段是否齐全，保留缺失信息作为待确认项。"}'}},
            {'message_id': 'example-message-2', 'create_time': '1767225600000',
             'body': {'content': '{"zh_cn":{"title":"测试笔记","content":[[{"tag":"text","text":"先保存最小失败输入，再检查修复后的实际结果和边界情况，避免只看运行成功就认为业务已经正确。"}]]}}'}}
        ]}}
        data = normalize(adapter.convert(payload, '自编转换测试'))
        self.assertEqual(len(data['sources']), 2)
        self.assertEqual(len(data['atoms']), 2)
        self.assertEqual(data['sources'][0]['thread_id'], 'example-thread')
        self.assertEqual(data['atoms'][0]['topic'], 'prompt-structure')

    def test_non_message_export_fails_clearly(self):
        with self.assertRaises(ValueError):
            adapter.convert({'unrelated': 'document'}, '测试')


if __name__ == '__main__':
    unittest.main()
