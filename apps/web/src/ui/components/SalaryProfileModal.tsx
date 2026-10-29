'use client';

import { App, Col, Form, Input, Modal, Row, Select } from 'antd';
import { CloseOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { api, ApiClientError } from '@/lib/api';
import type { SalaryProfile } from './payroll-types';
import { SALARY_FIELD_DEFAULTS, SalaryProfileFields } from './SalaryProfileFields';

export type SalaryModalMode = 'CREATE' | 'ADJUST' | 'EDIT';

interface Props {
  open: boolean;
  mode: SalaryModalMode;
  employee?: { id: string; label: string } | null;
  base?: SalaryProfile | null;
  employees: { value: string; label: string }[];
  onClose: () => void;
}

const TITLES: Record<SalaryModalMode, string> = {
  CREATE: 'Thiết lập lương cá nhân cho nhân sự',
  ADJUST: 'Điều chỉnh lương (tạo mức lương mới có ngày hiệu lực)',
  EDIT: 'Chỉnh sửa mức lương (chưa dùng chốt kỳ lương)',
};

export function SalaryProfileModal({ open, mode, employee, base, employees, onClose }: Props) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    const from =
      mode === 'EDIT' && base
        ? base.effectiveFrom.slice(0, 10)
        : mode === 'ADJUST'
          ? dayjs().add(1, 'month').startOf('month').format('YYYY-MM-DD')
          : dayjs().startOf('month').format('YYYY-MM-DD');
    const src = base
      ? {
          rate_type: base.rateType, amount_vnd: base.amountVnd, probation_percent: base.probationPercent, standard_work_days: base.standardWorkDays,
          standard_hours_per_day: base.standardHoursPerDay, ot_multiplier: base.otMultiplier, attendance_bonus_vnd: base.attendanceBonusVnd,
          meal_allowance_per_shift_vnd: base.mealAllowancePerShiftVnd, transport_allowance_vnd: base.transportAllowanceVnd,
          responsibility_allowance_vnd: base.responsibilityAllowanceVnd, other_allowance_vnd: base.otherAllowanceVnd,
        }
      : SALARY_FIELD_DEFAULTS;
    form.setFieldsValue({
      ...src,
      employee_id: employee?.id,
      effective_from: from,
      change_reason: mode === 'EDIT' ? base?.changeReason : mode === 'ADJUST' ? 'Điều chỉnh tăng lương định kỳ' : 'Thiết lập lương ban đầu',
      note: mode === 'EDIT' ? base?.note : '',
    });
  }, [open, mode, base, employee, form]);

  const mut = useMutation({
    mutationFn: (v: Record<string, unknown>) => {
      const payload = { ...v, effective_from: String(v.effective_from || '').slice(0, 10) };
      return mode === 'EDIT' && base
        ? api.put(`/admin/payroll/salary-profiles/${base.id}`, { ...payload, version: base.version })
        : api.post('/admin/payroll/salary-profiles', payload);
    },
    onSuccess: () => {
      message.success(mode === 'EDIT' ? 'Đã cập nhật mức lương và đồng bộ bảng lương' : 'Đã lưu mức lương mới và đồng bộ bảng lương cho nhân sự');
      ['salary-profiles', 'salary-history', 'employees', 'payroll-periods', 'payroll-periods-report', 'payroll-snapshots', 'payroll-reconcile', 'payroll-items'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        if (err.details.length > 0) form.setFields(err.details.map((d) => ({ name: d.field.split('.'), errors: [d.message] })));
        message.error(err.message);
      } else {
        message.error('Không thể lưu mức lương, vui lòng thử lại');
      }
    },
  });

  return (
    <Modal
      title={employee ? `${TITLES[mode]} — ${employee.label}` : TITLES[mode]}
      open={open}
      width="70vw"
      onOk={async () => mut.mutate(await form.validateFields())}
      onCancel={onClose}
      okText="Lưu mức lương"
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: <SaveOutlined /> }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      confirmLoading={mut.isPending}
      forceRender
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        {!employee && (
          <Form.Item name="employee_id" label="Nhân sự" rules={[{ required: true, message: 'Vui lòng chọn nhân sự' }]}>
            <Select showSearch optionFilterProp="label" options={employees} placeholder="Tìm theo mã hoặc họ tên nhân sự" />
          </Form.Item>
        )}
        {employee && <Form.Item name="employee_id" hidden><Input /></Form.Item>}
        <SalaryProfileFields form={form} />
        <Row gutter={12}>
          <Col span={12}><Form.Item name="change_reason" label="Lý do điều chỉnh"><Input maxLength={200} /></Form.Item></Col>
          <Col span={12}><Form.Item name="note" label="Ghi chú"><Input maxLength={300} placeholder="Ví dụ: Theo quyết định tăng lương số 12/2026" /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}
