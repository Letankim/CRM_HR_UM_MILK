'use client';

import { useEffect, useState } from 'react';
import { FileImageOutlined, ZoomInOutlined } from '@ant-design/icons';
import { Fancybox } from '@fancyapps/ui';
import '@fancyapps/ui/dist/fancybox/fancybox.css';

export interface FancyboxSlideItem {
  src: string;
  caption?: string;
}

/**
 * Mở trình xem ảnh phóng to Fancybox (hỗ trợ cả URL thường lẫn ảnh chụp Camera Base64 Data URL).
 */
export function openFancyboxGallery(slides: FancyboxSlideItem[], startIndex = 0) {
  const validSlides = slides.filter((s) => Boolean(s.src));
  if (validSlides.length === 0) return;

  Fancybox.show(
    validSlides.map((s) => ({
      src: s.src,
      type: 'image',
      caption: s.caption,
    })),
    {
      startIndex: Math.min(Math.max(0, startIndex), validSlides.length - 1),
      mainStyle: {
        '--f-z-index': '2200',
        zIndex: '2200',
      },
    },
  );
}

interface FancyboxImageProps {
  src: string;
  alt: string;
  caption?: string;
  gallerySlides?: FancyboxSlideItem[];
  slideIndex?: number;
  height?: number | string;
  objectFit?: 'cover' | 'contain';
}

export function FancyboxImage({
  src,
  alt,
  caption,
  gallerySlides,
  slideIndex = 0,
  height = 155,
  objectFit = 'cover',
}: FancyboxImageProps) {
  const [hovered, setHovered] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <div
        style={{
          width: '100%',
          height: typeof height === 'number' ? Math.min(height, 110) : 100,
          borderRadius: 3,
          background: '#F8FAFC',
          border: '1px dashed #CBD5E1',
          color: '#64748B',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <FileImageOutlined /> Không hiển thị trực tiếp bản xem trước của tệp này
      </div>
    );
  }

  const handleOpen = () => {
    if (gallerySlides && gallerySlides.length > 0) {
      openFancyboxGallery(gallerySlides, slideIndex);
    } else {
      openFancyboxGallery([{ src, caption: caption || alt }], 0);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      title="Bấm để phóng to và xem chi tiết hình ảnh (Fancybox)"
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        width: '100%',
        height,
        borderRadius: 3,
        overflow: 'hidden',
        cursor: 'zoom-in',
        background: '#0F172A',
      }}
    >
      <img
        src={src}
        alt={alt}
        onError={() => setFailed(true)}
        style={{
          width: '100%',
          height: '100%',
          objectFit,
          display: 'block',
          transition: 'transform 0.2s ease',
          transform: hovered ? 'scale(1.03)' : 'scale(1)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 8,
          bottom: 8,
          background: hovered ? 'rgba(37, 99, 235, 0.92)' : 'rgba(15, 23, 42, 0.78)',
          color: '#FFFFFF',
          fontSize: 11,
          fontWeight: 600,
          padding: '3px 8px',
          borderRadius: 4,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          border: '1px solid rgba(255, 255, 255, 0.22)',
          pointerEvents: 'none',
          transition: 'background 0.15s ease',
        }}
      >
        <ZoomInOutlined /> Phóng to ảnh
      </div>
    </div>
  );
}
