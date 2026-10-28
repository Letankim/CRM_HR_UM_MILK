'use client';

import { useEffect, useState } from 'react';
import { Alert, App, Button, Col, Descriptions, Form, Input, Modal, Row, Space, Tabs, Tag } from 'antd';
import {
  BankOutlined, CloseOutlined, IdcardOutlined, KeyOutlined, LockOutlined,
  MailOutlined, PhoneOutlined, SafetyCertificateOutlined, SaveOutlined, UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';

interface SelfProfileData {
  id: string;
  version: number;
  username: string;
  displayName: string;
  phone: string;
  email: string;
  role: string;
  roleLabel: string;
  employeeId: string | null;
  employeeCode: string | null;
  branchName: string;
  currentAddress: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
}

export interface UserProfileModalProps {
  open: boolean;
  initialTab?: 'info' | 'password';
  onClose: () => void;
}

export function UserProfileModal({ open, initialTab = 'info', onClose }: UserProfileModalProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [activeTab, setActiveTab] = useState<'info' | 'password'>(initialTab);
  const [infoForm] = Form.useForm();
  const [pwdForm] = Form.useForm();

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  const profileQ = useQuery({
    queryKey: ['auth-profile'],
    queryFn: () => api.get<SelfProfileData>('/auth/profile'),
    enabled: open,
  });

  useEffect(() => {
    if (!open || !profileQ.data) return;
    const p = profileQ.data;
    infoForm.setFieldsValue({
      display_name: p.displayName,
      phone: p.phone,
      email: p.email,
      current_address: p.currentAddress,
      emergency_contact_name: p.emergencyContactName,
      emergency_contact_phone: p.emergencyContactPhone,
      bank_name: p.bankName,
      bank_account_number: p.bankAccountNumber,
      bank_account_holder: p.bankAccountHolder,
    });
  }, [open, profileQ.data, infoForm]);

  const updateInfoMut = useMutation({
    mutationFn: (body: unknown) => api.put('/auth/profile', body),
    onSuccess: () => {
      message.success('Đã cập nhật thông tin cá nhân của bạn thành công');
      ['me', 'auth-profile', 'my-attendance', 'employees', 'accounts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.details.length > 0) {
        infoForm.setFields(e.details.map((d) => ({ name: d.field, errors: [d.message] })));
      }
      message.error(e instanceof ApiClientError ? e.message : 'Không thể cập nhật hồ sơ cá nhân');
    },
  });

  const changePwdMut = useMutation({
    mutationFn: (body: unknown) => api.put('/auth/password', body),
    onSuccess: () => {
      message.success('Đã đổi mật khẩu / mã PIN bảo mật thành công');
      pwdForm.resetFields();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.details.length > 0) {
        pwdForm.setFields(e.details.map((d) => ({ name: d.field, errors: [d.message] })));
      }
      message.error(e instanceof ApiClientError ? e.message : 'Đổi mật khẩu thất bại');
    },
  });

  const p = profileQ.data;

  return (
    <Modal
      open={open}
      forceRender
      width={660}
      title={p ? `Hồ sơ Cá nhân & Bảo mật Tài khoản — @${p.username}` : 'Hồ sơ Cá nhân & Bảo mật Tài khoản'}
      onCancel={onClose}
      footer={
        <Space>
          <Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
          {activeTab === 'info' ? (
            <Button type="primary" icon={<SaveOutlined />} loading={updateInfoMut.isPending} onClick={() => infoForm.submit()}>
              Lưu thông tin cá nhân
            </Button>
          ) : (
            <Button type="primary" icon={<KeyOutlined />} loading={changePwdMut.isPending} onClick={() => pwdForm.submit()}>
              Xác nhận đổi mật khẩu
            </Button>
          )}
        </Space>
      }
    >
      {p && (
        <Descriptions size="small" bordered column={1} styles={{ label: { width: 175, fontWeight: 500, whiteSpace: 'nowrap' } }} style={{ marginBottom: 12 }}>
          <Descriptions.Item label="Tài khoản đăng nhập"><Tag color="geekblue" style={{ margin: 0 }}>@{p.username}</Tag></Descriptions.Item>
          <Descriptions.Item label="Vai trò hệ thống"><Tag color="blue" style={{ margin: 0 }}>{p.roleLabel}</Tag></Descriptions.Item>
          <Descriptions.Item label="Mã nhân sự liên kết">{p.employeeCode ? <Tag style={{ margin: 0 }}>{p.employeeCode}</Tag> : 'Tài khoản quản trị nội bộ'}</Descriptions.Item>
          <Descriptions.Item label="Chi nhánh">{p.branchName}</Descriptions.Item>
        </Descriptions>
      )}

      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'info' | 'password')}
        items={[
          {
            key: 'info',
            forceRender: true,
            label: <span><IdcardOutlined /> Thông tin cá nhân &amp; Ngân hàng</span>,
            children: (
              <Form form={infoForm} layout="vertical" onFinish={(v) => updateInfoMut.mutate(v)} style={{ marginTop: 4 }}>
                <Row gutter={12}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="display_name" label="Họ và tên" rules={[{ required: true, message: 'Vui lòng nhập họ và tên' }]}>
                      <Input prefix={<UserOutlined />} placeholder="Nhập họ và tên hiển thị" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="phone" label="Số điện thoại">
                      <Input prefix={<PhoneOutlined />} placeholder="Ví dụ: 0901000001" />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={12}>
                  <Col xs={24} sm={12}><Form.Item name="email" label="Email"><Input prefix={<MailOutlined />} placeholder="Ví dụ: ten.ban@umbomilk.vn" /></Form.Item></Col>
                  <Col xs={24} sm={12}><Form.Item name="current_address" label="Chỗ ở hiện tại"><Input placeholder="Số nhà, đường, quận/huyện, TP. Hồ Chí Minh" /></Form.Item></Col>
                </Row>
                <Row gutter={12}>
                  <Col xs={24} sm={12}><Form.Item name="emergency_contact_name" label="Liên hệ khẩn cấp"><Input placeholder="Họ tên người thân liên hệ khi khẩn cấp" /></Form.Item></Col>
                  <Col xs={24} sm={12}><Form.Item name="emergency_contact_phone" label="SĐT khẩn cấp"><Input placeholder="Ví dụ: 0909123456" /></Form.Item></Col>
                </Row>
                <Row gutter={12}>
                  <Col xs={24} sm={8}><Form.Item name="bank_name" label="Ngân hàng"><Input prefix={<BankOutlined />} placeholder="Techcombank" /></Form.Item></Col>
                  <Col xs={24} sm={8}><Form.Item name="bank_account_number" label="Số tài khoản"><Input placeholder="Nhập số tài khoản" /></Form.Item></Col>
                  <Col xs={24} sm={8}><Form.Item name="bank_account_holder" label="Chủ tài khoản"><Input placeholder="NGUYEN VAN A" /></Form.Item></Col>
                </Row>
              </Form>
            ),
          },
          {
            key: 'password',
            forceRender: true,
            label: <span><SafetyCertificateOutlined /> Đổi mật khẩu / Mã PIN bảo mật</span>,
            children: (
              <Form form={pwdForm} layout="vertical" onFinish={(v) => changePwdMut.mutate(v)} style={{ marginTop: 4 }}>
                <Alert
                  type="info" showIcon style={{ marginBottom: 12 }}
                  message="Nhập mật khẩu hiện tại của bạn và mật khẩu mới tối thiểu 6 ký tự."
                />
                <Form.Item name="current_secret" label="Mật khẩu / Mã PIN hiện tại" rules={[{ required: true, message: 'Vui lòng nhập mật khẩu hoặc mã PIN hiện tại' }]}>
                  <Input.Password prefix={<LockOutlined />} placeholder="Nhập mật khẩu hoặc mã PIN đang sử dụng" />
                </Form.Item>
                <Row gutter={12}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="new_secret" label="Mật khẩu / Mã PIN mới" rules={[{ required: true, min: 6, message: 'Mật khẩu mới tối thiểu 6 ký tự' }]}>
                      <Input.Password prefix={<KeyOutlined />} placeholder="Nhập mật khẩu / mã PIN mới" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="confirm_secret" label="Xác nhận mật khẩu / Mã PIN mới"
                      dependencies={['new_secret']}
                      rules={[
                        { required: true, message: 'Vui lòng nhập lại mật khẩu mới' },
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            if (!value || getFieldValue('new_secret') === value) return Promise.resolve();
                            return Promise.reject(new Error('Mật khẩu xác nhận không khớp với mật khẩu mới'));
                          },
                        }),
                      ]}
                    >
                      <Input.Password prefix={<KeyOutlined />} placeholder="Nhập lại chính xác mật khẩu mới" />
                    </Form.Item>
                  </Col>
                </Row>
              </Form>
            ),
          },
        ]}
      />
    </Modal>
  );
}
