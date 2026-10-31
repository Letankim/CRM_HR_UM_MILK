'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Tag } from 'antd';
import { CloseOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import { ADJUSTMENT_CAUSE_OPTIONS, AdjustmentEvidenceFields, inferAdjustmentPunchType, kindFromPunchType } from './AdjustmentEvidenceFields';
import { DateStringPicker, TimeStringPicker } from './DateTimePickers';

const cleanShiftName = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();

export interface AttendanceAdjustmentModalProps {
  open: boolean;
  employeeId: string;
  shifts?: Record<string, unknown>[];
  initialShiftId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function AttendanceAdjustmentModal({
  open, employeeId, shifts, initialShiftId, onClose, onSuccess,
}: AttendanceAdjustmentModalProps) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const { options: shiftOptions } = useShiftTemplates();

  const cachedMyAtt = qc.getQueryData<{ shifts?: Record<string, unknown>[] }>(['my-attendance']);
  const todayStr = dayjs().format('YYYY-MM-DD');
  const isForgotOutShift = (s: Record<string, unknown>) =>
    Boolean(s.isForgotCheckout) || Boolean(s.checkInEvent && !s.checkOutEvent) || String(s.attendanceStatusLabel || '').includes('Quên Ra ca');
  const isCheckInIncidentShift = (s: Record<string, unknown>) =>
    s.status === 'PUBLISHED' && !s.checkInEvent && !s.isAbsentShift && !s.isExpiredToday && (Boolean(s.isToday) || String(s.workDate || s.work_date) <= todayStr);
  const isShiftNeedsSupplement = (s: Record<string, unknown>) =>
    !s.pendingAdjustmentCode &&
    !String(s.attendanceStatusLabel || '').includes('Đã gửi bù công') &&
    (s.status === 'ABSENT' || Boolean(s.isAbsentShift) || isForgotOutShift(s) || isCheckInIncidentShift(s) || (s.status === 'PUBLISHED' && !s.checkInEvent && Boolean(s.isExpiredToday)));

  const absentShifts = useMemo(() => {
    const raw = shifts && shifts.length > 0 ? shifts : (cachedMyAtt?.shifts ?? []);
    return raw
      .filter((s) => s.status !== 'DRAFT' && s.dayType !== 'OFF' && s.status !== 'ON_LEAVE' && s.status !== 'COMPLETED' && isShiftNeedsSupplement(s))
      .sort((a, b) => String(b.workDate || b.work_date).localeCompare(String(a.workDate || a.work_date)));
  }, [shifts, cachedMyAtt?.shifts]);

  const watchedDate = Form.useWatch('work_date', form) || dayjs().format('YYYY-MM-DD');
  const watchedAssignId = Form.useWatch('assignment_id', form) || '';
  const selectedShift = useMemo(
    () => (watchedAssignId ? absentShifts.find((s) => String(s.id) === String(watchedAssignId)) ?? null : null),
    [absentShifts, watchedAssignId],
  );
  const isShiftLocked = Boolean(selectedShift);

  const absentShiftsForSelectedDate = useMemo(
    () => absentShifts.filter((s) => String(s.workDate || s.work_date) === watchedDate),
    [absentShifts, watchedDate],
  );

  const applyShiftToForm = (s: Record<string, unknown>) => {
    const wDate = String(s.workDate || s.work_date || dayjs().format('YYYY-MM-DD'));
    const sCode = String(s.shiftCode || s.shift_code || 'CA_SANG');
    const inEv = s.checkInEvent as { checkTimeHm?: string; checkTimeFormatted?: string } | null | undefined;
    const forgotOut = isForgotOutShift(s);
    const startAt = (forgotOut && (inEv?.checkTimeHm || String(inEv?.checkTimeFormatted || '').slice(0, 5))) || String(s.startAt || s.start_at || '07:00');
    const endAt = String(s.endAt || s.end_at || '12:00');
    const hours = Number(s.scheduledHours || s.scheduled_hours || 5);
    const punchType = inferAdjustmentPunchType(s);
    form.setFieldsValue({
      assignment_id: String(s.id),
      work_date: wDate,
      shift_code: sCode,
      kind: kindFromPunchType(punchType),
      punch_type: punchType,
      requested_check_in_at: startAt,
      requested_check_out_at: endAt,
      requested_hours: hours,
      reason: punchType === 'CHECK_IN'
        ? 'Lỗi chấm công Vào ca tại cửa hàng — gửi ảnh minh chứng để HR xác nhận Vào ca thành công'
        : forgotOut
          ? 'Đã điểm danh Vào ca nhưng lỗi / quá hạn chấm công Ra ca — gửi ảnh minh chứng để HR xác nhận hoàn thành ca'
          : 'Bổ sung công bù ca bị đánh dấu Vắng mặt do quên điểm danh đúng giờ',
    });
  };

  useEffect(() => {
    if (!open) return;
    form.setFieldValue('evidence_photo_base64', undefined);
    const preset = (initialShiftId ? absentShifts.find((s) => String(s.id) === String(initialShiftId)) : undefined) ?? absentShifts[0];
    if (preset) {
      applyShiftToForm(preset);
    } else {
      form.setFieldsValue({
        assignment_id: undefined,
        work_date: dayjs().format('YYYY-MM-DD'),
        shift_code: undefined,
        kind: 'FORGOT_CHECK_IN',
        punch_type: 'FULL_SHIFT',
        requested_check_in_at: undefined,
        requested_check_out_at: undefined,
        requested_hours: undefined,
        reason: 'Bổ sung công bù ca bị đánh dấu Vắng mặt do quên điểm danh đúng giờ',
      });
    }
  }, [open, initialShiftId, absentShifts.length]);

  const shiftSelectOptions = useMemo(() => {
    const formatShiftOption = (s: Record<string, unknown>) => {
      const wDate = dayjs(String(s.workDate || s.work_date)).format('DD/MM/YYYY');
      const tag = isForgotOutShift(s) ? '[Lỗi / Quên Ra ca]' : isCheckInIncidentShift(s) ? '[Lỗi Vào ca hôm nay]' : '[Vắng mặt — Cần bù công]';
      return {
        value: String(s.id),
        label: `${tag} ${wDate} · ${cleanShiftName(s.shiftLabel || s.shift_code)} (${String(s.startAt || '07:00')} – ${String(s.endAt || '12:00')} · ${Number(s.scheduledHours || 5)}h)`,
      };
    };
    return absentShiftsForSelectedDate.map(formatShiftOption);
  }, [absentShiftsForSelectedDate]);

  const handleSubmit = async () => {
    try {
      const vals = await form.validateFields();
      setLoading(true);
      await api.post('/admin/attendance/adjustments', { ...vals, employee_id: employeeId });
      message.success('Đã gửi phiếu lỗi chấm công / bổ sung công kèm ảnh minh chứng thành công');
      form.resetFields(); onSuccess(); onClose();
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.details.length > 0) form.setFields(e.details.map((d) => ({ name: d.field, errors: [d.message] })));
        message.error(e.message);
      }
    }
    finally { setLoading(false); }
  };

  return (
    <Modal
      width="min(840px, 94vw)" open={open} forceRender title="Gửi phiếu lỗi chấm công / bổ sung công"
      onCancel={onClose} onOk={handleSubmit} confirmLoading={loading}
      okText="Gửi phiếu bổ sung công" cancelText="Đóng"
      okButtonProps={{ icon: <SendOutlined />, disabled: !isShiftLocked }} cancelButtonProps={{ icon: <CloseOutlined /> }}
    >
      {absentShifts.length === 0 ? (
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="Bạn hiện không có ca làm việc nào ở trạng thái Vắng mặt cần bù công."
        />
      ) : (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>Ca cần bổ sung công ({absentShifts.length} ca):</div>
          <Space size={6} wrap>
            {absentShifts.slice(0, 6).map((s) => (
              <Tag key={String(s.id)} color={String(s.id) === String(watchedAssignId) ? 'blue' : 'red'} style={{ margin: 0, cursor: 'pointer', fontWeight: 600 }} onClick={() => applyShiftToForm(s)}>
                {dayjs(String(s.workDate || s.work_date)).format('DD/MM/YYYY')} · {cleanShiftName(s.shiftLabel || s.shift_code)} ({String(s.startAt || '07:00')}–{String(s.endAt || '12:00')})
              </Tag>
            ))}
          </Space>
        </div>
      )}
      <Form
        form={form} layout="vertical"
        onValuesChange={(changed) => {
          if (changed.work_date && !isShiftLocked) {
            const matching = absentShifts.filter((s) => String(s.workDate || s.work_date) === String(changed.work_date));
            if (matching[0]) applyShiftToForm(matching[0]);
            else form.setFieldsValue({ assignment_id: undefined, shift_code: undefined, requested_check_in_at: undefined, requested_check_out_at: undefined, requested_hours: undefined });
          } else if (changed.assignment_id !== undefined) {
            const found = absentShifts.find((s) => String(s.id) === String(changed.assignment_id));
            if (found) applyShiftToForm(found);
            else form.setFieldsValue({ shift_code: undefined, requested_check_in_at: undefined, requested_check_out_at: undefined, requested_hours: undefined });
          }
        }}
      >
        <Row gutter={12}>
          <Col xs={24} md={10}>
            <Form.Item
              name="work_date"
              label={<Space size={6}><span>1. Chọn ngày ca làm việc</span>{isShiftLocked && <Button type="link" size="small" icon={<ReloadOutlined />} style={{ padding: 0, height: 18, fontSize: 11 }} onClick={() => form.setFieldsValue({ assignment_id: undefined, shift_code: undefined, requested_check_in_at: undefined, requested_check_out_at: undefined, requested_hours: undefined })}>Chọn lại ngày</Button>}</Space>}
              rules={[{ required: true, message: 'Vui lòng chọn ngày công' }]}
            >
              <DateStringPicker disabled={isShiftLocked} />
            </Form.Item>
          </Col>
          <Col xs={24} md={14}>
            <Form.Item name="assignment_id" label={`2. Ca cần báo lỗi chấm công / bổ sung công (${absentShiftsForSelectedDate.length} ca)`} rules={[{ required: true, message: 'Vui lòng chọn ca cần báo lỗi / bổ sung công' }]}>
              <Select
                allowClear showSearch optionFilterProp="label" options={shiftSelectOptions}
                placeholder={absentShiftsForSelectedDate.length > 0 ? 'Chọn ca cần báo lỗi Vào/Ra ca hoặc bù công' : 'Ngày đã chọn không có ca nào cần báo lỗi / bù công'}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={12}><Form.Item name="shift_code" label="Khung ca" rules={[{ required: true }]}><Select options={shiftOptions} disabled placeholder="Theo ca đã chọn" /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="kind" label="Nguyên nhân sự cố" rules={[{ required: true }]}><Select options={ADJUSTMENT_CAUSE_OPTIONS} /></Form.Item></Col>
        </Row>
        <AdjustmentEvidenceFields />
        <Row gutter={12}>
          <Col xs={12} md={8}><Form.Item name="requested_check_in_at" label="Giờ vào ca" rules={[{ required: true }]}><TimeStringPicker disabled /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="requested_check_out_at" label="Giờ ra ca" rules={[{ required: true }]}><TimeStringPicker disabled /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="requested_hours" label="Giờ công" rules={[{ required: true }]}><InputNumber min={0.5} max={16} step={0.5} style={{ width: '100%' }} suffix="giờ" disabled /></Form.Item></Col>
        </Row>
        <Form.Item name="reason" label="Lý do giải trình bổ sung công" rules={[{ required: true, message: 'Vui lòng nhập lý do giải trình' }]}>
          <Input.TextArea rows={2} placeholder="Nêu rõ lý do cần bù ca vắng mặt để Cửa hàng xác nhận và HR phê duyệt..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}
