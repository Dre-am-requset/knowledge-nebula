"""Offline Lark/Feishu message JSON -> portable knowledge dataset.

This adapter never logs in, reads browser state, or calls a remote service.
Input/output exports are private runtime files and belong under ignored data/.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nebula.demo import TOPICS

CLUES = [('prompt-structure', r'prompt|提示词|输出格式|角色设定'),
         ('prompt-context', r'上下文|context|知识库|引用|材料'),
         ('prompt-quality', r'rubric|评测|评分|幻觉|准确'),
         ('prompt-iteration', r'复盘|迭代|对照|失败案例'),
         ('ai-coding', r'代码|测试|编程|commit|git\b'),
         ('engineering-errors', r'报错|限流|超时|异常|timeout'),
         ('agent-design', r'agent|智能体|工作流|workflow'),
         ('agent-running', r'持续运行|自动更新|定时|断点'),
         ('tool-integration', r'\bmcp\b|\bcli\b|\bapi\b|插件|接口')]


def content_text(message):
    body = message.get('body', {})
    raw = body.get('content', message.get('content', '')) if isinstance(body, dict) else message.get('content', '')
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            return raw.strip()
    pieces = []

    def visit(value):
        if isinstance(value, dict):
            if isinstance(value.get('text'), str):
                pieces.append(value['text'])
            if isinstance(value.get('title'), str):
                pieces.append(value['title'])
            if isinstance(value.get('href'), str):
                pieces.append(value['href'])
            for key, child in value.items():
                if key not in ('text', 'title', 'href'):
                    visit(child)
        elif isinstance(value, list):
            for item in value:
                visit(item)
    visit(raw)
    return '\n'.join(pieces).strip()


def convert(payload, label):
    found = {}

    def walk(value):
        if isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            if isinstance(value.get('message_id'), str):
                found[value['message_id']] = value
            else:
                for child in value.values():
                    if isinstance(child, (dict, list)):
                        walk(child)
    walk(payload)
    sources, atoms, groups = [], [], {}
    for mid, message in found.items():
        if not re.fullmatch(r'[A-Za-z0-9_.:-]+', mid):
            raise ValueError('Message IDs must be safe stable identifiers')
        group = message.get('chat_id') or 'feishu-export'
        groups[group] = {'id': group, 'name': label + (' · ' + group if group != 'feishu-export' else '')}
        body = content_text(message)
        sid = 'message:' + mid
        timestamp = message.get('create_time', '')
        if isinstance(timestamp, (int, str)) and str(timestamp).isdigit():
            from datetime import datetime, timezone
            number = int(timestamp)
            timestamp = datetime.fromtimestamp(number / 1000 if number > 100000000000 else number, timezone.utc).isoformat()
        sender = message.get('sender_name') or '导入消息作者'
        sources.append({'id': sid, 'title': body.splitlines()[0][:120] if body else '非文字消息',
                        'body': body, 'chat': group, 'sender': sender, 'time': timestamp or '1970-01-01T00:00:00+00:00',
                        'kind': 'topic' if message.get('thread_id') else 'fragment',
                        'thread_id': message.get('thread_id'), 'root_message_id': message.get('root_id'),
                        'url': message.get('message_app_link', ''),
                        'withdrawn': message.get('deleted') is True or message.get('is_recalled') is True})
        if not body or len(body) < 40 or sources[-1]['withdrawn']:
            continue
        topic = next((key for key, pattern in CLUES if re.search(pattern, body, re.I)), 'knowledge-notes')
        question = len(body) < 300 and bool(re.search(r'[?？]|请问|怎么|如何', body))
        atoms.append({'id': 'message-' + mid, 'title': body.splitlines()[0][:80], 'summary': body[:240],
                      'body': body, 'topic': topic, 'source_ids': [sid], 'kind': 'question' if question else 'experience',
                      'status': 'unresolved' if question else 'rule_extract', 'importance': 35 if question else 55,
                      'origin': 'offline_rule_extract', 'importance_reasons': ['离线词项摘编，尚未语义复核'],
                      'boundary': '保留原消息。按词项指定主题；未自动合并话题回复或验证消息结论。'})
    if not sources:
        raise ValueError('No message_id records found in input JSON')
    categories = [{'id': key, 'name': name, 'color': color} for key, name, color in
                  [('prompt', '提示词', '#79dedc'), ('engineering', '开发与工具', '#82bcef'),
                   ('agent', '工作流', '#ada2ef'), ('career', '知识整理', '#a8cd8c')]]
    return {'version': 1, 'label': label, 'demo': False, 'groups': list(groups.values()), 'categories': categories,
            'topics': [{'id': key, 'category': category, 'name': name} for key, category, name, _ in TOPICS],
            'sources': sources, 'atoms': atoms, 'cards': [], 'paths': []}


def main():
    parser = argparse.ArgumentParser(description='Convert an existing Feishu/Lark JSON export offline')
    parser.add_argument('file', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--label', default='飞书消息导入')
    args = parser.parse_args()
    dataset = convert(json.loads(args.file.read_text(encoding='utf-8-sig')), args.label)
    from nebula.dataset import normalize
    normalize(dataset)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'sources': len(dataset['sources']), 'knowledge': len(dataset['atoms']), 'output': str(args.output)}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
