"""Package an explicit public-source allowlist, never a recursive workspace copy."""
import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = (
    '.gitattributes', '.gitignore', 'README.md', 'LICENSE', '分享说明.txt',
    'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'start.cmd', 'start.sh', 'docs/preview.png', 'docs/USAGE.md',
    'nebula/__init__.py', 'nebula/__main__.py', 'nebula/dataset.py', 'nebula/demo.py',
    'nebula/store.py', 'nebula/server.py', 'adapters/feishu_json.py', 'examples/minimal.json',
    'web/index.html', 'web/atlas.css', 'web/atlas.js', 'web/fragments.js', 'web/galaxy3d.js',
    'web/archive.html', 'web/vendor/three.module.min.js', 'web/vendor/three.core.min.js',
    'web/vendor/OrbitControls.js', 'web/vendor/THREE-LICENSE.txt',
    'tests/test_store.py', 'tests/test_http.py', 'tests/test_adapter.py', 'tests/test_release.py', 'tools/package_release.py',
)
CHECKS = [
    ('real account/message identifier', re.compile(r'\b(?:oc_|ou_|om_x)[a-f0-9]{24,}\b', re.I)),
    ('local user profile path', re.compile(r'[A-Z]:[\\/]Users[\\/]|\/Users\/[^\/\s]+\/', re.I)),
    ('credential-shaped token', re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{24,})\b')),
    ('private document link', re.compile(r'https?://[^\s/]+\.feishu\.cn/(?:docx|wiki|sheets)/[A-Za-z0-9]{10,}', re.I)),
]


def public_files():
    verified = []
    root = ROOT.resolve()
    for relative in PUBLIC_FILES:
        file = (root / relative).resolve()
        if not file.is_relative_to(root) or not file.is_file():
            raise ValueError(f'Missing or out-of-root release file: {relative}')
        body = file.read_bytes()
        if file.suffix != '.png':
            content = body.decode('utf-8')
            for name, pattern in CHECKS:
                if pattern.search(content):
                    # Report the path and category, never the sensitive matched text.
                    raise ValueError(f'Release scan found {name} in {relative}')
        verified.append((relative, body))
    return verified


def package(output):
    files = public_files()
    manifest = {'project': 'Knowledge Nebula', 'version': '0.1.0', 'license': 'MIT',
                'files': {name: hashlib.sha256(body).hexdigest() for name, body in files},
                'runtime_data_included': False}
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for relative, body in files:
            info = zipfile.ZipInfo('knowledge-nebula/' + relative, date_time=(2026, 10, 13, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if relative.endswith('.sh') else 0o644) << 16
            archive.writestr(info, body)
        archive.writestr('knowledge-nebula/RELEASE_MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    output.with_suffix('.manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'archive': str(output), 'public_files': len(files), 'bytes': output.stat().st_size,
            'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'runtime_data_included': False}


def main():
    parser = argparse.ArgumentParser(description='Create a source-only Knowledge Nebula release')
    parser.add_argument('--output', type=Path, default=ROOT / 'dist' / 'knowledge-nebula-v0.1.0.zip')
    args = parser.parse_args()
    print(json.dumps(package(args.output.resolve()), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        raise SystemExit(str(error))
