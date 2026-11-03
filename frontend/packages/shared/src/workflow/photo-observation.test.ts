import { describe, expect, it } from 'vitest'
import {
  canReviewPhoto,
  parsePhotoRecovery,
  photoContentType,
  photoFileIssue,
  photoUploadRejected,
  reviewedObservations,
  validatePhoto,
  validatePhotoAnalysis,
  validatePhotoPage,
} from './photo-observation'

const photo = {
  id: 'P1',
  elder_id: 'E1',
  admission_id: 'A1',
  revision: 1,
  status: 'pending_review',
  occurred_at: '2026-10-25T08:00:00+08:00',
  created_at: '2026-10-25T08:01:00+08:00',
  caption: '',
  reviews: [],
  links: [],
  mime: 'image/jpeg',
  size_bytes: 100,
}
const output = {
  status: 'visible_observations',
  observations: ['虚构可见观察'],
  missing_information: [],
  verification_items: [],
  requires_professional_review: true,
}
const analysis = {
  id: 'AI1',
  attachment_id: 'P1',
  elder_id: 'E1',
  admission_id: 'A1',
  revision: 2,
  status: 'pending_review',
  model_status: 'visible_observations',
  created_at: photo.created_at,
  reviews: [],
  output,
}

describe('private photo observation contract and human review', () => {
  it('restores a photo sharing request only with a fixed local API path and a real boolean', () => {
    const saved = {
      publication: {
        id: 'P1',
        key: 'share-key',
        path: '/attachments/P1/family-sharing',
        payload: {
          expected_revision: 2,
          share_with_family: false,
          note: '停止展示',
        },
      },
    }
    expect(parsePhotoRecovery(JSON.stringify(saved), 'E1')).toEqual(saved)
    expect(() =>
      parsePhotoRecovery(
        JSON.stringify({
          publication: { ...saved.publication, path: 'https://other.invalid/' },
        }),
        'E1',
      ),
    ).toThrow()
    expect(() =>
      parsePhotoRecovery(
        JSON.stringify({
          publication: {
            ...saved.publication,
            payload: {
              ...saved.publication.payload,
              share_with_family: 'false',
            },
          },
        }),
        'E1',
      ),
    ).toThrow()
  })
  it('rejects corrupt recovery journals and cross-elder upload retries', () => {
    expect(parsePhotoRecovery('{}', 'E1')).toEqual({})
    const saved = {
      upload: {
        key: 'fixed-key',
        signature: 'original-file',
        query: 'elder_id=E1&occurred_at=2026-10-25T00%3A00%3A00Z',
        type: 'image/jpeg',
      },
    }
    expect(parsePhotoRecovery(JSON.stringify(saved), 'E1')).toEqual(saved)
    for (const raw of [
      'null',
      '[]',
      '{',
      '{"review":{"key":"x","id":"AI1","payload":{}}}',
      JSON.stringify(saved),
    ]) {
      expect(() => parsePhotoRecovery(raw, 'E2')).toThrow()
    }
  })
  it('accepts nonempty common photo formats and checks unlabeled files by content', () => {
    expect(photoFileIssue({ type: 'image/jpeg', size: 4 * 1024 * 1024 })).toBe(
      '',
    )
    expect(photoFileIssue({ type: 'image/webp', size: 1 })).toBe('')
    expect(photoFileIssue({ type: '', size: 1 })).toBe('')
    for (const file of [
      { type: 'image/gif', size: 1 },
      { type: 'image/png', size: 0 },
      { type: 'image/png', size: 4 * 1024 * 1024 + 1 },
    ])
      expect(photoFileIssue(file)).toBeTruthy()
  })
  it('detects actual JPEG, PNG or WebP bytes instead of trusting the filename', () => {
    expect(photoContentType(new Uint8Array([255, 216, 255, 224]))).toBe(
      'image/jpeg',
    )
    expect(
      photoContentType(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
    ).toBe('image/png')
    expect(photoContentType(new TextEncoder().encode('RIFF1234WEBP'))).toBe(
      'image/webp',
    )
    for (const bytes of [
      [],
      [255, 216],
      [...new TextEncoder().encode('<svg></svg>')],
    ])
      expect(() => photoContentType(new Uint8Array(bytes))).toThrow()
  })
  it('releases only pre-write validation failures, preserving uncertain requests', () => {
    for (const [status, code] of [
      [413, 'attachment_size_invalid'],
      [415, 'attachment_format_mismatch'],
      [422, 'attachment_image_invalid'],
    ])
      expect(photoUploadRejected({ status, code })).toBe(true)
    for (const status of [
      0, 401, 403, 404, 409, 413, 415, 422, 429, 500, 502, 503,
    ])
      expect(photoUploadRejected({ status })).toBe(false)
    expect(
      photoUploadRejected({ status: 422, code: 'elder_not_in_care' }),
    ).toBe(false)
    expect(photoUploadRejected(null)).toBe(false)
  })
  it('rejects cross-elder, wrong-id, invalid metadata and duplicate pages', () => {
    expect(validatePhoto(photo, 'E1', 'P1')).toBe(photo)
    for (const value of [
      { ...photo, elder_id: 'E2' },
      { ...photo, revision: 0 },
      { ...photo, mime: 'image/png' },
      { ...photo, occurred_at: '2026-10-25T08:00:00' },
    ])
      expect(() => validatePhoto(value, 'E1')).toThrow()
    expect(() => validatePhoto(photo, 'E1', 'OTHER')).toThrow()
    expect(() =>
      validatePhotoPage({ items: [photo, photo], total: 2 }, 'E1'),
    ).toThrow()
  })
  it('checks analysis identity, enums, output structure and formal-record receipts', () => {
    expect(validatePhotoAnalysis(analysis, 'E1', 'P1', 'AI1')).toBe(analysis)
    for (const value of [
      { ...analysis, attachment_id: 'P2' },
      { ...analysis, status: 'unknown' },
      { ...analysis, output: { ...output, observations: [123] } },
      { ...analysis, status: 'confirmed', record_id: null },
    ])
      expect(() => validatePhotoAnalysis(value, 'E1', 'P1')).toThrow()
    expect(
      validatePhotoAnalysis(
        { ...analysis, status: 'confirmed', record_id: 'R1' },
        'E1',
      ).record_id,
    ).toBe('R1')
  })
  it('preserves manager-requested edits instead of restoring original model observations', () => {
    expect(
      reviewedObservations({
        ...analysis,
        reviews: [
          {
            decision: 'request_management',
            observations: ['人工修正后的可见观察'],
          },
        ],
      }),
    ).toEqual(['人工修正后的可见观察'])
  })
  it('prevents caregivers and families from bypassing professional or completed review', () => {
    expect(canReviewPhoto(analysis, 'caregiver', 'confirm')).toBe(false)
    expect(canReviewPhoto(analysis, 'caregiver', 'request_management')).toBe(
      true,
    )
    expect(
      canReviewPhoto(
        { ...analysis, status: 'pending_management' },
        'caregiver',
        'reject',
      ),
    ).toBe(false)
    expect(
      canReviewPhoto(
        { ...analysis, status: 'pending_management' },
        'supervisor',
        'confirm',
      ),
    ).toBe(true)
    expect(
      canReviewPhoto({ ...analysis, status: 'confirmed' }, 'admin', 'confirm'),
    ).toBe(false)
    expect(canReviewPhoto(analysis, 'family', 'confirm')).toBe(false)
    expect(
      canReviewPhoto({ ...analysis, output: null }, 'caregiver', 'confirm'),
    ).toBe(true)
  })
})
