'use client';

import { Alert, Flex, Input, Modal, Tag, Typography } from 'antd';
import { CloseOutlined, StopOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import type { AccountRowItem } from './AccountDetailDrawer';

export interface AccountRevokeModalProps {
  targets: AccountRowItem[];
  loading: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

const REVOKE_SUGGESTIONS = [
  'Nhân sự đã nghỉ việc chính thức tại chi nhánh',
  'Thu hồi quyền truy cập theo quyết định điều chuyển nội bộ',
  'Tài khoản không còn nhu cầu sử dụng trên hệ thống',
];

/**
 * Hộp thoại xác nhận thu hồi quyền truy cập (hỗ trợ cả thu hồi 1 tài khoản lẫn thu hồi hàng loạt).
 * Bắt buộc nhập Lý do thu hồi quyền truy cập (tối thiểu 3 ký tự).
 */
export function AccountRevokeModal({
  targets,
  loading,
  onConfirm,
  onCancel,
}: AccountRevokeModalProps) {
  const [reason, setReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const open = targets.length > 0;
  const isBulk = targets.length > 1;

  useEffect(() => {
    if (!open) {
      setReason('');
      setErrorMsg(null);
    }
  }, [open]);

  const title = isBulk
    ? `Thu hồi quyền truy cập hàng loạt (${targets.length} tài khoản)`
    : `Thu hồi tài khoản: ${targets[0]?.displayName ?? ''}`;

  const handleConfirm = () => {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setErrorMsg('Vui lòng nhập lý do thu hồi quyền truy cập rõ ràng (tối thiểu 3 ký tự).');
      return;
    }
    setErrorMsg(null);
    onConfirm(trimmed);
  };

  return (
    <Modal
      title={title}
      open={open}
      okText={isBulk ? `Thu hồi ${targets.length} tài khoản` : 'Xác nhận thu hồi'}
      okButtonProps={{ danger: true, loading, icon: <StopOutlined /> }}
      cancelText="Hủy bỏ"
      cancelButtonProps={{ icon: <CloseOutlined />, disabled: loading }}
      closable={!loading}
      maskClosable={!loading}
      destroyOnHidden
      onOk={handleConfirm}
      onCancel={() => {
        if (loading) return;
        setReason('');
        setErrorMsg(null);
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

      <div style={{ marginBottom: 6 }}>
        <Typography.Text strong style={{ fontSize: 13, color: '#0F172A' }}>
          <span style={{ color: '#DC2626', marginRight: 4 }}>*</span>
          Lý do thu hồi quyền truy cập
        </Typography.Text>
      </div>

      <Input.TextArea
        rows={3}
        maxLength={500}
        showCount
        autoFocus
        status={errorMsg ? 'error' : undefined}
        placeholder="Nhập lý do thu hồi quyền truy cập tài khoản (bắt buộc tối thiểu 3 ký tự)..."
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          if (errorMsg) setErrorMsg(null);
        }}
      />

      {errorMsg && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 8, padding: '6px 10px' }}
          message={<span style={{ fontSize: 12.5 }}>{errorMsg}</span>}
        />
      )}

      <Flex wrap="wrap" gap={6} align="center" style={{ marginTop: 10 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Gợi ý nhanh:
        </Typography.Text>
        {REVOKE_SUGGESTIONS.map((item) => (
          <Tag
            key={item}
            style={{ cursor: 'pointer', margin: 0, borderRadius: 2, userSelect: 'none' }}
            color={reason.trim() === item ? 'blue' : undefined}
            onClick={() => {
              setReason(item);
              if (errorMsg) setErrorMsg(null);
            }}
          >
            {item}
          </Tag>
        ))}
      </Flex>
    </Modal>
  );
}
