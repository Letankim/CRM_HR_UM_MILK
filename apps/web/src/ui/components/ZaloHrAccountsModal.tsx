'use client';

import { useEffect, useState } from 'react';
import { App, Avatar, Button, Card, Col, Form, Input, Modal, Popconfirm, QRCode, Row, Select, Space, Switch, Table, Tabs, Tag } from 'antd';
import {
  CheckCircleOutlined, CloseOutlined, DeleteOutlined, EditOutlined, FileTextOutlined,
  MessageOutlined, MobileOutlined, PlusOutlined, QrcodeOutlined, ReloadOutlined, SaveOutlined, UndoOutlined,
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

interface QrSessionDto {
  session_id: string; qr_image?: string; qr_url: string; session_token: string;
  status: 'PENDING' | 'SCANNED' | 'CONFIRMED' | 'DECLINED' | 'EXPIRED'; expires_in: number;
  scanned_display_name?: string; scanned_avatar?: string; zalo_name?: string; zalo_phone?: string;
}

const TEMPLATE_VARS = ['{candidate_name}', '{candidate_code}', '{position}', '{branch_name}', '{interview_time}', '{meet_link}', '{rsvp_url}', '{hr_zalo_name}', '{hr_zalo_phone}'];

export function ZaloHrAccountsModal({ open, accounts, defaultTemplates, userOptions, currentUserId, onClose }: Props) {
  const qc = useQueryClient(), { message } = App.useApp(), [accForm] = Form.useForm(), [tplForm] = Form.useForm();
  const [activeTab, setActiveTab] = useState<'accounts' | 'templates'>('accounts');
  const [editing, setEditing] = useState<ZaloHrAccountItem | null>(null), [selectedTplAccId, setSelectedTplAccId] = useState<string>('');
  const [qrSession, setQrSession] = useState<QrSessionDto>({ session_id: 'zqr_init', qr_image: '', qr_url: 'https://id.zalo.me', session_token: '', status: 'PENDING', expires_in: 100 });
  const [secondsLeft, setSecondsLeft] = useState(100);

  const qrMut = useMutation({
    mutationFn: () => api.post<QrSessionDto>('/admin/recruitment/zalo-qr-session', { owner_user_id: accForm.getFieldValue('owner_user_id') || currentUserId || userOptions[0]?.value, zalo_name: accForm.getFieldValue('zalo_name'), zalo_phone: accForm.getFieldValue('zalo_phone'), is_default: Boolean(accForm.getFieldValue('is_default') ?? true) }),
    onSuccess: (data) => { setQrSession(data); setSecondsLeft(data.expires_in || 100); },
  });

  const resetToCreate = () => {
    setEditing(null); accForm.resetFields();
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
    if (!open || activeTab !== 'accounts' || qrSession.status === 'CONFIRMED') return;
    const timer = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [open, activeTab, qrSession.status]);
  useEffect(() => {
    if (!open || activeTab !== 'accounts' || qrSession.session_id === 'zqr_init' || qrSession.status === 'CONFIRMED' || qrSession.status === 'DECLINED' || secondsLeft <= 0) return;
    const poll = setInterval(async () => {
      try {
        const st = await api.get<QrSessionDto>(`/admin/recruitment/zalo-qr-session/${qrSession.session_id}`);
        setQrSession((prev) => ({ ...prev, ...st }));
        if (st.scanned_display_name) accForm.setFieldValue('zalo_name', st.scanned_display_name);
        if (st.zalo_phone) accForm.setFieldValue('zalo_phone', st.zalo_phone);
        if (st.status === 'CONFIRMED') { message.success(`Đã quét mã QR trên điện thoại và liên kết Zalo "${st.zalo_name || st.scanned_display_name || ''}" thành công!`); qc.invalidateQueries({ queryKey: ['recruitment-zalo-accounts'] }); }
      } catch { /* ignore polling error */ }
    }, 2200);
    return () => clearInterval(poll);
  }, [open, activeTab, qrSession.session_id, qrSession.status, secondsLeft]);

  const startEdit = (item: ZaloHrAccountItem) => {
    setEditing(item); setQrSession((p) => ({ ...p, status: 'CONFIRMED' })); setActiveTab('accounts');
    accForm.setFieldsValue({ owner_user_id: item.owner_user_id, zalo_name: item.zalo_name, zalo_phone: item.zalo_phone, is_default: item.is_default, status: item.status });
  };

  const saveAccMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => editing ? api.put(`/admin/recruitment/zalo-accounts/${editing.id}`, { ...editing, ...v, access_token: qrSession.session_token }) : api.post('/admin/recruitment/zalo-accounts', { ...defaultTemplates, ...v, access_token: qrSession.session_token, zalo_id: `zalo_${String(v.zalo_phone || '').trim()}` }),
    onSuccess: () => { message.success(editing ? 'Đã cập nhật thông tin tài khoản Zalo thành công' : 'Đã lưu tài khoản Zalo tuyển dụng thành công'); qc.invalidateQueries({ queryKey: ['recruitment-zalo-accounts'] }); resetToCreate(); },
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

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0'), ss = String(secondsLeft % 60).padStart(2, '0');
  const isConfirmed = qrSession.status === 'CONFIRMED', isScanned = qrSession.status === 'SCANNED';

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
                  <Form form={accForm} layout="vertical" onFinish={(v) => saveAccMut.mutate(v)}>
                    <Row gutter={16} align="middle">
                      <Col xs={24} md={8}>
                        <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 4, padding: 12, textAlign: 'center' }}>
                          <Tag color={isConfirmed ? 'success' : isScanned ? 'warning' : 'processing'} icon={isConfirmed ? <CheckCircleOutlined /> : isScanned ? <MobileOutlined /> : <QrcodeOutlined />} style={{ marginBottom: 6, fontWeight: 600 }}>
                            {isConfirmed ? 'Đã xác thực QR Zalo' : isScanned ? `Đã quét: ${qrSession.scanned_display_name || 'Chờ xác nhận ĐT'}` : `Quét mã QR bằng Zalo (${mm}:${ss})`}
                          </Tag>
                          <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
                            {isScanned ? 'Vui lòng bấm nút "Đăng nhập" trên ứng dụng Zalo điện thoại để hoàn tất.' : 'Mở ứng dụng Zalo trên điện thoại và quét mã QR bên dưới để đăng nhập.'}
                          </div>
                          <div style={{ background: '#FFFFFF', border: '2px solid #2563EB', borderRadius: 4, padding: 6, display: 'inline-block' }}>
                            {isScanned && qrSession.scanned_avatar ? (
                              <div style={{ width: 164, height: 164, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                <Avatar src={qrSession.scanned_avatar} size={72} />
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{qrSession.scanned_display_name}</div>
                                <Tag color="blue">Chờ xác nhận trên ĐT</Tag>
                              </div>
                            ) : qrSession.qr_image ? (
                              <img src={qrSession.qr_image} alt="Mã QR Đăng nhập Zalo" style={{ width: 164, height: 164, display: 'block' }} />
                            ) : (
                              <QRCode value={qrSession.qr_url} size={164} status={qrMut.isPending ? 'loading' : secondsLeft <= 0 ? 'expired' : 'active'} onRefresh={() => qrMut.mutate()} />
                            )}
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <Button size="small" icon={<ReloadOutlined />} loading={qrMut.isPending} onClick={() => qrMut.mutate()}>Lấy mã QR Zalo mới</Button>
                          </div>
                        </div>
                      </Col>
                      <Col xs={24} md={16}>
                        <Row gutter={12}>
                          <Col xs={24} md={12}><Form.Item name="owner_user_id" label="Nhân sự HR phụ trách tài khoản Zalo" rules={[{ required: true }]}><Select options={userOptions} showSearch optionFilterProp="label" placeholder="Chọn nhân sự HR" /></Form.Item></Col>
                          <Col xs={24} md={12}><Form.Item name="zalo_name" label="Tên hiển thị Zalo tuyển dụng" rules={[{ required: true, message: 'Nhập tên hiển thị Zalo' }]}><Input placeholder="Tự động điền khi quét QR hoặc nhập tên Zalo" /></Form.Item></Col>
                          <Col xs={24} md={12}><Form.Item name="zalo_phone" label="Số điện thoại đăng ký Zalo" rules={[{ required: true, message: 'Nhập SĐT Zalo' }]}><Input placeholder="0901222333" /></Form.Item></Col>
                          <Col xs={24} md={12}><Form.Item name="status" label="Trạng thái hoạt động"><Select options={[{ value: 'ACTIVE', label: 'Đang hoạt động' }, { value: 'INACTIVE', label: 'Tạm ngưng' }]} /></Form.Item></Col>
                        </Row>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
                          <Form.Item name="is_default" label="Đặt làm Zalo mặc định của nhân sự này" valuePropName="checked" style={{ marginBottom: 0 }}><Switch checkedChildren="Mặc định" unCheckedChildren="Phụ" /></Form.Item>
                          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saveAccMut.isPending}>{editing ? 'Lưu cập nhật tài khoản' : 'Lưu cấu hình tài khoản Zalo'}</Button>
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
                  <Space size={8} wrap><span style={{ fontWeight: 600, fontSize: 13 }}>Tài khoản Zalo áp dụng:</span><Select style={{ width: 320 }} value={selectedTplAccId || accounts[0]?.id} onChange={(id) => loadTemplateForAcc(accounts.find((a) => a.id === id))} options={accounts.map((a) => ({ value: a.id, label: `${a.zalo_name} (${a.zalo_phone}) — ${a.owner_display_name}` }))} /></Space>
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
