'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Tag } from 'antd';
import { CloseOutlined, SendOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { DEFAULT_SHIFT_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { DateStringPicker, TimeStringPicker } from './DateTimePickers';

const SHIFT_OPTIONS = [...DEFAULT_SHIFT_OPTIONS];
const KIND_OPTIONS = [
  { value: 'FORGOT_CHECK_IN', label: 'Bù ca Vắng mặt / Quên chấm công Vào ca' },
  { value: 'FORGOT_CHECK_OUT', label: 'Quên chấm công Ra ca' },
  { value: 'GPS_ERROR', label: 'Thiết bị lỗi định vị GPS tại cửa hàng' },
  { value: 'CAMERA_ERROR', label: 'Thiết bị lỗi Camera không chụp được ảnh' },
  { value: 'OTHER', label: 'Lý do công việc / Điều động khác' },
];

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

  const cachedMyAtt = qc.getQueryData<{ shifts?: Record<string, unknown>[] }>(['my-attendance']);
  const allShifts = useMemo(() => {
    const raw = shifts && shifts.length > 0 ? shifts : (cachedMyAtt?.shifts ?? []);
    return raw.filter((s) => s.status !== 'DRAFT' && s.dayType !== 'OFF' && s.status !== 'ON_LEAVE');
  }, [shifts, cachedMyAtt?.shifts]);

  const isShiftAbsent = (s: Record<string, unknown>) =>
    s.status === 'ABSENT' || Boolean(s.isAbsentShift) || (s.status === 'PUBLISHED' && !s.checkInEvent && Boolean(s.isExpiredToday));

  const isShiftIncomplete = (s: Record<string, unknown>) =>
    isShiftAbsent(s) || (s.status === 'PUBLISHED' && (!s.checkInEvent || !s.checkOutEvent));

  const absentShifts = useMemo(
    () => allShifts.filter(isShiftAbsent).sort((a, b) => String(b.workDate || b.work_date).localeCompare(String(a.workDate || a.work_date))),
    [allShifts],
  );

  const watchedDate = Form.useWatch('work_date', form) || dayjs().format('YYYY-MM-DD');

  const shiftsForSelectedDate = useMemo(() => {
    return allShifts
      .filter((s) => String(s.workDate || s.work_date) === watchedDate)
      .sort((a, b) => (isShiftAbsent(b) ? 1 : 0) - (isShiftAbsent(a) ? 1 : 0));
  }, [allShifts, watchedDate]);

  const applyShiftToForm = (s: Record<string, unknown>) => {
    const wDate = String(s.workDate || s.work_date || dayjs().format('YYYY-MM-DD'));
    const sCode = String(s.shiftCode || s.shift_code || 'CA_SANG');
    const startAt = String(s.startAt || s.start_at || '07:00');
    const endAt = String(s.endAt || s.end_at || '12:00');
    const hours = Number(s.scheduledHours || s.scheduled_hours || 5);
    const absent = isShiftAbsent(s);
    form.setFieldsValue({
      assignment_id: String(s.id),
      work_date: wDate,
      shift_code: sCode,
      kind: absent ? 'FORGOT_CHECK_IN' : 'FORGOT_CHECK_OUT',
      requested_check_in_at: startAt,
      requested_check_out_at: endAt,
      requested_hours: hours,
      reason: form.getFieldValue('reason') || (absent ? 'Bổ sung công bù ca bị đánh dấu Vắng mặt do quên điểm danh đúng giờ' : 'Quên chấm công ra ca do thiết bị hết pin'),
    });
  };

  useEffect(() => {
    if (!open) return;
    const preset = (initialShiftId ? allShifts.find((s) => String(s.id) === String(initialShiftId)) : undefined)
      ?? absentShifts[0]
      ?? allShifts.find(isShiftIncomplete)
      ?? allShifts[0];
    if (preset) {
      applyShiftToForm(preset);
    } else {
      form.setFieldsValue({
        assignment_id: '',
        work_date: dayjs().format('YYYY-MM-DD'),
        shift_code: 'CA_SANG',
        kind: 'FORGOT_CHECK_IN',
        requested_check_in_at: '07:00',
        requested_check_out_at: '12:00',
        requested_hours: 5,
        reason: 'Bổ sung công ca làm việc thực tế tại cửa hàng',
      });
    }
  }, [open, initialShiftId, allShifts.length]);

  const shiftSelectOptions = useMemo(() => {
    const formatShiftOption = (s: Record<string, unknown>) => {
      const wDate = dayjs(String(s.workDate || s.work_date)).format('DD/MM/YYYY');
      const stateTag = isShiftAbsent(s)
        ? '[Vắng mặt — Cần bù công]'
        : !s.checkInEvent
          ? '[Chưa điểm danh Vào ca]'
          : !s.checkOutEvent
            ? '[Thiếu điểm danh Ra ca]'
            : '[Đã hoàn thành]';
      return {
        value: String(s.id),
        label: `${stateTag} ${wDate} · ${cleanShiftName(s.shiftLabel || s.shift_code)} (${String(s.startAt || '07:00')} – ${String(s.endAt || '12:00')} · ${Number(s.scheduledHours || 5)}h)`,
      };
    };
    const onDate = shiftsForSelectedDate.map(formatShiftOption);
    const otherAbsent = absentShifts
      .filter((s) => String(s.workDate || s.work_date) !== watchedDate)
      .map(formatShiftOption);
    return [...onDate, ...otherAbsent];
  }, [shiftsForSelectedDate, absentShifts, watchedDate]);

  const handleSubmit = async () => {
    try {
      const vals = await form.validateFields();
      setLoading(true);
      await api.post('/admin/attendance/adjustments', { ...vals, employee_id: employeeId });
      message.success('Đã gửi phiếu đề nghị bổ sung công thành công');
      form.resetFields();
      onSuccess();
      onClose();
    } catch (e) {
      if (e instanceof ApiClientError) message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal width={660} open={open} forceRender title="Gửi phiếu bổ sung công (Bù ca Vắng mặt / Quên chấm công)" onCancel={onClose} onOk={handleSubmit} confirmLoading={loading} okText="Gửi phiếu bổ sung công" cancelText="Đóng" okButtonProps={{ icon: <SendOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}>
      <Alert
        type={absentShifts.length > 0 ? 'warning' : 'info'} showIcon style={{ marginBottom: 12 }}
        message={
          absentShifts.length > 0
            ? `Bạn đang có ${absentShifts.length} ca làm việc ở trạng thái Vắng mặt (do quá giờ ca chưa điểm danh). Hãy chọn ngày hoặc chọn ca vắng mặt bên dưới để gửi phiếu bổ sung công.`
            : 'Chọn ngày làm việc để hệ thống tự động tải các ca vắng mặt hoặc thiếu chấm công trong ngày đó.'
        }
      />
      {absentShifts.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>Chọn nhanh ca Vắng mặt cần bù công:</div>
          <Space size={6} wrap>
            {absentShifts.slice(0, 6).map((s) => (
              <Tag
                key={String(s.id)} color="red" style={{ margin: 0, cursor: 'pointer', fontWeight: 600 }}
                onClick={() => applyShiftToForm(s)}
              >
                {dayjs(String(s.workDate || s.work_date)).format('DD/MM/YYYY')} · {cleanShiftName(s.shiftLabel || s.shift_code)} ({String(s.startAt || '07:00')}–{String(s.endAt || '12:00')})
              </Tag>
            ))}
          </Space>
        </div>
      )}
      <Form
        form={form} layout="vertical"
        onValuesChange={(changed) => {
          if (changed.work_date) {
            const matching = allShifts
              .filter((s) => String(s.workDate || s.work_date) === String(changed.work_date))
              .sort((a, b) => (isShiftAbsent(b) ? 1 : 0) - (isShiftAbsent(a) ? 1 : 0));
            if (matching[0]) applyShiftToForm(matching[0]);
            else form.setFieldValue('assignment_id', '');
          } else if (changed.assignment_id) {
            const found = allShifts.find((s) => String(s.id) === String(changed.assignment_id));
            if (found) applyShiftToForm(found);
          }
        }}
      >
        <Row gutter={12}>
          <Col xs={24} md={10}>
            <Form.Item name="work_date" label="1. Chọn ngày cần bổ sung công" rules={[{ required: true, message: 'Vui lòng chọn ngày công' }]}>
              <DateStringPicker />
            </Form.Item>
          </Col>
          <Col xs={24} md={14}>
            <Form.Item name="assignment_id" label={`2. Ca vắng mặt / Ca trong ngày (${shiftsForSelectedDate.length} ca)`}>
              <Select
                allowClear showSearch optionFilterProp="label" options={shiftSelectOptions}
                placeholder={shiftsForSelectedDate.length > 0 ? 'Chọn ca cần bổ sung công' : 'Không có ca phân công trong ngày này — chọn ngày khác hoặc chọn khung ca bên dưới'}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="shift_code" label="Khung ca bổ sung" rules={[{ required: true }]}>
              <Select options={SHIFT_OPTIONS} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="kind" label="Phân loại bổ sung công" rules={[{ required: true }]}>
              <Select options={KIND_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={12} md={8}>
            <Form.Item name="requested_check_in_at" label="Giờ vào thực tế" rules={[{ required: true }]}>
              <TimeStringPicker />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="requested_check_out_at" label="Giờ ra thực tế" rules={[{ required: true }]}>
              <TimeStringPicker />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="requested_hours" label="Số giờ công đề nghị" rules={[{ required: true }]}>
              <InputNumber min={0.5} max={16} step={0.5} style={{ width: '100%' }} suffix="giờ" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="reason" label="Lý do giải trình bổ sung công" rules={[{ required: true, message: 'Vui lòng nhập lý do giải trình' }]}>
          <Input.TextArea rows={2} placeholder="Nêu rõ lý do cần bù ca vắng mặt hoặc quên chấm công để Cửa hàng xác nhận và HR phê duyệt..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}
