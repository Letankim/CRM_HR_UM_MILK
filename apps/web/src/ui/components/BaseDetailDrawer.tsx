'use client';

import { Button, Drawer, Grid, Space } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

export const DETAIL_DRAWER_CONFIG = {
  defaultWidth: 720,
  wideWidth: 920,
} as const;

export interface BaseDetailDrawerProps {
  title: ReactNode;
  open: boolean;
  onClose: () => void;
  width?: number;
  extra?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  showCloseButton?: boolean;
  mobileBottom?: boolean;
}

/**
 * Khung Drawer xem chi tiết bản ghi dùng chung toàn hệ thống (Ant Design v5 Enterprise Style).
 * Bắt buộc dùng destroyOnHidden và styles theo chuẩn v5.
 */
export function BaseDetailDrawer({
  title,
  open,
  onClose,
  width = DETAIL_DRAWER_CONFIG.defaultWidth,
  extra,
  footer,
  children,
  showCloseButton = true,
  mobileBottom = false,
}: BaseDetailDrawerProps) {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const useBottomSheet = isMobile && mobileBottom;
  return (
    <Drawer
      title={<div style={{ whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.4 }}>{title}</div>}
      open={open}
      onClose={onClose}
      closable={!showCloseButton}
      placement={useBottomSheet ? 'bottom' : 'right'}
      height={useBottomSheet ? '92dvh' : undefined}
      width={useBottomSheet ? '100%' : isMobile ? '100%' : width}
      destroyOnHidden
      styles={{
        header: isMobile
          ? { padding: '12px 14px', flexDirection: 'column', alignItems: 'stretch', gap: 8 }
          : { padding: '14px 20px' },
        body: { padding: isMobile ? 12 : 20, background: '#FFFFFF' },
        footer: { padding: '12px 20px', background: '#F8FAFC', borderTop: '1px solid #E5E7EB' },
      }}
      extra={
        <Space size={6} wrap style={{ width: isMobile ? '100%' : undefined, justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
          {extra}
          {showCloseButton && (
            <Button size={isMobile ? 'small' : 'middle'} icon={<CloseOutlined />} onClick={onClose}>
              Đóng
            </Button>
          )}
        </Space>
      }
      footer={footer}
    >
      {children}
    </Drawer>
  );
}
