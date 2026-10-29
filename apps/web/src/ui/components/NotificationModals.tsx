'use client';

import { Button, Col, Descriptions, Form, Input, Modal, Row, Select, Space, Tag } from 'antd';
import type { FormInstance } from 'antd';
import { CloseOutlined, LinkOutlined, SendOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { ROLE_OPTIONS } from '@umbm/shared';
import { BaseDetailDrawer } from './BaseDetailDrawer';

export interface NotificationItem {
  id: string; version: number; code: string; category: string; categoryLabel: string;
  title: string; body: string; detailHtml: string; link: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL'; severityLabel: string;
  scopeType: 'BROADCAST' | 'ROLE' | 'PERSONAL'; targetLabel: string;
  recipient_user_id: string; recipient_role: string; read_at: string;
  readStatus: 'READ' | 'UNREAD'; readStatusLabel: string; created_at: string;
}

export const NOTIFICATION_CATEGORY_OPTIONS = [
  { value: 'ALL', label: 'Tất cả phân loại' },
  { value: 'ANNOUNCEMENT', label: 'Bản tin truyền thông nội bộ' },
  { value: 'WORKFLOW', label: 'Lịch ca, Nghỉ phép & Đổi ca' },
  { value: 'ATTENDANCE', label: 'Điểm danh GPS & Bổ sung công' },
  { value: 'PAYROLL', label: 'Kỳ lương & Phiếu lương' },
  { value: 'HR', label: 'Nhân sự, Tuyển dụng & Đào tạo' },
  { value: 'SYSTEM', label: 'Hệ thống & Tài khoản' },
];

export const NOTIFICATION_SCOPE_OPTIONS = [
  { value: 'ALL', label: 'Tất cả phạm vi nhận' },
  { value: 'BROADCAST', label: 'Toàn hệ thống (Tất cả vai trò)' },
  { value: 'ROLE', label: 'Theo vai trò đảm nhiệm' },
  { value: 'PERSONAL', label: 'Cá nhân riêng của bạn' },
];

export const NOTIFICATION_SEVERITY_OPTIONS = [
  { value: 'ALL', label: 'Tất cả mức độ' },
  { value: 'INFO', label: 'Thông thường' },
  { value: 'WARNING', label: 'Quan trọng' },
  { value: 'CRITICAL', label: 'Khẩn cấp' },
];

export const NOTIFICATION_READ_OPTIONS = [
  { value: 'ALL', label: 'Tất cả trạng thái đọc' },
  { value: 'UNREAD', label: 'Chưa đọc' },
  { value: 'READ', label: 'Đã đọc' },
];

export function NotificationDetailDrawer({
  record, onClose, onNavigate,
}: {
  record: NotificationItem | null; onClose: () => void; onNavigate?: (link: string) => void;
}) {
  const sevColor = record?.severity === 'CRITICAL' ? 'red' : record?.severity === 'WARNING' ? 'gold' : 'blue';
  const scopeColor = record?.scopeType === 'PERSONAL' ? 'purple' : record?.scopeType === 'ROLE' ? 'cyan' : 'geekblue';

  return (
    <BaseDetailDrawer
      open={Boolean(record)} onClose={onClose}
      title={record ? `Chi tiết Thông báo — ${record.code}` : 'Chi tiết Thông báo'}
      extra={
        record?.link && onNavigate ? (
          <Button size="small" type="primary" icon={<LinkOutlined />} onClick={() => { const l = record.link; onClose(); onNavigate(l); }}>
            Đi tới màn hình liên quan
          </Button>
        ) : null
      }
    >
      {record && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="Mã thông báo"><Tag color="geekblue">{record.code}</Tag></Descriptions.Item>
            <Descriptions.Item label="Phân loại"><Tag color="blue">{record.categoryLabel}</Tag></Descriptions.Item>
            <Descriptions.Item label="Mức độ ưu tiên"><Tag color={sevColor}>{record.severityLabel}</Tag></Descriptions.Item>
            <Descriptions.Item label="Đối tượng nhận"><Tag color={scopeColor}>{record.targetLabel}</Tag></Descriptions.Item>
            <Descriptions.Item label="Thời gian nhận">{dayjs(record.created_at).format('HH:mm:ss DD/MM/YYYY')}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái đọc">
              <Tag color={record.readStatus === 'READ' ? 'green' : 'gold'}>
                {record.readStatus === 'READ' && record.read_at
                  ? `Đã đọc (${dayjs(record.read_at).format('HH:mm DD/MM')})`
                  : 'Đã mở xem'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Tiêu đề thông báo" span={2}>
              <strong>{record.title}</strong>
            </Descriptions.Item>
            <Descriptions.Item label="Tóm tắt" span={2}>
              {record.body}
            </Descriptions.Item>
          </Descriptions>
          <div
            style={{ padding: '14px 18px', border: '1px solid #E5E7EB', borderRadius: 4, background: '#FFFFFF', lineHeight: 1.7 }}
            dangerouslySetInnerHTML={{ __html: record.detailHtml || `<p>${record.body}</p>` }}
          />
        </Space>
      )}
    </BaseDetailDrawer>
  );
}

export function SendNotificationModal({
  open,
  form,
  loading,
  userOptions,
  onClose,
  onSubmit,
}: {
  open: boolean;
  form: FormInstance;
  loading?: boolean;
  userOptions: { value: string; label: string }[];
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const targetScope = Form.useWatch('target_scope', form) || 'ALL';

  return (
    <Modal
      open={open}
      forceRender
      width={640}
      title="Phát hành Thông báo Hệ thống / Theo Vai trò / Cá nhân"
      okText="Phát thông báo ngay"
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: <SendOutlined />, loading }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ category: 'SYSTEM', severity: 'INFO', target_scope: 'ALL', recipient_roles: ['THU_VIEC', 'CHINH_THUC'], recipient_user_ids: [], link: '/dashboard' }}
        onFinish={onSubmit}
      >
        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="category" label="Phân loại thông báo" rules={[{ required: true }]}>
              <Select options={NOTIFICATION_CATEGORY_OPTIONS.filter((o) => o.value !== 'ALL')} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="severity" label="Mức độ ưu tiên" rules={[{ required: true }]}>
              <Select options={NOTIFICATION_SEVERITY_OPTIONS.filter((o) => o.value !== 'ALL')} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="target_scope" label="Phạm vi người nhận" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'ALL', label: 'Toàn hệ thống (Tất cả nhân sự)' },
                  { value: 'ROLE', label: 'Gửi theo Nhóm nhân sự (Chọn nhiều loại)' },
                  { value: 'USER', label: 'Gửi cho Cá nhân (Chọn nhiều người)' },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>
        {targetScope === 'ROLE' && (
          <Form.Item
            name="recipient_roles"
            label="Chọn các loại nhân sự / nhóm vai trò nhận thông báo (Có thể chọn nhiều)"
            rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 nhóm nhân sự nhận thông báo' }]}
          >
            <Select
              mode="multiple"
              allowClear
              placeholder="Chọn 1 hoặc nhiều nhóm nhân sự (Nhân viên thử việc, Chính thức, HR, Cửa hàng...)"
              options={ROLE_OPTIONS}
            />
          </Form.Item>
        )}
        {targetScope === 'USER' && (
          <Form.Item
            name="recipient_user_ids"
            label="Chọn các cá nhân nhận thông báo (Có thể chọn 1 hoặc nhiều người)"
            rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 cá nhân nhận thông báo' }]}
          >
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Tìm và chọn 1 hoặc nhiều cá nhân theo tên, tài khoản hoặc vai trò..."
              options={userOptions}
            />
          </Form.Item>
        )}
        <Form.Item name="title" label="Tiêu đề thông báo" rules={[{ required: true, message: 'Vui lòng nhập tiêu đề thông báo' }]}>
          <Input placeholder="Ví dụ: Nhắc lịch chốt công tuần / Thông báo kiểm tra định kỳ..." />
        </Form.Item>
        <Form.Item name="body" label="Nội dung chi tiết" rules={[{ required: true, message: 'Vui lòng nhập nội dung thông báo' }]}>
          <Input.TextArea rows={3} placeholder="Nhập nội dung thông báo gửi tới người nhận..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}
