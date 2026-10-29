import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '../context.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';
import {
  enrichMediaAsset,
  formatMediaSize,
  normalizeMediaUrls,
  parseMediaIds,
  resolveAnnouncementMediaAttachments,
} from './comms-media-helper.js';
import { detectBufferMimeType, extractGoogleDriveFileId } from './mkt-media-storage.service.js';

// 1x1 PNG hợp lệ (68 bytes)
const SAMPLE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let t: TestAppContext;
let mktHeaders: Record<string, string>;

beforeAll(async () => {
  t = await buildTestApp('mkt_media_proxy');
  mktHeaders = await t.loginHeaders('mkt');
});

afterAll(async () => {
  await t.app.close();
});

describe('comms-media-helper & mkt-media-storage proxy (cơ chế chuẩn Điểm danh, 0 lỗi 403 Google Drive)', () => {
  it('parses media_ids from JSON array, CSV string, or array without leaking brackets', () => {
    expect(parseMediaIds('')).toEqual([]);
    expect(parseMediaIds('[]')).toEqual([]);
    expect(parseMediaIds('01M6443WFJ4138EJY2WQ98JRJG')).toEqual(['01M6443WFJ4138EJY2WQ98JRJG']);
    expect(parseMediaIds('["01M6443WFJ4138EJY2WQ98JRJG","01M6443WFJ4138EJY2WQ98JRJH"]')).toEqual([
      '01M6443WFJ4138EJY2WQ98JRJG',
      '01M6443WFJ4138EJY2WQ98JRJH',
    ]);
    expect(parseMediaIds('id_a, id_b , ')).toEqual(['id_a', 'id_b']);
  });

  it('formats media byte sizes and detects binary magic-byte MIME types cleanly', () => {
    expect(formatMediaSize(0)).toBe('—');
    expect(formatMediaSize(512)).toBe('512 Bytes');
    expect(formatMediaSize(245000)).toBe('239 KB');
    expect(formatMediaSize(2_621_440)).toBe('2.5 MB');

    const pngBuf = Buffer.from(SAMPLE_PNG_BASE64, 'base64');
    expect(detectBufferMimeType(pngBuf, 'application/octet-stream')).toBe('image/png');
    expect(detectBufferMimeType(Buffer.from('%PDF-1.7 sample'), 'image/png')).toBe('application/pdf');
  });

  it('extracts Drive File ID from all Google Drive URL variants and routes through /api/mkt/media/files/:id', () => {
    expect(extractGoogleDriveFileId('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123/view?usp=sharing')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz123');
    expect(extractGoogleDriveFileId('https://drive.google.com/thumbnail?sz=w1200&id=1AbCdEfGhIjKlMnOpQrStUvWxYz123')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz123');
    expect(extractGoogleDriveFileId('https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz123');
    expect(extractGoogleDriveFileId('1AbCdEfGhIjKlMnOpQrStUvWxYz123')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz123');
    expect(extractGoogleDriveFileId('drive://internal')).toBeNull();

    const gd = normalizeMediaUrls(
      'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123/view?usp=sharing',
      'image/jpeg',
      '01M6443WFJ4138EJY2WQ98JRJG',
    );
    expect(gd.openUrl).toBe('/api/mkt/media/files/01M6443WFJ4138EJY2WQ98JRJG');
    expect(gd.previewUrl).toBe('/api/mkt/media/files/01M6443WFJ4138EJY2WQ98JRJG');
    expect(gd.openUrl).not.toContain('googleusercontent');
    expect(gd.previewUrl).not.toContain('drive.google.com/thumbnail');
  });

  it('resolves announcement media_ids ULIDs into full human-readable proxy metadata', () => {
    const sampleAsset = {
      id: '01M6443WFJ4138EJY2WQ98JRJG',
      code: 'MED-003',
      file_name: 'banner-chien-dich-cuoi-thang-10.png',
      mime_type: 'image/png',
      size_bytes: 245000,
      drive_file_id: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123/view?usp=sharing',
      category: 'BANNER',
      is_internal_only: true,
      uploaded_by: 'u_mkt',
      created_by: 'u_mkt',
      updated_by: 'u_mkt',
      created_at: '2026-10-29T10:00:00.000Z',
      updated_at: '2026-10-29T10:00:00.000Z',
      is_deleted: false,
      version: 2,
    };
    const mockCtx = {
      db: {
        users: { get: (id: string) => (id === 'u_mkt' ? { id: 'u_mkt', display_name: 'Nguyễn Truyền Thông' } : undefined) },
        mediaAssets: {
          get: (id: string) => (id === sampleAsset.id ? sampleAsset : undefined),
          all: () => [sampleAsset],
        },
      },
    } as unknown as AppContext;

    const enriched = enrichMediaAsset(mockCtx, sampleAsset);
    expect(enriched.mimeLabel).toBe('Hình ảnh PNG');
    expect(enriched.categoryLabel).toBe('Banner truyền thông');
    expect(enriched.storageSourceLabel).toBe('Google Drive Hệ thống (05_MKT_MEDIA)');
    expect(enriched.openUrl).toBe('/api/mkt/media/files/01M6443WFJ4138EJY2WQ98JRJG?v=2');
    expect(enriched.previewUrl).toBe('/api/mkt/media/files/01M6443WFJ4138EJY2WQ98JRJG?v=2');

    const attachments = resolveAnnouncementMediaAttachments(mockCtx, '01M6443WFJ4138EJY2WQ98JRJG,UNKNOWN_ORPHAN_ID');
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.previewUrl).toBe('/api/mkt/media/files/01M6443WFJ4138EJY2WQ98JRJG?v=2');
  });

  it('uploads direct base64 image & serves raw PNG bytes via GET /api/mkt/media/files/:id for any viewer account', async () => {
    const createRes = await t.app.inject({
      method: 'POST',
      url: '/api/mkt/media',
      headers: mktHeaders,
      payload: {
        file_name: 'banner-truc-tiep-thang-10.png',
        mime_type: 'image/png',
        category: 'BANNER',
        is_internal_only: true,
        file_base64: `data:image/png;base64,${SAMPLE_PNG_BASE64}`,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json().data as { id: string; openUrl: string; previewUrl: string; size_bytes: number };
    expect(created.openUrl).toBe(`/api/mkt/media/files/${created.id}`);
    expect(created.previewUrl).toBe(`/api/mkt/media/files/${created.id}`);
    expect(created.size_bytes).toBe(Buffer.from(SAMPLE_PNG_BASE64, 'base64').length);

    // Trình duyệt không cần cookie Google cá nhân vẫn tải được ảnh 200 OK giống Điểm danh
    const streamRes = await t.app.inject({
      method: 'GET',
      url: `/api/mkt/media/files/${created.id}`,
    });
    expect(streamRes.statusCode).toBe(200);
    expect(streamRes.headers['content-type']).toBe('image/png');
    expect(streamRes.rawPayload.equals(Buffer.from(SAMPLE_PNG_BASE64, 'base64'))).toBe(true);
  });
});
