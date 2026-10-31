'use client';

import { useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Space, Tag } from 'antd';
import { CalendarOutlined, CloseOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { DEFAULT_OPERATION_SETTINGS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { BoundedDateStringPicker } from './BoundedDateStringPicker';
import { useMyAttendanceExtras, useOffWindow } from './self-attendance-shared';

const fmt = (d?: string) => (d ? dayjs(d).format('DD/MM/YYYY') : '—');

export interface LeaveRequestModalProps {
  open: boolean; employeeId: string; stage?: string; onClose: () => void; onSuccess: () => void;
}

/** Đăng ký nghỉ OFF: Chính thức theo cổng đăng ký tuần; Thử việc trong chu kỳ 12 ngày (tối đa 5 ngày OFF). */
export function LeaveRequestModal({ open, employeeId, stage, onClose, onSuccess }: LeaveRequestModalProps) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<{ leave_date: string; reason: string }>();
  const [loading, setLoading] = useState(false);
  const myQ = useMyAttendanceExtras(open);
  const winQ = useOffWindow(open);
  const draftKey = `umbm_leave_draft_${employeeId || 'me'}`;

  const isProbation = (stage || myQ.data?.profile?.stage) === 'PROBATION';
  const win = winQ.data ?? myQ.data?.offWindow;
  const weeklyLimit = winQ.data?.officialWeeklyOffLimit ?? DEFAULT_OPERATION_SETTINGS.officialWeeklyOffLimit;
  const cycle = myQ.data?.probationCycle ?? null;
  const today = dayjs().format('YYYY-MM-DD');
  const minDate = isProbation ? (cycle ? (cycle.start > today ? cycle.start : today) : today) : win?.targetWeekStart;
  const maxDate = isProbation ? cycle?.end : win?.targetWeekEnd;
  const cycleFull = Boolean(cycle && cycle.offCount >= cycle.offLimit);
  const blockedReason = isProbation
    ? (!cycle ? 'Chưa xác định được chu kỳ thử việc của bạn.' : cycle.isLocked ? 'Chu kỳ thử việc đã được HR chốt lịch, không thể đăng ký thêm ngày OFF.' : cycleFull ? `Bạn đã đăng ký đủ ${cycle.offLimit} ngày OFF trong chu kỳ.` : minDate && maxDate && minDate > maxDate ? 'Chu kỳ thử việc hiện tại đã kết thúc.' : '')
    : (!win ? 'Đang tải trạng thái cổng đăng ký OFF...' : !win.isOpen ? 'Cổng đăng ký nghỉ OFF đang đóng.' : '');
  const isBlocked = Boolean(blockedReason);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const base = { leave_date: minDate ?? '', reason: 'Xin nghỉ OFF theo định mức' };
    try {
      const saved = window.localStorage.getItem(draftKey);
      const parsed = saved ? (JSON.parse(saved) as { leave_date?: string; reason?: string }) : {};
      const okDate = parsed.leave_date && (!minDate || parsed.leave_date >= minDate) && (!maxDate || parsed.leave_date <= maxDate);
      form.setFieldsValue({ ...base, ...parsed, leave_date: okDate ? parsed.leave_date! : base.leave_date });
    } catch { form.setFieldsValue(base); }
  }, [open, draftKey, form, minDate, maxDate]);

  const handleSaveDraft = () => {
    if (typeof window !== 'undefined') window.localStorage.setItem(draftKey, JSON.stringify(form.getFieldsValue()));
    message.success('Đã lưu nháp đơn đăng ký nghỉ OFF trên thiết bị');
    onClose();
  };

  const handleSubmit = async () => {
    try {
      const vals = await form.validateFields();
      setLoading(true);
      await api.post('/admin/leave-requests', { ...vals, employee_id: employeeId });
      message.success('Đã gửi đơn đăng ký nghỉ OFF thành công');
      if (typeof window !== 'undefined') window.localStorage.removeItem(draftKey);
      void qc.invalidateQueries({ queryKey: ['off-window'] });
      form.resetFields(); onSuccess(); onClose();
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.details.length > 0) form.setFields(e.details.map((d) => ({ name: d.field as 'leave_date', errors: [d.message] })));
        message.error(e.message);
      }
    } finally { setLoading(false); }
  };

  return (
    <Modal
      width={640} open={open} forceRender title="Đăng ký nghỉ OFF" onCancel={onClose}
      footer={
        <Space wrap>
          <Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
          <Button icon={<SaveOutlined />} onClick={handleSaveDraft}>Lưu nháp</Button>
          <Button type="primary" icon={<SendOutlined />} loading={loading} disabled={isBlocked} onClick={handleSubmit}>Gửi đơn đăng ký OFF</Button>
        </Space>
      }
    >
      <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
        {isProbation ? (
          <Alert
            type={isBlocked ? 'warning' : 'info'} showIcon
            message={cycle ? `Chu kỳ thử việc: ${fmt(cycle.start)} – ${fmt(cycle.end)}` : 'Đăng ký nghỉ OFF trong chu kỳ thử việc'}
            description={blockedReason || 'Chỉ chọn ngày trong chu kỳ thử việc hiện tại, không chọn ngày đã qua.'}
          />
        ) : (
          <Alert
            type={win?.isOpen ? 'success' : 'warning'} showIcon
            message={win?.message || 'Đang tải trạng thái cổng đăng ký OFF...'}
            description={win ? `Tuần đăng ký: ${fmt(win.targetWeekStart)} – ${fmt(win.targetWeekEnd)} · Mở ${dayjs(win.opensAt).format('HH:mm DD/MM')} – Đóng ${dayjs(win.closesAt).format('HH:mm DD/MM')}` : undefined}
          />
        )}
        <Space size={6} wrap>
          {isProbation && cycle && <Tag color={cycleFull ? 'red' : 'blue'} icon={<CalendarOutlined />} style={{ margin: 0, fontWeight: 600 }}>Đã đăng ký {cycle.offCount}/{cycle.offLimit} ngày OFF trong chu kỳ</Tag>}
          {!isProbation && <Tag color="blue" icon={<CalendarOutlined />} style={{ margin: 0, fontWeight: 600 }}>Tối đa {weeklyLimit} ngày OFF / tuần</Tag>}
        </Space>
      </Space>
      <Form form={form} layout="vertical" disabled={isBlocked}>
        <Form.Item name="leave_date" label="Ngày xin nghỉ OFF" rules={[{ required: true, message: 'Vui lòng chọn ngày nghỉ' }]}>
          <BoundedDateStringPicker minDate={minDate} maxDate={maxDate} />
        </Form.Item>
        <Form.Item name="reason" label="Lý do xin nghỉ" rules={[{ required: true, message: 'Vui lòng nhập lý do' }]}>
          <Input.TextArea rows={2} placeholder="Nêu rõ lý do xin nghỉ OFF..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}
