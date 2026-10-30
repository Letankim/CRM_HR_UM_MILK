'use client';

import { Tooltip } from 'antd';
import { useId } from 'react';
import { SYSTEM_CONFIG } from '@umbm/shared';
import { BRAND } from '../theme';

/**
 * Biểu tượng nhận diện AHr — kế thừa trực tiếp ngôn ngữ hình học của công ty mẹ Auto stack (AS):
 * Cánh chữ A nghiêng 60 độ + tam giác lõi màu xanh Auto stack (#00A8FF -> #0062E6) kết hợp chữ H kiến trúc (#0F172A).
 */
export function AhrBrandMark({
  size = 34,
  tiled = true,
  onClick,
}: {
  size?: number;
  tiled?: boolean;
  onClick?: () => void;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `ahrMarkGrad_${uid}`;
  const radius = Math.max(6, Math.round(size * 0.2));
  const innerSize = tiled ? Math.round(size * 0.76) : size;

  const svg = (
    <svg
      width={innerSize}
      height={innerSize}
      viewBox="0 0 64 64"
      fill="none"
      aria-label={SYSTEM_CONFIG.productName}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={gradId} x1="12" y1="7" x2="34" y2="57" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00A8FF" />
          <stop offset="100%" stopColor="#0062E6" />
        </linearGradient>
      </defs>
      <path
        d="M13 55.5H7.2C4.2 55.5 3.1 53.1 4.6 50.5L26.2 13.4C28.6 9.3 32.5 8.2 37.8 8.2H43C39.2 9.4 36.8 16 34.7 19.6L13 55.5Z"
        fill={`url(#${gradId})`}
      />
      <path d="M21.8 47.5L28 36.8L34.2 47.5H21.8Z" fill={`url(#${gradId})`} />
      <path
        d="M39.2 19.5H45.4V33.8H51.6V19.5H57.8C58.46 19.5 59 20.04 59 20.7V54.3C59 54.96 58.46 55.5 57.8 55.5H51.6V40.6H45.4V55.5H39.2C38.54 55.5 38 54.96 38 54.3V20.7C38 20.04 38.54 19.5 39.2 19.5Z"
        fill="#0F172A"
      />
    </svg>
  );

  if (!tiled) return svg;

  return (
    <div
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: '#FFFFFF',
        border: `1px solid ${BRAND.headerControlBorder}`,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {svg}
    </div>
  );
}

/** Wordmark vector AHr (chữ A xẻ rãnh đặc trưng của Auto stack + Hr màu xanh công nghệ). */
export function AhrWordmarkSvg({ height = 17 }: { height?: number }) {
  const width = Math.round((height * 103) / 36);
  return (
    <svg
      width={width}
      height={height}
      viewBox="71 15 103 36"
      fill="none"
      aria-label="AHr"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d="M73 49L86.4 17H93.6L107 49H99.2L96.2 41.6H86.2L88.4 36.2H94L90 26L80.8 49H73Z" fill="#0F172A" />
      <path d="M112 17H119.6V29.8H134.4V17H142V49H134.4V36H119.6V49H112V17Z" fill="#0078F0" />
      <path
        d="M148.5 24.5H155.7V27.7C157.5 25.2 160.5 24.1 164.7 24.1H172L169.3 30.5H162.7C158.3 30.5 155.9 32.5 155.9 36.7V49H148.5V24.5Z"
        fill="#0078F0"
      />
    </svg>
  );
}

/** Cụm Logo chuẩn trên đầu Sidebar Quản trị & Cổng Nhân viên. */
export function AhrBrandLockup({
  collapsed = false,
  subtitle = SYSTEM_CONFIG.brandSubtitle,
  onClick,
}: {
  collapsed?: boolean;
  subtitle?: string;
  onClick?: () => void;
}) {
  const tooltipTitle = collapsed ? `${SYSTEM_CONFIG.productName} — ${subtitle}` : undefined;

  return (
    <div
      onClick={onClick}
      style={{
        flexShrink: 0,
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: 10,
        padding: collapsed ? 0 : '0 16px',
        borderBottom: `1px solid ${BRAND.border}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <Tooltip placement="right" title={tooltipTitle}>
        <div>
          <AhrBrandMark size={35} tiled />
        </div>
      </Tooltip>
      {!collapsed && (
        <div style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
          <AhrWordmarkSvg height={17} />
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.5, color: '#64748B', marginTop: 3 }}>
            {subtitle}
          </div>
        </div>
      )}
    </div>
  );
}

/** Nhận diện thu gọn của công ty mẹ Auto stack (AS) dùng ở chân Sidebar & màn hình Đăng nhập. */
export function AutoStackBadge({ height = 14, showWordmark = true }: { height?: number; showWordmark?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `asMarkGrad_${uid}`;
  const markWidth = Math.round((height * 96) / 68);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, lineHeight: 1 }}>
      <svg width={markWidth} height={height} viewBox="0 0 96 68" fill="none" aria-label="Auto stack" style={{ display: 'block', flexShrink: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="14" y1="5" x2="38" y2="60" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#00B2FF" />
            <stop offset="100%" stopColor="#0066EE" />
          </linearGradient>
        </defs>
        <path d="M17.8 60H10.5C6.6 60 5 56.9 7 53.5L31.5 11.5C34.3 6.7 39.2 5 45.8 5H53C48.2 6.4 44.8 13.7 42.3 18L17.8 60Z" fill={`url(#${gradId})`} />
        <path d="M30 48.5L38.75 33.5L47.5 48.5H30Z" fill={`url(#${gradId})`} />
        <path
          d="M58 17.5H87L81.5 26.8H58.2C55.4 26.8 53.4 28.4 53.4 30.8C53.4 33.2 55.4 34.8 58.4 34.8H74.8C83.8 34.8 89.5 40.1 89.5 47.4C89.5 54.8 83.6 60 74.4 60H45.8L40.6 51.2H73.8C76.8 51.2 78.8 49.6 78.8 47.2C78.8 44.8 76.8 43.2 73.8 43.2H57.6C48.6 43.2 43 38 43 30.8C43 23.2 48.9 17.5 58 17.5Z"
          fill="#0F172A"
        />
      </svg>
      {showWordmark && (
        <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.2, whiteSpace: 'nowrap' }}>
          <span style={{ color: '#0F172A' }}>Auto</span>{' '}
          <span style={{ color: '#0078F0' }}>stack</span>
        </span>
      )}
    </span>
  );
}
