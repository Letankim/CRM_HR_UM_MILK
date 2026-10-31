'use client';

import { Alert, App, Button, Col, Flex, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space } from 'antd';
import { CheckOutlined, CloseOutlined, DeleteOutlined, EyeOutlined, FileAddOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { SHIFT_ASSIGNMENT_STATUS_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useEmployeeSearchSelect } from '../hooks/useEmployeeSearchSelect';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import { evaluateBranchShiftSurplusPreview, useStaffingRules } from '../hooks/useStaffingRules';
import { DateStringPicker } from './DateTimePickers';
import { GuardButton, usePermissionGuard } from './GuardButton';
import { hasPendingAdjustmentRecord, isAbsentShiftRecord, QuickAbsentAdjustmentModal } from './QuickAbsentAdjustmentModal';
import { canViewShiftAttendanceDetail } from './ShiftAttendanceDetailModal';

export interface ScheduleAssignmentItem {
  id: string; employeeId: string; employeeCode: string; employeeName: string;
  employeeStage: string; employeeStageLabel: string; branchId: string; branchName: string;
  workDate: string; shiftCode: string; shiftLabel: string; startAt: string; endAt: string;
  scheduledHours: number; dayType: 'WORK' | 'OFF' | 'OT'; status: string; statusLabel: string;
  publishedAt: string | null; note: string; version: number; created_at: string;
  attendanceStatusLabel?: string; attendanceStatusColor?: string;
  pendingAdjustmentCode?: string | null; pendingSwapCode?: string | null; pendingLeaveCode?: string | null;
  source?: string; linkedAssignmentId?: string | null;
  isLockedByPayroll?: boolean; lockedByPeriodCode?: string | null;
}

interface ScheduleFormValues {
  employee_id: string; work_date: string; shift_code: string; status: string;
  day_type: 'WORK' | 'OFF' | 'OT'; scheduled_hours: number; note?: string;
}

export interface ScheduleFormModalProps {
  open: boolean; editing?: ScheduleAssignmentItem | null; presetDate?: string; presetShiftCode?: string;
  employees: { value: string; label: string; branchId?: string }[];
  existingAssignments?: ScheduleAssignmentItem[];
  canEdit?: boolean; onClose: () => void;
  onViewAttendance?: (item: ScheduleAssignmentItem) => void;
}

function isTimeOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const toMin = (hm: string) => { const [h, m] = (hm || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  let s1 = toMin(aStart), e1 = toMin(aEnd), s2 = toMin(bStart), e2 = toMin(bEnd);
  if (e1 <= s1) e1 += 1440;
  if (e2 <= s2) e2 += 1440;
  return s1 < e2 && s2 < e1;
}

export function ScheduleFormModal({
  open, editing, presetDate, presetShiftCode, employees, existingAssignments = [], canEdit = true, onClose, onViewAttendance,
}: ScheduleFormModalProps) {
  const [form] = Form.useForm<ScheduleFormValues>();
  const [quickAdjOpen, setQuickAdjOpen] = useState(false);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const hasSchedulePerm = usePermissionGuard({ perms: ['schedule.propose', 'schedule.publish'], allowed: canEdit });
  const canCreateAdj = usePermissionGuard({ perms: ['attendance.confirm', 'adjustment.approve'], allowed: canEdit });
  const isLocked = Boolean(editing?.isLockedByPayroll);
  const isApprovedNonDraft = Boolean(editing && editing.status !== 'DRAFT');
  const canModifyShift = hasSchedulePerm && !isLocked;
  const canEditFields = canModifyShift && !isApprovedNonDraft;

  const empSelect = useEmployeeSearchSelect({ initialOptions: employees, enabled: open && !editing });
  const { rules: staffingRules, branchCodeById, branchNameById } = useStaffingRules(open);
  const watchedEmpId = Form.useWatch('employee_id', form);
  const watchedDate = Form.useWatch('work_date', form);
  const watchedShiftCode = Form.useWatch('shift_code', form);
  const watchedDayType = Form.useWatch('day_type', form);
  const watchedStatus = Form.useWatch('status', form);
  const hasPendingAdj = Boolean(editing && hasPendingAdjustmentRecord(editing as unknown as Record<string, unknown>));
  const isEditingAbsent = canCreateAdj && !isLocked && !hasPendingAdj && Boolean(editing && (watchedStatus === 'ABSENT' || isAbsentShiftRecord(editing as unknown as Record<string, unknown>)));

  const baseEmployees = editing ? employees : empSelect.options;
  const selectedEmpBranchId = useMemo(
    () => baseEmployees.find((e) => e.value === watchedEmpId)?.branchId || editing?.branchId || 'ALL',
    [baseEmployees, watchedEmpId, editing?.branchId],
  );
  const { options: shiftOptions, hoursMap } = useShiftTemplates(selectedEmpBranchId);
  const curShiftMeta = useMemo(() => shiftOptions.find((s) => s.value === watchedShiftCode), [shiftOptions, watchedShiftCode]);

  const surplusPreview = useMemo(() => evaluateBranchShiftSurplusPreview({
    assignments: existingAssignments, rules: staffingRules, branchCodeById, branchId: selectedEmpBranchId,
    branchName: branchNameById.get(selectedEmpBranchId) || editing?.branchName, workDate: watchedDate, shiftCode: watchedShiftCode,
    editingId: editing?.id, isOff: watchedDayType === 'OFF' || watchedStatus === 'ON_LEAVE',
  }), [existingAssignments, staffingRules, branchCodeById, branchNameById, selectedEmpBranchId, editing?.branchName, editing?.id, watchedDate, watchedShiftCode, watchedDayType, watchedStatus]);

  const employeeSelectOptions = useMemo(() => {
    if (editing) {
      if (baseEmployees.some((e) => e.value === editing.employeeId)) return baseEmployees;
      return [{ value: editing.employeeId, label: `${editing.employeeCode} — ${editing.employeeName} (${editing.branchName})`, branchId: editing.branchId }, ...baseEmployees];
    }
    return baseEmployees.map((emp) => {
      const conflict = watchedDate ? existingAssignments.find((a) =>
        a.employeeId === emp.value && a.workDate === watchedDate && a.dayType !== 'OFF' && a.status !== 'ON_LEAVE' &&
        (a.shiftCode === watchedShiftCode || (curShiftMeta && isTimeOverlap(curShiftMeta.startTime, curShiftMeta.endTime, a.startAt, a.endAt))),
      ) : undefined;
      return conflict ? { ...emp, disabled: true, label: `${emp.label} — Đã có ${conflict.shiftLabel}` } : emp;
    });
  }, [baseEmployees, editing, existingAssignments, watchedDate, watchedShiftCode, curShiftMeta]);

  const availableShiftOptions = useMemo(() => {
    if (!watchedEmpId || !watchedDate) return shiftOptions;
    return shiftOptions.map((opt) => {
      const conflict = existingAssignments.find((a) =>
        a.id !== editing?.id && a.employeeId === watchedEmpId && a.workDate === watchedDate && a.dayType !== 'OFF' && a.status !== 'ON_LEAVE' &&
        (a.shiftCode === opt.value || isTimeOverlap(opt.startTime, opt.endTime, a.startAt, a.endAt)),
      );
      return conflict ? { ...opt, disabled: true, label: `${opt.label} — Đã trùng ${conflict.shiftLabel}` } : opt;
    });
  }, [shiftOptions, existingAssignments, editing?.id, watchedEmpId, watchedDate]);

  useEffect(() => {
    if (!open || shiftOptions.length === 0 || editing) return;
    const curShift = form.getFieldValue('shift_code');
    if (!curShift || !shiftOptions.some((o) => o.value === curShift)) {
      const nextShift = shiftOptions[0]!.value;
      form.setFieldsValue({ shift_code: nextShift, scheduled_hours: hoursMap[nextShift] ?? 5 });
    }
  }, [open, editing, selectedEmpBranchId, shiftOptions, hoursMap, form]);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({ employee_id: editing.employeeId, work_date: editing.workDate, shift_code: editing.shiftCode, status: editing.status, day_type: editing.dayType, scheduled_hours: editing.scheduledHours, note: editing.note });
    } else {
      form.resetFields();
      const targetDate = presetDate || dayjs().format('YYYY-MM-DD'), targetShift = presetShiftCode || 'CA_SANG';
      const firstFreeEmp = baseEmployees.find((e) => !existingAssignments.some((a) => a.employeeId === e.value && a.workDate === targetDate && a.shiftCode === targetShift));
      form.setFieldsValue({ employee_id: firstFreeEmp?.value ?? baseEmployees[0]?.value, work_date: targetDate, shift_code: targetShift, status: 'PUBLISHED', day_type: 'WORK', scheduled_hours: hoursMap[targetShift] ?? 5 });
    }
  }, [open, editing, presetDate, presetShiftCode]);

  const invalidateAll = () => ['schedules', 'attendance-sessions', 'attendance-sessions-count', 'attendance-all', 'my-attendance', 'nv-attendance', 'nv-schedules', 'payroll-periods', 'payroll-snapshots', 'payroll-reconcile'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const saveMutation = useMutation({
    mutationFn: (values: ScheduleFormValues) => editing ? api.put(`/admin/schedules/${editing.id}`, isApprovedNonDraft ? { version: editing.version, note: values.note ?? '' } : { ...values, employee_id: editing.employeeId, version: editing.version }) : api.post('/admin/schedules', values),
    onSuccess: () => { message.success(isApprovedNonDraft ? 'Đã cập nhật ghi chú phân ca thành công' : editing ? 'Đã cập nhật phân công ca làm việc' : 'Đã xếp lịch ca làm việc thành công'); invalidateAll(); onClose(); },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        if (err.details.length > 0) form.setFields(err.details.map((d) => ({ name: d.field as keyof ScheduleFormValues, errors: [d.message] })));
        message.error(err.message);
      } else message.error('Không thể lưu lịch phân ca');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/admin/schedules/${editing!.id}`, { version: editing!.version }),
    onSuccess: () => { message.success('Đã xóa phân công ca làm việc'); invalidateAll(); onClose(); },
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : 'Xóa thất bại'),
  });

  return (
    <Modal
      title={editing ? `${canEditFields ? 'Chỉnh sửa Phân Ca Chờ Duyệt' : canModifyShift ? 'Chi tiết & Ghi chú Phân Ca' : 'Chi tiết Phân Ca'} — ${editing.employeeName} (${editing.workDate})` : 'Phân Công Ca Làm Việc Mới'}
      open={open} onCancel={onClose} width="min(840px, 94vw)" style={{ maxWidth: 'calc(100vw - 24px)' }} forceRender
      footer={
        canModifyShift ? (
          <Flex justify={editing ? 'space-between' : 'flex-end'} align="center" wrap="wrap" gap={8} style={{ width: '100%' }}>
            {editing && (
              <Popconfirm title="Xác nhận xóa phân công ca này?" description="Ca làm việc này sẽ bị xóa khỏi lịch phân công." okText="Xác nhận xóa" cancelText="Hủy bỏ" okButtonProps={{ danger: true, icon: <DeleteOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onConfirm={() => deleteMutation.mutateAsync()}>
                <GuardButton danger icon={<DeleteOutlined />} perms={['schedule.propose', 'schedule.publish']} allowed={canModifyShift} loading={deleteMutation.isPending}>Xóa ca này</GuardButton>
              </Popconfirm>
            )}
            <Space wrap size={8}>
              <Button icon={<CloseOutlined />} onClick={onClose}>{canEditFields ? 'Hủy bỏ' : 'Đóng'}</Button>
              {editing && onViewAttendance && canViewShiftAttendanceDetail(editing) && <Button type="primary" ghost icon={<EyeOutlined />} onClick={() => onViewAttendance(editing)}>Xem chi tiết điểm danh</Button>}
              {isEditingAbsent && <Button danger icon={<FileAddOutlined />} onClick={() => setQuickAdjOpen(true)}>Tạo phiếu bổ sung công</Button>}
              {isApprovedNonDraft && <GuardButton type="primary" icon={<SaveOutlined />} perms={['schedule.propose', 'schedule.publish']} allowed={canModifyShift} loading={saveMutation.isPending} onClick={() => saveMutation.mutate(form.getFieldsValue())}>Lưu ghi chú</GuardButton>}
              {canEditFields && editing?.status === 'DRAFT' && <GuardButton type="primary" icon={<CheckOutlined />} perms={['schedule.propose', 'schedule.publish']} allowed={canEditFields} loading={saveMutation.isPending} onClick={async () => { const vals = await form.validateFields(); saveMutation.mutate({ ...vals, status: 'PUBLISHED' }); }}>Duyệt &amp; Phát hành ca</GuardButton>}
              {canEditFields && <GuardButton type={editing?.status === 'DRAFT' ? 'default' : 'primary'} icon={editing ? <SaveOutlined /> : <CheckOutlined />} perms={['schedule.propose', 'schedule.publish']} allowed={canEditFields} loading={saveMutation.isPending} onClick={async () => saveMutation.mutate(await form.validateFields())}>{editing ? 'Lưu cập nhật' : 'Xác nhận phân ca'}</GuardButton>}
            </Space>
          </Flex>
        ) : (
          <Space wrap size={8}>
            {editing && onViewAttendance && canViewShiftAttendanceDetail(editing) && <Button type="primary" ghost icon={<EyeOutlined />} onClick={() => onViewAttendance(editing)}>Xem chi tiết điểm danh</Button>}
            {isEditingAbsent && <Button type="primary" danger icon={<FileAddOutlined />} onClick={() => setQuickAdjOpen(true)}>Tạo phiếu bổ sung công</Button>}
            <Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
          </Space>
        )
      }
    >
      {editing && onViewAttendance && editing.status === 'COMPLETED' && <Alert type="success" showIcon style={{ marginTop: 8, marginBottom: 8 }} message="Ca làm việc này đã hoàn thành." action={<Button size="small" type="primary" ghost icon={<EyeOutlined />} onClick={() => onViewAttendance(editing)}>Xem chi tiết điểm danh</Button>} />}
      {isLocked && <Alert type="info" showIcon style={{ marginTop: 8, marginBottom: 8 }} message={`Ca làm việc này thuộc kỳ lương đã chốt (${editing?.lockedByPeriodCode || 'Đã phê duyệt'}), đã khóa chỉnh sửa và xóa để bảo toàn dữ liệu bảng lương.`} />}
      {!isLocked && isApprovedNonDraft && <Alert type="info" showIcon style={{ marginTop: 8, marginBottom: 8 }} message="Ca làm việc này đã được phê duyệt nên các thông tin nhân sự, ngày và khung ca đã được khóa. Bạn vẫn có thể chỉnh sửa Ghi chú phân ca bên dưới hoặc xóa phân ca này." />}
      {!isLocked && editing?.status === 'DRAFT' && <Alert type="warning" showIcon style={{ marginTop: 8, marginBottom: 8 }} message="Ca đăng ký đang chờ Quản lý cửa hàng hoặc HR phê duyệt. Nhân sự phân công đã được khóa cố định; bấm 'Duyệt & Phát hành ca' để phát hành chính thức." />}
      {surplusPreview && <Alert type="warning" showIcon style={{ marginTop: 8, marginBottom: 8 }} message={surplusPreview.isNew ? `Cảnh báo dư định biên tại ${surplusPreview.branchLabel}: Khung ca này hiện đã có ${surplusPreview.currentCount}/${surplusPreview.maxStaff} nhân sự (định biên ${surplusPreview.minStaff}–${surplusPreview.maxStaff}). Nếu phân thêm sẽ Dư +${surplusPreview.surplusDiff} nhân sự (${surplusPreview.projectedCount}/${surplusPreview.maxStaff}).` : `Cảnh báo dư định biên tại ${surplusPreview.branchLabel}: Khung ca này đang có ${surplusPreview.projectedCount}/${surplusPreview.maxStaff} nhân sự — Dư +${surplusPreview.surplusDiff} nhân sự so với định biên tối đa (${surplusPreview.minStaff}–${surplusPreview.maxStaff}).`} />}
      {hasPendingAdj && <Alert type="warning" showIcon style={{ marginTop: 8, marginBottom: 8 }} message={`Ca làm việc này đã gửi Phiếu bổ sung công (${editing?.pendingAdjustmentCode || 'Chờ duyệt'}) và đang chờ Cửa hàng / HR phê duyệt.`} />}
      {isEditingAbsent && <Alert type="error" showIcon style={{ marginTop: 8, marginBottom: 8 }} message="Ca làm việc này đang ở trạng thái Vắng mặt (Cần bổ sung công). Bạn có thể tạo phiếu bổ sung công trực tiếp từ chi tiết ca này." action={<Button size="small" type="primary" danger icon={<FileAddOutlined />} onClick={() => setQuickAdjOpen(true)}>Tạo phiếu bổ sung công</Button>} />}
      <Form<ScheduleFormValues> form={form} layout="vertical" disabled={!canModifyShift} style={{ marginTop: 12 }} onValuesChange={(changed) => { if (changed.shift_code && hoursMap[changed.shift_code]) form.setFieldValue('scheduled_hours', hoursMap[changed.shift_code]); }}>
        <Form.Item name="employee_id" label="Nhân sự phân công" rules={[{ required: true, message: 'Vui lòng chọn nhân sự' }]}>
          <Select showSearch disabled={Boolean(editing) || !canEditFields} options={employeeSelectOptions} loading={!editing && empSelect.loading} onSearch={editing ? undefined : empSelect.onSearch} filterOption={editing ? undefined : empSelect.filterOption} onDropdownVisibleChange={editing ? undefined : empSelect.onDropdownVisibleChange} placeholder="Tìm và chọn nhân sự phân công..." />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="work_date" label="Ngày làm việc" rules={[{ required: true }]}><DateStringPicker disabled={!canEditFields} /></Form.Item></Col>
          <Col span={12}><Form.Item name="shift_code" label="Khung ca làm việc (theo chi nhánh)" rules={[{ required: true }]}><Select disabled={!canEditFields} options={availableShiftOptions} /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="day_type" label="Loại ngày công"><Select disabled={!canEditFields} options={[{ value: 'WORK', label: 'Ca làm việc chuẩn' }, { value: 'OT', label: 'Ca tăng ca (OT)' }, { value: 'OFF', label: 'Ngày nghỉ phép (OFF)' }]} /></Form.Item></Col>
          <Col span={8}><Form.Item name="scheduled_hours" label="Số giờ công"><InputNumber disabled={!canEditFields} min={0} max={24} step={0.5} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={8}><Form.Item name="status" label="Trạng thái lịch"><Select disabled={!canEditFields} options={SHIFT_ASSIGNMENT_STATUS_OPTIONS} /></Form.Item></Col>
        </Row>
        <Form.Item name="note" label="Ghi chú phân ca / Đánh dấu đặc biệt">
          <Input disabled={!canModifyShift} placeholder="Ví dụ: Trực mở quầy, kèm nhân viên mới..." />
        </Form.Item>
      </Form>
      <QuickAbsentAdjustmentModal shift={editing as unknown as Record<string, unknown>} open={quickAdjOpen} onClose={() => setQuickAdjOpen(false)} onSuccess={onClose} />
    </Modal>
  );
}
