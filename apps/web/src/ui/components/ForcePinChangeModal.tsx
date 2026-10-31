'use client';

import { useEffect } from 'react';
import { Alert, App, Button, Flex, Form, Modal, Typography } from 'antd';
import { KeyOutlined, LogoutOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isEmployeeRole, type PublicUser } from '@umbm/shared';
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
      open={open}
      closable={false}
      maskClosable={false}
      keyboard={false}
      centered
      destroyOnHidden
      width={460}
      zIndex={1100}
      title={
        <Flex align="center" gap={8}>
          <SafetyCertificateOutlined style={{ color: '#2563EB' }} />
          <span>{isEmployee ? 'Bắt buộc đổi mã PIN đăng nhập' : 'Bắt buộc đổi mật khẩu đăng nhập'}</span>
        </Flex>
      }
      footer={
        <Flex justify="space-between" align="center">
          <Button type="link" icon={<LogoutOutlined />} onClick={() => void logout()} style={{ paddingInline: 0 }} disabled={changeMut.isPending}>
            Đăng xuất
          </Button>
          <Button type="primary" icon={<KeyOutlined />} loading={changeMut.isPending} onClick={() => form.submit()}>
            {isEmployee ? 'Xác nhận đổi mã PIN' : 'Xác nhận đổi mật khẩu'}
          </Button>
        </Flex>
      }
    >
      <Alert type="warning" showIcon style={{ marginBottom: 14, borderRadius: 4 }} message={reasonText(reason, noun)} />
      {user && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 12 }}>
          Tài khoản <Typography.Text strong>{user.displayName || user.username}</Typography.Text> cần đổi {noun} trước khi tiếp tục sử dụng hệ thống.
          {isEmployee ? ' Mã PIN mới gồm đúng 6 chữ số và phải khác mã PIN hiện tại.' : ' Mật khẩu mới tối thiểu 6 ký tự và phải khác mật khẩu hiện tại.'}
        </Typography.Paragraph>
      )}
      <Form<ChangeSecretFormValues> form={form} layout="vertical" requiredMark={false} disabled={changeMut.isPending} onFinish={(v) => changeMut.mutate(v)}>
        <ChangeSecretFields isEmployee={isEmployee} issuedSecret={reason === 'FIRST_LOGIN' || reason === 'RESET'} autoFocus />
      </Form>
    </Modal>
  );
}
