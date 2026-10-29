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
import { detectBufferMimeType, extractGoogleDriveFileId, saveMediaCache, toMktCacheKey } from './mkt-media-storage.service.js';

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
    expect(detectBufferMimeType(Buffer.from('%PDF-1.7 sample'), 'application/octet-stream')).toBe('application/pdf');
    const fakeZipBuf = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('tai-lieu-noi-bo/readme.txt')]);
    expect(detectBufferMimeType(fakeZipBuf, 'application/octet-stream', 'tai-lieu.zip')).toBe('application/zip');
    const fakeXlsxBuf = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml xl/workbook.xml')]);
    expect(detectBufferMimeType(fakeXlsxBuf, 'application/octet-stream')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('extracts Drive File ID from all Google Drive URL variants and routes through /api/mkt/media/files/:id', () => {
    expect(extractGoogleDriveFileId('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123/view?usp=sharing')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz123');
    expect(extractGoogleDriveFileId('https://drive.google.com/thumbnail?sz=w1200&id=1AbCdEfGhIjKlMnOpQrStUvWxYz123')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz123');
    expect(extractGoogleDriveFileId('https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOpQrStUvWxYz123&export=download')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz123');
    expect(extractGoogleDriveFileId('https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz123');
    expect(extractGoogleDriveFileId('1AbCdEfGhIjKlMnOpQrStUvWxYz123')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz123');
    expect(extractGoogleDriveFileId('drive://internal')).toBeNull();

    const gd = normalizeMediaUrls('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123/view?usp=sharing', 'image/jpeg', '01M6443WFJ4138EJY2WQ98JRJG');
    expect(gd.openUrl).toBe('/api/mkt/media/files/01M6443WFJ4138EJY2WQ98JRJG');
    expect(gd.previewUrl).toBe('/api/mkt/media/files/01M6443WFJ4138EJY2WQ98JRJG');
  });

  it('resolves announcement media_ids ULIDs into full human-readable proxy metadata', () => {
    const sampleAsset = {
      id: '01M6443WFJ4138EJY2WQ98JRJG', code: 'MED-003', file_name: 'banner-chien-dich-cuoi-thang-10.png',
      mime_type: 'image/png', size_bytes: 245000, drive_file_id: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123/view?usp=sharing',
      category: 'BANNER', is_internal_only: true, uploaded_by: 'u_mkt', created_by: 'u_mkt', updated_by: 'u_mkt',
      created_at: '2026-10-29T10:00:00.000Z', updated_at: '2026-10-29T10:00:00.000Z', is_deleted: false, version: 2,
    };
    const mockCtx = {
      db: {
        users: { get: (id: string) => (id === 'u_mkt' ? { id: 'u_mkt', display_name: 'Nguyễn Truyền Thông' } : undefined) },
        mediaAssets: { get: (id: string) => (id === sampleAsset.id ? sampleAsset : undefined), all: () => [sampleAsset] },
      },
    } as unknown as AppContext;

    const enriched = enrichMediaAsset(mockCtx, sampleAsset);
    expect(enriched.mimeLabel).toBe('Hình ảnh PNG');
    expect(enriched.categoryLabel).toBe('Banner truyền thông');
    expect(enriched.storageSourceLabel).toBe('Google Drive Hệ thống');
    expect(enriched.storageSourceLabel).not.toContain('05_MKT_MEDIA');
    expect(enriched.openUrl).toBe('/api/mkt/media/files/01M6443WFJ4138EJY2WQ98JRJG?v=2');

    const attachments = resolveAnnouncementMediaAttachments(mockCtx, '01M6443WFJ4138EJY2WQ98JRJG,UNKNOWN_ORPHAN_ID');
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.previewUrl).toBe('/api/mkt/media/files/01M6443WFJ4138EJY2WQ98JRJG?v=2');
  });

  it('uploads direct base64 image & serves raw PNG bytes via GET /api/mkt/media/files/:id for any viewer account', async () => {
    const createRes = await t.app.inject({
      method: 'POST', url: '/api/mkt/media', headers: mktHeaders,
      payload: {
        file_name: 'banner-truc-tiep-thang-10.png', mime_type: 'image/png',
        category: 'BANNER', is_internal_only: true, file_base64: `data:image/png;base64,${SAMPLE_PNG_BASE64}`,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json().data as { id: string; openUrl: string; previewUrl: string; size_bytes: number };
    expect(created.openUrl).toBe(`/api/mkt/media/files/${created.id}`);
    expect(created.size_bytes).toBe(Buffer.from(SAMPLE_PNG_BASE64, 'base64').length);

    const streamRes = await t.app.inject({ method: 'GET', url: `/api/mkt/media/files/${created.id}` });
    expect(streamRes.statusCode).toBe(200);
    expect(streamRes.headers['content-type']).toBe('image/png');
    expect(streamRes.rawPayload.equals(Buffer.from(SAMPLE_PNG_BASE64, 'base64'))).toBe(true);
  });

  it('auto-calculates distinct fileName, size, and MIME across multiple switched links without losing fileName on cache hit', async () => {
    const fakePngId = '1VitestFakePngId00000000001';
    const pngBytes = Buffer.from(SAMPLE_PNG_BASE64, 'base64');
    saveMediaCache(t.ctx, toMktCacheKey(fakePngId), pngBytes);

    const probeRes = await t.app.inject({
      method: 'POST', url: '/api/mkt/media/probe', headers: mktHeaders,
      payload: { url: `https://drive.google.com/file/d/${fakePngId}/view?usp=drive_link` },
    });
    expect(probeRes.statusCode).toBe(200);
    const info = probeRes.json().data as {
      reachable: boolean; driveFileId: string; fileName: string; mimeType: string; sizeBytes: number; previewUrl: string;
    };
    expect(info.reachable).toBe(true);
    expect(info.driveFileId).toBe(fakePngId);
    expect(info.fileName).toBe('tep-dinh-kem-1VitestF.png');
    expect(info.mimeType).toBe('image/png');
    expect(info.sizeBytes).toBe(pngBytes.length);
    expect(info.previewUrl).toBe(`/api/mkt/media/files/${fakePngId}`);

    // Chuyển sang tệp ZIP số 1 -> rồi chuyển sang tệp Excel số 2: mỗi tệp trả đúng fileName riêng của tệp mới, kể cả khi probe lại từ cache
    const zipDriveId = '1VitestFakeZipId00000000002';
    const zipBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('bo-tai-lieu-mkt-thang-11/data.csv')]);
    saveMediaCache(t.ctx, toMktCacheKey(zipDriveId), zipBytes, { fileName: 'BoTaiLieu_SOP_Q4.zip', mimeType: 'application/zip' });

    const xlsxDriveId = '1VitestFakeXlsxId0000000003';
    const xlsxBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml xl/workbook.xml')]);
    saveMediaCache(t.ctx, toMktCacheKey(xlsxDriveId), xlsxBytes, { fileName: 'BangKeChienDich_T11.xlsx' });

    const zipProbeRes = await t.app.inject({
      method: 'POST', url: '/api/mkt/media/probe', headers: mktHeaders,
      payload: { url: `https://drive.google.com/file/d/${zipDriveId}/view` },
    });
    const zipInfo = zipProbeRes.json().data as { reachable: boolean; fileName: string; mimeType: string; mimeLabel: string; sizeBytes: number; isImage: boolean; previewUrl: string };
    expect(zipInfo.reachable).toBe(true);
    expect(zipInfo.fileName).toBe('BoTaiLieu_SOP_Q4.zip');
    expect(zipInfo.mimeType).toBe('application/zip');
    expect(zipInfo.mimeLabel).toBe('Tệp nén ZIP');
    expect(zipInfo.isImage).toBe(false);
    expect(zipInfo.previewUrl).toBe('');

    const xlsxProbeRes = await t.app.inject({
      method: 'POST', url: '/api/mkt/media/probe', headers: mktHeaders,
      payload: { url: `https://drive.google.com/file/d/${xlsxDriveId}/view` },
    });
    const xlsxInfo = xlsxProbeRes.json().data as { reachable: boolean; fileName: string; mimeType: string; mimeLabel: string; isImage: boolean };
    expect(xlsxInfo.reachable).toBe(true);
    expect(xlsxInfo.fileName).toBe('BangKeChienDich_T11.xlsx');
    expect(xlsxInfo.mimeLabel).toBe('Bảng tính Excel (XLSX)');
    expect(xlsxInfo.isImage).toBe(false);

    const saveZipRes = await t.app.inject({
      method: 'POST', url: '/api/mkt/media', headers: mktHeaders,
      payload: { file_name: zipInfo.fileName, mime_type: zipInfo.mimeType, size_bytes: zipInfo.sizeBytes, category: 'ARCHIVE_PACKAGE', drive_url: `https://drive.google.com/file/d/${zipDriveId}/view` },
    });
    expect(saveZipRes.statusCode).toBe(201);
    const savedZip = saveZipRes.json().data as { id: string; file_name: string; isImage: boolean; mimeLabel: string };
    expect(savedZip.file_name).toBe('BoTaiLieu_SOP_Q4.zip');
    expect(savedZip.isImage).toBe(false);

    const dlZipRes = await t.app.inject({ method: 'GET', url: `/api/mkt/media/files/${savedZip.id}` });
    expect(dlZipRes.statusCode).toBe(200);
    expect(dlZipRes.headers['content-type']).toBe('application/zip');
    expect(dlZipRes.headers['content-disposition']).toContain('attachment;');
    expect(dlZipRes.rawPayload.equals(zipBytes)).toBe(true);
  });
});
