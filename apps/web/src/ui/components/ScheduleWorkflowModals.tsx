'use client';

import { useMemo } from 'react';
import { Alert, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Tag } from 'antd';
import { AlertOutlined, CloseOutlined, FileAddOutlined, LockOutlined, PlusOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { DEFAULT_SHIFT_OPTIONS } from '@umbm/shared';
import { DateStringPicker, TimeStringPicker } from './DateTimePickers';

export interface WorkflowAssignmentOption {
  id: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  shiftCode: string;
  shiftLabel: string;
  startAt?: string;
  endAt?: string;
  scheduledHours?: number;
  status?: string;
  statusLabel?: string;
  attendanceStatusLabel?: string;
}

interface Props {
  employees: { value: string; label: string }[];
  assignments: WorkflowAssignmentOption[];
  leaveModal: boolean;
  swapModal: boolean;
  emgModal: boolean;
  adjModal: boolean;
  onCloseLeave: () => void;
  onCloseSwap: () => void;
  onCloseEmg: () => void;
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
  employees, assignments, leaveModal, swapModal, emgModal, adjModal,
  onCloseLeave, onCloseSwap, onCloseEmg, onCloseAdj, onSubmitAction,
}: Props) {
  const [leaveForm] = Form.useForm();
  const [swapForm] = Form.useForm();
  const [emgForm] = Form.useForm();
  const [adjForm] = Form.useForm();
  const watchedSwapAssignId = Form.useWatch('from_assignment_id', swapForm);
  const selectedSwapAssign = assignments.find((a) => a.id === watchedSwapAssignId);
  const swapPeerOptions = employees.map((e) => {
    const isRequester = selectedSwapAssign && e.value === selectedSwapAssign.employeeId;
    const busyOnDate = selectedSwapAssign && assignments.find((a) => a.employeeId === e.value && a.workDate === selectedSwapAssign.workDate);
    return {
      value: e.value,
      disabled: Boolean(isRequester || busyOnDate),
      label: isRequester ? `${e.label} — Người xin đổi ca` : busyOnDate ? `${e.label} — Đã có ${busyOnDate.shiftLabel} ngày ${selectedSwapAssign.workDate} (Không thể nhận ca)` : e.label,
    };
  });

  const watchedAdjEmpId = Form.useWatch('employee_id', adjForm) || '';
  const watchedAdjAssignId = Form.useWatch('assignment_id', adjForm) || '';
  const selectedAdjAssign = useMemo(
    () => (watchedAdjAssignId ? assignments.find((a) => a.id === String(watchedAdjAssignId)) ?? null : null),
    [assignments, watchedAdjAssignId],
  );
  const isAdjShiftLocked = Boolean(selectedAdjAssign);

  const isAbsentAssign = (a: WorkflowAssignmentOption) =>
    a.status === 'ABSENT' || String(a.attendanceStatusLabel || '').includes('Vắng mặt');

  const empAssignments = useMemo(() => {
    if (!watchedAdjEmpId) return [];
    return assignments
      .filter((a) => a.employeeId === watchedAdjEmpId && a.status !== 'DRAFT' && a.status !== 'ON_LEAVE')
      .sort((a, b) => (isAbsentAssign(b) ? 1 : 0) - (isAbsentAssign(a) ? 1 : 0) || b.workDate.localeCompare(a.workDate));
  }, [assignments, watchedAdjEmpId]);

  const empAbsentAssignments = useMemo(() => empAssignments.filter(isAbsentAssign), [empAssignments]);

  const applyAssignToAdjForm = (a: WorkflowAssignmentOption) => {
    const absent = isAbsentAssign(a);
    adjForm.setFieldsValue({
      assignment_id: a.id,
      work_date: a.workDate,
      shift_code: a.shiftCode,
      kind: absent ? 'FORGOT_CHECK_IN' : 'FORGOT_CHECK_OUT',
      requested_check_in_at: a.startAt || '07:00',
      requested_check_out_at: a.endAt || '12:00',
      requested_hours: a.scheduledHours || 5,
      reason: adjForm.getFieldValue('reason') || (absent ? 'Bổ sung công bù ca Vắng mặt do nhân sự quên điểm danh đúng giờ' : 'Bổ sung công thực tế tại cửa hàng'),
    });
  };

  const adjShiftOptions = useMemo(() => {
    return empAssignments.map((a) => {
      const stateTag = isAbsentAssign(a) ? '[Vắng mặt — Cần bù công]' : a.attendanceStatusLabel ? `[${a.attendanceStatusLabel}]` : `[${a.statusLabel || a.status}]`;
      return { value: a.id, label: `${stateTag} ${dayjs(a.workDate).format('DD/MM/YYYY')} · ${cleanShiftName(a.shiftLabel)} (${a.startAt || '07:00'} – ${a.endAt || '12:00'} · ${a.scheduledHours || 5}h)` };
    });
  }, [empAssignments]);

  return (
    <>
      <Modal width={640} open={leaveModal} forceRender title="Tạo đơn xin nghỉ phép (OFF)" okText="Gửi đơn nghỉ phép" cancelText="Hủy bỏ" okButtonProps={{ icon: <PlusOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={onCloseLeave} onOk={() => leaveForm.submit()}>
        <Form form={leaveForm} layout="vertical" initialValues={{ shift_code: 'CA_SANG', kind: 'WEEKLY_OFF', leave_date: dayjs().add(1, 'day').format('YYYY-MM-DD') }} onFinish={(v) => { onSubmitAction('/admin/leave-requests', v); onCloseLeave(); }}>
          <Form.Item name="employee_id" label="Nhân sự" rules={[{ required: true }]}><Select options={employees} showSearch optionFilterProp="label" placeholder="Chọn nhân sự" /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="leave_date" label="Ngày nghỉ" rules={[{ required: true }]}><DateStringPicker /></Form.Item></Col><Col span={12}><Form.Item name="shift_code" label="Khung ca"><Select options={DEFAULT_SHIFT_OPTIONS} /></Form.Item></Col></Row>
          <Form.Item name="reason" label="Lý do xin nghỉ" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal width={640} open={swapModal} forceRender title="Tạo yêu cầu đổi ca" okText="Tạo yêu cầu đổi ca" cancelText="Hủy bỏ" okButtonProps={{ icon: <SwapOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={onCloseSwap} onOk={() => swapForm.submit()}>
        <Form form={swapForm} layout="vertical" onFinish={(v) => { onSubmitAction('/admin/shift-swaps', v); onCloseSwap(); }}>
          <Form.Item name="from_assignment_id" label="Ca làm việc cần đổi" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" placeholder="Chọn ca làm việc cần đổi" onChange={(id) => { const found = assignments.find((a) => a.id === id); if (found) { swapForm.setFieldValue('requester_id', found.employeeId); swapForm.setFieldValue('peer_id', undefined); } }} options={assignments.map((a) => ({ value: a.id, label: `${a.workDate} — ${a.shiftLabel} (${a.employeeName})` }))} /></Form.Item>
          <Form.Item name="requester_id" label="Người xin đổi ca" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" placeholder="Chọn người xin đổi ca" options={employees} disabled /></Form.Item>
          <Form.Item name="peer_id" label="Đồng nghiệp nhận ca thay (Bắt buộc chưa có ca ngày đó)" rules={[{ required: true, message: 'Vui lòng chọn đồng nghiệp trống lịch trong ngày đó' }]}><Select showSearch optionFilterProp="label" placeholder="Chọn đồng nghiệp chưa có ca trong ngày đó" options={swapPeerOptions} /></Form.Item>
          <Form.Item name="reason" label="Lý do đổi ca" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal width={640} open={emgModal} forceRender title="Báo nghỉ đột xuất / Khẩn cấp" okText="Gửi báo nghỉ khẩn" cancelText="Hủy bỏ" okButtonProps={{ danger: true, icon: <AlertOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={onCloseEmg} onOk={() => emgForm.submit()}>
        <Form form={emgForm} layout="vertical" initialValues={{ work_date: dayjs().format('YYYY-MM-DD'), shift_code: 'CA_TOI' }} onFinish={(v) => { onSubmitAction('/admin/emergency-leaves', v); onCloseEmg(); }}>
          <Form.Item name="employee_id" label="Nhân sự" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" placeholder="Chọn nhân sự" options={employees} /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="work_date" label="Ngày ca làm việc" rules={[{ required: true }]}><DateStringPicker /></Form.Item></Col><Col span={12}><Form.Item name="shift_code" label="Khung ca"><Select options={DEFAULT_SHIFT_OPTIONS} /></Form.Item></Col></Row>
          <Form.Item name="reason" label="Lý do khẩn cấp" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal width={680} open={adjModal} forceRender title="Tạo phiếu bổ sung / điều chỉnh công theo Nhân sự" okText="Tạo phiếu bổ sung" cancelText="Hủy bỏ" okButtonProps={{ icon: <FileAddOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={onCloseAdj} onOk={() => adjForm.submit()}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Chọn Nhân sự để tải danh sách ca vắng mặt. Khi đã chọn ca bù công, Ngày công, Khung ca và Thời gian ca sẽ được khóa cố định theo đúng ca đó để tránh sai lệch dữ liệu." />
        <Form
          form={adjForm} layout="vertical"
          initialValues={{ work_date: dayjs().format('YYYY-MM-DD'), shift_code: 'CA_SANG', kind: 'FORGOT_CHECK_IN', requested_check_in_at: '07:00', requested_check_out_at: '12:00', requested_hours: 5 }}
          onFinish={(v) => { onSubmitAction('/admin/attendance/adjustments', v); onCloseAdj(); }}
          onValuesChange={(changed) => {
            if (changed.employee_id) {
              const empShifts = assignments
                .filter((a) => a.employeeId === String(changed.employee_id) && a.status !== 'DRAFT' && a.status !== 'ON_LEAVE')
                .sort((a, b) => (isAbsentAssign(b) ? 1 : 0) - (isAbsentAssign(a) ? 1 : 0) || b.workDate.localeCompare(a.workDate));
              if (empShifts[0]) applyAssignToAdjForm(empShifts[0]);
              else adjForm.setFieldValue('assignment_id', '');
            } else if (changed.assignment_id !== undefined) {
              const found = assignments.find((a) => a.id === String(changed.assignment_id));
              if (found) applyAssignToAdjForm(found);
            }
          }}
        >
          <Form.Item name="employee_id" label="1. Chọn nhân sự cần bổ sung công" rules={[{ required: true, message: 'Vui lòng chọn nhân sự' }]}>
            <Select showSearch optionFilterProp="label" placeholder="Chọn nhân sự để tải danh sách ca làm việc" options={employees} />
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
          <Form.Item name="assignment_id" label={`2. Ca làm việc của nhân sự đã chọn (${empAssignments.length} ca)`}>
            <Select
              allowClear showSearch optionFilterProp="label" options={adjShiftOptions} disabled={!watchedAdjEmpId}
              placeholder={!watchedAdjEmpId ? 'Vui lòng chọn nhân sự ở mục 1 trước' : empAssignments.length > 0 ? 'Chọn ca vắng mặt / ca cần bổ sung của nhân sự' : 'Nhân sự chưa có ca phát hành nào'}
            />
          </Form.Item>
          {isAdjShiftLocked && selectedAdjAssign && (
            <div style={{ marginBottom: 12, padding: '6px 10px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4, fontSize: 12, color: '#1E40AF' }}>
              <LockOutlined style={{ marginRight: 6 }} />
              Đã khóa cố định <strong>Ngày công ({dayjs(selectedAdjAssign.workDate).format('DD/MM/YYYY')})</strong>, <strong>Khung ca</strong> và <strong>Thời gian ca ({selectedAdjAssign.startAt || '07:00'} – {selectedAdjAssign.endAt || '12:00'} · {selectedAdjAssign.scheduledHours || 5}h)</strong> theo đúng ca bù đã chọn.
            </div>
          )}
          <Row gutter={12}>
            <Col xs={24} md={8}><Form.Item name="work_date" label="Ngày công (Cố định)" rules={[{ required: true }]}><DateStringPicker disabled={isAdjShiftLocked} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name="shift_code" label="Khung ca (Cố định)" rules={[{ required: true }]}><Select options={DEFAULT_SHIFT_OPTIONS} disabled={isAdjShiftLocked} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name="kind" label="Phân loại" rules={[{ required: true }]}><Select options={KIND_OPTIONS} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col xs={12} md={8}><Form.Item name="requested_check_in_at" label="Giờ vào ca (Cố định)"><TimeStringPicker disabled={isAdjShiftLocked} /></Form.Item></Col>
            <Col xs={12} md={8}><Form.Item name="requested_check_out_at" label="Giờ ra ca (Cố định)"><TimeStringPicker disabled={isAdjShiftLocked} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name="requested_hours" label="Giờ công (Cố định)" rules={[{ required: true }]}><InputNumber min={0.5} max={16} step={0.5} style={{ width: '100%' }} suffix="giờ" disabled={isAdjShiftLocked} /></Form.Item></Col>
          </Row>
          <Form.Item name="reason" label="Giải trình lý do bổ sung công" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
