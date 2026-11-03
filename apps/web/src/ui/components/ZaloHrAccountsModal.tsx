'use client';

import { useEffect, useState } from 'react';
import { App, Avatar, Button, Card, Col, Form, Input, Modal, Popconfirm, QRCode, Row, Select, Space, Switch, Table, Tabs, Tag } from 'antd';
import { CheckCircleOutlined, CloseOutlined, DeleteOutlined, EditOutlined, FileTextOutlined, MessageOutlined, MobileOutlined, PlusOutlined, QrcodeOutlined, ReloadOutlined, SaveOutlined, UndoOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import { applyApiFormErrors } from '@/lib/form-error';
import { TEMPLATE_VARS, type QrSessionDto, type ZaloHrAccountItem } from './zalo-accounts-types';

export type { ZaloHrAccountItem } from './zalo-accounts-types';

interface Props {
  open: boolean; accounts: ZaloHrAccountItem[];
  defaultTemplates?: { greeting: string; invite: string; reminder: string; pass: string };
  userOptions: { value: string; label: string }[]; currentUserId?: string; onClose: () => void;
}

export function ZaloHrAccountsModal({ open, accounts, defaultTemplates, userOptions, currentUserId, onClose }: Props) {
  const qc = useQueryClient(), { message } = App.useApp(), [accForm] = Form.useForm(), [tplForm] = Form.useForm();
  const [activeTab, setActiveTab] = useState<'accounts' | 'templates'>('accounts');
  const [editing, setEditing] = useState<ZaloHrAccountItem | null>(null), [selectedTplAccId, setSelectedTplAccId] = useState<string>('');
  const [qrSession, setQrSession] = useState<QrSessionDto>({ session_id: 'zqr_init', qr_image: '', qr_url: 'https://id.zalo.me', session_token: '', status: 'PENDING', expires_in: 100 });
  const [secondsLeft, setSecondsLeft] = useState(100);

  const qrMut = useMutation({
    mutationFn: () => api.post<QrSessionDto>('/admin/recruitment/zalo-qr-session', { owner_user_id: currentUserId || userOptions[0]?.value, zalo_name: accForm.getFieldValue('zalo_name'), zalo_phone: accForm.getFieldValue('zalo_phone'), is_default: Boolean(accForm.getFieldValue('is_default') ?? true) }),
    onSuccess: (data) => { setQrSession(data); setSecondsLeft(data.expires_in || 100); },
  });

  const resetToCreate = () => {
    setEditing(null); accForm.resetFields();
    accForm.setFieldsValue({ owner_user_id: currentUserId || userOptions[0]?.value, zalo_name: '', zalo_phone: '', is_default: true, status: 'ACTIVE' });
    qrMut.mutate();
  };

  const loadTemplateForAcc = (acc?: ZaloHrAccountItem) => {
    const target = acc ?? accounts.find((a) => a.is_default) ?? accounts[0];
    setSelectedTplAccId(target?.id ?? '');
    tplForm.setFieldsValue({ greeting_template: target?.greeting_template || defaultTemplates?.greeting || '', invite_template: target?.invite_template || defaultTemplates?.invite || '', reminder_template: target?.reminder_template || defaultTemplates?.reminder || '', pass_template: target?.pass_template || defaultTemplates?.pass || '' });
  };

  useEffect(() => { if (open) { setActiveTab('accounts'); resetToCreate(); loadTemplateForAcc(accounts.find((a) => a.is_default) ?? accounts[0]); } }, [open, currentUserId]);
  useEffect(() => {
    if (!open || activeTab !== 'accounts' || qrSession.status === 'CONFIRMED') return;
    const timer = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [open, activeTab, qrSession.status]);
  useEffect(() => {
    if (!open || activeTab !== 'accounts' || editing || qrSession.session_id === 'zqr_init') return;
    if (qrSession.status === 'DECLINED' || qrSession.status === 'EXPIRED' || (qrSession.status === 'CONFIRMED' && Boolean(qrSession.saved_account))) return;
    let active = true;
    const checkQrStatus = async () => {
      try {
        const st = await api.get<QrSessionDto>(`/admin/recruitment/zalo-qr-session/${qrSession.session_id}`);
        if (!active) return;
        setQrSession((prev) => ({ ...prev, ...st }));
        if (st.scanned_display_name) accForm.setFieldValue('zalo_name', st.scanned_display_name);
        if (st.zalo_name) accForm.setFieldValue('zalo_name', st.zalo_name);
        if (st.zalo_phone) accForm.setFieldValue('zalo_phone', st.zalo_phone);
        if (st.status === 'CONFIRMED' && st.saved_account) {
          const saved = st.saved_account;
          qc.setQueryData<{ items: ZaloHrAccountItem[] }>(['recruitment-zalo-accounts'], (old) => old ? { ...old, items: [saved, ...old.items.filter((a) => a.id !== saved.id)] } : old);
          setEditing(saved); qc.invalidateQueries({ queryKey: ['recruitment-zalo-accounts'] });
          message.success(`Đã liên kết Zalo "${saved.zalo_name}" thành công và hiển thị ngay trong danh sách`);
        }
      } catch { /* ignore */ }
    };
    void checkQrStatus();
    const poll = setInterval(checkQrStatus, 5000);
    return () => { active = false; clearInterval(poll); };
  }, [open, activeTab, editing, qrSession.session_id, qrSession.status, qrSession.saved_account]);

  const startEdit = (item: ZaloHrAccountItem) => {
    setEditing(item); setQrSession((p) => ({ ...p, status: 'CONFIRMED' })); setActiveTab('accounts');
    accForm.setFieldsValue({ owner_user_id: item.owner_user_id, zalo_name: item.zalo_name, zalo_phone: item.zalo_phone, is_default: item.is_default, status: item.status });
  };

  const saveAccMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => {
      const targetAcc = editing ?? qrSession.saved_account ?? null;
      const ownerId = String(v.owner_user_id || targetAcc?.owner_user_id || currentUserId || userOptions[0]?.value || 'hr');
      return targetAcc
        ? api.put(`/admin/recruitment/zalo-accounts/${targetAcc.id}`, { ...targetAcc, ...v, owner_user_id: ownerId, access_token: qrSession.session_token })
        : api.post('/admin/recruitment/zalo-accounts', { ...defaultTemplates, ...v, owner_user_id: ownerId, access_token: qrSession.session_token, zalo_id: `zalo_${String(v.zalo_phone || '').trim()}` });
    },
    onSuccess: () => { message.success('Đã lưu cấu hình tài khoản Zalo tuyển dụng thành công'); qc.invalidateQueries({ queryKey: ['recruitment-zalo-accounts'] }); resetToCreate(); },
    onError: (e) => message.error(applyApiFormErrors(accForm, e, { fallbackMessage: 'Lưu tài khoản Zalo thất bại' })),
  });

  const setDefaultMut = useMutation({
    mutationFn: (item: ZaloHrAccountItem) => api.put(`/admin/recruitment/zalo-accounts/${item.id}`, { ...item, is_default: true, status: 'ACTIVE' }),
    onSuccess: (_, item) => { message.success(`Đã chọn "${item.zalo_name}" làm tài khoản Zalo mặc định gửi thông báo`); qc.invalidateQueries({ queryKey: ['recruitment-zalo-accounts'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Đặt tài khoản mặc định thất bại'),
  });

  const saveTplMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => {
      const target = accounts.find((a) => a.id === selectedTplAccId) ?? accounts[0];
      if (!target) throw new Error('Vui lòng liên kết ít nhất 1 tài khoản Zalo trước khi lưu mẫu tin nhắn');
      return api.put(`/admin/recruitment/zalo-accounts/${target.id}`, { owner_user_id: target.owner_user_id, zalo_name: target.zalo_name, zalo_phone: target.zalo_phone, is_default: target.is_default, status: target.status, ...v });
    },
    onSuccess: () => { message.success('Đã lưu cấu hình mẫu tin nhắn Zalo tuyển dụng thành công'); qc.invalidateQueries({ queryKey: ['recruitment-zalo-accounts'] }); },
    onError: (e) => message.error(applyApiFormErrors(tplForm, e, { fallbackMessage: 'Lưu mẫu tin nhắn thất bại' })),
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
                            {isConfirmed ? (qrSession.saved_account || editing ? 'Đã xác thực QR Zalo' : 'Đã đăng nhập, đang lưu tài khoản...') : isScanned ? `Đã quét: ${qrSession.scanned_display_name || 'Chờ xác nhận ĐT'}` : `Quét mã QR bằng Zalo (${mm}:${ss})`}
                          </Tag>
                          <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
                            {isScanned ? 'Vui lòng bấm nút "Đăng nhập" trên ứng dụng Zalo điện thoại để hoàn tất.' : 'Mở ứng dụng Zalo trên điện thoại và quét mã QR bên dưới để đăng nhập.'}
                          </div>
                          <div style={{ background: '#FFFFFF', border: '2px solid #2563EB', borderRadius: 4, padding: 6, display: 'inline-block' }}>
                            {isScanned && qrSession.scanned_avatar ? (
                              <div style={{ width: 164, height: 164, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                <Avatar src={qrSession.scanned_avatar} size={72} /><div style={{ fontWeight: 600, fontSize: 13 }}>{qrSession.scanned_display_name}</div><Tag color="blue">Chờ xác nhận trên ĐT</Tag>
                              </div>
                            ) : qrSession.qr_image ? <img src={qrSession.qr_image} alt="Mã QR Đăng nhập Zalo" style={{ width: 164, height: 164, display: 'block' }} />
                            : <QRCode value={qrSession.qr_url} size={164} status={qrMut.isPending ? 'loading' : secondsLeft <= 0 ? 'expired' : 'active'} onRefresh={() => qrMut.mutate()} />}
                          </div>
                          <div style={{ marginTop: 8 }}><Button size="small" icon={<ReloadOutlined />} loading={qrMut.isPending} onClick={() => qrMut.mutate()}>Lấy mã QR Zalo mới</Button></div>
                        </div>
                      </Col>
                      <Col xs={24} md={16}>
                        <Row gutter={12}>
                          <Col xs={24} md={24}><Form.Item name="zalo_name" label="Tên hiển thị Zalo tuyển dụng" rules={[{ required: true, message: 'Nhập tên hiển thị Zalo' }]}><Input placeholder="Tự động điền ngay khi quét mã QR trên điện thoại hoặc nhập tên Zalo" /></Form.Item></Col>
                          <Col xs={24} md={12}><Form.Item name="zalo_phone" label="Số điện thoại đăng ký Zalo" rules={[{ required: true, message: 'Nhập SĐT Zalo' }]}><Input placeholder="Tự động điền khi quét QR hoặc nhập SĐT" /></Form.Item></Col>
                          <Col xs={24} md={12}><Form.Item name="status" label="Trạng thái hoạt động"><Select options={[{ value: 'ACTIVE', label: 'Đang hoạt động' }, { value: 'INACTIVE', label: 'Tạm ngưng' }]} /></Form.Item></Col>
                        </Row>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
                          <Form.Item name="is_default" label="Đặt làm tài khoản Zalo mặc định gửi thông báo" valuePropName="checked" style={{ marginBottom: 0 }}><Switch checkedChildren="Mặc định" unCheckedChildren="Phụ" /></Form.Item>
                          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saveAccMut.isPending}>{editing || qrSession.saved_account ? 'Lưu cập nhật tài khoản' : 'Lưu cấu hình tài khoản Zalo'}</Button>
                        </div>
                      </Col>
                    </Row>
                  </Form>
                </Card>

                <Table<ZaloHrAccountItem>
                  size="small" rowKey="id" pagination={false} dataSource={accounts}
                  columns={[
                    { title: 'Tài khoản Zalo đã liên kết', key: 'zalo', render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{r.zalo_name}</span><Tag color="blue" className="num">{r.zalo_phone}</Tag></Space> },
                    { title: 'Mặc định gửi thông báo', key: 'default', width: 210, render: (_, r) => r.is_default ? <Tag color="gold" icon={<CheckCircleOutlined />} style={{ fontWeight: 600 }}>Đang dùng mặc định</Tag> : <Button size="small" type="primary" ghost loading={setDefaultMut.isPending} onClick={() => setDefaultMut.mutate(r)}>Chọn làm mặc định</Button> },
                    { title: 'Trạng thái', key: 'status', width: 150, render: (_, r) => <Tag color={r.status === 'ACTIVE' ? 'success' : 'default'} icon={<CheckCircleOutlined />}>{r.status === 'ACTIVE' ? 'Đã liên kết QR' : 'Tạm ngưng'}</Tag> },
                    {
                      title: 'Thao tác', key: 'actions', width: 215, align: 'right',
                      render: (_, r) => <Space size={4}><Button size="small" icon={<FileTextOutlined />} onClick={() => { loadTemplateForAcc(r); setActiveTab('templates'); }}>Mẫu tin nhắn</Button><Button size="small" icon={<EditOutlined />} onClick={() => startEdit(r)}>Sửa</Button><Popconfirm title="Xóa tài khoản Zalo này? Nếu đang là mặc định, hệ thống sẽ tự động chuyển sang tài khoản còn lại." okText="Xóa" cancelText="Hủy" onConfirm={() => delMut.mutate(r.id)}><Button size="small" danger icon={<DeleteOutlined />} loading={delMut.isPending} /></Popconfirm></Space>,
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
                  <Space size={8} wrap><span style={{ fontWeight: 600, fontSize: 13 }}>Tài khoản Zalo áp dụng:</span><Select style={{ width: 320 }} value={selectedTplAccId || accounts[0]?.id} onChange={(id) => loadTemplateForAcc(accounts.find((a) => a.id === id))} options={accounts.map((a) => ({ value: a.id, label: `${a.zalo_name} (${a.zalo_phone})${a.is_default ? ' — Mặc định' : ''}` }))} /></Space>
                  <Space size={4} wrap><span style={{ fontSize: 12, color: '#64748B' }}>Biến tự động:</span>{TEMPLATE_VARS.map((v) => <Tag key={v} color="blue" style={{ margin: 0, fontSize: 11 }}>{v}</Tag>)}</Space>
                </div>
                <Row gutter={12}>
                  <Col xs={24} md={12}><Form.Item name="greeting_template" label="1. Mẫu Lời mời kết bạn Zalo (Tối đa 150 ký tự)" rules={[{ max: 150, message: 'Lời mời kết bạn Zalo chỉ được tối đa 150 ký tự' }]}><Input.TextArea rows={4} maxLength={150} showCount /></Form.Item></Col>
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
