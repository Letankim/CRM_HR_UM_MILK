'use client';

import { Button, Descriptions, Tabs, Tag } from 'antd';
import { DiffOutlined, FolderOpenOutlined, InfoCircleOutlined, RollbackOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { BaseDetailDrawer } from './BaseDetailDrawer';

export interface AuditLogItem {
  id: string;
  version?: number;
  isArchived?: boolean;
  actorUserId: string;
  actorUsername: string;
  actorDisplayName: string;
  actorRole: string;
  actorRoleLabel: string;
  action: string;
  actionLabel: string;
  entity: string;
  entityLabel: string;
  entityId: string;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  ip: string;
  requestId: string;
  created_at: string;
}

interface Props {
  selected: AuditLogItem | null;
  onClose: () => void;
  onArchiveOrRestore?: (item: AuditLogItem) => void;
}

export function AuditLogDetailDrawer({ selected, onClose, onArchiveOrRestore }: Props) {
  return (
    <BaseDetailDrawer
      title={selected ? `Chi tiết Kiểm toán: ${selected.actionLabel}` : 'Chi tiết Kiểm toán'}
      open={!!selected}
      onClose={onClose}
      extra={
        selected && onArchiveOrRestore ? (
          <Button
            size="small"
            type={selected.isArchived ? 'primary' : 'default'}
            icon={selected.isArchived ? <RollbackOutlined /> : <FolderOpenOutlined />}
            onClick={() => onArchiveOrRestore(selected)}
          >
            {selected.isArchived ? 'Khôi phục về hiện hành' : 'Lưu trữ & Làm trống'}
          </Button>
        ) : null
      }
    >
      {selected && (
        <Tabs
          defaultActiveKey="info"
          items={[
            {
              key: 'info',
              label: <span><InfoCircleOutlined /> Thông tin chung</span>,
              children: (
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="Trạng thái lưu trữ">
                    {selected.isArchived ? <Tag color="gold">Đã lưu vào Kho Lưu Trữ (Đã dọn khỏi phiên hiện hành)</Tag> : <Tag color="green">Nhật ký Hiện hành</Tag>}
                  </Descriptions.Item>
                  <Descriptions.Item label="Thời điểm thực hiện">{dayjs(selected.created_at).format('HH:mm:ss DD/MM/YYYY')}</Descriptions.Item>
                  <Descriptions.Item label="Người thực hiện">{selected.actorDisplayName} (@{selected.actorUsername})</Descriptions.Item>
                  <Descriptions.Item label="Vai trò">{selected.actorRoleLabel}</Descriptions.Item>
                  <Descriptions.Item label="Hành động">{selected.actionLabel}</Descriptions.Item>
                  <Descriptions.Item label="Phân hệ tác động">{selected.entityLabel}</Descriptions.Item>
                  <Descriptions.Item label="Địa chỉ IP">{selected.ip || 'Nội bộ'}</Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: 'diff',
              label: <span><DiffOutlined /> Trước &amp; Sau thay đổi</span>,
              children: (
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="Dữ liệu trước khi thay đổi">
                    <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{selected.beforeData ? JSON.stringify(selected.beforeData, null, 2) : 'Không có (Bản ghi tạo mới)'}</pre>
                  </Descriptions.Item>
                  <Descriptions.Item label="Dữ liệu sau khi thay đổi">
                    <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{selected.afterData ? JSON.stringify(selected.afterData, null, 2) : 'Không ghi nhận'}</pre>
                  </Descriptions.Item>
                </Descriptions>
              ),
            },
          ]}
        />
      )}
    </BaseDetailDrawer>
  );
}
