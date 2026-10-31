'use client';

import { Alert, Button, Flex, Space, Spin, Tag, Typography } from 'antd';
import type { HookAPI } from 'antd/es/modal/useModal';
import { ArrowRightOutlined, CheckCircleOutlined, ExclamationCircleOutlined, SyncOutlined } from '@ant-design/icons';
import type { LinkedFieldDiff } from '@/lib/linked-entity-sync';

export interface SummaryPair {
  label: string;
  value: string;
}

export interface PromptLinkedSyncOptions {
  modal: HookAPI;
  title: string;
  description: string;
  warningText?: string | null;
  diffs: LinkedFieldDiff[];
  onConfirm: () => void;
}

/**
 * Mở hộp thoại thông báo chi tiết các trường dữ liệu khác nhau giữa tài khoản / hồ sơ liên kết và biểu mẫu,
 * hỏi người dùng có muốn tự động điền dữ liệu mới vào biểu mẫu hay giữ nguyên dữ liệu đang nhập.
 */
export function promptLinkedEntitySyncModal({
  modal,
  title,
  description,
  warningText,
  diffs,
  onConfirm,
}: PromptLinkedSyncOptions): void {
  if (diffs.length === 0) return;
  modal.confirm({
    width: 600,
    icon: <SyncOutlined style={{ color: '#2563EB' }} />,
    title,
    okText: 'Tự động điền dữ liệu',
    cancelText: 'Giữ dữ liệu trên form',
    onOk: () => onConfirm(),
    content: (
      <div style={{ marginTop: 8 }}>
        <Typography.Paragraph style={{ marginBottom: 10, color: '#334155', fontSize: 13 }}>
          {description}
        </Typography.Paragraph>
        {warningText && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 10, borderRadius: 4 }}
            message={warningText}
          />
        )}
        <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, overflow: 'hidden' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr',
              padding: '7px 12px',
              background: '#F8FAFC',
              borderBottom: '1px solid #E5E7EB',
              fontSize: 12,
              fontWeight: 600,
              color: '#475569',
            }}
          >
            <span>Trường thông tin</span>
            <span>Giá trị trên biểu mẫu / Dữ liệu mới sẽ điền</span>
          </div>
          {diffs.map((d, idx) => (
            <div
              key={d.field}
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr',
                padding: '8px 12px',
                borderBottom: idx < diffs.length - 1 ? '1px solid #F1F5F9' : 'none',
                fontSize: 13,
                alignItems: 'center',
                background: '#FFFFFF',
              }}
            >
              <span style={{ fontWeight: 600, color: '#0F172A' }}>{d.label}</span>
              <Space size={6} wrap>
                <span style={{ color: '#64748B', textDecoration: d.currentDisplay.startsWith('Chưa') ? 'none' : 'line-through' }}>
                  {d.currentDisplay}
                </span>
                <ArrowRightOutlined style={{ fontSize: 11, color: '#94A3B8' }} />
                <span style={{ fontWeight: 600, color: '#2563EB' }}>{d.incomingDisplay}</span>
              </Space>
            </div>
          ))}
        </div>
      </div>
    ),
  });
}

export interface LinkedEntitySyncBannerProps {
  loading?: boolean;
  headerTitle: string;
  summaryItems: SummaryPair[];
  warningText?: string | null;
  diffs: LinkedFieldDiff[];
  applyButtonLabel: string;
  onApply: () => void;
}

/**
 * Thẻ tóm tắt thông tin chung vừa tải từ API của Tài khoản / Nhân sự liên kết và nút đồng bộ nhanh vào biểu mẫu.
 */
export function LinkedEntitySyncBanner({
  loading,
  headerTitle,
  summaryItems,
  warningText,
  diffs,
  applyButtonLabel,
  onApply,
}: LinkedEntitySyncBannerProps) {
  if (loading) {
    return (
      <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, padding: '10px 12px', background: '#FFFFFF', marginTop: 8 }}>
        <Space size={8}>
          <Spin size="small" />
          <span style={{ fontSize: 13, color: '#475569' }}>Đang tải thông tin chung từ hệ thống để đối chiếu với biểu mẫu...</span>
        </Space>
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, padding: '10px 12px', background: '#FFFFFF', marginTop: 8 }}>
      <Flex justify="space-between" align="center" wrap="wrap" gap={8} style={{ marginBottom: 8 }}>
        <Space size={8} wrap>
          <span style={{ fontWeight: 600, color: '#0F172A', fontSize: 13 }}>{headerTitle}</span>
          {diffs.length > 0 ? (
            <Tag color="warning" icon={<ExclamationCircleOutlined />} style={{ margin: 0, borderRadius: 2 }}>
              Khác {diffs.length} thông tin so với biểu mẫu
            </Tag>
          ) : (
            <Tag color="success" icon={<CheckCircleOutlined />} style={{ margin: 0, borderRadius: 2 }}>
              Đã khớp thông tin chung
            </Tag>
          )}
        </Space>
        {diffs.length > 0 && (
          <Button type="primary" size="small" icon={<SyncOutlined />} onClick={onApply}>
            {applyButtonLabel} ({diffs.length})
          </Button>
        )}
      </Flex>

      <Space size={[16, 4]} wrap style={{ fontSize: 12.5, color: '#475569' }}>
        {summaryItems.map((item) => (
          <span key={item.label}>
            <span style={{ color: '#64748B' }}>{item.label}:</span>{' '}
            <strong style={{ color: '#0F172A', fontWeight: 500 }}>{item.value || 'Chưa cập nhật'}</strong>
          </span>
        ))}
      </Space>

      {warningText && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 8, borderRadius: 4, padding: '6px 10px' }}
          message={<span style={{ fontSize: 12.5 }}>{warningText}</span>}
        />
      )}
    </div>
  );
}
