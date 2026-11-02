'use client';

import { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Select, Space, Switch, Table, Tag } from 'antd';
import { CheckCircleOutlined, CloseOutlined, DeleteOutlined, EditOutlined, PlusOutlined, QrcodeOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';

export interface ZaloHrAccountItem {
  id: string; setting_key: string; owner_user_id: string; owner_username: string; owner_display_name: string;
  owner_role_label: string; zalo_name: string; zalo_phone: string; zalo_id: string; has_credentials: boolean;
  masked_credentials: string; encrypted_preview: string; is_default: boolean; status: 'ACTIVE' | 'INACTIVE';
  greeting_template: string; invite_template: string; reminder_template: string; pass_template: string;
  updated_at: string; version: number;
}

interface Props {
  open: boolean;
  accounts: ZaloHrAccountItem[];
  defaultTemplates?: { greeting: string; invite: string; reminder: string; pass: string };
  userOptions: { value: string; label: string }[];
  currentUserId?: string;
  onClose: () => void;
}

function buildQrMatrix(seed: string): boolean[][] {
  const size = 21;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const drawFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        grid[r0 + r]![c0 + c] = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      }
    }
  };
  drawFinder(0, 0); drawFinder(0, size - 7); drawFinder(size - 7, 0);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if ((r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8)) continue;
      hash = Math.imul(hash ^ ((r * 31 + c * 17) & 0xff), 16777619);
      grid[r]![c] = (Math.abs(hash) % 10) < 5;
    }
  }
  return grid;
}

