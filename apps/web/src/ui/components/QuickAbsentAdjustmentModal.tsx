'use client';

import { useEffect, useState } from 'react';
import { Alert, App, Descriptions, Form, Input, Modal, Select, Space, Tag } from 'antd';
import { ClockCircleOutlined, CloseOutlined, FileAddOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { ADJUSTMENT_CAUSE_OPTIONS, AdjustmentEvidenceFields, inferAdjustmentPunchType, kindFromPunchType, type AdjustmentPunchType } from './AdjustmentEvidenceFields';
import { applyOptimisticAdjustmentToMyAttendance } from './self-attendance-shared';

const cleanShiftName = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();

/** Kiểm tra một bản ghi phân ca có đang ở trạng thái Vắng mặt hoặc Quên Ra ca cần bổ sung công (chưa gửi phiếu chờ duyệt) hay không. */
export function isAbsentShiftRecord(r?: Record<string, unknown> | null): boolean {
  if (!r || r.status === 'COMPLETED' || r.status === 'DRAFT' || r.dayType === 'OFF' || r.status === 'ON_LEAVE') return false;
  if (r.pendingAdjustmentCode || String(r.attendanceStatusLabel || '').includes('Đã gửi')) return false;
  const lbl = String(r.attendanceStatusLabel || '');
  return (
    r.status === 'ABSENT' ||
    Boolean(r.isAbsentShift) ||
    Boolean(r.isForgotCheckout) ||
    lbl.includes('Vắng mặt') ||
    lbl.includes('Quên Ra ca')
  );
}

/** Kiểm tra một ca làm việc đã gửi Phiếu bổ sung công đang chờ duyệt hay chưa. */
export function hasPendingAdjustmentRecord(r?: Record<string, unknown> | null): boolean {
  if (!r) return false;
  return Boolean(r.pendingAdjustmentCode) || String(r.attendanceStatusLabel || '').includes('Đã gửi');
}

export interface QuickAbsentAdjustmentModalProps {
  shift: Record<string, unknown> | null;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

/** Modal tạo nhanh Phiếu bổ sung công trực tiếp từ chi tiết Ca làm việc đang ở trạng thái Vắng mặt. */
export function QuickAbsentAdjustmentModal({
  shift, open, onClose, onSuccess,
}: QuickAbsentAdjustmentModalProps) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<{ kind: string; reason: string; punch_type: AdjustmentPunchType; evidence_photo_base64?: string }>();
  const [submitting, setSubmitting] = useState(false);
  const me = useMe().data?.user;

  const empId = String(shift?.employeeId || shift?.employee_id || '');
  const empName = String(shift?.employeeName || shift?.fullName || 'Nhân sự');
  const empCode = String(shift?.employeeCode || shift?.employee_code || '');
  const isSelfSubmit = Boolean(me && (['THU_VIEC', 'CHINH_THUC'].includes(me.role) || (me.employeeId && (me.employeeId === empId || me.employeeId === empCode))));
  const branchName = String(shift?.branchName || '');
  const workDate = String(shift?.workDate || shift?.work_date || dayjs().format('YYYY-MM-DD'));
  const shiftCode = String(shift?.shiftCode || shift?.shift_code || 'CA_SANG');
  const shiftLabel = cleanShiftName(shift?.shiftLabel || shiftCode);
  const startAt = String(shift?.startAt || shift?.start_at || '07:00');
  const endAt = String(shift?.endAt || shift?.end_at || '12:00');
  const hours = Number(shift?.scheduledHours || shift?.scheduled_hours || 5);
  const pendingAdjCode = shift?.pendingAdjustmentCode ? String(shift.pendingAdjustmentCode) : '';

  useEffect(() => {
    if (!open || !shift) return;
    const punchType = inferAdjustmentPunchType(shift);
    const isForgotOut = punchType === 'CHECK_OUT';
    form.setFieldsValue({
      punch_type: punchType,
      evidence_photo_base64: undefined,
      kind: kindFromPunchType(punchType),
      reason: isForgotOut
        ? `Bổ sung công Ra ca (${shiftLabel} ngày ${dayjs(workDate).format('DD/MM/YYYY')}) do nhân sự đã Vào ca nhưng quên điểm danh Ra ca`
        : `Bổ sung công bù ca Vắng mặt (${shiftLabel} ngày ${dayjs(workDate).format('DD/MM/YYYY')}) do nhân sự quên điểm danh đúng giờ`,
    });
  }, [open, shift, shiftLabel, workDate, form]);

  const handleSubmit = async () => {
    if (!shift || !empId) return;
    try {
      const vals = await form.validateFields();
      setSubmitting(true);
      const created = await api.post<Record<string, unknown>>('/admin/attendance/adjustments', {
        employee_id: empId,
        assignment_id: String(shift.id),
        work_date: workDate,
        shift_code: shiftCode,
        kind: vals.kind,
        punch_type: vals.punch_type,
        ...(vals.evidence_photo_base64 ? { evidence_photo_base64: vals.evidence_photo_base64 } : {}),
        requested_check_in_at: startAt,
        requested_check_out_at: endAt,
        requested_hours: hours,
        reason: vals.reason,
      });
      applyOptimisticAdjustmentToMyAttendance(qc, created);
      message.success('Đã tạo phiếu bổ sung công cho ca vắng mặt thành công');
      ['schedules', 'attendance-adjustments', 'my-attendance', 'employees', 'employee-dossier', 'nv-schedules'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      onSuccess?.();
      onClose();
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.details.length > 0) form.setFields(e.details.map((d) => ({ name: d.field as 'evidence_photo_base64', errors: [d.message] })));
        message.error(e.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      width="min(840px, 94vw)"
      open={open && Boolean(shift)}
      destroyOnHidden
      title="Tạo Phiếu Bổ Sung Công Bù Ca Vắng Mặt"
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okText="Xác nhận tạo phiếu bổ sung công"
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: <FileAddOutlined />, disabled: Boolean(pendingAdjCode) }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
    >
      {shift && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {pendingAdjCode && (
            <Alert type="warning" showIcon message={`Ca làm việc này đã gửi Phiếu bổ sung công (${pendingAdjCode}) và đang chờ duyệt. Không được phép gửi trùng yêu cầu.`} />
          )}
          <Descriptions
            bordered
            size="small"
            column={1}
            styles={{
              label: { width: 185, fontWeight: 600, background: '#F8FAFC', whiteSpace: 'nowrap' },
              content: { background: '#FFFFFF' },
            }}
          >
            <Descriptions.Item label="Nhân sự được bù công">
              <strong>{empName}</strong> {empCode ? <Tag color="geekblue" style={{ marginLeft: 6 }}>{empCode}</Tag> : null}
              {branchName ? <span style={{ color: '#64748B', marginLeft: 6 }}>· {branchName}</span> : null}
            </Descriptions.Item>
            <Descriptions.Item label="Ngày công (Cố định)">
              <strong className="num">{dayjs(workDate).format('DD/MM/YYYY')}</strong>
            </Descriptions.Item>
            <Descriptions.Item label="Nội dung đề nghị">
              <Tag color="blue" style={{ margin: 0, fontWeight: 600 }}>
                {inferAdjustmentPunchType(shift) === 'CHECK_OUT' ? `Xác nhận Ra ca lúc ${endAt}` : `${hours} giờ (${startAt} – ${endAt})`}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Khung ca & Giờ ca">
              <Space size={6} wrap>
                <strong>{shiftLabel}</strong>
                <Tag color="red" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{startAt} – {endAt}</Tag>
                <Tag color="volcano" style={{ margin: 0 }}>
                  {inferAdjustmentPunchType(shift) === 'CHECK_OUT' ? 'Trạng thái: Quên Ra ca — Cần xác nhận giờ Ra ca' : 'Trạng thái: Vắng mặt — Cần bổ sung công'}
                </Tag>
              </Space>
            </Descriptions.Item>
          </Descriptions>
          <Form form={form} layout="vertical">
            <AdjustmentEvidenceFields evidenceRequired={isSelfSubmit} />
            <Form.Item name="kind" label="Nguyên nhân sự cố" rules={[{ required: true, message: 'Vui lòng chọn nguyên nhân' }]}>
              <Select options={ADJUSTMENT_CAUSE_OPTIONS} />
            </Form.Item>
            <Form.Item name="reason" label="Lý do giải trình bổ sung công" rules={[{ required: true, message: 'Vui lòng nhập lý do giải trình' }]}>
              <Input.TextArea rows={3} placeholder="Nhập rõ lý do bổ sung công cho ca vắng mặt này..." />
            </Form.Item>
          </Form>
        </Space>
      )}
    </Modal>
  );
}
