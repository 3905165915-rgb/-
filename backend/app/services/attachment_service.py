"""Private, bounded image files. JSON stores references, never public URLs."""
import copy
import hashlib
import io
import os
import warnings
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from app.services.care_scope_service import require_elder_access
from app.services.facility_service import care_eligible, version
from app.services.workflow import DomainError, audit, current_staff, find, identifier, now, parse_time, replayable

MAX_BYTES = 4 * 1024 * 1024
MAX_PIXELS = 16_000_000
MAX_PER_ELDER = 100
MAX_PER_OBJECT = 10


def access(data, item, user_id, role):
    current_staff(data, user_id, role)
    if role in {'admin', 'supervisor'}:
        return
    require_elder_access(data, item['elder_id'], user_id, role)
    if item['created_by'] != user_id and item['status'] != 'approved':
        raise DomainError('attachment_pending_review_private', 403)


def view(item):
    return {k: copy.deepcopy(v) for k, v in item.items() if k != 'storage_key'}


def normalize(content, mime):
    if not content or len(content) > MAX_BYTES:
        raise DomainError('attachment_size_invalid', 413)
    if mime not in {'image/jpeg', 'image/jpg', 'image/png', 'image/webp'}:
        raise DomainError('attachment_format_invalid', 415)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as source:
                # Browser MIME and downloaded filename extensions are only hints.
                # Trust a decoded, allowlisted raster format, then re-encode it.
                if source.format not in {'JPEG', 'PNG', 'WEBP'}:
                    raise DomainError('attachment_format_invalid', 415)
                if source.width * source.height > MAX_PIXELS or getattr(source, 'n_frames', 1) != 1:
                    raise DomainError('attachment_dimensions_invalid', 422)
                source.load()
                cleaned = ImageOps.exif_transpose(source).convert('RGB')
                # Re-encode pixels: discard EXIF/GPS, comments and arbitrary input names.
                result = io.BytesIO()
                cleaned.save(result, format='JPEG', quality=90)
                output = result.getvalue()
                if len(output) > MAX_BYTES:
                    raise DomainError('attachment_normalized_too_large', 413)
                return output, cleaned.width, cleaned.height
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        if isinstance(exc, DomainError):
            raise
        raise DomainError('attachment_image_invalid', 422) from exc


def file_path(store, item):
    base = (store.data_dir / 'attachments').resolve()
    target = (base / item['storage_key']).resolve()
    if target.parent != base or not target.name.endswith('.jpg'):
        raise DomainError('attachment_storage_reference_invalid', 500)
    return target


def upload(store, elder_id, occurred_at, caption, content, mime, user_id, role, key=None):
    data = store.read()
    current_staff(data, user_id, role)
    require_elder_access(data, elder_id, user_id, role)
    elder = care_eligible(data, elder_id)
    if occurred_at > parse_time(now()):
        raise DomainError('attachment_occurrence_in_future', 422)
    normalized, width, height = normalize(content, mime)
    item_id = identifier('PHOTO')
    item = {'id': item_id, 'elder_id': elder_id, 'admission_id': elder.get('current_admission_id'),
            'occurred_at': occurred_at.isoformat(), 'caption': caption, 'created_by': user_id,
            'created_at': now(), 'status': 'pending_review', 'revision': 1, 'reviews': [], 'links': [],
            'storage_key': item_id + '.jpg', 'mime': 'image/jpeg', 'size_bytes': len(normalized),
            'width': width, 'height': height, 'sha256': hashlib.sha256(normalized).hexdigest(),
            'original_sha256': hashlib.sha256(content).hexdigest()}
    path = file_path(store, item)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.upload')
    try:
        with temp.open('xb') as stream:
            stream.write(normalized)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
        def mutate(current):
            current_staff(current, user_id, role)
            require_elder_access(current, elder_id, user_id, role)
            current_elder = care_eligible(current, elder_id)
            if current_elder.get('current_admission_id') != item['admission_id']:
                raise DomainError('attachment_admission_changed')
            def operation():
                if sum(r['elder_id'] == elder_id for r in current['attachments']) >= MAX_PER_ELDER:
                    raise DomainError('attachment_elder_limit_reached', 422)
                current['attachments'].append(item)
                audit(current, 'upload_attachment', item_id, user_id, elder_id=elder_id)
                return view(item)
            return replayable(current, user_id, 'upload_attachment', key,
                              {'elder_id': elder_id, 'occurred_at': occurred_at.isoformat(), 'caption': caption,
                               'sha256': item['original_sha256']}, operation)
        result = store.mutate(mutate)
        if result['id'] != item_id:
            path.unlink(missing_ok=True)
        return result
    except BaseException:
        # Only unlink this request's generated path, never a shared existing file.
        if not any(r['id'] == item_id for r in store.read()['attachments']):
            path.unlink(missing_ok=True)
        raise
    finally:
        temp.unlink(missing_ok=True)


