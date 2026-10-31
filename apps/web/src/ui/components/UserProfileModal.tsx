'use client';

import { useEffect, useState } from 'react';
import { Alert, App, Button, Col, Descriptions, Form, Input, Modal, Row, Space, Tabs, Tag } from 'antd';
import {
  BankOutlined, CloseOutlined, IdcardOutlined, KeyOutlined,
  MailOutlined, PhoneOutlined, SafetyCertificateOutlined, SaveOutlined, UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isEmployeeRole, type Role } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { ChangeSecretFields } from './ChangeSecretFields';

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
  const p = profileQ.data;
  const isEmployee = p ? isEmployeeRole(p.role as Role) : false;
  const opsConfigQ = useQuery({
    queryKey: ['operations-config'],
    queryFn: () => api.get<{ settings?: { pinRotationDays?: number } }>('/admin/operations-config'),
    enabled: open && activeTab === 'password',
    retry: false,
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
      message.success(isEmployee ? 'Đã đổi mã PIN đăng nhập thành công' : 'Đã đổi mật khẩu đăng nhập thành công');
      pwdForm.resetFields();
      void qc.invalidateQueries({ queryKey: ['me'] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.details.length > 0) {
        pwdForm.setFields(e.details.map((d) => ({ name: d.field, errors: [d.message] })));
      }
      message.error(e instanceof ApiClientError ? e.message : (isEmployee ? 'Đổi mã PIN thất bại' : 'Đổi mật khẩu thất bại'));
    },
  });

  const pinRotationDays = Number(opsConfigQ.data?.settings?.pinRotationDays ?? 0);

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
              {isEmployee ? 'Xác nhận đổi mã PIN' : 'Xác nhận đổi mật khẩu'}
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
            label: <span><SafetyCertificateOutlined /> {isEmployee ? 'Đổi mã PIN bảo mật (6 số)' : 'Đổi mật khẩu bảo mật'}</span>,
            children: (
              <Form form={pwdForm} layout="vertical" onFinish={(v) => changePwdMut.mutate(v)} style={{ marginTop: 4 }}>
                {pinRotationDays > 0 && (
                  <Alert
                    type="info" showIcon style={{ marginBottom: 12, borderRadius: 4 }}
                    message={`Theo quy định bảo mật, ${isEmployee ? 'mã PIN' : 'mật khẩu'} cần được đổi định kỳ mỗi ${pinRotationDays} ngày`}
                  />
                )}
                <ChangeSecretFields isEmployee={isEmployee} />
              </Form>
            ),
          },
        ]}
      />
    </Modal>
  );
}
