'use client';

import { Col, Form, Input, InputNumber, Modal, Row, Select } from 'antd';
import { AlertOutlined, CloseOutlined, FileAddOutlined, PlusOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { DEFAULT_SHIFT_OPTIONS } from '@umbm/shared';
import { DateStringPicker } from './DateTimePickers';

interface Props {
  employees: { value: string; label: string }[];
  assignments: { id: string; employeeId: string; employeeName: string; workDate: string; shiftCode: string; shiftLabel: string }[];
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

      <Modal width={640} open={adjModal} forceRender title="Tạo phiếu bổ sung / điều chỉnh công" okText="Tạo phiếu bổ sung" cancelText="Hủy bỏ" okButtonProps={{ icon: <FileAddOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={onCloseAdj} onOk={() => adjForm.submit()}>
        <Form form={adjForm} layout="vertical" initialValues={{ work_date: dayjs().format('YYYY-MM-DD'), shift_code: 'CA_SANG', requested_hours: 5 }} onFinish={(v) => { onSubmitAction('/admin/attendance/adjustments', v); onCloseAdj(); }}>
          <Form.Item name="employee_id" label="Nhân sự" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" placeholder="Chọn nhân sự" options={employees} /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="work_date" label="Ngày công" rules={[{ required: true }]}><DateStringPicker /></Form.Item></Col><Col span={12}><Form.Item name="shift_code" label="Khung ca"><Select options={DEFAULT_SHIFT_OPTIONS} /></Form.Item></Col></Row>
          <Form.Item name="requested_hours" label="Số giờ công thực tế đề nghị" rules={[{ required: true }]}><InputNumber min={0.5} max={16} step={0.5} style={{ width: '100%' }} suffix="giờ" /></Form.Item>
          <Form.Item name="reason" label="Giải trình lý do" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
