'use client';

import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Image } from 'antd';
import { DownloadOutlined, FileImageOutlined, ZoomInOutlined } from '@ant-design/icons';

export interface FancyboxSlideItem {
  src: string;
  caption?: string;
}

/**
 * Chuẩn hóa đường dẫn ảnh xem trước để hoạt động đồng nhất cả qua Rewrite `/api`
 * lẫn khi `NEXT_PUBLIC_API_BASE` trỏ trực tiếp tới máy chủ API.
 */
export function resolvePreviewSrc(rawSrc: string): string {
  const s = String(rawSrc || '').trim();
  if (!s) return '';
  if (s.startsWith('data:') || s.startsWith('blob:') || /^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/api/')) {
    const apiBase = (process.env.NEXT_PUBLIC_API_BASE ?? '/api').replace(/\/+$/, '');
    return `${apiBase}${s.slice(4)}`;
  }
  return s;
}

function downloadImageSrc(src: string, caption?: string) {
  if (!src || typeof document === 'undefined') return;
  const link = document.createElement('a');
  const safeName = (caption || 'minh-chung').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'minh-chung';
  link.href = src;
  link.download = `${safeName}.jpg`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** Mở trình xem ảnh phóng to độ nét cao (Ant Design Lightbox zIndex 2500 — nổi trên mọi Modal/Drawer). */
export function openFancyboxGallery(slides: FancyboxSlideItem[], startIndex = 0) {
  if (typeof document === 'undefined') return;
  const valid = slides.map((s) => ({ src: resolvePreviewSrc(s.src), caption: s.caption })).filter((s) => Boolean(s.src));
  if (valid.length === 0) return;

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const safeStart = Math.min(Math.max(0, startIndex), valid.length - 1);
  const cleanup = () => setTimeout(() => { root.unmount(); host.remove(); }, 220);

  function ImperativeGallery() {
    const [visible, setVisible] = useState(true);
    const [cur, setCur] = useState(safeStart);
    const activeCaption = valid[cur]?.caption;
    return (
      <Image.PreviewGroup
        items={valid.map((item) => ({ src: item.src, alt: item.caption || 'Hình ảnh' }))}
        preview={{
          visible, current: cur, zIndex: 2500, minScale: 0.25, maxScale: 8,
          onChange: (next) => setCur(next),
          onVisibleChange: (vis) => { setVisible(vis); if (!vis) cleanup(); },
          countRender: (current, total) => activeCaption ? `${activeCaption} (${current}/${total})` : `${current} / ${total}`,
        }}
      >
        <span style={{ display: 'none' }} />
      </Image.PreviewGroup>
    );
  }
  root.render(<ImperativeGallery />);
}

export interface FancyboxImageProps {
  src: string;
  alt: string;
  caption?: string;
  gallerySlides?: FancyboxSlideItem[];
  slideIndex?: number;
  height?: number | string;
  objectFit?: 'cover' | 'contain';
}

export function FancyboxImage({
  src, alt, caption, gallerySlides, slideIndex = 0, height = 155, objectFit = 'cover',
}: FancyboxImageProps) {
  const [hovered, setHovered] = useState(false);
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(slideIndex);

  const resolvedSrc = useMemo(() => resolvePreviewSrc(src), [src]);
  const slides = useMemo(() => {
    const raw = gallerySlides && gallerySlides.length > 0 ? gallerySlides : [{ src, caption: caption || alt }];
    return raw.map((item) => ({ src: resolvePreviewSrc(item.src), caption: item.caption || alt })).filter((item) => Boolean(item.src));
  }, [gallerySlides, src, caption, alt]);

  useEffect(() => { setFailed(false); }, [resolvedSrc]);

  const isCompact = typeof height === 'number' && height < 88;

  if (!resolvedSrc || failed) {
    return (
      <div style={{
        width: '100%', height: typeof height === 'number' ? Math.min(height, 110) : 100, borderRadius: 4,
        background: '#F8FAFC', border: '1px dashed #CBD5E1', color: '#64748B', fontSize: 11, padding: '0 6px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textAlign: 'center',
      }}>
        <FileImageOutlined />
        {!isCompact && <span>Không tải được ảnh xem trước</span>}
      </div>
    );
  }

  const openPreview = (e?: MouseEvent) => {
    e?.stopPropagation();
    setCurrentIdx(Math.min(Math.max(0, slideIndex), Math.max(0, slides.length - 1)));
    setPreviewOpen(true);
  };
  const activeSlide = slides[currentIdx] ?? slides[0];

  return (
    <Image.PreviewGroup
      items={slides.map((s) => ({ src: s.src, alt: s.caption }))}
      preview={{
        visible: previewOpen, current: currentIdx, zIndex: 2500, minScale: 0.25, maxScale: 8,
        onChange: (next) => setCurrentIdx(next),
        onVisibleChange: (vis) => setPreviewOpen(vis),
        countRender: (cur, total) => activeSlide?.caption ? `${activeSlide.caption}${total > 1 ? ` (${cur}/${total})` : ''}` : `${cur} / ${total}`,
        toolbarRender: (originalNode) => (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {originalNode}
            <button
              type="button" title="Tải ảnh về máy"
              onClick={() => downloadImageSrc(activeSlide?.src || resolvedSrc, activeSlide?.caption || alt)}
              style={{
                border: '1px solid rgba(255,255,255,0.28)', background: 'rgba(15, 23, 42, 0.72)', color: '#FFFFFF',
                borderRadius: 4, height: 36, padding: '0 10px', cursor: 'pointer', display: 'inline-flex',
                alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
              }}
            >
              <DownloadOutlined /> Tải ảnh
            </button>
          </div>
        ),
      }}
    >
      <div
        role="button" tabIndex={0} title="Bấm để phóng to hình ảnh"
        onClick={openPreview}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openPreview(); } }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        style={{ position: 'relative', width: '100%', height, borderRadius: 4, overflow: 'hidden', cursor: 'zoom-in', background: '#F8FAFC' }}
      >
        <img
          src={resolvedSrc} alt={alt} loading="lazy" onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit, display: 'block', transition: 'transform 0.18s ease', transform: hovered ? 'scale(1.03)' : 'scale(1)' }}
        />
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.42)', opacity: hovered ? 1 : 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', transition: 'opacity 0.16s ease',
        }}>
          {isCompact ? (
            <ZoomInOutlined style={{ color: '#FFFFFF', fontSize: 16 }} />
          ) : (
            <span style={{
              background: 'rgba(15, 23, 42, 0.82)', color: '#FFFFFF', fontSize: 11, fontWeight: 600,
              padding: '3px 9px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.24)',
              display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
            }}>
              <ZoomInOutlined /> Xem ảnh
            </span>
          )}
        </div>
      </div>
    </Image.PreviewGroup>
  );
}
