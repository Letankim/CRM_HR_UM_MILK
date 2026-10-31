'use client';

import { App, Button, Descriptions, Empty, Flex, Modal, Space, Tag, Typography } from 'antd';
import { CloseOutlined, CompressOutlined, CopyOutlined, ExpandOutlined, FileTextOutlined, MailOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { EMAIL_TEMPLATE_LABELS, type EmailTemplateCode } from '@umbm/shared';

export interface EmailLogItem {
  id: string;
  to: string;
  recipientName?: string;
  referenceCode?: string;
  subject: string;
  template: EmailTemplateCode;
  templateLabel?: string;
  attempts?: number;
  status: 'QUEUED' | 'SENT' | 'QUEUED_MEMORY' | 'DRY_RUN' | 'FAILED';
  queuedAt?: string;
  sentAt: string;
  html?: string;
  error?: string;
}

export function formatEmailDateTime(value?: string): string {
  if (!value) return '—';
  return value.slice(0, 19).replace('T', ' ');
}

export function renderEmailQueueStatusTag(status: EmailLogItem['status']) {
  if (status === 'QUEUED') return <Tag color="gold" style={{ borderRadius: 2, margin: 0 }}>Đang xếp hàng đợi</Tag>;
  if (status === 'FAILED') return <Tag color="red" style={{ borderRadius: 2, margin: 0 }}>Lỗi kết nối</Tag>;
  return <Tag color="green" style={{ borderRadius: 2, margin: 0 }}>{status === 'SENT' ? 'Đã gửi Gmail' : 'Đã xử lý hàng đợi'}</Tag>;
}

/** Mở rộng khung hiển thị bảng Email lên toàn chiều ngang khung xem trước trên trình quản trị (không ảnh hưởng HTML gốc gửi qua SMTP). */
export function expandEmailHtmlForPreview(rawHtml?: string, fullWidth = false): string | undefined {
  if (!rawHtml) return undefined;
  const maxWidth = fullWidth ? '100%' : '1140px';
  const previewCss = `<style>table[width="640"]{max-width:${maxWidth} !important;width:100% !important;} body>table{padding:14px 16px !important;}</style>`;
  return rawHtml.includes('</head>') ? rawHtml.replace('</head>', `${previewCss}</head>`) : `${previewCss}${rawHtml}`;
}

export interface EmailQueueDetailModalProps {
  email: EmailLogItem | null;
  fallbackHtml?: string;
  onClose: () => void;
}

export function EmailQueueDetailModal({ email, fallbackHtml, onClose }: EmailQueueDetailModalProps) {
  const { message } = App.useApp();
  const [maximized, setMaximized] = useState(false);
  const label = email ? (email.templateLabel || EMAIL_TEMPLATE_LABELS[email.template] || 'Thông báo hệ thống') : '';
  const previewDoc = expandEmailHtmlForPreview(email?.html || fallbackHtml, maximized);

  const handleClose = () => {
    setMaximized(false);
    onClose();
  };

  const copyText = (text: string, labelMsg: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => message.success(`Đã sao chép ${labelMsg}`));
    }
  };

  return (
    <Modal
      open={Boolean(email)}
      onCancel={handleClose}
      destroyOnHidden
      width={maximized ? '96vw' : 'min(1260px, 94vw)'}
      centered
      styles={{ body: { maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' } }}
      title={
        <Space size={8}>
          <MailOutlined style={{ color: '#2563EB' }} />
          <span>Chi tiết Nội dung Email{email?.referenceCode ? ` — Mã ${email.referenceCode}` : ''}</span>
        </Space>
      }
      footer={
        <Space size={8} wrap>
          <Button icon={maximized ? <CompressOutlined /> : <ExpandOutlined />} onClick={() => setMaximized((v) => !v)}>
            {maximized ? 'Thu về kích thước chuẩn' : 'Mở rộng toàn màn hình'}
          </Button>
          {email && (
            <Button icon={<CopyOutlined />} onClick={() => copyText(email.to, 'địa chỉ Email người nhận')}>
              Sao chép Email nhận
            </Button>
          )}
          {email && (
            <Button icon={<FileTextOutlined />} onClick={() => copyText(email.subject, 'tiêu đề Email')}>
              Sao chép tiêu đề
            </Button>
          )}
          <Button type="primary" icon={<CloseOutlined />} onClick={handleClose}>
            Đóng
          </Button>
        </Space>
      }
    >
      {email && (
        <div>
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2, lg: 3 }} style={{ marginBottom: 12 }}>
            <Descriptions.Item label="Người nhận">
              <div>
                <Typography.Text strong>{email.recipientName || 'Nhân sự Ụm Bò Milk'}</Typography.Text>
                <div style={{ fontSize: 12, color: '#64748B' }}>{email.to}</div>
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="Loại thông báo">
              <Tag color="blue" style={{ borderRadius: 2, margin: 0 }}>{label}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Trạng thái gửi">
              <Space size={8} wrap>
                {renderEmailQueueStatusTag(email.status)}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Lần thử: <span className="num">{email.attempts ?? 1}/3</span>
                </Typography.Text>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Mã tham chiếu">
              <span className="num" style={{ fontWeight: 600 }}>{email.referenceCode || '—'}</span>
            </Descriptions.Item>
            <Descriptions.Item label="Thời gian tạo / xếp hàng">
              <span className="num">{formatEmailDateTime(email.queuedAt || email.sentAt)}</span>
            </Descriptions.Item>
            <Descriptions.Item label="Thời gian gửi thành công">
              <span className="num">{email.sentAt ? formatEmailDateTime(email.sentAt) : 'Đang chờ xử lý gửi'}</span>
            </Descriptions.Item>
            <Descriptions.Item label="Tiêu đề thư" span={3}>
              <Typography.Text strong>{email.subject}</Typography.Text>
            </Descriptions.Item>
            {email.error && (
              <Descriptions.Item label="Chi tiết lỗi kết nối" span={3}>
                <Typography.Text type="danger">{email.error}</Typography.Text>
              </Descriptions.Item>
            )}
          </Descriptions>

          <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
            <Space size={6}>
              <FileTextOutlined style={{ color: '#2563EB' }} />
              <Typography.Text strong style={{ fontSize: 13 }}>Nội dung Email đã gửi / kết xuất</Typography.Text>
            </Space>
          </Flex>

          {previewDoc ? (
            <iframe
              title={`Chi tiết nội dung email ${email.id}`}
              srcDoc={previewDoc}
              style={{
                width: '100%',
                height: maximized ? 'calc(100vh - 300px)' : 'min(640px, calc(100vh - 320px))',
                minHeight: 520,
                border: '1px solid #E5E7EB',
                borderRadius: 4,
                background: '#F8FAFC',
                display: 'block',
              }}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có dữ liệu HTML xem trước cho bản ghi này" />
          )}
        </div>
      )}
    </Modal>
  );
}
