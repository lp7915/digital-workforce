#!/usr/bin/env python3
"""验证本地报告产物；不以本地自报状态证明远端发布或业务真实性。"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from datetime import datetime
from urllib.parse import urlparse

FILES = ('events.json', 'quality.json', 'review-items.json', 'report.md', 'report.html')
SECTIONS = ('一句话结论', '周期与质量', '热点格局', '传播变化', '内容机会', '风险与行动', '事件清单', '行动建议', '来源与限制')


def http_url(value):
    try:
        parsed = urlparse(value)
        return parsed.scheme in ('http', 'https') and bool(parsed.hostname) and not parsed.username and not parsed.password
    except (TypeError, ValueError):
        return False


class ReportHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.unsafe = False
        self.text = []
        self.tags = set()

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag)
        if tag in ('script', 'iframe', 'object', 'embed', 'form', 'base', 'link', 'svg', 'math'):
            self.unsafe = True
        if tag == 'meta' and any(name not in ('charset', 'name', 'content') for name, _ in attrs):
            self.unsafe = True
        for name, value in attrs:
            if name.startswith('on') or name in ('srcdoc', 'style'):
                self.unsafe = True
            if name in ('href', 'src', 'action', 'poster', 'data', 'xlink:href', 'srcset') and not http_url(value):
                self.unsafe = True

    handle_startendtag = handle_starttag

    def handle_data(self, value):
        self.text.append(value)


def validate(root):
    root = Path(root).resolve()
    errors = []
    hashes = {}

    def fail(code, file, message):
        errors.append({'code': code, 'file': file, 'message': message})

    def read(name, json_file=False):
        path = root / name
        try:
            if path.is_symlink() or not path.is_file() or path.stat().st_size > 20 * 1024 * 1024:
                raise ValueError('文件不存在、为符号链接或超过 20 MB')
            raw = path.read_bytes()
            hashes[name] = hashlib.sha256(raw).hexdigest()
            text = raw.decode('utf-8')
            if not text.strip():
                raise ValueError('文件为空')
            if not json_file:
                return text
            value = json.loads(text)
            if not isinstance(value, dict):
                fail('INVALID_SCHEMA', name, 'JSON 顶层必须为对象')
                return {}
            return value
        except (OSError, ValueError) as error:
            fail('INVALID_FILE', name, str(error))
            return {} if json_file else ''

    manifest = read('output-manifest.json', True)
    if manifest.get('schema_version') != 1:
        fail('INVALID_SCHEMA', 'output-manifest.json', 'schema_version 必须为 1')
    for field in ('run_id', 'project_id'):
        if not isinstance(manifest.get(field), str) or not manifest[field].strip():
            fail('INVALID_CONTEXT', 'output-manifest.json', field + ' 不能为空')
    if not re.fullmatch(r'[a-f0-9]{64}', str(manifest.get('input_sha256', ''))):
        fail('INVALID_CONTEXT', 'output-manifest.json', 'input_sha256 必须为输入文件 SHA256')
    try:
        period = manifest['period']
        start, end = (datetime.fromisoformat(period[k].replace('Z', '+00:00')) for k in ('start', 'end'))
        if start.tzinfo is None or end.tzinfo is None or start >= end:
            raise ValueError()
    except (KeyError, TypeError, ValueError, AttributeError):
        fail('INVALID_CONTEXT', 'output-manifest.json', '周期必须是带时区的开始和结束时间，开始早于结束')
    if manifest.get('delivery_status') != 'draft':
        fail('UNVERIFIED_DELIVERY', 'output-manifest.json', '本验证器仅验收本地产物；远端发布须另以真实服务回读验证，不能自报成功')
    contents = {name: read(name, name.endswith('.json')) for name in FILES}
    expected = manifest.get('files')
    if not isinstance(expected, dict):
        expected = {}
    for name in FILES:
        if not re.fullmatch(r'[a-f0-9]{64}', str(expected.get(name, ''))) or expected.get(name) != hashes.get(name):
            fail('HASH_MISMATCH', name, '文件缺少 SHA256 或已在清单生成后被修改')
    for name in ('events.json', 'review-items.json', 'quality.json'):
        fields = ('period', 'input_sha256') if name == 'quality.json' else ('run_id', 'project_id', 'period', 'input_sha256')
        for field in fields:
            if contents[name].get(field) != manifest.get(field) or field not in contents[name]:
                fail('CONTEXT_MISMATCH', name, field + ' 与本轮清单不一致')
    events = contents['events.json'].get('events')
    if not isinstance(events, list) or not events:
        fail('INVALID_SCHEMA', 'events.json', 'events 必须为非空事件数组；无数据时返回阻塞原因，不能生成成功报告')
        events = []
    seen = set()
    for event in events:
        if not isinstance(event, dict):
            fail('INVALID_SCHEMA', 'events.json', '事件必须为对象')
            continue
        event_id = event.get('event_id')
        if not isinstance(event_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', event_id) or event_id in seen:
            fail('INVALID_EVENT', 'events.json', 'event_id 必须唯一且非空，仅使用字母数字、连字符、下划线')
            continue
        seen.add(event_id)
        urls = event.get('source_urls')
        if not isinstance(urls, list) or not urls or not all(http_url(url) for url in urls):
            fail('INVALID_SOURCE', 'events.json', event_id + ' 缺少有效来源 URL')
            continue
        for name in ('report.md', 'report.html'):
            report = contents[name]
            # 检查可追溯性；URL 的真实性与结论是否被来源支持仍须语义复核。
            if not re.search(r'(?<![\w-])' + re.escape(event_id) + r'(?![\w-])', report) or not any(url in report or url.replace('&', '&amp;') in report for url in urls):
                fail('MISSING_CITATION', name, event_id + ' 缺少事件编号或来源链接')
    review = contents['review-items.json'].get('items')
    if not isinstance(review, list):
        fail('INVALID_SCHEMA', 'review-items.json', 'items 必须为数组')
    elif any(not isinstance(item, dict) or item.get('status') != 'resolved' or not item.get('resolution') for item in review):
        fail('PENDING_REVIEW', 'review-items.json', '存在未解决或未记录处理依据的复核项')
    quality = contents['quality.json']
    if type(quality.get('valid_count')) is not int or quality['valid_count'] < 1:
        fail('INVALID_DATA', 'quality.json', '没有有效数据')
    html = ReportHTML()
    html.feed(contents['report.html'])
    if html.unsafe or not {'html', 'body'}.issubset(html.tags):
        fail('UNSAFE_HTML', 'report.html', '使用完整静态 HTML；禁止脚本、嵌入内容、事件属性、内联样式和非 HTTP(S) 资源')
    for name, text in [('report.md', contents['report.md']), ('report.html', ' '.join(html.text))]:
        for section in SECTIONS:
            if section not in text:
                fail('MISSING_SECTION', name, '缺少章节：' + section)
        if re.search(r'\bTODO\b|\bTBD\b|\{\{[^}]+\}\}|待填写|待填入|请填入|在此填写', text, re.I):
            fail('PLACEHOLDER', name, '报告存在未替换占位内容')
    return {'schema_version': 1, 'run_id': manifest.get('run_id'), 'status': 'failed' if errors else 'draft_validated', 'errors': errors, 'file_sha256': hashes, 'requires_semantic_review': True, 'remote_delivery_verified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir', required=True)
    args = parser.parse_args()
    root = Path(args.run_dir)
    result = validate(root)
    output = root / 'validation.json'
    # 避免沿产物目录中的符号链接写入其他文件。
    if output.is_symlink():
        raise SystemExit('validation.json 不允许为符号链接')
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': result['status'], 'error_count': len(result['errors']), 'result': str(output)}, ensure_ascii=False))
    raise SystemExit(1 if result['errors'] else 0)


if __name__ == '__main__':
    main()
