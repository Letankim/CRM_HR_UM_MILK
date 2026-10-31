'use client';

import { useEffect, useState } from 'react';
import { Alert, Form, Input, Modal, Space, Table, Tag } from 'antd';
import { CloseCircleOutlined, CloseOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { StatusTag } from '../StatusTag';
import { cleanShiftLabel, fmtYmd, issueSeverity, type PlannerIssue, type PlannerOffItem, type PlannerShift } from './schedule-planner-types';

/** Danh sách vướng mắc khi tự động sắp ca (không xếp được / cảnh báo định biên). */
export function PlannerIssuesAlert({ issues, maxHeight = 220 }: { issues: PlannerIssue[]; maxHeight?: number }) {
  if (issues.length === 0) return null;
  const errorCount = issues.filter((i) => issueSeverity(i) === 'error').length;
  return (
    <Alert
      type={errorCount > 0 ? 'error' : 'warning'} showIcon icon={<ExclamationCircleOutlined />}
      message={`Không thể xếp được / Cảnh báo định biên (${issues.length} trường hợp)`}
      description={
        <div style={{ maxHeight, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          {issues.map((i, idx) => (
            <Space key={`${i.kind}-${i.employeeId}-${i.workDate}-${i.shiftCode}-${idx}`} size={6} align="start">
              <Tag color={issueSeverity(i) === 'error' ? 'red' : 'gold'} style={{ margin: 0 }}>{issueSeverity(i) === 'error' ? 'Không xếp được' : 'Cảnh báo'}</Tag>
              <span style={{ fontSize: 13 }}>{i.message}</span>
            </Space>
          ))}
        </div>
      }
    />
  );
}

/** Bảng đơn OFF trong kỳ chốt lịch (dùng chung cho tuần chính thức và chu kỳ thử việc). */
export function PlannerOffTable({ rows, renderActions, loading }: { rows: PlannerOffItem[]; renderActions?: (r: PlannerOffItem) => React.ReactNode; loading?: boolean }) {
  return (
    <Table<PlannerOffItem>
      size="small" rowKey="id" loading={loading} dataSource={rows} pagination={rows.length > 10 ? { pageSize: 10, showTotal: (t) => `Tổng ${t} đơn` } : false}
      locale={{ emptyText: 'Không có đơn nghỉ OFF nào trong kỳ này' }}
      columns={[
        { title: 'Mã đơn', dataIndex: 'requestCode', width: 110, render: (v: string) => <Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag> },
        { title: 'Nhân sự', width: 220, ellipsis: true, render: (_, r) => <span><strong>{r.employeeName}</strong> <span style={{ color: '#64748B' }}>({r.employeeCode})</span></span> },
        { title: 'Ngày nghỉ', dataIndex: 'leaveDate', width: 115, render: (v: string) => <strong className="num">{fmtYmd(v)}</strong> },
        { title: 'Trạng thái', dataIndex: 'status', width: 170, render: (v: string, r) => <StatusTag value={v} label={r.statusLabel || undefined} /> },
        { title: 'Lý do', dataIndex: 'reason', ellipsis: true },
        ...(renderActions ? [{ title: 'Thao tác', width: 180, align: 'right' as const, render: (_: unknown, r: PlannerOffItem) => renderActions(r) }] : []),
      ]}
    />
  );
}

/** Bảng ca dự kiến sẽ tự động sắp theo ca mặc định. */
export function PlannerShiftTable({ rows, showEmployee = true }: { rows: PlannerShift[]; showEmployee?: boolean }) {
  return (
    <Table<PlannerShift>
      size="small" rowKey={(r) => `${r.employeeId}-${r.workDate}-${r.shiftCode}`} dataSource={rows}
      pagination={rows.length > 10 ? { pageSize: 10, showTotal: (t) => `Tổng ${t} ca dự kiến` } : false}
      locale={{ emptyText: 'Không còn ca nào cần tự động sắp' }}
      columns={[
        { title: 'Ngày làm việc', dataIndex: 'workDate', width: 125, render: (v: string) => <strong className="num">{fmtYmd(v)}</strong> },
        ...(showEmployee ? [{ title: 'Nhân sự', width: 230, ellipsis: true, render: (_: unknown, r: PlannerShift) => <span><strong>{r.employeeName}</strong> <span style={{ color: '#64748B' }}>({r.employeeCode})</span></span> }] : []),
        { title: 'Khung ca', render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftLabel(r.shiftLabel)}</span><Tag color="blue" style={{ margin: 0 }}>{r.startAt} – {r.endAt} ({r.hours} giờ)</Tag></Space> },
      ]}
    />
  );
}

/** Hộp thoại nhập lý do từ chối đơn nghỉ OFF (bắt buộc nhập lý do). */
export function OffRejectModal({ target, loading, onClose, onConfirm }: { target: PlannerOffItem | null; loading?: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [form] = Form.useForm<{ reason: string }>();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(Boolean(target)); if (target) form.setFieldsValue({ reason: '' }); }, [target, form]);
  return (
    <Modal
      open={open} width="min(520px, 94vw)" title="Từ chối đơn nghỉ OFF" okText="Xác nhận từ chối" cancelText="Hủy bỏ" confirmLoading={loading}
      okButtonProps={{ danger: true, icon: <CloseCircleOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose} onOk={() => form.submit()} destroyOnHidden
    >
      {target && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`${target.employeeName} (${target.employeeCode}) xin nghỉ OFF ngày ${fmtYmd(target.leaveDate)}`} />}
      <Form form={form} layout="vertical" onFinish={(v) => onConfirm(v.reason.trim())}>
        <Form.Item name="reason" label="Lý do từ chối" rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập lý do từ chối đơn nghỉ OFF' }]}>
          <Input.TextArea rows={3} maxLength={300} placeholder="Ví dụ: Ngày này cửa hàng thiếu định biên, vui lòng chọn ngày khác" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
