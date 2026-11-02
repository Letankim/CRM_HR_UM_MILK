'use client';

import { Button, Drawer, Grid, Space, type DrawerProps } from 'antd';
import { CloseOutlined, ExpandAltOutlined, ShrinkOutlined } from '@ant-design/icons';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Cấu hình kích thước chuẩn duy nhất cho toàn bộ Drawer xem chi tiết trên hệ thống:
 * - Mặc định mở chi tiết: 85% chiều ngang màn hình (85vw)
 * - Khi bấm Phóng to: 95% chiều ngang màn hình (95vw)
 * - Không hiển thị con số % trên nhãn nút Phóng to / Thu nhỏ.
 */
export const DETAIL_DRAWER_CONFIG = {
  defaultWidth: '85vw',
  expandedWidth: '95vw',
  mobileHeight: '92dvh',
  expandLabel: 'Phóng to',
  collapseLabel: 'Thu nhỏ',
  closeLabel: 'Đóng',
} as const;

export interface BaseDetailDrawerProps extends Omit<DrawerProps, 'width' | 'extra' | 'onClose'> {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  /** Cho phép truyền width tùy chỉnh nếu cần, mặc định luôn là 85vw */
  width?: number | string;
  /** Các nút thao tác nghiệp vụ riêng của từng màn hình (nằm bên trái nút Phóng to / Đóng) */
  extra?: ReactNode;
  /** Hiển thị nút Đóng chuẩn ở góc phải Header (mặc định: true) */
  showCloseButton?: boolean;
  /** Trên thiết bị di động (< 768px), trượt từ dưới lên thay vì từ phải sang (mặc định: false) */
  mobileBottom?: boolean;
  children?: ReactNode;
}

export function BaseDetailDrawer({
  open,
  title,
  onClose,
  extra,
  showCloseButton = true,
  mobileBottom = false,
  placement,
  height,
  styles,
  destroyOnHidden = true,
  children,
  ...rest
}: BaseDetailDrawerProps) {
  const [expanded, setExpanded] = useState(false);
  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === false;

  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  const useBottomSheet = isMobile && mobileBottom;
  const resolvedPlacement = placement ?? (useBottomSheet ? 'bottom' : 'right');
  const currentWidth = useBottomSheet
    ? undefined
    : isMobile
      ? '100vw'
      : expanded
        ? DETAIL_DRAWER_CONFIG.expandedWidth
        : DETAIL_DRAWER_CONFIG.defaultWidth;

  return (
    <Drawer
      {...rest}
      open={open}
      title={<div style={{ whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.4 }}>{title}</div>}
      onClose={onClose}
      closable={!showCloseButton}
      placement={resolvedPlacement}
      width={currentWidth}
      height={useBottomSheet ? (height ?? DETAIL_DRAWER_CONFIG.mobileHeight) : height}
      destroyOnHidden={destroyOnHidden}
      styles={{
        ...styles,
        header: {
          ...(isMobile
            ? { padding: '12px 14px', flexDirection: 'column', alignItems: 'stretch', gap: 8 }
            : { padding: '14px 20px' }),
          ...styles?.header,
        },
        body: {
          padding: isMobile ? 12 : 20,
          background: '#FFFFFF',
          ...styles?.body,
        },
        wrapper: {
          ...(currentWidth ? { width: currentWidth, maxWidth: '100vw' } : {}),
          ...styles?.wrapper,
        },
      }}
      extra={
        <Space size={8} wrap style={{ width: isMobile ? '100%' : undefined, justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
          {extra}
          {!isMobile && (
            <Button
              size="small"
              icon={expanded ? <ShrinkOutlined /> : <ExpandAltOutlined />}
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? DETAIL_DRAWER_CONFIG.collapseLabel : DETAIL_DRAWER_CONFIG.expandLabel}
            </Button>
          )}
          {showCloseButton && (
            <Button size="small" icon={<CloseOutlined />} onClick={onClose}>
              {DETAIL_DRAWER_CONFIG.closeLabel}
            </Button>
          )}
        </Space>
      }
    >
      {children}
    </Drawer>
  );
}
