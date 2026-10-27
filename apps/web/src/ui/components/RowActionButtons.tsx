'use client';

import { Button, Dropdown, Space, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { EllipsisOutlined, EyeOutlined } from '@ant-design/icons';

export interface RowActionButtonsProps {
  onViewDetail?: () => void;
  detailTooltip?: string;
  menuItems?: MenuProps['items'];
  loading?: boolean;
}

/**
 * Cụm nút thao tác chuẩn doanh nghiệp 3DO ADMIN:
 * Nút icon con mắt [Xem chi tiết] + Nút [...] mở danh sách thao tác ngữ cảnh khi click.
 */
export function RowActionButtons({
  onViewDetail,
  detailTooltip = 'Xem chi tiết',
  menuItems = [],
  loading = false,
}: RowActionButtonsProps) {
  const validItems = (menuItems ?? []).filter(Boolean);
  const hasViewInMenu = validItems.some((item) => item && 'key' in item && (item.key === 'view' || item.key === '__view_detail'));
  const combinedItems: MenuProps['items'] = [
    ...(onViewDetail && !hasViewInMenu
      ? [
          {
            key: '__view_detail',
            icon: <EyeOutlined />,
            label: detailTooltip,
            onClick: onViewDetail,
          },
          ...(validItems.length > 0 ? [{ type: 'divider' as const }] : []),
        ]
      : []),
    ...validItems,
  ];

  return (
    <Space size={4}>
      {onViewDetail && (
        <Tooltip title={detailTooltip}>
          <Button size="small" icon={<EyeOutlined />} onClick={onViewDetail} disabled={loading} aria-label={detailTooltip} />
        </Tooltip>
      )}
      {combinedItems.length > 0 && (
        <Dropdown menu={{ items: combinedItems }} trigger={['click']} placement="bottomRight" disabled={loading}>
          <Tooltip title="Mở danh sách thao tác">
            <Button size="small" icon={<EllipsisOutlined />} loading={loading} aria-label="Thao tác" />
          </Tooltip>
        </Dropdown>
      )}
    </Space>
  );
}
