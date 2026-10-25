'use client';

import { Alert, App, Button, Flex, Popconfirm, Space, Steps } from 'antd';
import { CalculatorOutlined, CheckCircleOutlined, CloseOutlined, DeleteOutlined, RollbackOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PAY_PERIOD_STATUS_LABELS, type PayPeriodStatus } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { StatusTag } from '@/ui/StatusTag';
import { fmtVnd, type PayPeriodRow } from './payroll-types';

const STEP_ORDER: PayPeriodStatus[] = ['DRAFT', 'RECONCILE', 'APPROVED', 'PUBLISHED', 'PAID'];
const NEXT: Partial<Record<PayPeriodStatus, { next: PayPeriodStatus; label: string; confirm: string }>> = {
  DRAFT: { next: 'RECONCILE', label: 'Chuyển sang Đối soát công', confirm: 'Hệ thống sẽ tính lại bảng lương theo công và hồ sơ lương mới nhất.' },
  RECONCILE: { next: 'APPROVED', label: 'Phê duyệt & Chốt bảng lương', confirm: 'Sau khi phê duyệt, bảng lương được khóa số liệu và không tự tính lại khi dữ liệu nguồn thay đổi.' },
  APPROVED: { next: 'PUBLISHED', label: 'Phát hành Phiếu lương', confirm: 'Phiếu lương sẽ được phát cho từng nhân viên và không thể sửa đè. Mọi sai lệch phải tạo phiếu điều chỉnh.' },
  PUBLISHED: { next: 'PAID', label: 'Xác nhận Đã thanh toán', confirm: 'Xác nhận đã chi trả lương cho toàn bộ nhân sự trong kỳ.' },
};
const BACK: Partial<Record<PayPeriodStatus, PayPeriodStatus>> = { RECONCILE: 'DRAFT', APPROVED: 'RECONCILE' };

export function PayrollPeriodBar({ period, canManage, onDeleted }: { period: PayPeriodRow; canManage: boolean; onDeleted: () => void }) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['payroll-periods'] });
    qc.invalidateQueries({ queryKey: ['payroll-snapshots'] });
    qc.invalidateQueries({ queryKey: ['payroll-items'] });
  };
  const onError = (e: unknown) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại, vui lòng thử lại');

  const transition = useMutation({
    mutationFn: (target: PayPeriodStatus) => api.post(`/admin/payroll/periods/${period.id}/transition`, { version: period.version, target_status: target }),
    onSuccess: (_d, target) => { message.success(`Đã chuyển kỳ lương sang "${PAY_PERIOD_STATUS_LABELS[target]}"`); refresh(); },
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

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #E5E7EB' }}>
      <Steps size="small" current={STEP_ORDER.indexOf(period.status)} items={STEP_ORDER.map((st) => ({ title: PAY_PERIOD_STATUS_LABELS[st] }))} />
      {period.unreconciled_records_count > 0 && editable && (
        <Alert style={{ marginTop: 12 }} type="warning" showIcon message={`Còn ${period.unreconciled_records_count} nhân sự có công nhưng chưa thiết lập hồ sơ lương hợp lệ — chưa thể phê duyệt kỳ lương.`} />
      )}
      <Flex justify="space-between" align="center" wrap gap={10} style={{ marginTop: 12 }}>
        <Space size={16} wrap>
          <span>Kỳ: <strong>{period.from_date} → {period.to_date}</strong></span>
          <span>Nhân sự: <strong>{period.total_employees}</strong></span>
          <span>Tổng thu nhập: <strong className="num">{fmtVnd(period.total_gross_vnd)}</strong></span>
          <span>Tổng thực lĩnh: <strong className="num" style={{ color: '#15803D', fontSize: 15 }}>{fmtVnd(period.total_net_vnd)}</strong></span>
          <StatusTag value={period.status} label={PAY_PERIOD_STATUS_LABELS[period.status]} />
        </Space>
        {canManage && (
          <Space size={8} wrap>
            {editable && <Button size="small" icon={<CalculatorOutlined />} loading={recalc.isPending} onClick={() => recalc.mutate()}>Tính lại</Button>}
            {editable && (
              <Popconfirm title="Xóa kỳ lương này?" description="Toàn bộ bảng lương nháp của kỳ sẽ bị xóa." okText="Xóa" cancelText="Hủy bỏ" okButtonProps={{ danger: true, icon: <DeleteOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onConfirm={() => remove.mutateAsync()}>
                <Button size="small" danger icon={<DeleteOutlined />} loading={remove.isPending}>Xóa kỳ</Button>
              </Popconfirm>
            )}
            {back && <Button size="small" icon={<RollbackOutlined />} loading={transition.isPending && transition.variables === back} onClick={() => transition.mutate(back)}>Trả về {PAY_PERIOD_STATUS_LABELS[back]}</Button>}
            {next && (
              <Popconfirm title={next.label} description={next.confirm} okText="Xác nhận" cancelText="Hủy bỏ" okButtonProps={{ icon: <CheckCircleOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onConfirm={() => transition.mutateAsync(next.next)}>
                <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={transition.isPending && transition.variables === next.next}>{next.label}</Button>
              </Popconfirm>
            )}
          </Space>
        )}
      </Flex>
    </div>
  );
}
