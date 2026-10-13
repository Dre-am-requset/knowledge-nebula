import argparse
import json
from pathlib import Path

from . import __version__
from .demo import make_demo
from .server import serve
from .store import Store


def main():
    parser = argparse.ArgumentParser(description='Knowledge Nebula — local knowledge, interactive 3D stars')
    parser.add_argument('--version', action='version', version=__version__)
    parser.add_argument('--db', default='data/nebula.sqlite', help='Local SQLite file (default: data/nebula.sqlite)')
    sub = parser.add_subparsers(dest='command', required=True)
    demo = sub.add_parser('demo', help='Import original public examples')
    demo.add_argument('--replace', action='store_true', help='Replace active imported dataset; personal records are preserved')
    start = sub.add_parser('serve', help='Run local website')
    start.add_argument('--port', type=int, default=8768)
    start.add_argument('--demo', action='store_true', help='Initialize demo only when the database has no imported dataset')
    ingest = sub.add_parser('import', help='Validate and import a version-1 knowledge JSON file')
    ingest.add_argument('file', type=Path)
    ingest.add_argument('--replace', action='store_true', help='Mark absent source objects inactive; keep notes and audit history')
    sub.add_parser('status', help='Show local dataset counts')
    args = parser.parse_args()
    store = Store(args.db)
    if args.command == 'demo':
        result = store.import_data(make_demo(), replace=args.replace)
    elif args.command == 'import':
        if args.file.stat().st_size > 50000000:
            raise ValueError('Import file exceeds 50 MB; split it into smaller incremental imports')
        result = store.import_data(json.loads(args.file.read_text(encoding='utf-8-sig')), replace=args.replace)
    elif args.command == 'serve':
        if not 0 <= args.port <= 65535:
            raise ValueError('Port must be between 0 and 65535')
        with store.connect() as db:
            initialized = bool(store.metadata(db).get('generation'))
        if not initialized:
            if args.demo:
                store.import_data(make_demo())
            else:
                raise ValueError('No dataset loaded. Run `python -m nebula demo` or `python -m nebula import FILE` first.')
        serve(store, args.port)
        return
    else:
        result = {'version': __version__, 'totals': store.atlas()['totals'], 'atoms': store.catalog({})['total']}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        raise SystemExit(str(error))
