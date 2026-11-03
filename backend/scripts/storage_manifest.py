"""Hash an offline store and its referenced photos; never initialize or restore data."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.storage.json_store import JsonStore


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
        separators=(',', ':')).encode('utf-8')).hexdigest()


def manifest(source, attachments=None):
    source = Path(source).resolve(strict=True)
    raw = source.read_bytes()
    data = json.loads(raw)
    JsonStore._validate(data)
    root = Path(attachments) if attachments is not None else source.parent / 'attachments'
    photos = []
    for item in data['attachments']:
        path = JsonStore._attachment_path(root, item)
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != item['sha256']:
            raise ValueError('Attachment digest does not match the offline store')
        photos.append({'id': item['id'], 'sha256': actual, 'bytes': path.stat().st_size})
    if source.read_bytes() != raw:
        raise RuntimeError('Store changed during verification; use a stopped-service snapshot')
    return {'schema_version': data['schema_version'], 'store_sha256': hashlib.sha256(raw).hexdigest(),
            'collections': {key: {'count': len(value), 'sha256': digest(sorted(value,
                key=lambda row: (str(row.get('id', '')), digest(row))))}
                for key, value in sorted(data.items()) if isinstance(value, list)},
            'attachments': sorted(photos, key=lambda row: row['id'])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('store_json', type=Path)
    parser.add_argument('--attachments', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    # Never overwrite the source store or an existing operational artifact.
    if args.output.resolve() == args.store_json.resolve():
        parser.error('Output must be separate from the source store')
    result = manifest(args.store_json, args.attachments)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
    print('Offline storage manifest verified and written')


if __name__ == '__main__':
    main()
