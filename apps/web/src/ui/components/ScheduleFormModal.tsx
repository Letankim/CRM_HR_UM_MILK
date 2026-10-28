'use client';

import { Alert, App, Button, Col, Flex, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space } from 'antd';
import { CheckOutlined, CloseOutlined, DeleteOutlined, FileAddOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { SHIFT_ASSIGNMENT_STATUS_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import { DateStringPicker } from './DateTimePickers';
import { GuardButton, usePermissionGuard } from './GuardButton';
import { hasPendingAdjustmentRecord, isAbsentShiftRecord, QuickAbsentAdjustmentModal } from './QuickAbsentAdjustmentModal';

export interface ScheduleAssignmentItem {
  id: string; employeeId: string; employeeCode: string; employeeName: string;
  employeeStage: string; employeeStageLabel: string; branchId: string; branchName: string;
  workDate: string; shiftCode: string; shiftLabel: string; startAt: string; endAt: string;
  scheduledHours: number; dayType: 'WORK' | 'OFF' | 'OT'; status: string; statusLabel: string;
  publishedAt: string | null; note: string; version: number; created_at: string;
  attendanceStatusLabel?: string; attendanceStatusColor?: string;
  pendingAdjustmentCode?: string | null; pendingSwapCode?: string | null; pendingLeaveCode?: string | null; pendingEmergencyCode?: string | null;
  isLockedByPayroll?: boolean; lockedByPeriodCode?: string | null;
}

interface ScheduleFormValues {
  employee_id: string; work_date: string; shift_code: string; status: string;
  day_type: 'WORK' | 'OFF' | 'OT'; scheduled_hours: number; note?: string;
}

export interface ScheduleFormModalProps {
  open: boolean; editing?: ScheduleAssignmentItem | null; presetDate?: string; presetShiftCode?: string;
  employees: { value: string; label: string; branchId?: string }[]; canEdit?: boolean; onClose: () => void;
}

export function ScheduleFormModal({
  open, editing, presetDate, presetShiftCode, employees, canEdit = true, onClose,
}: ScheduleFormModalProps) {
  const [form] = Form.useForm<ScheduleFormValues>();
  const [quickAdjOpen, setQuickAdjOpen] = useState(false);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const hasSchedulePerm = usePermissionGuard({ perms: ['schedule.propose', 'schedule.publish'], allowed: canEdit });
  const canCreateAdj = usePermissionGuard({ perms: ['attendance.confirm', 'adjustment.approve'], allowed: canEdit });
  const isLocked = Boolean(editing?.isLockedByPayroll);
  const canModifyShift = hasSchedulePerm && !isLocked;
  const watchedEmpId = Form.useWatch('employee_id', form);
  const watchedStatus = Form.useWatch('status', form);
  const hasPendingAdj = Boolean(editing && hasPendingAdjustmentRecord(editing as unknown as Record<string, unknown>));
  const isEditingAbsent = canCreateAdj && !isLocked && !hasPendingAdj && Boolean(editing && (watchedStatus === 'ABSENT' || isAbsentShiftRecord(editing as unknown as Record<string, unknown>)));
  const selectedEmpBranchId = useMemo(
    () => employees.find((e) => e.value === watchedEmpId)?.branchId || editing?.branchId || 'ALL',
    [employees, watchedEmpId, editing?.branchId],
  );
  const { options: shiftOptions, hoursMap } = useShiftTemplates(selectedEmpBranchId);

  const employeeSelectOptions = useMemo(() => {
    if (!editing?.employeeId || employees.some((e) => e.value === editing.employeeId)) return employees;
    return [{ value: editing.employeeId, label: `${editing.employeeCode} — ${editing.employeeName} (${editing.branchName})`, branchId: editing.branchId }, ...employees];
  }, [employees, editing]);

  useEffect(() => {
    if (!open || shiftOptions.length === 0) return;
    const curShift = form.getFieldValue('shift_code');
    if (!curShift || !shiftOptions.some((o) => o.value === curShift)) {
      const nextShift = shiftOptions[0]!.value;
      form.setFieldsValue({ shift_code: nextShift, scheduled_hours: hoursMap[nextShift] ?? 5 });
    }
  }, [open, selectedEmpBranchId, shiftOptions, hoursMap, form]);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({
        employee_id: editing.employeeId, work_date: editing.workDate, shift_code: editing.shiftCode,
        status: editing.status, day_type: editing.dayType, scheduled_hours: editing.scheduledHours, note: editing.note,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        employee_id: employees[0]?.value, work_date: presetDate || dayjs().format('YYYY-MM-DD'),
        shift_code: presetShiftCode || 'CA_SANG', status: 'PUBLISHED', day_type: 'WORK', scheduled_hours: 5,
      });
    }
  }, [open, editing, presetDate, presetShiftCode, employees, form]);

  const saveMutation = useMutation({
    mutationFn: (values: ScheduleFormValues) =>
      editing
        ? api.put(`/admin/schedules/${editing.id}`, { ...values, version: editing.version })
        : api.post('/admin/schedules', values),
    onSuccess: () => {
      message.success(editing ? 'Đã cập nhật phân công ca làm việc' : 'Đã xếp lịch ca làm việc thành công');
      qc.invalidateQueries({ queryKey: ['schedules'] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        if (err.details.length > 0) {
          form.setFields(err.details.map((d) => ({ name: d.field as keyof ScheduleFormValues, errors: [d.message] })));
        }
        message.error(err.message);
      } else {
        message.error('Không thể lưu lịch phân ca');
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/admin/schedules/${editing!.id}`, { version: editing!.version }),
    onSuccess: () => {
      message.success('Đã xóa phân công ca làm việc');
      qc.invalidateQueries({ queryKey: ['schedules'] });
      onClose();
    },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : 'Xóa thất bại'),
  });

  return (
    <Modal
      title={
        editing
          ? `${hasSchedulePerm ? 'Chỉnh sửa Phân Ca' : 'Chi tiết Phân Ca'} — ${editing.employeeName} (${editing.workDate})`
          : 'Phân Công Ca Làm Việc Mới'
      }
      open={open}
      onCancel={onClose}
      footer={
        canModifyShift ? (
          <Flex justify={editing ? 'space-between' : 'flex-end'} align="center" wrap="wrap" gap={8} style={{ width: '100%' }}>
            {editing && (
              <Popconfirm title="Xác nhận xóa phân công ca này?" description="Ca làm việc này sẽ bị xóa khỏi lịch phân công." okText="Xác nhận xóa" cancelText="Hủy bỏ" okButtonProps={{ danger: true, icon: <DeleteOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onConfirm={() => deleteMutation.mutateAsync()}>
                <GuardButton danger icon={<DeleteOutlined />} perms={['schedule.propose', 'schedule.publish']} allowed={canModifyShift} loading={deleteMutation.isPending}>Xóa ca này</GuardButton>
              </Popconfirm>
            )}
            <Space wrap size={8}>
              <Button icon={<CloseOutlined />} onClick={onClose}>Hủy bỏ</Button>
              {isEditingAbsent && (
                <Button danger icon={<FileAddOutlined />} onClick={() => setQuickAdjOpen(true)}>
                  Tạo phiếu bổ sung công
                </Button>
              )}
              {editing && editing.status === 'DRAFT' && (
                <GuardButton
                  type="primary" icon={<CheckOutlined />} perms={['schedule.propose', 'schedule.publish']} allowed={canModifyShift} loading={saveMutation.isPending}
                  onClick={async () => { const vals = await form.validateFields(); saveMutation.mutate({ ...vals, status: 'PUBLISHED' }); }}
                >
                  Duyệt &amp; Phát hành ca
                </GuardButton>
              )}
              <GuardButton
                type={editing && editing.status === 'DRAFT' ? 'default' : 'primary'}
                icon={editing ? <SaveOutlined /> : <CheckOutlined />}
                perms={['schedule.propose', 'schedule.publish']} allowed={canModifyShift} loading={saveMutation.isPending}
                onClick={async () => saveMutation.mutate(await form.validateFields())}
              >
                {editing ? 'Lưu cập nhật' : 'Xác nhận phân ca'}
              </GuardButton>
            </Space>
          </Flex>
        ) : (
          <Space wrap size={8}>
            {isEditingAbsent && (
              <Button type="primary" danger icon={<FileAddOutlined />} onClick={() => setQuickAdjOpen(true)}>
                Tạo phiếu bổ sung công
              </Button>
            )}
            <Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
          </Space>
        )
      }
      width="min(840px, 94vw)"
      style={{ maxWidth: 'calc(100vw - 24px)' }}
      forceRender
    >
      {isLocked && (
        <Alert type="info" showIcon style={{ marginTop: 8, marginBottom: 8 }} message={`Ca làm việc này thuộc kỳ lương đã chốt (${editing?.lockedByPeriodCode || 'Đã phê duyệt'}), đã khóa chỉnh sửa và xóa để bảo toàn dữ liệu bảng lương.`} />
      )}
      {!isLocked && editing && editing.status === 'DRAFT' && (
        <Alert type="warning" showIcon style={{ marginTop: 8, marginBottom: 8 }} message="Ca đăng ký đang chờ Quản lý cửa hàng hoặc HR phê duyệt. Bấm 'Duyệt & Phát hành ca' để chuyển sang Đã phân ca chính thức và cho phép nhân sự điểm danh." />
      )}
      {hasPendingAdj && (
        <Alert type="warning" showIcon style={{ marginTop: 8, marginBottom: 8 }} message={`Ca làm việc này đã gửi Phiếu bổ sung công (${editing?.pendingAdjustmentCode || 'Chờ duyệt'}) và đang chờ Cửa hàng / HR phê duyệt. Không được phép gửi trùng yêu cầu.`} />
      )}
      {isEditingAbsent && (
        <Alert
          type="error" showIcon style={{ marginTop: 8, marginBottom: 8 }}
          message="Ca làm việc này đang ở trạng thái Vắng mặt (Cần bổ sung công). Bạn có thể tạo phiếu bổ sung công trực tiếp từ chi tiết ca này."
          action={<Button size="small" type="primary" danger icon={<FileAddOutlined />} onClick={() => setQuickAdjOpen(true)}>Tạo phiếu bổ sung công</Button>}
        />
      )}
      <Form<ScheduleFormValues> form={form} layout="vertical" disabled={!canModifyShift} style={{ marginTop: 12 }} onValuesChange={(changed) => { if (changed.shift_code && hoursMap[changed.shift_code]) form.setFieldValue('scheduled_hours', hoursMap[changed.shift_code]); }}>
        <Form.Item name="employee_id" label="Nhân sự phân công" rules={[{ required: true, message: 'Vui lòng chọn nhân sự' }]}>
          <Select showSearch optionFilterProp="label" options={employeeSelectOptions} placeholder="Chọn nhân sự" />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="work_date" label="Ngày làm việc" rules={[{ required: true }]}><DateStringPicker /></Form.Item></Col>
          <Col span={12}><Form.Item name="shift_code" label="Khung ca làm việc (theo chi nhánh)" rules={[{ required: true }]}><Select options={shiftOptions} /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="day_type" label="Loại ngày công"><Select options={[{ value: 'WORK', label: 'Ca làm việc chuẩn' }, { value: 'OT', label: 'Ca tăng ca (OT)' }, { value: 'OFF', label: 'Ngày nghỉ phép (OFF)' }]} /></Form.Item></Col>
          <Col span={8}><Form.Item name="scheduled_hours" label="Số giờ công"><InputNumber min={0} max={24} step={0.5} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={8}><Form.Item name="status" label="Trạng thái lịch"><Select options={SHIFT_ASSIGNMENT_STATUS_OPTIONS} /></Form.Item></Col>
        </Row>
        <Form.Item name="note" label="Ghi chú phân ca / Đánh dấu đặc biệt">
          <Input placeholder="Ví dụ: Trực mở quầy, kèm nhân viên mới..." />
        </Form.Item>
      </Form>
      <QuickAbsentAdjustmentModal shift={editing as unknown as Record<string, unknown>} open={quickAdjOpen} onClose={() => setQuickAdjOpen(false)} onSuccess={onClose} />
    </Modal>
  );
}