def listing(store, elder_id, user_id, role, limit=100, offset=0):
    data = store.read()
    require_elder_access(data, elder_id, user_id, role)
    items = []
    for item in reversed(data['attachments']):
        if item['elder_id'] != elder_id:
            continue
        try:
            access(data, item, user_id, role)
        except DomainError:
            continue
        items.append(view(item))
    return {'items': items[offset:offset + limit], 'total': len(items)}


def get(store, item_id, user_id, role, download=False):
    data = store.read()
    item = find(data, 'attachments', item_id, 'attachment_not_found')
    access(data, item, user_id, role)
    if not download:
        return view(item)
    path = file_path(store, item)
    if not path.is_file():
        raise DomainError('attachment_file_missing', 404)
    return path


def review(store, item_id, payload, user_id, role, key=None):
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        item = find(data, 'attachments', item_id, 'attachment_not_found')
        def operation():
            version(item, payload.expected_revision)
            if item['status'] != 'pending_review':
                raise DomainError('attachment_already_reviewed')
            item['reviews'].append({**payload.model_dump(), 'by': user_id, 'at': now()})
            item.update(status='approved' if payload.decision == 'approve' else 'rejected',
                        family_visible=payload.decision == 'approve' and payload.share_with_family,
                        revision=item['revision'] + 1)
            audit(data, 'review_attachment', item_id, user_id, elder_id=item['elder_id'], decision=payload.decision)
            return view(item)
        return replayable(data, user_id, 'review_attachment', key, {'id': item_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)


def family_sharing(store, item_id, payload, user_id, role, key=None):
    """Independent publication choice, including withdrawal after approval."""
    def mutate(data):
        current_staff(data, user_id, role, management=True)
        item = find(data, 'attachments', item_id, 'attachment_not_found')
        def operation():
            version(item, payload.expected_revision)
            if payload.share_with_family and item['status'] != 'approved':
                raise DomainError('family_photo_must_be_approved', 422)
            if payload.share_with_family and not any(link['target_type'] == 'record' for link in item['links']):
                raise DomainError('family_photo_requires_record_link', 422)
            item['family_visible'] = payload.share_with_family
            item['revision'] += 1
            item.setdefault('family_sharing_reviews', []).append({**payload.model_dump(), 'by': user_id, 'at': now()})
            audit(data, 'update_photo_family_sharing', item_id, user_id, elder_id=item['elder_id'],
                  shared=payload.share_with_family)
            return view(item)
        return replayable(data, user_id, 'update_photo_family_sharing', key,
                          {'id': item_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)


def link(store, item_id, payload, user_id, role, key=None):
    def mutate(data):
        item = find(data, 'attachments', item_id, 'attachment_not_found')
        access(data, item, user_id, role)
        def operation():
            collection = 'care_records' if payload.target_type == 'record' else 'incidents'
            target = find(data, collection, payload.target_id, 'attachment_target_not_found')
            if target['elder_id'] != item['elder_id'] or target.get('admission_id') != item['admission_id']:
                raise DomainError('attachment_target_elder_or_admission_mismatch', 422)
            if role in {'caregiver', 'nurse'} and target['created_by'] != user_id:
                raise DomainError('attachment_link_requires_author_or_management', 403)
            reference = payload.model_dump()
            if any(all(link.get(k) == v for k, v in reference.items()) for link in item['links']):
                return view(item)
            if sum(any(all(link.get(k) == v for k, v in reference.items()) for link in r['links']) for r in data['attachments']) >= MAX_PER_OBJECT:
                raise DomainError('attachment_object_limit_reached', 422)
            item['links'].append({**reference, 'by': user_id, 'at': now()})
            item['revision'] += 1
            audit(data, 'link_attachment', item_id, user_id, elder_id=item['elder_id'], target_id=target['id'])
            return view(item)
        return replayable(data, user_id, 'link_attachment', key, {'id': item_id, **payload.model_dump()}, operation)
    return store.mutate(mutate)
