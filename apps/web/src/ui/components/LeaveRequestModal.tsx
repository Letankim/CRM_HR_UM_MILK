'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Select, Space, Tag } from 'antd';
import { CalendarOutlined, CheckCircleOutlined, CloseOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { DEFAULT_OPERATION_SETTINGS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useMyAttendanceExtras, useOffWindow } from './self-attendance-shared';

const fmt = (d?: string) => (d ? dayjs(d).format('DD/MM/YYYY') : '—');
const DOW_VI = ['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

export interface LeaveRequestModalProps {
  open: boolean; employeeId: string; stage?: string; onClose: () => void; onSuccess: () => void;
}

/** Đăng ký nghỉ OFF: Chọn 1 lần tối đa số ngày cho phép, duyệt tự động ngay lập tức theo cơ chế Ai đăng ký trước được trước. */
export function LeaveRequestModal({ open, employeeId, stage, onClose, onSuccess }: LeaveRequestModalProps) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<{ leave_dates: string[]; reason: string }>();
  const [loading, setLoading] = useState(false);
  const myQ = useMyAttendanceExtras(open);
  const winQ = useOffWindow(open);
  const draftKey = `umbm_leave_draft_${employeeId || 'me'}`;

  const isProbation = (stage || myQ.data?.profile?.stage) === 'PROBATION';
  const isOffice = Boolean(myQ.data?.profile?.isOffice || myQ.data?.profile?.defaultShiftCode === 'HANH_CHINH');
  const win = winQ.data ?? myQ.data?.offWindow;
  const weeklyLimit = winQ.data?.officialWeeklyOffLimit ?? DEFAULT_OPERATION_SETTINGS.officialWeeklyOffLimit;
  const cycle = myQ.data?.probationCycle ?? null;
  const today = dayjs().format('YYYY-MM-DD');
  const minDate = isProbation ? (cycle ? (cycle.start > today ? cycle.start : today) : today) : win?.targetWeekStart;
  const maxDate = isProbation ? cycle?.end : win?.targetWeekEnd;
  const maxLimit = isProbation ? (cycle?.offLimit ?? (isOffice ? 2 : 5)) : weeklyLimit;
  const takenOffByDate = useMemo(() => myQ.data?.takenOffByDate ?? {}, [myQ.data?.takenOffByDate]);

  const myRegisteredDates = useMemo(() => {
    const set = new Set<string>();
    for (const l of (myQ.data?.leaves ?? []) as Array<{ leave_date?: string; status?: string }>) {
      if (!l.leave_date || l.status === 'REJECTED' || l.status === 'CANCELLED') continue;
      if ((!minDate || l.leave_date >= minDate) && (!maxDate || l.leave_date <= maxDate)) set.add(l.leave_date);
    }
    return set;
  }, [myQ.data?.leaves, minDate, maxDate]);

  const usedCount = isProbation ? Math.max(cycle?.offCount ?? 0, myRegisteredDates.size) : myRegisteredDates.size;
  const remainingQuota = Math.max(0, maxLimit - usedCount);
  const cycleFull = remainingQuota <= 0;

  const dateItems = useMemo(() => {
    if (!minDate || !maxDate || minDate > maxDate) return [];
    const list: { date: string; dow: string; label: string; isMine: boolean; takenBy: string; disabled: boolean }[] = [];
    let cur = dayjs(minDate);
    const end = dayjs(maxDate);
    while (!cur.isAfter(end, 'day')) {
      const d = cur.format('YYYY-MM-DD'), dow = DOW_VI[cur.day()] ?? '';
      const isMine = myRegisteredDates.has(d), takenBy = takenOffByDate[d] || '';
      const statusText = isMine ? ' — [Bạn đã đăng ký]' : takenBy ? ` — [Đã kín: ${takenBy} cùng ca đã đăng ký]` : ' — [Còn trống]';
      list.push({ date: d, dow, label: `${dow} (${cur.format('DD/MM/YYYY')})${statusText}`, isMine, takenBy, disabled: isMine || Boolean(takenBy) });
      cur = cur.add(1, 'day');
    }
    return list;
  }, [minDate, maxDate, myRegisteredDates, takenOffByDate]);

  const blockedReason = isProbation
    ? (!cycle ? 'Chưa xác định được chu kỳ thử việc của bạn.' : cycle.isLocked ? 'Chu kỳ thử việc đã được HR chốt lịch, không thể đăng ký thêm ngày OFF.' : cycleFull ? `Bạn đã đăng ký đủ ${maxLimit} ngày OFF trong chu kỳ.` : minDate && maxDate && minDate > maxDate ? 'Chu kỳ thử việc hiện tại đã kết thúc.' : '')
    : (!win ? 'Đang tải trạng thái cổng đăng ký OFF...' : !win.isOpen ? 'Cổng đăng ký nghỉ OFF đang đóng.' : cycleFull ? `Bạn đã đăng ký đủ ${maxLimit} ngày OFF cho tuần này.` : '');
  const isBlocked = Boolean(blockedReason);
  const selectedDates = (Form.useWatch('leave_dates', form) as string[] | undefined) ?? [];

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const freeDates = dateItems.filter((x) => !x.disabled).map((x) => x.date);
    const defaultPick = freeDates.slice(0, Math.min(1, remainingQuota));
    const base = { leave_dates: defaultPick, reason: 'Xin nghỉ OFF theo định mức' };
    try {
      const saved = window.localStorage.getItem(draftKey);
      const parsed = saved ? (JSON.parse(saved) as { leave_dates?: string[]; leave_date?: string; reason?: string }) : {};
      const rawDates = Array.isArray(parsed.leave_dates) ? parsed.leave_dates : parsed.leave_date ? [parsed.leave_date] : [];
      const validSaved = rawDates.filter((d) => freeDates.includes(d)).slice(0, remainingQuota);
      form.setFieldsValue({ reason: parsed.reason || base.reason, leave_dates: validSaved.length > 0 ? validSaved : base.leave_dates });
    } catch { form.setFieldsValue(base); }
  }, [open, draftKey, form, dateItems, remainingQuota]);

  const toggleDate = (date: string) => {
    if (isBlocked) return;
    const cur = [...selectedDates];
    if (cur.includes(date)) {
      form.setFieldValue('leave_dates', cur.filter((x) => x !== date));
    } else {
      if (cur.length >= remainingQuota) {
        message.warning(`Bạn chỉ còn chọn được tối đa ${remainingQuota} ngày OFF trong kỳ này`);
        return;
      }
      form.setFieldValue('leave_dates', [...cur, date].sort());
    }
  };

  const handleSaveDraft = () => {
    if (typeof window !== 'undefined') window.localStorage.setItem(draftKey, JSON.stringify(form.getFieldsValue()));
    message.success('Đã lưu nháp đơn đăng ký nghỉ OFF trên thiết bị');
    onClose();
  };

  const handleSubmit = async () => {
    try {
      const vals = await form.validateFields();
      const dates = (vals.leave_dates ?? []).slice(0, remainingQuota);
      if (dates.length === 0) { message.warning('Vui lòng chọn ít nhất 1 ngày nghỉ OFF'); return; }
      setLoading(true);
      await api.post('/admin/leave-requests', { employee_id: employeeId, leave_dates: dates, leave_date: dates[0], reason: vals.reason });
      message.success(`Đã đăng ký ${dates.length} ngày nghỉ OFF thành công`);
      if (typeof window !== 'undefined') window.localStorage.removeItem(draftKey);
      void qc.invalidateQueries({ queryKey: ['off-window'] });
      void qc.invalidateQueries({ queryKey: ['my-attendance'] });
      form.resetFields(); onSuccess(); onClose();
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.details.length > 0) form.setFields([{ name: 'leave_dates', errors: e.details.map((d) => d.message) }]);
        message.error(e.message);
      }
    } finally { setLoading(false); }
  };

  return (
    <Modal
      width={680} open={open} forceRender title="Đăng ký nghỉ OFF" onCancel={onClose}
      footer={
        <Space wrap>
          <Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
          <Button icon={<SaveOutlined />} onClick={handleSaveDraft}>Lưu nháp</Button>
          <Button type="primary" icon={<SendOutlined />} loading={loading} disabled={isBlocked || selectedDates.length === 0} onClick={handleSubmit}>
            Xác nhận đăng ký ({selectedDates.length}/{remainingQuota} ngày)
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
        <Alert
          type={isBlocked ? 'warning' : 'success'} showIcon
          message={isProbation ? (cycle ? `Chu kỳ thử việc: ${fmt(cycle.start)} – ${fmt(cycle.end)}` : 'Đăng ký nghỉ OFF chu kỳ thử việc') : (win?.message || 'Cổng đăng ký nghỉ OFF tuần')}
          description={blockedReason || `Bạn có thể chọn tối đa ${remainingQuota} ngày OFF còn lại trong kỳ.`}
        />
        <Space size={6} wrap>
          <Tag color={cycleFull ? 'red' : 'blue'} icon={<CalendarOutlined />} style={{ margin: 0, fontWeight: 600 }}>
            Đã đăng ký: {usedCount}/{maxLimit} ngày OFF · Còn được chọn: {remainingQuota} ngày
          </Tag>
          <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0, fontWeight: 600 }}>
            Đang chọn: {selectedDates.length}/{remainingQuota} ngày
          </Tag>
        </Space>
      </Space>
      <Form form={form} layout="vertical" disabled={isBlocked}>
        {dateItems.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Bấm chọn nhanh các ngày nghỉ OFF ({selectedDates.length}/{remainingQuota} ngày):</div>
            <Space size={[6, 6]} wrap>
              {dateItems.map((it) => {
                const active = selectedDates.includes(it.date);
                return (
                  <Button
                    key={it.date} size="small" type={active ? 'primary' : 'default'} disabled={it.disabled}
                    danger={Boolean(it.takenBy)} onClick={() => toggleDate(it.date)}
                  >
                    {it.dow} ({dayjs(it.date).format('DD/MM')})
                    {it.isMine ? ' · Đã ĐK' : it.takenBy ? ` · Kín (${it.takenBy})` : ''}
                  </Button>
                );
              })}
            </Space>
          </div>
        )}
        <Form.Item
          name="leave_dates"
          label={`Danh sách ngày nghỉ OFF đăng ký (Tối đa ${remainingQuota} ngày)`}
          rules={[{ required: true, type: 'array', min: 1, message: 'Vui lòng chọn ít nhất 1 ngày nghỉ OFF' }]}
        >
          <Select
            mode="multiple" maxCount={remainingQuota || 1} placeholder="Chọn 1 hoặc nhiều ngày nghỉ OFF còn trống..."
            options={dateItems.map((it) => ({ value: it.date, label: it.label, disabled: it.disabled }))}
          />
        </Form.Item>
        <Form.Item name="reason" label="Lý do xin nghỉ" rules={[{ required: true, message: 'Vui lòng nhập lý do' }]}>
          <Input.TextArea rows={2} placeholder="Nêu rõ lý do xin nghỉ OFF..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}