export function ZaloHrAccountsModal({ open, accounts, defaultTemplates, userOptions, currentUserId, onClose }: Props) {
  const qc = useQueryClient(), { message } = App.useApp(), [form] = Form.useForm();
  const [editing, setEditing] = useState<ZaloHrAccountItem | null>(null);
  const [qrSession, setQrSession] = useState({ session_id: 'zqr_init', session_token: 'zalo_qr_session_init', expires_in: 180 });
  const [qrScanned, setQrScanned] = useState(false), [secondsLeft, setSecondsLeft] = useState(180);

  const qrMut = useMutation({
    mutationFn: () => api.post<{ session_id: string; session_token: string; expires_in: number }>('/admin/recruitment/zalo-qr-session', {}),
    onSuccess: (data) => { setQrSession(data); setSecondsLeft(data.expires_in || 180); setQrScanned(false); },
  });

  const resetToCreate = () => {
    setEditing(null); setQrScanned(false); form.resetFields();
    form.setFieldsValue({
      owner_user_id: currentUserId || userOptions[0]?.value, zalo_name: 'HR Ụm Bò Milk - Tuyển dụng', zalo_phone: '0901000002',
      is_default: true, status: 'ACTIVE', greeting_template: defaultTemplates?.greeting ?? '',
      invite_template: defaultTemplates?.invite ?? '', reminder_template: defaultTemplates?.reminder ?? '', pass_template: defaultTemplates?.pass ?? '',
    });
    qrMut.mutate();
  };

  useEffect(() => { if (open) resetToCreate(); }, [open, currentUserId]);
  useEffect(() => {
    if (!open || qrScanned) return;
    const timer = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [open, qrScanned]);

  const startEdit = (item: ZaloHrAccountItem) => {
    setEditing(item); setQrScanned(true);
    form.setFieldsValue({
      owner_user_id: item.owner_user_id, zalo_name: item.zalo_name, zalo_phone: item.zalo_phone,
      is_default: item.is_default, status: item.status, greeting_template: item.greeting_template,
      invite_template: item.invite_template, reminder_template: item.reminder_template, pass_template: item.pass_template,
    });
  };

  const saveMut = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      editing
        ? api.put(`/admin/recruitment/zalo-accounts/${editing.id}`, { ...values, access_token: qrSession.session_token })
        : api.post('/admin/recruitment/zalo-accounts', { ...values, access_token: qrSession.session_token, zalo_id: `zalo_${String(values.zalo_phone || '').trim()}` }),
    onSuccess: () => {
      message.success(editing ? 'Đã cập nhật tài khoản Zalo thành công' : 'Đã quét mã QR và lưu tài khoản Zalo tuyển dụng thành công');
      qc.invalidateQueries({ queryKey: ['recruitment-zalo-accounts'] }); resetToCreate();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Lưu tài khoản Zalo thất bại'),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/recruitment/zalo-accounts/${id}`),
    onSuccess: () => { message.success('Đã xóa tài khoản Zalo tuyển dụng'); qc.invalidateQueries({ queryKey: ['recruitment-zalo-accounts'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa thất bại'),
  });

  const qrMatrix = useMemo(() => buildQrMatrix(qrSession.session_id), [qrSession.session_id]);
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0'), ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <Modal
      width={1060} style={{ maxWidth: 'calc(100vw - 24px)' }} open={open} destroyOnHidden onCancel={onClose}
      title="Quản lý Tài khoản Zalo Tuyển dụng & Đăng nhập QR"
      footer={[<Button key="close" icon={<CloseOutlined />} onClick={onClose}>Đóng cửa sổ</Button>]}
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Card
          size="small" title={editing ? `Cập nhật Tài khoản Zalo: ${editing.zalo_name}` : 'Liên kết Tài khoản Zalo mới bằng Mã QR'}
          extra={editing && <Button size="small" icon={<PlusOutlined />} onClick={resetToCreate}>Chuyển sang Thêm mới bằng QR</Button>}
        >
          <Form form={form} layout="vertical" onFinish={(v) => { setQrScanned(true); saveMut.mutate(v); }}>
            <Row gutter={16} align="stretch">
              <Col xs={24} md={8}>
                <div style={{ height: '100%', background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 4, padding: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', textAlign: 'center' }}>
                  <div>
                    <Tag color={qrScanned ? 'success' : 'processing'} icon={qrScanned ? <CheckCircleOutlined /> : <QrcodeOutlined />} style={{ marginBottom: 8, fontWeight: 600 }}>
                      {qrScanned ? 'Đã xác thực phiên đăng nhập QR Zalo' : `Quét mã QR bằng Zalo (${mm}:${ss})`}
                    </Tag>
                    <div style={{ fontSize: 12, color: '#475569', marginBottom: 10 }}>
                      Mở ứng dụng <b>Zalo</b> trên điện thoại, chọn <b>Quét mã QR</b> để liên kết tài khoản Zalo tuyển dụng.
                    </div>
                  </div>
                  <div style={{ background: '#FFFFFF', border: '2px solid #2563EB', borderRadius: 4, padding: 10, position: 'relative', display: 'inline-block' }}>
                    <svg width={168} height={168} viewBox="0 0 21 21" shapeRendering="crispEdges">
                      {qrMatrix.map((row, rIdx) => row.map((cell, cIdx) => (cell ? <rect key={`${rIdx}-${cIdx}`} x={cIdx} y={rIdx} width={1} height={1} fill="#0F172A" /> : null)))}
                    </svg>
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#2563EB', color: '#FFFFFF', fontWeight: 700, fontSize: 11, padding: '2px 6px', borderRadius: 2, border: '2px solid #FFFFFF' }}>Zalo</div>
                  </div>
                  <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 10 }}>
                    <Button size="small" block type={qrScanned ? 'default' : 'primary'} ghost={!qrScanned} icon={<CheckCircleOutlined />} onClick={() => { setQrScanned(true); message.success('Đã xác nhận quét mã QR Zalo thành công. Nhấn Lưu để hoàn tất.'); }}>
                      {qrScanned ? 'Đã quét mã QR thành công' : 'Xác nhận đã quét mã QR trên điện thoại'}
                    </Button>
                    <Button size="small" block icon={<ReloadOutlined />} loading={qrMut.isPending} onClick={() => qrMut.mutate()}>Làm mới mã QR khác</Button>
                  </Space>
                </div>
              </Col>
              <Col xs={24} md={16}>
                <Row gutter={12}>
                  <Col xs={24} md={9}><Form.Item name="owner_user_id" label="Nhân sự HR phụ trách" rules={[{ required: true }]}><Select options={userOptions} showSearch optionFilterProp="label" placeholder="Chọn nhân sự HR" /></Form.Item></Col>
                  <Col xs={24} md={9}><Form.Item name="zalo_name" label="Tên hiển thị Zalo tuyển dụng" rules={[{ required: true, message: 'Nhập tên Zalo' }]}><Input placeholder="VD: HR Ụm Bò Milk - Kim Ngân" /></Form.Item></Col>
                  <Col xs={24} md={6}><Form.Item name="zalo_phone" label="Số điện thoại Zalo" rules={[{ required: true, message: 'Nhập SĐT Zalo' }]}><Input placeholder="0901222333" /></Form.Item></Col>
                  <Col xs={12} md={12}><Form.Item name="greeting_template" label="Mẫu tin nhắn Chào ứng viên & Kết bạn"><Input.TextArea rows={2} /></Form.Item></Col>
                  <Col xs={12} md={12}><Form.Item name="invite_template" label="Mẫu tin nhắn Mời phỏng vấn (kèm link xác nhận)"><Input.TextArea rows={2} /></Form.Item></Col>
                  <Col xs={12} md={12}><Form.Item name="reminder_template" label="Mẫu tin nhắn Tự động nhắc trước phỏng vấn"><Input.TextArea rows={2} /></Form.Item></Col>
                  <Col xs={12} md={12}><Form.Item name="pass_template" label="Mẫu tin nhắn Thông báo Đạt phỏng vấn"><Input.TextArea rows={2} /></Form.Item></Col>
                </Row>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <Space size={16}>
                    <Form.Item name="is_default" label="Mặc định theo nhân sự" valuePropName="checked" style={{ marginBottom: 0 }}><Switch checkedChildren="Mặc định" unCheckedChildren="Phụ" /></Form.Item>
                    <Form.Item name="status" label="Trạng thái" style={{ marginBottom: 0 }}><Select style={{ width: 135 }} options={[{ value: 'ACTIVE', label: 'Đang hoạt động' }, { value: 'INACTIVE', label: 'Tạm ngưng' }]} /></Form.Item>
                  </Space>
                  <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saveMut.isPending}>
                    {editing ? 'Lưu cập nhật tài khoản Zalo' : 'Đã quét QR & Lưu tài khoản Zalo'}
                  </Button>
                </div>
              </Col>
            </Row>
          </Form>
        </Card>

        <Table<ZaloHrAccountItem>
          size="small" rowKey="id" pagination={false} dataSource={accounts}
          columns={[
            { title: 'Nhân sự phụ trách', key: 'owner', width: 210, render: (_, r) => <div><div style={{ fontWeight: 600 }}>{r.owner_display_name} (@{r.owner_username})</div><div style={{ fontSize: 11, color: '#64748B' }}>{r.owner_role_label}</div></div> },
            { title: 'Tài khoản Zalo đã liên kết', key: 'zalo', render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{r.zalo_name}</span><Tag color="blue" className="num">{r.zalo_phone}</Tag>{r.is_default && <Tag color="gold">Mặc định</Tag>}</Space> },
            { title: 'Trạng thái phiên QR', key: 'status', width: 170, render: (_, r) => <Tag color={r.status === 'ACTIVE' ? 'success' : 'default'} icon={<CheckCircleOutlined />}>{r.status === 'ACTIVE' ? 'Đã liên kết QR' : 'Tạm ngưng'}</Tag> },
            {
              title: 'Thao tác', key: 'actions', width: 140, align: 'right',
              render: (_, r) => (
                <Space size={4}>
                  <Button size="small" icon={<EditOutlined />} onClick={() => startEdit(r)}>Sửa</Button>
                  <Popconfirm title="Xóa tài khoản Zalo này?" okText="Xóa" cancelText="Hủy" onConfirm={() => delMut.mutate(r.id)}><Button size="small" danger icon={<DeleteOutlined />} loading={delMut.isPending} /></Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Space>
    </Modal>
  );
}
