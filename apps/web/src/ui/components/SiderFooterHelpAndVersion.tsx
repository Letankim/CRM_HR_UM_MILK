'use client';

import { ExportOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { Tag, Tooltip } from 'antd';
import { useState } from 'react';
import { BRAND } from '../theme';

export const USER_GUIDE_HTML_URL = '/huong-dan-su-dung.html';

export function SiderFooterHelpAndVersion({
  collapsed,
  versionLabel,
}: {
  collapsed: boolean;
  versionLabel: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        flexShrink: 0,
        padding: collapsed ? '8px 4px 10px' : '8px 12px 10px',
        borderTop: `1px solid ${BRAND.border}`,
        background: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        alignItems: collapsed ? 'center' : 'stretch',
        gap: 8,
      }}
    >
      <Tooltip
        placement="right"
        title={collapsed ? 'Hướng dẫn sử dụng hệ thống' : 'Mở tài liệu hướng dẫn sử dụng toàn hệ thống'}
      >
        <a
          href={USER_GUIDE_HTML_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Mở tài liệu hướng dẫn sử dụng hệ thống"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            width: collapsed ? 36 : '100%',
            height: collapsed ? 34 : 34,
            padding: collapsed ? 0 : '0 10px',
            borderRadius: collapsed ? 6 : 4,
            border: `1px solid ${hovered ? '#93C5FD' : BRAND.primaryBorder}`,
            background: hovered ? BRAND.primaryBg : '#F8FAFC',
            color: hovered ? BRAND.primary : BRAND.text,
            textDecoration: 'none',
            transition: 'all 0.15s ease',
            cursor: 'pointer',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: BRAND.primaryBg,
                border: `1px solid ${BRAND.primaryBorder}`,
                color: BRAND.primary,
                display: 'inline-grid',
                placeItems: 'center',
                fontSize: 12,
                flexShrink: 0,
              }}
            >
              <QuestionCircleOutlined />
            </span>
            {!collapsed && (
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Hướng dẫn sử dụng
              </span>
            )}
          </span>
          {!collapsed && (
            <ExportOutlined style={{ fontSize: 11, color: hovered ? BRAND.primary : BRAND.textSecondary, flexShrink: 0 }} />
          )}
        </a>
      </Tooltip>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          paddingInline: collapsed ? 0 : 4,
        }}
      >
        {!collapsed && <span style={{ fontSize: 12, color: '#64748B' }}>Phiên bản hệ thống</span>}
        <Tooltip placement="right" title={collapsed ? `Phiên bản hệ thống ${versionLabel}` : undefined}>
          <Tag color="blue" style={{ margin: 0, borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
            {collapsed ? versionLabel.replace(/\.0$/, '') : versionLabel}
          </Tag>
        </Tooltip>
      </div>
    </div>
  );
}
