'use client';

import { App, Col, Form, Input, InputNumber, Modal, Row, Select } from 'antd';
import { CloseOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { PAYROLL_ITEM_TYPE_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { DateStringPicker } from './DateTimePickers';
import { MONEY_INPUT_PROPS } from './payroll-types';

export function CreatePeriodModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: (v: Record<string, unknown>) => api.post('/admin/payroll/periods', v),
    onSuccess: () => {
      message.success('Đã tạo kỳ lương mới và tự động tính bảng lương cho toàn bộ nhân sự');
      qc.invalidateQueries({ queryKey: ['payroll-periods'] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.details.length > 0) form.setFields(e.details.map((d) => ({ name: d.field, errors: [d.message] })));
      message.error(e instanceof ApiClientError ? e.message : 'Tạo kỳ lương thất bại');
    },
  });

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        name: `Kỳ lương Tháng ${dayjs().format('MM/YYYY')}`,
        from_date: dayjs().startOf('month').format('YYYY-MM-DD'),
        to_date: dayjs().endOf('month').format('YYYY-MM-DD'),
      });
    }
  }, [open, form]);

  return (
    <Modal
      width={640}
      title="Khởi tạo Kỳ Lương Mới"
      open={open}
      onOk={async () => mut.mutate(await form.validateFields())}
      onCancel={onClose}
      okText="Khởi tạo kỳ lương"
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: <PlusOutlined /> }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      confirmLoading={mut.isPending}
      forceRender
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item name="name" label="Tên kỳ lương" rules={[{ required: true }]}>
          <Input placeholder="Ví dụ: Kỳ lương Tháng 10/2026" />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="from_date" label="Từ ngày" rules={[{ required: true }]}><DateStringPicker /></Form.Item></Col>
          <Col span={12}><Form.Item name="to_date" label="Đến ngày" rules={[{ required: true }]}><DateStringPicker /></Form.Item></Col>
        </Row>
        <Form.Item name="note" label="Ghi chú"><Input placeholder="Ví dụ: Chốt công từ ngày 01 đến cuối tháng" /></Form.Item>
      </Form>
    </Modal>
  );
}

export function PayrollItemModal({
  open,
  periodId,
  employees,
  editing,
  onClose,
}: {
  open: boolean;
  periodId: string;
  employees: { value: string; label: string }[];
  editing?: { id: string; version: number; employeeId: string; itemType: string; title: string; quantity: number; unitAmountVnd: number; note: string } | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({
        employee_id: editing.employeeId,
        item_type: editing.itemType,
        title: editing.title,
        quantity: editing.quantity,
        unit_amount_vnd: editing.unitAmountVnd,
        note: editing.note,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        employee_id: employees[0]?.value,
        item_type: 'BONUS_KPI',
        title: 'Thưởng hoàn thành chỉ tiêu doanh số / KPI tháng',
        quantity: 1,
        unit_amount_vnd: 500000,
      });
    }
  }, [open, editing, employees, form]);

  const mut = useMutation({
    mutationFn: (v: Record<string, unknown>) =>
      editing
        ? api.put(`/admin/payroll/items/${editing.id}`, { ...v, period_id: periodId, version: editing.version })
        : api.post('/admin/payroll/items', { ...v, period_id: periodId }),
    onSuccess: () => {
      message.success(editing ? 'Đã cập nhật khoản thưởng / điều chỉnh' : 'Đã thêm khoản thưởng / điều chỉnh và tính lại bảng lương');
      qc.invalidateQueries({ queryKey: ['payroll-items'] });
      qc.invalidateQueries({ queryKey: ['payroll-snapshots'] });
      qc.invalidateQueries({ queryKey: ['payroll-periods'] });
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể lưu khoản thưởng / điều chỉnh'),
  });

  return (
    <Modal
      width={660}
      title={editing ? 'Chỉnh sửa Khoản Thưởng / Phụ cấp / Khấu trừ' : 'Thêm Khoản Thưởng / Phụ cấp / Điều chỉnh Lương'}
      open={open}
      onOk={async () => mut.mutate(await form.validateFields())}
      onCancel={onClose}
      okText={editing ? 'Lưu cập nhật' : 'Thêm khoản mục'}
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: editing ? <SaveOutlined /> : <PlusOutlined /> }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      confirmLoading={mut.isPending}
      forceRender
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item name="employee_id" label="Nhân sự" rules={[{ required: true }]}>
          <Select showSearch optionFilterProp="label" options={employees} />
        </Form.Item>
        <Form.Item name="item_type" label="Loại khoản mục" rules={[{ required: true }]}>
          <Select options={PAYROLL_ITEM_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item name="title" label="Nội dung trên phiếu lương" rules={[{ required: true }]}>
          <Input placeholder="Ví dụ: Thưởng chuyên cần đạt 100% ca tháng 10" />
        </Form.Item>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="quantity" label="Số lượng" rules={[{ required: true }]}><InputNumber min={0.5} step={1} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={16}><Form.Item name="unit_amount_vnd" label="Đơn giá / Số tiền" rules={[{ required: true }]}><InputNumber min={0} step={50000} style={{ width: '100%' }} suffix="đ" {...MONEY_INPUT_PROPS} /></Form.Item></Col>
        </Row>
        <Form.Item name="note" label="Ghi chú"><Input /></Form.Item>
      </Form>
    </Modal>
  );
}
