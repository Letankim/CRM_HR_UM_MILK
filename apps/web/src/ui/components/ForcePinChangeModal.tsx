'use client';

import { useEffect } from 'react';
import { Alert, App, Avatar, Button, Flex, Form, Modal, Tag, Typography } from 'antd';
import { KeyOutlined, LogoutOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isEmployeeRole, ROLE_SHORT_LABELS, type PublicUser } from '@umbm/shared';
import { api, ApiClientError, PIN_CHANGE_REQUIRED_EVENT } from '@/lib/api';
import { useLogout, useMe, type AppKind } from '@/lib/auth';
import { ChangeSecretFields, type ChangeSecretFormValues } from './ChangeSecretFields';

type PinChangeReason = NonNullable<PublicUser['pinChangeReason']>;

function reasonText(reason: PinChangeReason | null | undefined, noun: string): string {
  if (reason === 'RESET') return `${capitalize(noun)} đã được đặt lại — vui lòng đổi ${noun} mới`;
  if (reason === 'EXPIRED') return `${capitalize(noun)} đã hết chu kỳ sử dụng — vui lòng đổi ${noun} mới`;
  return `Tài khoản vừa được cấp — vui lòng đổi ${noun} để bảo mật`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface ForcePinChangeModalProps {
  app: AppKind;
}

/**
 * Hộp thoại BẮT BUỘC đổi mã PIN / mật khẩu (không thể đóng) khi tài khoản có `mustChangePin = true`
 * (lần đăng nhập đầu tiên, vừa được đặt lại, hoặc mã PIN hết chu kỳ sử dụng).
 * Đồng thời lắng nghe sự kiện `umbm:pin-change-required` (API trả 403 PIN_CHANGE_REQUIRED) để tải lại phiên.
 */
export function ForcePinChangeModal({ app }: ForcePinChangeModalProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<ChangeSecretFormValues>();
  const { data } = useMe();
  const logout = useLogout(app);
  const user = data?.user;
  const open = Boolean(user?.mustChangePin);
  const isEmployee = user ? isEmployeeRole(user.role) : app === 'employee';
  const noun = isEmployee ? 'mã PIN' : 'mật khẩu';

  useEffect(() => {
    const handler = () => void qc.invalidateQueries({ queryKey: ['me'] });
    window.addEventListener(PIN_CHANGE_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(PIN_CHANGE_REQUIRED_EVENT, handler);
  }, [qc]);

  const changeMut = useMutation({
    mutationFn: (values: ChangeSecretFormValues) =>
      api.put<{ ok: boolean; user?: PublicUser }>('/auth/password', values),
    onSuccess: (res) => {
      message.success(`Đã đổi ${noun} thành công. Bạn có thể tiếp tục sử dụng hệ thống`);
      form.resetFields();
      qc.setQueryData<{ user: PublicUser; app: AppKind; socketToken?: string | null }>(['me'], (old) =>
        old ? { ...old, user: res?.user ?? { ...old.user, mustChangePin: false, pinChangeReason: null } } : old,
      );
      void qc.invalidateQueries();
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.details.length > 0) {
        form.setFields(e.details.map((d) => ({ name: d.field as keyof ChangeSecretFormValues, errors: [d.message] })));
      }
      message.error(e instanceof ApiClientError ? e.message : `Không thể đổi ${noun}, vui lòng thử lại`);
    },
  });

  const reason = user?.pinChangeReason ?? null;

  return (
    <Modal
      rootClassName="umbm-force-secret-modal"
      open={open}
      closable={false}
      maskClosable={false}
      keyboard={false}
      centered
      destroyOnHidden
      width={440}
      zIndex={1100}
      styles={{
        header: { paddingBottom: 12, marginBottom: 14, borderBottom: '1px solid #E5E7EB' },
        body: { paddingTop: 0 },
        footer: { marginTop: 16, paddingTop: 14, borderTop: '1px solid #E5E7EB' },
      }}
      title={
        <Flex align="center" gap={8}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 4,
              background: '#EFF6FF',
              border: '1px solid #BFDBFE',
              color: '#2563EB',
              display: 'inline-grid',
              placeItems: 'center',
              fontSize: 15,
              flexShrink: 0,
            }}
          >
            <SafetyCertificateOutlined />
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
            {isEmployee ? 'Bắt buộc đổi mã PIN đăng nhập' : 'Bắt buộc đổi mật khẩu đăng nhập'}
          </span>
        </Flex>
      }
      footer={
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: '100%' }}>
          <Button
            size="large"
            block
            icon={<LogoutOutlined />}
            onClick={() => void logout()}
            disabled={changeMut.isPending}
            style={{ height: 40, fontWeight: 500 }}
          >
            Đăng xuất
          </Button>
          <Button
            type="primary"
            size="large"
            block
            icon={<KeyOutlined />}
            loading={changeMut.isPending}
            onClick={() => form.submit()}
            style={{ height: 40, fontWeight: 600 }}
          >
            {isEmployee ? 'Đổi mã PIN' : 'Đổi mật khẩu'}
          </Button>
        </div>
      }
    >
      <Alert type="warning" showIcon style={{ marginBottom: 12, borderRadius: 4 }} message={reasonText(reason, noun)} />
      {user && (
        <Flex
          align="center"
          justify="space-between"
          gap={10}
          style={{
            border: '1px solid #E5E7EB',
            borderRadius: 4,
            background: '#F8FAFC',
            padding: '8px 12px',
            marginBottom: 14,
          }}
        >
          <Flex align="center" gap={10} style={{ minWidth: 0, flex: 1 }}>
            <Avatar
              size={32}
              style={{
                background: '#EFF6FF',
                color: '#2563EB',
                border: '1px solid #93C5FD',
                fontWeight: 700,
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              {(user.displayName || user.username).charAt(0).toUpperCase()}
            </Avatar>
            <div style={{ minWidth: 0, flex: 1, lineHeight: 1.3 }}>
              <Typography.Text strong ellipsis style={{ display: 'block', fontSize: 13, color: '#0F172A' }}>
                {user.displayName || user.username}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {isEmployee ? 'Mã PIN mới gồm đúng 6 chữ số, khác mã cũ' : 'Mật khẩu mới từ 6 ký tự, khác mật khẩu cũ'}
              </Typography.Text>
            </div>
          </Flex>
          <Tag color="blue" style={{ margin: 0, borderRadius: 4, fontWeight: 600, flexShrink: 0 }}>
            {ROLE_SHORT_LABELS[user.role]}
          </Tag>
        </Flex>
      )}
      <Form<ChangeSecretFormValues> form={form} layout="vertical" requiredMark={false} disabled={changeMut.isPending} onFinish={(v) => changeMut.mutate(v)}>
        <ChangeSecretFields isEmployee={isEmployee} issuedSecret={reason === 'FIRST_LOGIN' || reason === 'RESET'} autoFocus />
      </Form>
    </Modal>
  );
}
