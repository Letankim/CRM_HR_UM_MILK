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
  mobileHeight: '88%',
  expandLabel: 'Phóng to',
  collapseLabel: 'Thu nhỏ',
  closeLabel: 'Đóng',
} as const;

export interface BaseDetailDrawerProps extends Omit<DrawerProps, 'width' | 'extra' | 'onClose'> {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
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
      title={title}
      onClose={onClose}
      placement={resolvedPlacement}
      width={currentWidth}
      height={useBottomSheet ? (height ?? DETAIL_DRAWER_CONFIG.mobileHeight) : height}
      destroyOnHidden={destroyOnHidden}
      styles={{
        ...styles,
        wrapper: {
          ...(currentWidth ? { width: currentWidth, maxWidth: '100vw' } : {}),
          ...styles?.wrapper,
        },
      }}
      extra={
        <Space size={8} wrap>
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
