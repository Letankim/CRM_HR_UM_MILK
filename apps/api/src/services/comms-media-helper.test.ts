import { describe, expect, it } from 'vitest';
import type { AppContext } from '../context.js';
import {
  enrichMediaAsset,
  formatMediaSize,
  normalizeMediaUrls,
  parseMediaIds,
  resolveAnnouncementMediaAttachments,
} from './comms-media-helper.js';

describe('comms-media-helper', () => {
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

  it('formats media byte sizes cleanly', () => {
    expect(formatMediaSize(0)).toBe('—');
    expect(formatMediaSize(512)).toBe('512 Bytes');
    expect(formatMediaSize(245000)).toBe('239 KB');
    expect(formatMediaSize(2_621_440)).toBe('2.5 MB');
  });

  it('normalizes direct HTTP URLs, Google Drive share links, and internal placeholders', () => {
    expect(normalizeMediaUrls('drive://internal', 'image/png')).toEqual({
      openUrl: '',
      previewUrl: '',
      isImage: true,
    });
    expect(normalizeMediaUrls('https://cdn.example.com/banner-t10.png', 'image/png')).toEqual({
      openUrl: 'https://cdn.example.com/banner-t10.png',
      previewUrl: 'https://cdn.example.com/banner-t10.png',
      isImage: true,
    });
    const gd = normalizeMediaUrls('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123/view?usp=sharing', 'image/jpeg');
    expect(gd.openUrl).toContain('drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123');
    expect(gd.previewUrl).toBe('https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOpQrStUvWxYz123&sz=w1200');
    expect(gd.isImage).toBe(true);
  });

  it('resolves announcement media_ids ULIDs into full human-readable media asset metadata', () => {
    const sampleAsset = {
      id: '01M6443WFJ4138EJY2WQ98JRJG',
      code: 'MED-003',
      file_name: 'banner-chien-dich-cuoi-thang-10.png',
      mime_type: 'image/png',
      size_bytes: 245000,
      drive_file_id: 'https://example.com/media/banner-t10.png',
      category: 'BANNER',
      is_internal_only: true,
      uploaded_by: 'u_mkt',
      created_by: 'u_mkt',
      updated_by: 'u_mkt',
      created_at: '2026-10-29T10:00:00.000Z',
      updated_at: '2026-10-29T10:00:00.000Z',
      is_deleted: false,
      version: 1,
    };
    const mockCtx = {
      db: {
        users: {
          get: (id: string) => (id === 'u_mkt' ? { id: 'u_mkt', display_name: 'Nguyễn Truyền Thông' } : undefined),
        },
        mediaAssets: {
          get: (id: string) => (id === sampleAsset.id ? sampleAsset : undefined),
          all: () => [sampleAsset],
        },
      },
    } as unknown as AppContext;

    const enriched = enrichMediaAsset(mockCtx, sampleAsset);
    expect(enriched.mimeLabel).toBe('Hình ảnh PNG');
    expect(enriched.categoryLabel).toBe('Banner truyền thông');
    expect(enriched.sizeFormatted).toBe('239 KB');
    expect(enriched.creatorName).toBe('Nguyễn Truyền Thông');

    const attachments = resolveAnnouncementMediaAttachments(mockCtx, '01M6443WFJ4138EJY2WQ98JRJG,UNKNOWN_ORPHAN_ID');
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.file_name).toBe('banner-chien-dich-cuoi-thang-10.png');
    expect(attachments[0]?.code).toBe('MED-003');
    expect(attachments[0]?.openUrl).toBe('https://example.com/media/banner-t10.png');
  });
});
