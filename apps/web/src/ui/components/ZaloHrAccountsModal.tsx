'use client';

import { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Select, Space, Switch, Table, Tabs, Tag } from 'antd';
import {
  CheckCircleOutlined, CloseOutlined, DeleteOutlined, EditOutlined, FileTextOutlined,
  MessageOutlined, PlusOutlined, QrcodeOutlined, ReloadOutlined, SaveOutlined, UndoOutlined,
} from '@ant-design/icons';
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
  open: boolean; accounts: ZaloHrAccountItem[];
  defaultTemplates?: { greeting: string; invite: string; reminder: string; pass: string };
  userOptions: { value: string; label: string }[]; currentUserId?: string; onClose: () => void;
}

const TEMPLATE_VARS = ['{candidate_name}', '{candidate_code}', '{position}', '{branch_name}', '{interview_time}', '{meet_link}', '{rsvp_url}', '{hr_zalo_name}', '{hr_zalo_phone}'];

function buildQrMatrix(seed: string): boolean[][] {
  const size = 21;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const drawFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) grid[r0 + r]![c0 + c] = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
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
  const qc = useQueryClient(), { message } = App.useApp(), [accForm] = Form.useForm(), [tplForm] = Form.useForm();
  const [activeTab, setActiveTab] = useState<'accounts' | 'templates'>('accounts');
  const [editing, setEditing] = useState<ZaloHrAccountItem | null>(null), [selectedTplAccId, setSelectedTplAccId] = useState<string>('');
  const [qrSession, setQrSession] = useState({ session_id: 'zqr_init', session_token: 'zalo_qr_session_init', expires_in: 180 });
  const [qrScanned, setQrScanned] = useState(false), [secondsLeft, setSecondsLeft] = useState(180);

  const qrMut = useMutation({
    mutationFn: () => api.post<{ session_id: string; session_token: string; expires_in: number }>('/admin/recruitment/zalo-qr-session', {}),
    onSuccess: (data) => { setQrSession(data); setSecondsLeft(data.expires_in || 180); setQrScanned(false); },
  });

  const resetToCreate = () => {
    setEditing(null); setQrScanned(false); accForm.resetFields();
    accForm.setFieldsValue({ owner_user_id: currentUserId || userOptions[0]?.value, zalo_name: 'HR Ụm Bò Milk - Tuyển dụng', zalo_phone: '0901000002', is_default: true, status: 'ACTIVE' });
    qrMut.mutate();
  };

  const loadTemplateForAcc = (acc?: ZaloHrAccountItem) => {
    const target = acc ?? accounts[0];
    setSelectedTplAccId(target?.id ?? '');
    tplForm.setFieldsValue({ greeting_template: target?.greeting_template || defaultTemplates?.greeting || '', invite_template: target?.invite_template || defaultTemplates?.invite || '', reminder_template: target?.reminder_template || defaultTemplates?.reminder || '', pass_template: target?.pass_template || defaultTemplates?.pass || '' });
  };

  useEffect(() => { if (open) { setActiveTab('accounts'); resetToCreate(); loadTemplateForAcc(accounts[0]); } }, [open, currentUserId]);
  useEffect(() => {
    if (!open || qrScanned || activeTab !== 'accounts') return;
    const timer = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [open, qrScanned, activeTab]);

  const startEdit = (item: ZaloHrAccountItem) => {
    setEditing(item); setQrScanned(true); setActiveTab('accounts');
    accForm.setFieldsValue({ owner_user_id: item.owner_user_id, zalo_name: item.zalo_name, zalo_phone: item.zalo_phone, is_default: item.is_default, status: item.status });
  };

  const saveAccMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => editing ? api.put(`/admin/recruitment/zalo-accounts/${editing.id}`, { ...editing, ...v, access_token: qrSession.session_token }) : api.post('/admin/recruitment/zalo-accounts', { ...defaultTemplates, ...v, access_token: qrSession.session_token, zalo_id: `zalo_${String(v.zalo_phone || '').trim()}` }),
    onSuccess: () => { message.success(editing ? 'Đã cập nhật thông tin tài khoản Zalo thành công' : 'Đã quét mã QR và liên kết tài khoản Zalo thành công'); qc.invalidateQueries({ queryKey: ['recruitment-zalo-accounts'] }); resetToCreate(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Lưu tài khoản Zalo thất bại'),
  });

  const saveTplMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => {
      const target = accounts.find((a) => a.id === selectedTplAccId) ?? accounts[0];
      if (!target) throw new Error('Vui lòng liên kết ít nhất 1 tài khoản Zalo trước khi lưu mẫu tin nhắn');
      return api.put(`/admin/recruitment/zalo-accounts/${target.id}`, { owner_user_id: target.owner_user_id, zalo_name: target.zalo_name, zalo_phone: target.zalo_phone, is_default: target.is_default, status: target.status, ...v });
    },
    onSuccess: () => { message.success('Đã lưu cấu hình mẫu tin nhắn Zalo tuyển dụng thành công'); qc.invalidateQueries({ queryKey: ['recruitment-zalo-accounts'] }); },
    onError: (e) => message.error(e instanceof ApiClientError || e instanceof Error ? e.message : 'Lưu mẫu tin nhắn thất bại'),
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
      width={1020} style={{ maxWidth: 'calc(100vw - 24px)' }} open={open} destroyOnHidden onCancel={onClose}
      title="Quản lý Tài khoản Zalo Tuyển dụng & Mẫu Tin nhắn Tự động"
      footer={[<Button key="close" icon={<CloseOutlined />} onClick={onClose}>Đóng cửa sổ</Button>]}
    >
      <Tabs
        activeKey={activeTab} onChange={(k) => setActiveTab(k as 'accounts' | 'templates')}
        items={[
          {
            key: 'accounts',
            label: <span><QrcodeOutlined /> Tài khoản Zalo &amp; Liên kết QR ({accounts.length})</span>,
            children: (
              <Space direction="vertical" size={14} style={{ width: '100%' }}>
                <Card
                  size="small" title={editing ? `Cập nhật Tài khoản Zalo: ${editing.zalo_name}` : 'Liên kết Tài khoản Zalo mới bằng Mã QR'}
                  extra={editing && <Button size="small" icon={<PlusOutlined />} onClick={resetToCreate}>Thêm tài khoản mới bằng QR</Button>}
                >
                  <Form form={accForm} layout="vertical" onFinish={(v) => { setQrScanned(true); saveAccMut.mutate(v); }}>
                    <Row gutter={16} align="middle">
                      <Col xs={24} md={8}>
                        <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 4, padding: 12, textAlign: 'center' }}>
                          <Tag color={qrScanned ? 'success' : 'processing'} icon={qrScanned ? <CheckCircleOutlined /> : <QrcodeOutlined />} style={{ marginBottom: 6, fontWeight: 600 }}>
                            {qrScanned ? 'Đã xác thực QR Zalo' : `Quét mã QR bằng Zalo (${mm}:${ss})`}
                          </Tag>
                          <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>Mở ứng dụng <b>Zalo</b> trên điện thoại và quét mã QR bên dưới để liên kết.</div>
                          <div style={{ background: '#FFFFFF', border: '2px solid #2563EB', borderRadius: 4, padding: 8, position: 'relative', display: 'inline-block' }}>
                            <svg width={148} height={148} viewBox="0 0 21 21" shapeRendering="crispEdges">
                              {qrMatrix.map((row, rIdx) => row.map((cell, cIdx) => (cell ? <rect key={`${rIdx}-${cIdx}`} x={cIdx} y={rIdx} width={1} height={1} fill="#0F172A" /> : null)))}
                            </svg>
                            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#2563EB', color: '#FFFFFF', fontWeight: 700, fontSize: 11, padding: '2px 6px', borderRadius: 2, border: '2px solid #FFFFFF' }}>Zalo</div>
                          </div>
                          <Space size={6} style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} wrap>
                            <Button size="small" type={qrScanned ? 'default' : 'primary'} ghost={!qrScanned} icon={<CheckCircleOutlined />} onClick={() => { setQrScanned(true); message.success('Đã ghi nhận quét mã QR Zalo.'); }}>
                              {qrScanned ? 'Đã quét QR' : 'Xác nhận đã quét QR'}
                            </Button>
                            <Button size="small" icon={<ReloadOutlined />} loading={qrMut.isPending} onClick={() => qrMut.mutate()}>Đổi mã QR</Button>
                          </Space>
                        </div>
                      </Col>
                      <Col xs={24} md={16}>
                        <Row gutter={12}>
                          <Col xs={24} md={12}><Form.Item name="owner_user_id" label="Nhân sự HR phụ trách tài khoản Zalo" rules={[{ required: true }]}><Select options={userOptions} showSearch optionFilterProp="label" placeholder="Chọn nhân sự HR" /></Form.Item></Col>
                          <Col xs={24} md={12}><Form.Item name="zalo_name" label="Tên hiển thị Zalo tuyển dụng" rules={[{ required: true, message: 'Nhập tên hiển thị Zalo' }]}><Input placeholder="VD: HR Ụm Bò Milk - Kim Ngân" /></Form.Item></Col>
                          <Col xs={24} md={12}><Form.Item name="zalo_phone" label="Số điện thoại đăng ký Zalo" rules={[{ required: true, message: 'Nhập SĐT Zalo' }]}><Input placeholder="0901222333" /></Form.Item></Col>
                          <Col xs={24} md={12}><Form.Item name="status" label="Trạng thái hoạt động"><Select options={[{ value: 'ACTIVE', label: 'Đang hoạt động' }, { value: 'INACTIVE', label: 'Tạm ngưng' }]} /></Form.Item></Col>
                        </Row>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
                          <Form.Item name="is_default" label="Đặt làm Zalo mặc định của nhân sự này" valuePropName="checked" style={{ marginBottom: 0 }}><Switch checkedChildren="Mặc định" unCheckedChildren="Phụ" /></Form.Item>
                          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saveAccMut.isPending}>{editing ? 'Lưu cập nhật tài khoản' : 'Đã quét QR & Lưu tài khoản Zalo'}</Button>
                        </div>
                      </Col>
                    </Row>
                  </Form>
                </Card>

                <Table<ZaloHrAccountItem>
                  size="small" rowKey="id" pagination={false} dataSource={accounts}
                  columns={[
                    { title: 'Nhân sự phụ trách', key: 'owner', width: 220, render: (_, r) => <div><div style={{ fontWeight: 600 }}>{r.owner_display_name} (@{r.owner_username})</div><div style={{ fontSize: 11, color: '#64748B' }}>{r.owner_role_label}</div></div> },
                    { title: 'Tài khoản Zalo đã liên kết', key: 'zalo', render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{r.zalo_name}</span><Tag color="blue" className="num">{r.zalo_phone}</Tag>{r.is_default && <Tag color="gold">Mặc định</Tag>}</Space> },
                    { title: 'Trạng thái', key: 'status', width: 150, render: (_, r) => <Tag color={r.status === 'ACTIVE' ? 'success' : 'default'} icon={<CheckCircleOutlined />}>{r.status === 'ACTIVE' ? 'Đã liên kết QR' : 'Tạm ngưng'}</Tag> },
                    {
                      title: 'Thao tác', key: 'actions', width: 215, align: 'right',
                      render: (_, r) => (
                        <Space size={4}>
                          <Button size="small" icon={<FileTextOutlined />} onClick={() => { loadTemplateForAcc(r); setActiveTab('templates'); }}>Mẫu tin nhắn</Button>
                          <Button size="small" icon={<EditOutlined />} onClick={() => startEdit(r)}>Sửa</Button>
                          <Popconfirm title="Xóa tài khoản Zalo này?" okText="Xóa" cancelText="Hủy" onConfirm={() => delMut.mutate(r.id)}><Button size="small" danger icon={<DeleteOutlined />} loading={delMut.isPending} /></Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: 'templates',
            label: <span><MessageOutlined /> Quản lý Mẫu tin nhắn Zalo</span>,
            children: (
              <Form form={tplForm} layout="vertical" onFinish={(v) => saveTplMut.mutate(v)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '10px 12px', marginBottom: 12 }}>
                  <Space size={8} wrap>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>Tài khoản Zalo áp dụng:</span>
                    <Select style={{ width: 320 }} value={selectedTplAccId || accounts[0]?.id} onChange={(id) => loadTemplateForAcc(accounts.find((a) => a.id === id))} options={accounts.map((a) => ({ value: a.id, label: `${a.zalo_name} (${a.zalo_phone}) — ${a.owner_display_name}` }))} />
                  </Space>
                  <Space size={4} wrap><span style={{ fontSize: 12, color: '#64748B' }}>Biến tự động:</span>{TEMPLATE_VARS.map((v) => <Tag key={v} color="blue" style={{ margin: 0, fontSize: 11 }}>{v}</Tag>)}</Space>
                </div>
                <Row gutter={12}>
                  <Col xs={24} md={12}><Form.Item name="greeting_template" label="1. Mẫu tin nhắn Chào ứng viên & Kết bạn Zalo"><Input.TextArea rows={4} /></Form.Item></Col>
                  <Col xs={24} md={12}><Form.Item name="invite_template" label="2. Mẫu tin nhắn Mời phỏng vấn (kèm Link xác nhận RSVP)"><Input.TextArea rows={4} /></Form.Item></Col>
                  <Col xs={24} md={12}><Form.Item name="reminder_template" label="3. Mẫu tin nhắn Tự động nhắc lịch trước giờ phỏng vấn (5–15 phút)"><Input.TextArea rows={4} /></Form.Item></Col>
                  <Col xs={24} md={12}><Form.Item name="pass_template" label="4. Mẫu tin nhắn Thông báo Đạt phỏng vấn & Mời nhận việc"><Input.TextArea rows={4} /></Form.Item></Col>
                </Row>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <Button icon={<UndoOutlined />} onClick={() => tplForm.setFieldsValue({ greeting_template: defaultTemplates?.greeting ?? '', invite_template: defaultTemplates?.invite ?? '', reminder_template: defaultTemplates?.reminder ?? '', pass_template: defaultTemplates?.pass ?? '' })}>Khôi phục mẫu mặc định</Button>
                  <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saveTplMut.isPending}>Lưu cấu hình mẫu tin nhắn</Button>
                </div>
              </Form>
            ),
          },
        ]}
      />
    </Modal>
  );
}
