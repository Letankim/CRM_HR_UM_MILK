'use client';

import { Alert, App, Button, Flex, Input, Popconfirm, Space, Steps, Tag } from 'antd';
import { CalculatorOutlined, CheckCircleOutlined, CloseOutlined, DeleteOutlined, RollbackOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PAY_PERIOD_STATUS_LABELS, type PayPeriodStatus } from '@umbm/shared';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { StatusTag } from '@/ui/StatusTag';
import { fmtVnd, type PayPeriodRow } from './payroll-types';

const STEP_ORDER: PayPeriodStatus[] = ['DRAFT', 'RECONCILE', 'APPROVED', 'PUBLISHED', 'PAID'];
const NEXT: Partial<Record<PayPeriodStatus, { next: PayPeriodStatus; label: string; confirm: string }>> = {
  DRAFT: { next: 'RECONCILE', label: 'Chuyển sang Đối soát công', confirm: 'Hệ thống sẽ tính lại bảng lương theo công và hồ sơ lương mới nhất.' },
  RECONCILE: { next: 'APPROVED', label: 'Phê duyệt & Chốt bảng lương', confirm: 'Sau khi phê duyệt, bảng lương được khóa số liệu và không tự tính lại khi dữ liệu nguồn thay đổi.' },
  APPROVED: { next: 'PUBLISHED', label: 'Phát hành Phiếu lương', confirm: 'Phiếu lương sẽ được phát cho từng nhân viên và không thể sửa đè. Mọi sai lệch phải tạo phiếu điều chỉnh.' },
  PUBLISHED: { next: 'PAID', label: 'Xác nhận Đã thanh toán', confirm: 'Xác nhận đã chi trả lương cho toàn bộ nhân sự trong kỳ và ghi nhận chứng từ thanh toán.' },
};
const BACK: Partial<Record<PayPeriodStatus, PayPeriodStatus>> = { RECONCILE: 'DRAFT', APPROVED: 'RECONCILE' };

export function PayrollPeriodBar({ period, canManage, onDeleted }: { period: PayPeriodRow; canManage: boolean; onDeleted: () => void }) {
  const qc = useQueryClient();
  const can = useCan();
  const { message } = App.useApp();
  const [payVoucherNote, setPayVoucherNote] = useState('');
  const refresh = () => {
    ['payroll-periods', 'payroll-periods-report', 'payroll-snapshots', 'payroll-reconcile', 'payroll-items'].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] }),
    );
  };
  const onError = (e: unknown) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại, vui lòng thử lại');

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

  const editable = period.status === 'DRAFT' || period.status === 'RECONCILE';
  const next = NEXT[period.status];
  const back = BACK[period.status];
  const canDoNext = next?.next === 'PUBLISHED'
    ? can('payroll.publish', 'payroll.manage')
    : next?.next === 'PAID'
      ? can('payroll.pay', 'payroll.manage')
      : canManage;

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #E5E7EB' }}>
      <Steps size="small" current={STEP_ORDER.indexOf(period.status)} items={STEP_ORDER.map((st) => ({ title: PAY_PERIOD_STATUS_LABELS[st] }))} />
      {period.unreconciled_records_count > 0 && editable && (
        <Alert style={{ marginTop: 12 }} type="warning" showIcon message={`Còn ${period.unreconciled_records_count} nhân sự có công nhưng chưa thiết lập hồ sơ lương hợp lệ — chưa thể phê duyệt kỳ lương.`} />
      )}
      <Flex justify="space-between" align="center" wrap gap={10} style={{ marginTop: 12 }}>
        <Space size={14} wrap>
          <span>Kỳ: <strong>{period.from_date} → {period.to_date}</strong></span>
          <span>Nhân sự: <strong>{period.total_employees}</strong></span>
          <span>Tổng thu nhập: <strong className="num">{fmtVnd(period.total_gross_vnd)}</strong></span>
          <span>Tổng thực lĩnh: <strong className="num" style={{ color: '#15803D', fontSize: 15 }}>{fmtVnd(period.total_net_vnd)}</strong></span>
          <StatusTag value={period.status} label={PAY_PERIOD_STATUS_LABELS[period.status]} />
          {period.paid_at && (
            <Tag color="green">Đã thanh toán: {String(period.paid_at).slice(0, 16).replace('T', ' ')}{period.paid_by ? ` (${period.paid_by})` : ''}{period.note ? ` · CT: ${period.note}` : ''}</Tag>
          )}
        </Space>
        {(canManage || canDoNext) && (
          <Space size={8} wrap>
            {canManage && editable && <Button size="small" icon={<CalculatorOutlined />} loading={recalc.isPending} onClick={() => recalc.mutate()}>Tính lại</Button>}
            {canManage && editable && (
              <Popconfirm title="Xóa kỳ lương này?" description="Toàn bộ bảng lương nháp của kỳ sẽ bị xóa." okText="Xóa" cancelText="Hủy bỏ" okButtonProps={{ danger: true, icon: <DeleteOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onConfirm={() => remove.mutateAsync()}>
                <Button size="small" danger icon={<DeleteOutlined />} loading={remove.isPending}>Xóa kỳ</Button>
              </Popconfirm>
            )}
            {canManage && back && <Button size="small" icon={<RollbackOutlined />} loading={transition.isPending && transition.variables?.target === back} onClick={() => transition.mutate({ target: back })}>Trả về {PAY_PERIOD_STATUS_LABELS[back]}</Button>}
            {canDoNext && next && (
              <Popconfirm
                title={next.label}
                description={
                  <div style={{ maxWidth: 320 }}>
                    <div>{next.confirm}</div>
                    {next.next === 'PAID' && (
                      <Input
                        size="small" style={{ marginTop: 8 }}
                        placeholder="Mã chứng từ / Ủy nhiệm chi (VD: UNC-202610-01)"
                        value={payVoucherNote}
                        onChange={(e) => setPayVoucherNote(e.target.value)}
                      />
                    )}
                  </div>
                }
                okText="Xác nhận" cancelText="Hủy bỏ" okButtonProps={{ icon: <CheckCircleOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
                onConfirm={() => transition.mutateAsync({ target: next.next, note: next.next === 'PAID' ? (payVoucherNote.trim() || period.note || 'Đã đối chiếu UNC ngân hàng') : undefined })}
              >
                <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={transition.isPending && transition.variables?.target === next.next}>{next.label}</Button>
              </Popconfirm>
            )}
          </Space>
        )}
      </Flex>
    </div>
  );
}
