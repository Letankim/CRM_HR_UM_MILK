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
 * Cụm nút thao tác gọn gàng trên từng dòng theo đúng mẫu 3DO ADMIN:
 * Nút icon con mắt [Xem chi tiết] + Nút [...] mở menu thao tác ngữ cảnh khi click.
 */
export function RowActionButtons({
  onViewDetail,
  detailTooltip = 'Xem chi tiết',
  menuItems = [],
  loading = false,
}: RowActionButtonsProps) {
  const validItems = menuItems.filter(Boolean);
  return (
    <Space size={4}>
      {onViewDetail && (
        <Tooltip title={detailTooltip}>
          <Button size="small" icon={<EyeOutlined />} onClick={onViewDetail} disabled={loading} aria-label={detailTooltip} />
        </Tooltip>
      )}
      {validItems.length > 0 && (
        <Dropdown menu={{ items: validItems }} trigger={['click']} placement="bottomRight" disabled={loading}>
          <Tooltip title="Thao tác">
            <Button size="small" icon={<EllipsisOutlined />} loading={loading} aria-label="Thao tác khác" />
          </Tooltip>
        </Dropdown>
      )}
    </Space>
  );
}
