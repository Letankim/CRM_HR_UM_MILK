'use client';

import { useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Select, Space } from 'antd';
import { CloseOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import { DateStringPicker } from './DateTimePickers';

export { AttendanceAdjustmentModal } from './AttendanceAdjustmentModal';
export { MyShiftRegisterModal } from './MyShiftRegisterModal';

export function LeaveRequestModal({
  open, employeeId, onClose, onSuccess,
}: { open: boolean; employeeId: string; onClose: () => void; onSuccess: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const { options: shiftOptions } = useShiftTemplates();
  const reqMode = Form.useWatch('req_mode', form) || 'LEAVE';
  const draftKey = `umbm_leave_draft_${employeeId || 'me'}`;

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    try { const saved = window.localStorage.getItem(draftKey); if (saved) form.setFieldsValue(JSON.parse(saved)); } catch { /* ignore */ }
  }, [open, draftKey, form]);

  const handleSaveDraft = () => {
    if (typeof window !== 'undefined') window.localStorage.setItem(draftKey, JSON.stringify(form.getFieldsValue()));
    message.success('Đã lưu nháp đơn đăng ký nghỉ OFF trên thiết bị');
    onClose();
  };

  const handleSubmit = async () => {
    try {
      const vals = await form.validateFields();
      setLoading(true);
      if (vals.req_mode === 'EMERGENCY') {
        await api.post('/admin/emergency-leaves', { employee_id: employeeId, work_date: vals.leave_date, shift_code: vals.shift_code, reason: vals.reason });
        message.success('Đã gửi báo cáo nghỉ khẩn cấp (<12h) tới Quản lý Cửa hàng & HR');
      } else {
        await api.post('/admin/leave-requests', { ...vals, employee_id: employeeId });
        message.success('Đã gửi đơn đăng ký nghỉ OFF thành công');
      }
      if (typeof window !== 'undefined') window.localStorage.removeItem(draftKey);
      form.resetFields(); onSuccess(); onClose();
    } catch (e) { if (e instanceof ApiClientError) message.error(e.message); }
    finally { setLoading(false); }
  };

  return (
    <Modal
      width={640} open={open} forceRender title="Đăng ký Nghỉ phép OFF / Báo nghỉ Khẩn cấp (<12h)" onCancel={onClose}
      footer={
        <Space wrap>
          <Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
          {reqMode === 'LEAVE' && <Button icon={<SaveOutlined />} onClick={handleSaveDraft}>Lưu nháp</Button>}
          <Button type="primary" danger={reqMode === 'EMERGENCY'} icon={<SendOutlined />} loading={loading} onClick={handleSubmit}>
            {reqMode === 'EMERGENCY' ? 'Gửi báo nghỉ khẩn cấp' : 'Gửi đơn đăng ký OFF'}
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" initialValues={{ req_mode: 'LEAVE', leave_date: dayjs().add(1, 'day').format('YYYY-MM-DD'), shift_code: 'CA_SANG', reason: 'Xin nghỉ phép theo định mức chu kỳ' }}>
        <Form.Item name="req_mode" label="Loại đề nghị nghỉ"><Select options={[{ value: 'LEAVE', label: 'Đăng ký nghỉ phép OFF định kỳ (Theo định mức chu kỳ)' }, { value: 'EMERGENCY', label: 'Báo nghỉ khẩn cấp sát giờ ca (<12h trước giờ vào ca)' }]} /></Form.Item>
        <Form.Item name="leave_date" label="Ngày xin nghỉ" rules={[{ required: true, message: 'Chọn ngày nghỉ' }]}><DateStringPicker minDate={dayjs().format('YYYY-MM-DD')} /></Form.Item>
        <Form.Item name="shift_code" label="Khung ca" rules={[{ required: true }]}><Select options={shiftOptions} /></Form.Item>
        <Form.Item name="reason" label="Lý do xin nghỉ" rules={[{ required: true, message: 'Nhập lý do' }]}><Input.TextArea rows={2} placeholder="Nêu rõ lý do xin nghỉ phép hoặc sự cố khẩn cấp..." /></Form.Item>
      </Form>
    </Modal>
  );
}

export function ShiftSwapRequestModal({
  open, employeeId, shifts, peers, onClose, onSuccess,
}: {
  open: boolean; employeeId: string; shifts: Record<string, unknown>[];
  peers: { id: string; employeeCode: string; fullName: string; positionTitle?: string; branchName?: string; busyShiftsByDate?: Record<string, string> }[];
  onClose: () => void; onSuccess: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const approvedShifts = shifts.filter((s) => s.status === 'PUBLISHED');
  const shiftOptions = approvedShifts.map((s) => {
    const pendingCode = String(s.pendingSwapCode || s.pendingLeaveCode || s.pendingEmergencyCode || '');
    return {
      value: String(s.id), disabled: Boolean(pendingCode),
      label: `${dayjs(String(s.workDate)).format('DD/MM/YYYY')} · ${String(s.shiftLabel || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim()} (${String(s.startAt || '07:00')} – ${String(s.endAt || '12:00')}) · ${pendingCode ? `[Đang chờ duyệt ${pendingCode}]` : String(s.branchName || '')}`,
    };
  });
  const watchedAssignId = Form.useWatch('from_assignment_id', form);
  const selectableShifts = approvedShifts.filter((s) => !s.pendingSwapCode && !s.pendingLeaveCode && !s.pendingEmergencyCode);
  const selectedShift = selectableShifts.find((s) => String(s.id) === String(watchedAssignId)) ?? selectableShifts[0];
  const selectedWorkDate = String(selectedShift?.workDate || '');

  const peerOptions = peers.map((p) => {
    const busyShift = selectedWorkDate ? p.busyShiftsByDate?.[selectedWorkDate] : undefined;
    const cleanBusy = busyShift ? busyShift.replace(/\s*\([^)]*\)\s*/g, '').trim() : '';
    return {
      value: p.id, disabled: Boolean(busyShift),
      label: busyShift
        ? `${p.employeeCode} — ${p.fullName} · Đã có ${cleanBusy} ngày ${dayjs(selectedWorkDate).format('DD/MM/YYYY')} (Không thể nhận ca)`
        : `${p.employeeCode} — ${p.fullName}${p.positionTitle ? ` (${p.positionTitle})` : ''}${selectedWorkDate ? ` · Trống lịch ngày ${dayjs(selectedWorkDate).format('DD/MM/YYYY')}` : ''}`,
    };
  });
  const availablePeers = peerOptions.filter((p) => !p.disabled);

  useEffect(() => {
    if (!open) return;
    const firstAssign = selectableShifts[0];
    const dateStr = String(firstAssign?.workDate || '');
    const firstFreePeer = peers.find((p) => !dateStr || !p.busyShiftsByDate?.[dateStr]);
    form.setFieldsValue({ from_assignment_id: firstAssign ? String(firstAssign.id) : undefined, peer_id: firstFreePeer?.id, reason: 'Bận lịch cá nhân đột xuất, nhờ đồng nghiệp cùng chi nhánh trực thay ca' });
  }, [open, selectableShifts.length]);

  const handleSubmit = async () => {
    try {
      const vals = await form.validateFields();
      setLoading(true);
      await api.post('/admin/shift-swaps', { requester_id: employeeId, from_assignment_id: vals.from_assignment_id, peer_id: vals.peer_id, reason: vals.reason });
      message.success('Đã gửi yêu cầu đổi ca (Bước 1/3: Chờ đồng nghiệp xác nhận)');
      form.resetFields(); onSuccess(); onClose();
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.details.length > 0) form.setFields(e.details.map((d) => ({ name: d.field, errors: [d.message] })));
        message.error(e.message);
      }
    } finally { setLoading(false); }
  };

  return (
    <Modal width={640} open={open} forceRender title="Tạo yêu cầu đổi ca" onCancel={onClose} onOk={handleSubmit} confirmLoading={loading} okText="Gửi yêu cầu đổi ca" cancelText="Đóng" okButtonProps={{ icon: <SendOutlined />, disabled: shiftOptions.length === 0 || availablePeers.length === 0 }} cancelButtonProps={{ icon: <CloseOutlined /> }}>
      {shiftOptions.length === 0 ? (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Bạn chưa có ca làm việc đã phát hành nào để tạo yêu cầu đổi ca. Hãy đăng ký ca và chờ Quản lý cửa hàng / HR duyệt trước." />
      ) : availablePeers.length === 0 && selectedWorkDate ? (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`Không có đồng nghiệp nào trống lịch trong ngày ${dayjs(selectedWorkDate).format('DD/MM/YYYY')}. Tất cả đồng nghiệp cùng chi nhánh đều đã có ca làm việc ngày này nên không thể tạo yêu cầu đổi ca.`} />
      ) : null}
      <Form
        form={form} layout="vertical"
        onValuesChange={(changed) => {
          if (changed.from_assignment_id) {
            const nextShift = approvedShifts.find((s) => String(s.id) === String(changed.from_assignment_id));
            const nextDate = String(nextShift?.workDate || '');
            const freePeer = peers.find((p) => !nextDate || !p.busyShiftsByDate?.[nextDate]);
            form.setFieldValue('peer_id', freePeer?.id);
          }
        }}
      >
        <Form.Item name="from_assignment_id" label="Ca làm việc cần đổi" rules={[{ required: true, message: 'Vui lòng chọn ca làm việc cần đổi' }]}><Select showSearch optionFilterProp="label" options={shiftOptions} placeholder="Chọn ca làm việc của bạn" /></Form.Item>
        <Form.Item name="peer_id" label="Đồng nghiệp nhận ca thay" rules={[{ required: true, message: 'Vui lòng chọn đồng nghiệp trống lịch trong ngày đó' }]}><Select showSearch optionFilterProp="label" options={peerOptions} placeholder="Chọn đồng nghiệp chưa có ca trong ngày đó" /></Form.Item>
        <Form.Item name="reason" label="Lý do xin đổi ca" rules={[{ required: true, message: 'Vui lòng nhập lý do đổi ca' }]}><Input.TextArea rows={2} placeholder="Nêu rõ lý do xin đổi ca để đồng nghiệp và Quản lý cửa hàng phê duyệt..." /></Form.Item>
      </Form>
    </Modal>
  );
}
