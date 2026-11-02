'use client';

import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Col, Flex, Form, Input, Modal, Popconfirm, Row, Select, Space, Switch, Table, Tag } from 'antd';
import { CheckCircleOutlined, CloseOutlined, DeleteOutlined, EditOutlined, LockOutlined, PlusOutlined, SafetyCertificateOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';

export interface ZaloHrAccountItem {
  id: string; setting_key: string; owner_user_id: string; owner_username: string;
  owner_display_name: string; owner_role_label: string; zalo_name: string; zalo_phone: string;
  zalo_id: string; has_credentials: boolean; masked_credentials: string; encrypted_preview: string;
  is_default: boolean; status: 'ACTIVE' | 'INACTIVE'; greeting_template: string;
  invite_template: string; reminder_template: string; pass_template: string; updated_at: string;
}

interface Props {
  open: boolean; accounts: ZaloHrAccountItem[];
  defaultTemplates?: { greeting: string; invite: string; reminder: string; pass: string };
  userOptions: { value: string; label: string }[]; currentUserId?: string; onClose: () => void;
}

export function ZaloHrAccountsModal({ open, accounts, defaultTemplates, userOptions, currentUserId, onClose }: Props) {
  const qc = useQueryClient(), { message } = App.useApp(), [form] = Form.useForm();
  const [editing, setEditing] = useState<ZaloHrAccountItem | null>(null), [showForm, setShowForm] = useState(false);

  useEffect(() => { if (!open) { setEditing(null); setShowForm(false); } }, [open]);

  const startCreate = () => {
    setEditing(null); form.resetFields();
    form.setFieldsValue({
      owner_user_id: currentUserId || userOptions[0]?.value, zalo_name: 'HR Tuyển Dụng Ụm Bò Milk', zalo_phone: '0901000002',
      zalo_id: '', access_token: '', is_default: true, greeting_template: defaultTemplates?.greeting ?? '',
      invite_template: defaultTemplates?.invite ?? '', reminder_template: defaultTemplates?.reminder ?? '',
    });
    setShowForm(true);
  };

  const startEdit = (item: ZaloHrAccountItem) => {
    setEditing(item);
    form.setFieldsValue({
      owner_user_id: item.owner_user_id, zalo_name: item.zalo_name, zalo_phone: item.zalo_phone, zalo_id: item.zalo_id,
      access_token: '', is_default: item.is_default, greeting_template: item.greeting_template,
      invite_template: item.invite_template, reminder_template: item.reminder_template,
    });
    setShowForm(true);
  };

  const saveMut = useMutation({
    mutationFn: (values: Record<string, unknown>) => editing ? api.put(`/admin/recruitment/zalo-accounts/${editing.id}`, values) : api.post('/admin/recruitment/zalo-accounts', values),
    onSuccess: () => {
      message.success(editing ? 'Đã cập nhật và mã hóa lại tài khoản Zalo trên Sheet' : 'Đã thêm và mã hóa tài khoản Zalo lưu trên Sheet thành công');
      setShowForm(false); setEditing(null);
      ['recruitment-zalo-accounts', 'candidates', 'interviews'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Lưu cấu hình tài khoản Zalo thất bại'),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/recruitment/zalo-accounts/${id}`),
    onSuccess: () => {
      message.success('Đã xóa cấu hình tài khoản Zalo');
      qc.invalidateQueries({ queryKey: ['recruitment-zalo-accounts'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa tài khoản Zalo thất bại'),
  });

  return (
    <Modal
      width={880}
      open={open}
      destroyOnHidden
      title="Cấu hình Tài khoản Zalo Tuyển dụng (Mã hóa AES-256 theo từng nhân sự)"
      footer={<Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>}
      onCancel={onClose}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          icon={<SafetyCertificateOutlined />}
          message="Bảo mật mã hóa AES-256-GCM trên Google Sheets theo từng nhân sự phụ trách"
          description="Mỗi tài khoản Zalo được gắn với nhân sự HR phụ trách và mã hóa toàn bộ khóa phiên (Cookie / Token) bằng thuật toán AES-256-GCM trước khi ghi vào Sheet. Khi chọn tài khoản Zalo để gửi tin nhắn cho ứng viên, hệ thống tự động lưu lại ID Zalo để tự động gửi nhắc nhở trước 5–15 phút khi ứng viên đã xác nhận lịch phỏng vấn."
        />

        <Flex justify="space-between" align="center">
          <strong style={{ color: '#0F172A' }}>Danh sách tài khoản Zalo đã cấu hình ({accounts.length})</strong>
          {!showForm && (
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={startCreate}>
              Thêm tài khoản Zalo mới
            </Button>
          )}
        </Flex>

        <Table<ZaloHrAccountItem>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={accounts}
          columns={[
            {
              title: 'Nhân sự sở hữu (Theo người)',
              dataIndex: 'owner_display_name',
              render: (_, r) => (
                <div>
                  <div style={{ fontWeight: 600, color: '#0F172A' }}>{r.owner_display_name} (@{r.owner_username})</div>
                  <div style={{ fontSize: 11, color: '#64748B' }}>{r.owner_role_label}</div>
                </div>
              ),
            },
            {
              title: 'Tài khoản Zalo & SĐT',
              dataIndex: 'zalo_name',
              render: (_, r) => (
                <div>
                  <Space size={4} wrap>
                    <strong style={{ color: '#2563EB' }}>{r.zalo_name}</strong>
                    {r.is_default && <Tag color="blue" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>Mặc định</Tag>}
                  </Space>
                  <div style={{ fontSize: 12, color: '#475569' }}>SĐT Zalo: <b className="num">{r.zalo_phone}</b> · ID Zalo: <code>{r.zalo_id}</code></div>
                </div>
              ),
            },
            {
              title: 'Mã hóa trên Sheet',
              dataIndex: 'masked_credentials',
              width: 195,
              render: (_, r) => (
                <Space direction="vertical" size={2}>
                  <Tag color="success" icon={<LockOutlined />} style={{ margin: 0 }}>{r.masked_credentials}</Tag>
                  <span style={{ fontSize: 11, color: '#64748B' }} className="mono">{r.encrypted_preview}</span>
                </Space>
              ),
            },
            {
              title: 'Thao tác',
              width: 120,
              align: 'right',
              render: (_, r) => (
                <Space size={4}>
                  <Button size="small" icon={<EditOutlined />} onClick={() => startEdit(r)}>Sửa</Button>
                  <Popconfirm title="Xóa cấu hình tài khoản Zalo này?" okText="Xóa" cancelText="Hủy" onConfirm={() => delMut.mutate(r.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} loading={delMut.isPending} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />

        {showForm && (
          <Card
            size="small"
            title={editing ? `Chỉnh sửa tài khoản Zalo: ${editing.zalo_name}` : 'Thêm cấu hình tài khoản Zalo mới'}
            style={{ borderColor: '#93C5FD', background: '#F8FAFC' }}
          >
            <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="owner_user_id" label="Nhân sự sở hữu tài khoản Zalo" rules={[{ required: true, message: 'Chọn nhân sự sở hữu' }]}>
                    <Select showSearch optionFilterProp="label" options={userOptions} placeholder="Chọn nhân sự HR phụ trách" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="zalo_name" label="Tên hiển thị Zalo khi gửi" rules={[{ required: true, message: 'Nhập tên hiển thị Zalo' }]}>
                    <Input placeholder="Ví dụ: HR Tuyển Dụng Ụm Bò Milk - Nguyễn Thị Nhân Sự" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="zalo_phone" label="Số điện thoại Zalo (10 số từ 0)" rules={[{ required: true, message: 'Nhập SĐT Zalo' }]}>
                    <Input placeholder="0901000002" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="zalo_id" label="ID Zalo / UID của HR">
                    <Input placeholder="Ví dụ: zalo_hr_umbm_01" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="is_default" label="Đặt làm mặc định theo người" valuePropName="checked">
                    <Switch checkedChildren="Mặc định" unCheckedChildren="Phụ" />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item
                    name="access_token"
                    label={editing ? 'Khóa phiên Zalo / Cookie / OA Access Token (Để trống nếu giữ nguyên bản mã hiện tại)' : 'Khóa phiên Zalo / Cookie / OA Access Token (Tự động mã hóa AES-256 khi lưu)'}
                  >
                    <Input.Password placeholder="Nhập Cookie phiên Zalo hoặc Access Token để hệ thống mã hóa AES-256 lưu trên Sheet..." />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="invite_template" label="Mẫu tin nhắn mời phỏng vấn ({candidate_name}, {interview_time}, {meet_link}, {rsvp_url})">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="reminder_template" label="Mẫu tin nhắn tự động nhắc trước 5–15p ({candidate_name}, {minutes_left}, {meet_link})">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                </Col>
              </Row>
              <Flex justify="flex-end" gap={8}>
                <Button icon={<CloseOutlined />} onClick={() => { setShowForm(false); setEditing(null); }}>Hủy bỏ</Button>
                <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saveMut.isPending}>
                  {editing ? 'Lưu & Mã hóa lại trên Sheet' : 'Mã hóa AES-256 & Lưu tài khoản Zalo'}
                </Button>
              </Flex>
            </Form>
          </Card>
        )}
      </Space>
    </Modal>
  );
}
