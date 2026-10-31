'use client';

import { Alert, App, Button, Flex, Input, Popconfirm, Space, Steps, Tag } from 'antd';
import {
  CalculatorOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseOutlined,
  DeleteOutlined, MailOutlined, RollbackOutlined, SafetyCertificateOutlined, SendOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PAY_PERIOD_STATUS_LABELS, type PayPeriodStatus } from '@umbm/shared';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { StatusTag } from '@/ui/StatusTag';
import { fmtVnd, type PayPeriodRow } from './payroll-types';
import { AdminApprovePeriodModal, FinancePublishPeriodModal } from './PayrollWorkflowModals';

const STEP_ORDER: PayPeriodStatus[] = ['DRAFT', 'RECONCILE', 'APPROVED', 'PUBLISHED', 'PAID'];
const BACK: Partial<Record<PayPeriodStatus, PayPeriodStatus>> = { RECONCILE: 'DRAFT', APPROVED: 'RECONCILE' };

export function PayrollPeriodBar({ period, canManage, onDeleted }: { period: PayPeriodRow; canManage: boolean; onDeleted: () => void }) {
  const qc = useQueryClient();
  const can = useCan();
  const me = useMe().data?.user;
  const isAdmin = me?.role === 'ADMIN';
  const { message } = App.useApp();
  const [payVoucherNote, setPayVoucherNote] = useState('');
  const [adminApproveOpen, setAdminApproveOpen] = useState(false);
  const [financePublishOpen, setFinancePublishOpen] = useState(false);

  const refresh = () => {
    ['payroll-periods', 'payroll-periods-report', 'payroll-snapshots', 'payroll-reconcile', 'payroll-items', 'notifications'].forEach((k) =>
      void qc.invalidateQueries({ queryKey: [k] }),
    );
  };
  const onError = (e: unknown) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại, vui lòng thử lại');

  const submitAdminMut = useMutation({
    mutationFn: () => api.post(`/admin/payroll/periods/${period.id}/submit-to-admin`, {}),
    onSuccess: () => { message.success('Đã gửi bảng lương trình Ban Quản trị ký phê duyệt'); refresh(); },
    onError,
  });
  const transition = useMutation({
    mutationFn: (payload: { target: PayPeriodStatus; note?: string }) =>
      api.post(`/admin/payroll/periods/${period.id}/transition`, { version: period.version, target_status: payload.target, note: payload.note }),
    onSuccess: (_d, vars) => { message.success(`Đã chuyển kỳ lương sang "${PAY_PERIOD_STATUS_LABELS[vars.target]}"`); setPayVoucherNote(''); refresh(); },
    onError,
  });
  const recalc = useMutation({
    mutationFn: () => api.post(`/admin/payroll/periods/${period.id}/recalculate`),
    onSuccess: () => { message.success('Đã tính lại bảng lương theo dữ liệu mới nhất'); refresh(); },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/payroll/periods/${period.id}`, { version: period.version }),
    onSuccess: () => { message.success('Đã xóa kỳ lương'); onDeleted(); refresh(); },
    onError,
  });
  const notifyPayslips = useMutation({
    mutationFn: () => api.post<{ count: number }>(`/admin/payroll/periods/${period.id}/notify-payslips`),
    onSuccess: (d) => {
      message.success(`Đã đồng bộ và gửi phiếu lương cho ${d?.count ?? period.total_employees} nhân sự`);
      void qc.invalidateQueries({ queryKey: ['me', 'payslips'] });
      refresh();
    },
    onError,
  });

  const editable = period.status === 'DRAFT' || period.status === 'RECONCILE';
  const isPublishedOrPaid = period.status === 'PUBLISHED' || period.status === 'PAID';
  const canPublish = can('payroll.publish', 'payroll.manage');
  const canPay = can('payroll.pay', 'payroll.manage');
  const back = BACK[period.status];
  const totalIssued = period.issued_payslips_count || period.total_employees;

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #E5E7EB' }}>
      <Steps size="small" current={STEP_ORDER.indexOf(period.status)} items={STEP_ORDER.map((st) => ({ title: PAY_PERIOD_STATUS_LABELS[st] }))} />
      {period.unreconciled_records_count > 0 && editable && (
        <Alert style={{ marginTop: 12 }} type="warning" showIcon message={`Còn ${period.unreconciled_records_count} nhân sự có công nhưng chưa thiết lập hồ sơ lương hợp lệ — chưa thể trình / phê duyệt kỳ lương.`} />
      )}
      <Flex justify="space-between" align="center" wrap gap={10} style={{ marginTop: 12 }}>
        <Space size={10} wrap>
          <span>Kỳ: <strong>{period.from_date} → {period.to_date}</strong></span>
          <span>Nhân sự: <strong>{period.total_employees}</strong></span>
          <span>Thực lĩnh: <strong className="num" style={{ color: '#15803D', fontSize: 15 }}>{fmtVnd(period.total_net_vnd)}</strong></span>
          <StatusTag value={period.status} label={PAY_PERIOD_STATUS_LABELS[period.status]} />
          {period.adminSignedBy && (
            <Tag color="geekblue" icon={<SafetyCertificateOutlined />} style={{ margin: 0, borderRadius: 2 }}>
              Quản trị đã ký: {period.adminSignedBy}
            </Tag>
          )}
          {period.financeSignedBy && (
            <Tag color="blue" icon={<CheckCircleOutlined />} style={{ margin: 0, borderRadius: 2 }}>
              Kế toán đã ký: {period.financeSignedBy}
            </Tag>
          )}
          {isPublishedOrPaid && (
            <>
              <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0, borderRadius: 2 }}>
                NV đã ký: {period.confirmed_count ?? 0}/{totalIssued}
              </Tag>
              <Tag color={(period.paid_count ?? 0) >= totalIssued && totalIssued > 0 ? 'green' : 'cyan'} style={{ margin: 0, borderRadius: 2 }}>
                Đã TT: {period.paid_count ?? 0}/{totalIssued}
              </Tag>
              {(period.disputed_count ?? 0) > 0 && (
                <Tag color="volcano" style={{ margin: 0, borderRadius: 2 }}>Thắc mắc: {period.disputed_count}</Tag>
              )}
            </>
          )}
        </Space>

        <Space size={8} wrap>
          {isPublishedOrPaid && (canManage || canPublish || canPay) && (
            <Button size="small" icon={<MailOutlined />} loading={notifyPayslips.isPending} onClick={() => notifyPayslips.mutate()}>
              Gửi lại phiếu lương
            </Button>
          )}
          {canManage && editable && <Button size="small" icon={<CalculatorOutlined />} loading={recalc.isPending} onClick={() => recalc.mutate()}>Tính lại</Button>}
          {canManage && editable && (
            <Popconfirm title="Xóa kỳ lương này?" description="Toàn bộ bảng lương nháp của kỳ sẽ bị xóa." okText="Xóa" cancelText="Hủy bỏ" okButtonProps={{ danger: true, icon: <DeleteOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onConfirm={() => remove.mutateAsync()}>
              <Button size="small" danger icon={<DeleteOutlined />} loading={remove.isPending}>Xóa kỳ</Button>
            </Popconfirm>
          )}
          {(canManage || isAdmin) && back && (
            <Button size="small" icon={<RollbackOutlined />} loading={transition.isPending && transition.variables?.target === back} onClick={() => transition.mutate({ target: back })}>
              Trả về {PAY_PERIOD_STATUS_LABELS[back]}
            </Button>
          )}

          {period.status === 'DRAFT' && canManage && (
            <Popconfirm
              title="Gửi bảng lương trình Ban Quản trị ký phê duyệt?"
              description="Hệ thống sẽ tổng hợp lại số liệu công lương mới nhất và gửi thông báo tới Ban Quản trị để rà soát & ký chữ ký số."
              okText="Gửi trình Quản trị" cancelText="Hủy bỏ" okButtonProps={{ icon: <SendOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
              onConfirm={() => submitAdminMut.mutateAsync()}
            >
              <Button size="small" type="primary" icon={<SendOutlined />} loading={submitAdminMut.isPending}>
                Gửi trình Quản trị phê duyệt
              </Button>
            </Popconfirm>
          )}

          {period.status === 'RECONCILE' && (
            isAdmin ? (
              <Button size="small" type="primary" icon={<SafetyCertificateOutlined />} onClick={() => setAdminApproveOpen(true)}>
                Duyệt &amp; Ký chữ ký Quản trị
              </Button>
            ) : (
              <Tag color="processing" icon={<ClockCircleOutlined />} style={{ margin: 0, padding: '2px 8px' }}>
                Đã gửi trình — Đang chờ Ban Quản trị ký phê duyệt
              </Tag>
            )
          )}

          {period.status === 'APPROVED' && canPublish && (
            <Button size="small" type="primary" icon={<SendOutlined />} onClick={() => setFinancePublishOpen(true)}>
              Ký chữ ký Kế toán &amp; Phát hành xuống NV
            </Button>
          )}

          {period.status === 'PUBLISHED' && canPay && (
            <Popconfirm
              title="Tất toán & khóa hoàn tất toàn bộ kỳ lương?"
              description={
                <div style={{ maxWidth: 330 }}>
                  <div>Bạn có thể đánh dấu Đã thanh toán cho từng nhân sự qua nút Mã QR trên bảng, hoặc bấm xác nhận bên dưới để tất toán toàn bộ kỳ lương.</div>
                  <Input size="small" style={{ marginTop: 8 }} placeholder="Mã chứng từ / UNC tổng (VD: UNC-202610)" value={payVoucherNote} onChange={(e) => setPayVoucherNote(e.target.value)} />
                </div>
              }
              okText="Tất toán cả kỳ" cancelText="Hủy bỏ" okButtonProps={{ icon: <CheckCircleOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
              onConfirm={() => transition.mutateAsync({ target: 'PAID', note: payVoucherNote.trim() || period.note || 'Đã tất toán toàn bộ kỳ lương' })}
            >
              <Button size="small" icon={<CheckCircleOutlined />} loading={transition.isPending && transition.variables?.target === 'PAID'}>
                Tất toán cả kỳ
              </Button>
            </Popconfirm>
          )}
        </Space>
      </Flex>

      <AdminApprovePeriodModal open={adminApproveOpen} period={period} onClose={() => setAdminApproveOpen(false)} onSuccess={refresh} />
      <FinancePublishPeriodModal open={financePublishOpen} period={period} onClose={() => setFinancePublishOpen(false)} onSuccess={refresh} />
    </div>
  );
}
