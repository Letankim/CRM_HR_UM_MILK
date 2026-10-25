'use client';

import { Input, Modal, Tag, Typography } from 'antd';
import { CloseOutlined, StopOutlined } from '@ant-design/icons';
import { useState } from 'react';
import type { AccountRowItem } from './AccountDetailDrawer';

export interface AccountRevokeModalProps {
  targets: AccountRowItem[];
  loading: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/**
 * Hộp thoại xác nhận thu hồi quyền truy cập (hỗ trợ cả thu hồi 1 tài khoản lẫn thu hồi hàng loạt).
 * Sử dụng `destroyOnHidden` chuẩn Ant Design v5.
 */
export function AccountRevokeModal({
  targets,
  loading,
  onConfirm,
  onCancel,
}: AccountRevokeModalProps) {
  const [reason, setReason] = useState('');
  const open = targets.length > 0;
  const isBulk = targets.length > 1;

  const title = isBulk
    ? `Thu hồi quyền truy cập hàng loạt (${targets.length} tài khoản)`
    : `Thu hồi tài khoản: ${targets[0]?.displayName ?? ''}`;

  return (
    <Modal
      title={title}
      open={open}
      okText={isBulk ? `Thu hồi ${targets.length} tài khoản` : 'Xác nhận thu hồi'}
      okButtonProps={{ danger: true, loading, icon: <StopOutlined /> }}
      cancelText="Hủy bỏ"
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      destroyOnHidden
      onOk={() => {
        onConfirm(reason.trim());
        setReason('');
      }}
      onCancel={() => {
        setReason('');
        onCancel();
      }}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 10 }}>
        Tài khoản bị thu hồi sẽ tự động đăng xuất ngay lập tức trên mọi thiết bị và được lưu lại lịch sử thao tác để
        theo dõi.
      </Typography.Paragraph>

      {isBulk && (
        <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {targets.map((t) => (
            <Tag key={t.id} color="red" style={{ margin: 0, borderRadius: 2 }}>
              {t.displayName} ({t.username})
            </Tag>
          ))}
        </div>
      )}

      <Input.TextArea
        rows={3}
        maxLength={500}
        placeholder="Nhập lý do thu hồi quyền truy cập tài khoản..."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}
