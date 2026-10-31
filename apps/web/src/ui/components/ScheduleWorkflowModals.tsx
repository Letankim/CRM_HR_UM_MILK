'use client';

import { useMemo } from 'react';
import { Col, Form, Input, InputNumber, Modal, Row, Select, Space, Tag } from 'antd';
import { CloseOutlined, FileAddOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import { DateStringPicker, TimeStringPicker } from './DateTimePickers';
import { WorkflowSwapCreateModal } from './WorkflowSwapCreateModal';

export interface WorkflowAssignmentOption {
  id: string; employeeId: string; employeeName: string; workDate: string; shiftCode: string; shiftLabel: string;
  startAt?: string; endAt?: string; scheduledHours?: number; status?: string; statusLabel?: string; attendanceStatusLabel?: string;
  pendingAdjustmentCode?: string | null; pendingSwapCode?: string | null; pendingLeaveCode?: string | null;
}

interface Props {
  employees: { value: string; label: string; branchId?: string }[];
  assignments: WorkflowAssignmentOption[];
  leaveModal: boolean;
  swapModal: boolean;
  adjModal: boolean;
  submitting?: boolean;
  onCloseLeave: () => void;
  onCloseSwap: () => void;
  onCloseAdj: () => void;
  onSubmitAction: (url: string, body: unknown) => void;
}

const KIND_OPTIONS = [
  { value: 'FORGOT_CHECK_IN', label: 'Bù ca Vắng mặt / Quên chấm công Vào ca' },
  { value: 'FORGOT_CHECK_OUT', label: 'Quên chấm công Ra ca' },
  { value: 'GPS_ERROR', label: 'Thiết bị lỗi định vị GPS tại cửa hàng' },
  { value: 'CAMERA_ERROR', label: 'Thiết bị lỗi Camera không chụp được ảnh' },
  { value: 'OTHER', label: 'Lý do công việc / Điều động khác' },
];

const cleanShiftName = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();

export function ScheduleWorkflowModals({
  employees, assignments, leaveModal, swapModal, adjModal, submitting = false,
  onCloseLeave, onCloseSwap, onCloseAdj, onSubmitAction,
}: Props) {
  const [leaveForm] = Form.useForm();
  const [adjForm] = Form.useForm();
  const watchedLeaveEmpId = Form.useWatch('employee_id', leaveForm);
  const { options: leaveShiftOptions } = useShiftTemplates(employees.find((e) => e.value === watchedLeaveEmpId)?.branchId);
  const { options: allShiftOptions } = useShiftTemplates();

  const isAbsentAssign = (a: WorkflowAssignmentOption) =>
    !a.pendingAdjustmentCode &&
    !String(a.attendanceStatusLabel || '').includes('Đã gửi bù công') &&
    (a.status === 'ABSENT' || String(a.attendanceStatusLabel || '').includes('Vắng mặt'));

  const watchedAdjEmpId = Form.useWatch('employee_id', adjForm) || '';
  const watchedAdjAssignId = Form.useWatch('assignment_id', adjForm) || '';

  // Chỉ tải duy nhất các ca VẮNG MẶT (ABSENT) cần bù công của nhân sự đã chọn, tuyệt đối không lấy ca chưa điểm danh hoặc đã hoàn thành
  const empAbsentAssignments = useMemo(() => {
    if (!watchedAdjEmpId) return [];
    return assignments
      .filter((a) => a.employeeId === watchedAdjEmpId && isAbsentAssign(a))
      .sort((a, b) => b.workDate.localeCompare(a.workDate));
  }, [assignments, watchedAdjEmpId]);

  const selectedAdjAssign = useMemo(
    () => (watchedAdjAssignId ? empAbsentAssignments.find((a) => a.id === String(watchedAdjAssignId)) ?? null : null),
    [empAbsentAssignments, watchedAdjAssignId],
  );
  const isAdjShiftLocked = Boolean(selectedAdjAssign);

  const applyAssignToAdjForm = (a: WorkflowAssignmentOption) => {
    adjForm.setFieldsValue({
      assignment_id: a.id,
      work_date: a.workDate,
      shift_code: a.shiftCode,
      kind: 'FORGOT_CHECK_IN',
      requested_check_in_at: a.startAt || '07:00',
      requested_check_out_at: a.endAt || '12:00',
      requested_hours: a.scheduledHours || 5,
      reason: adjForm.getFieldValue('reason') || 'Bổ sung công bù ca Vắng mặt do nhân sự quên điểm danh đúng giờ',
    });
  };

  const adjShiftOptions = useMemo(() => {
    return empAbsentAssignments.map((a) => ({
      value: a.id,
      label: `[Vắng mặt — Cần bù công] ${dayjs(a.workDate).format('DD/MM/YYYY')} · ${cleanShiftName(a.shiftLabel)} (${a.startAt || '07:00'} – ${a.endAt || '12:00'} · ${a.scheduledHours || 5}h)`,
    }));
  }, [empAbsentAssignments]);

  return (
    <>
      <Modal width="min(760px, 94vw)" open={leaveModal} forceRender title="Tạo đơn xin nghỉ phép (OFF)" okText="Gửi đơn nghỉ phép" cancelText="Hủy bỏ" confirmLoading={submitting} okButtonProps={{ icon: <PlusOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={onCloseLeave} onOk={() => !submitting && leaveForm.submit()}>
        <Form form={leaveForm} layout="vertical" initialValues={{ shift_code: 'CA_SANG', kind: 'WEEKLY_OFF', leave_date: dayjs().add(1, 'day').format('YYYY-MM-DD') }} onFinish={(v) => { if (submitting) return; onSubmitAction('/admin/leave-requests', v); onCloseLeave(); }}>
          <Form.Item name="employee_id" label="Nhân sự" rules={[{ required: true }]}><Select options={employees} showSearch optionFilterProp="label" placeholder="Chọn nhân sự" /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="leave_date" label="Ngày nghỉ" rules={[{ required: true }]}><DateStringPicker /></Form.Item></Col><Col span={12}><Form.Item name="shift_code" label="Khung ca"><Select options={leaveShiftOptions} /></Form.Item></Col></Row>
          <Form.Item name="reason" label="Lý do xin nghỉ" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <WorkflowSwapCreateModal open={swapModal} employees={employees} assignments={assignments} submitting={submitting} onClose={onCloseSwap} onSubmit={(body) => onSubmitAction('/admin/shift-swaps', body)} />

      <Modal width="min(840px, 94vw)" open={adjModal} forceRender title="Tạo phiếu bổ sung công" okText="Tạo phiếu bổ sung" cancelText="Hủy bỏ" confirmLoading={submitting} okButtonProps={{ icon: <FileAddOutlined />, disabled: !isAdjShiftLocked || submitting }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={onCloseAdj} onOk={() => !submitting && adjForm.submit()}>
        <Form
          form={adjForm} layout="vertical"
          initialValues={{ kind: 'FORGOT_CHECK_IN', reason: 'Bổ sung công bù ca Vắng mặt do nhân sự quên điểm danh đúng giờ' }}
          onFinish={(v) => { if (submitting) return; onSubmitAction('/admin/attendance/adjustments', v); onCloseAdj(); }}
          onValuesChange={(changed) => {
            if (changed.employee_id) {
              const empAbsents = assignments
                .filter((a) => a.employeeId === String(changed.employee_id) && isAbsentAssign(a))
                .sort((a, b) => b.workDate.localeCompare(a.workDate));
              if (empAbsents[0]) applyAssignToAdjForm(empAbsents[0]);
              else adjForm.setFieldsValue({ assignment_id: undefined, work_date: undefined, shift_code: undefined, requested_check_in_at: undefined, requested_check_out_at: undefined, requested_hours: undefined });
            } else if (changed.assignment_id !== undefined) {
              const found = empAbsentAssignments.find((a) => a.id === String(changed.assignment_id));
              if (found) applyAssignToAdjForm(found);
              else adjForm.setFieldsValue({ work_date: undefined, shift_code: undefined, requested_check_in_at: undefined, requested_check_out_at: undefined, requested_hours: undefined });
            }
          }}
        >
          <Form.Item name="employee_id" label="1. Chọn nhân sự cần bổ sung công" rules={[{ required: true, message: 'Vui lòng chọn nhân sự' }]}>
            <Select showSearch optionFilterProp="label" placeholder="Chọn nhân sự để tải danh sách ca Vắng mặt cần bù công" options={employees} />
          </Form.Item>
          {watchedAdjEmpId && empAbsentAssignments.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>Ca Vắng mặt của nhân sự này (bấm để chọn bù công):</div>
              <Space size={6} wrap>
                {empAbsentAssignments.slice(0, 6).map((a) => (
                  <Tag key={a.id} color={a.id === watchedAdjAssignId ? 'blue' : 'red'} style={{ margin: 0, cursor: 'pointer', fontWeight: 600 }} onClick={() => applyAssignToAdjForm(a)}>
                    {dayjs(a.workDate).format('DD/MM/YYYY')} · {cleanShiftName(a.shiftLabel)} ({a.startAt || '07:00'}–{a.endAt || '12:00'})
                  </Tag>
                ))}
              </Space>
            </div>
          )}
          <Form.Item name="assignment_id" label={`2. Ca Vắng mặt cần bù của nhân sự đã chọn (${empAbsentAssignments.length} ca vắng mặt)`} rules={[{ required: true, message: 'Vui lòng chọn ca Vắng mặt cần bù công' }]}>
            <Select
              allowClear showSearch optionFilterProp="label" options={adjShiftOptions} disabled={!watchedAdjEmpId || empAbsentAssignments.length === 0}
              placeholder={!watchedAdjEmpId ? 'Vui lòng chọn nhân sự ở mục 1 trước' : empAbsentAssignments.length > 0 ? 'Chọn ca Vắng mặt cần bù công của nhân sự' : 'Nhân sự này không có ca Vắng mặt nào cần bù công'}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} md={8}><Form.Item name="work_date" label="Ngày công" rules={[{ required: true }]}><DateStringPicker disabled /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name="shift_code" label="Khung ca" rules={[{ required: true }]}><Select options={allShiftOptions} disabled placeholder="Theo ca đã chọn" /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name="kind" label="Phân loại" rules={[{ required: true }]}><Select options={KIND_OPTIONS} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col xs={12} md={8}><Form.Item name="requested_check_in_at" label="Giờ vào ca"><TimeStringPicker disabled /></Form.Item></Col>
            <Col xs={12} md={8}><Form.Item name="requested_check_out_at" label="Giờ ra ca"><TimeStringPicker disabled /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name="requested_hours" label="Giờ công" rules={[{ required: true }]}><InputNumber min={0.5} max={16} step={0.5} style={{ width: '100%' }} suffix="giờ" disabled /></Form.Item></Col>
          </Row>
          <Form.Item name="reason" label="Giải trình lý do bổ sung công" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
