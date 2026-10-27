'use client';

import { useEffect, useState } from 'react';
import { Alert, App, Descriptions, Form, Input, Modal, Select, Space, Tag } from 'antd';
import { ClockCircleOutlined, CloseOutlined, FileAddOutlined, LockOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';

const KIND_OPTIONS = [
  { value: 'FORGOT_CHECK_IN', label: 'Bù ca Vắng mặt / Quên chấm công Vào ca' },
  { value: 'FORGOT_CHECK_OUT', label: 'Quên chấm công Ra ca' },
  { value: 'GPS_ERROR', label: 'Thiết bị lỗi định vị GPS tại cửa hàng' },
  { value: 'CAMERA_ERROR', label: 'Thiết bị lỗi Camera không chụp được ảnh' },
  { value: 'OTHER', label: 'Lý do công việc / Điều động khác' },
];

const cleanShiftName = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();

/** Kiểm tra một bản ghi phân ca có đang ở trạng thái Vắng mặt cần bổ sung công hay không. */
export function isAbsentShiftRecord(r?: Record<string, unknown> | null): boolean {
  if (!r) return false;
  return (
    r.status === 'ABSENT' ||
    Boolean(r.isAbsentShift) ||
    String(r.attendanceStatusLabel || '').includes('Vắng mặt')
  );
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
  const [form] = Form.useForm<{ kind: string; reason: string }>();
  const [submitting, setSubmitting] = useState(false);

  const empId = String(shift?.employeeId || shift?.employee_id || '');
  const empName = String(shift?.employeeName || shift?.fullName || 'Nhân sự');
  const empCode = String(shift?.employeeCode || shift?.employee_code || '');
  const branchName = String(shift?.branchName || '');
  const workDate = String(shift?.workDate || shift?.work_date || dayjs().format('YYYY-MM-DD'));
  const shiftCode = String(shift?.shiftCode || shift?.shift_code || 'CA_SANG');
  const shiftLabel = cleanShiftName(shift?.shiftLabel || shiftCode);
  const startAt = String(shift?.startAt || shift?.start_at || '07:00');
  const endAt = String(shift?.endAt || shift?.end_at || '12:00');
  const hours = Number(shift?.scheduledHours || shift?.scheduled_hours || 5);

  useEffect(() => {
    if (!open || !shift) return;
    form.setFieldsValue({
      kind: 'FORGOT_CHECK_IN',
      reason: `Bổ sung công bù ca Vắng mặt (${shiftLabel} ngày ${dayjs(workDate).format('DD/MM/YYYY')}) do nhân sự quên điểm danh đúng giờ`,
    });
  }, [open, shift, shiftLabel, workDate, form]);

  const handleSubmit = async () => {
    if (!shift || !empId) return;
    try {
      const vals = await form.validateFields();
      setSubmitting(true);
      await api.post('/admin/attendance/adjustments', {
        employee_id: empId,
        assignment_id: String(shift.id),
        work_date: workDate,
        shift_code: shiftCode,
        kind: vals.kind,
        requested_check_in_at: startAt,
        requested_check_out_at: endAt,
        requested_hours: hours,
        reason: vals.reason,
      });
      message.success('Đã tạo phiếu bổ sung công cho ca vắng mặt thành công');
      ['schedules', 'attendance-adjustments', 'my-attendance', 'employees', 'employee-dossier', 'nv-schedules'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      onSuccess?.();
      onClose();
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Không thể tạo phiếu bổ sung công');
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
      okButtonProps={{ icon: <FileAddOutlined /> }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
    >
      {shift && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            icon={<LockOutlined />}
            message="Thông tin Ngày công, Khung ca và Thời lượng giờ công đã được khóa cố định theo đúng ca Vắng mặt đang chọn."
          />
          <Descriptions
            bordered
            size="small"
            column={{ xs: 1, sm: 2 }}
            styles={{
              label: { width: 175, fontWeight: 600, background: '#F8FAFC', whiteSpace: 'nowrap' },
              content: { minWidth: 210 },
            }}
          >
            <Descriptions.Item label="Nhân sự được bù công" span={2}>
              <strong>{empName}</strong> {empCode ? <Tag color="geekblue" style={{ marginLeft: 6 }}>{empCode}</Tag> : null}
              {branchName ? <span style={{ color: '#64748B', marginLeft: 6 }}>· {branchName}</span> : null}
            </Descriptions.Item>
            <Descriptions.Item label="Ngày công (Cố định)">
              <strong className="num">{dayjs(workDate).format('DD/MM/YYYY')}</strong>
            </Descriptions.Item>
            <Descriptions.Item label="Giờ công đề nghị">
              <Tag color="blue" style={{ margin: 0, fontWeight: 600 }}>{hours} giờ</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Khung ca & Giờ ca" span={2}>
              <Space size={6} wrap>
                <strong>{shiftLabel}</strong>
                <Tag color="red" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{startAt} – {endAt}</Tag>
                <Tag color="volcano" style={{ margin: 0 }}>Trạng thái: Vắng mặt — Cần bổ sung công</Tag>
              </Space>
            </Descriptions.Item>
          </Descriptions>
          <Form form={form} layout="vertical">
            <Form.Item name="kind" label="Phân loại bổ sung công" rules={[{ required: true, message: 'Vui lòng chọn phân loại' }]}>
              <Select options={KIND_OPTIONS} />
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
