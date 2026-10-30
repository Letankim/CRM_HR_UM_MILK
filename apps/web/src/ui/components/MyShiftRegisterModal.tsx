'use client';

import { useEffect } from 'react';
import { Alert, App, Form, Input, Modal, Select } from 'antd';
import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import { DateStringPicker } from './DateTimePickers';

interface ShiftAvailabilityResult {
  branchId: string;
  branchName: string;
  workDate: string;
  shiftCode: string;
  shiftLabel: string;
  approvedCount: number;
  pendingDraftCount: number;
  minStaff: number | null;
  maxStaff: number | null;
  isFullOrExceeded: boolean;
  alreadyHasShift: boolean;
  hasOverlappingShift: boolean;
  canRegister: boolean;
  message: string;
}

export function MyShiftRegisterModal({
  open, todayDate, onClose, onCreated,
}: { open: boolean; todayDate: string; onClose: () => void; onCreated: (createdId?: string) => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const { options: shiftOptions, endTimeMap } = useShiftTemplates();
  const watchedDate = String(Form.useWatch('work_date', form) || todayDate);
  const watchedShift = String(Form.useWatch('shift_code', form) || '');
  const nowHm = dayjs().format('HH:mm');
  const isTodaySelected = watchedDate === todayDate;
  const cachedShifts = qc.getQueryData<{ shifts?: Record<string, unknown>[] }>(['my-attendance'])?.shifts ?? [];

  const shiftOptionsForDate = shiftOptions.map((opt) => {
    const endHm = endTimeMap[opt.value] || '12:00';
    const isPassed = isTodaySelected && nowHm >= endHm;
    const existing = cachedShifts.find(
      (s) => String(s.workDate || s.work_date) === watchedDate && String(s.shiftCode || s.shift_code) === opt.value,
    );
    const disabled = isPassed || Boolean(existing);
    const suffix = existing
      ? ` — Đã đăng ký (${existing.status === 'DRAFT' ? 'Chờ duyệt' : 'Đã phân ca'})`
      : isPassed
        ? ' — Đã qua giờ ca hôm nay'
        : '';
    return { value: opt.value, disabled, label: `${opt.label}${suffix}` };
  });
  const availableToday = shiftOptions.filter((opt) => nowHm < (endTimeMap[opt.value] || '12:00'));

  const availQ = useQuery({
    queryKey: ['shift-availability', watchedDate, watchedShift],
    queryFn: () =>
      api.get<ShiftAvailabilityResult>(
        `/my-attendance/shift-availability?work_date=${encodeURIComponent(watchedDate)}&shift_code=${encodeURIComponent(watchedShift)}`,
      ),
    enabled: Boolean(open && /^\d{4}-\d{2}-\d{2}$/.test(watchedDate) && watchedShift),
    retry: false,
  });
  const avail = availQ.data;

  useEffect(() => {
    if (!open || !avail) return;
    if (!avail.canRegister) {
      message.warning({ key: 'shift-cap-warn', content: avail.message });
    }
  }, [open, avail?.workDate, avail?.shiftCode, avail?.canRegister, avail?.message, message]);

  useEffect(() => {
    if (!open || shiftOptions.length === 0) return;
    const currentHm = dayjs().format('HH:mm');
    const firstValidToday = shiftOptions.find((opt) => currentHm < (endTimeMap[opt.value] || '12:00'));
    const initDate = firstValidToday ? todayDate : dayjs(todayDate).add(1, 'day').format('YYYY-MM-DD');
    const firstFreeShift = shiftOptions.find((opt) => {
      if (initDate === todayDate && currentHm >= (endTimeMap[opt.value] || '12:00')) return false;
      return !cachedShifts.some((s) => String(s.workDate || s.work_date) === initDate && String(s.shiftCode || s.shift_code) === opt.value);
    });
    form.setFieldsValue({
      work_date: initDate,
      shift_code: firstFreeShift?.value ?? firstValidToday?.value ?? (shiftOptions[0]?.value || 'CA_SANG'),
      note: 'Đăng ký ca làm việc cá nhân',
    });
  }, [open, todayDate, shiftOptions, endTimeMap, form]);

  const createShiftMut = useMutation({
    mutationFn: (body: unknown) => api.post<{ id: string }>('/my-attendance/shifts', body),
    onSuccess: (created) => {
      message.success('Đã gửi đăng ký ca làm việc (Chờ Quản lý cửa hàng / HR duyệt phân ca)');
      void qc.invalidateQueries({ queryKey: ['shift-availability'] });
      onCreated(created?.id ? String(created.id) : undefined);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.details.length > 0) {
        form.setFields(e.details.map((d) => ({ name: d.field, errors: [d.message] })));
      }
      message.error(e instanceof ApiClientError ? e.message : 'Không thể đăng ký ca làm việc');
    },
  });

  const isSubmitBlocked = availQ.isFetching || Boolean(avail && !avail.canRegister);

  return (
    <Modal
      width={640} open={open} forceRender destroyOnHidden title="Đăng ký ca làm việc cá nhân"
      onCancel={onClose} onOk={() => form.submit()} okText="Gửi đăng ký ca" cancelText="Hủy bỏ"
      okButtonProps={{ icon: <PlusOutlined />, loading: createShiftMut.isPending || availQ.isFetching, disabled: isSubmitBlocked }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
    >
      {isTodaySelected && availableToday.length === 0 && (
        <Alert type="warning" showIcon style={{ marginBottom: 10 }} message={`Tất cả các khung ca trong ngày hôm nay (${dayjs(todayDate).format('DD/MM/YYYY')}) đã trôi qua (hiện tại ${nowHm}). Vui lòng chọn ngày làm việc từ ngày mai trở đi.`} />
      )}
      {avail && (
        <Alert
          type={avail.canRegister ? 'info' : 'error'}
          showIcon
          style={{ marginBottom: 10 }}
          message={avail.message}
        />
      )}
      <Form
        form={form} layout="vertical" style={{ marginTop: 8 }} onFinish={(v) => createShiftMut.mutate(v)}
        onValuesChange={(changed) => {
          if (changed.work_date === todayDate) {
            const firstOk = shiftOptions.find((opt) => dayjs().format('HH:mm') < (endTimeMap[opt.value] || '12:00'));
            if (firstOk) form.setFieldValue('shift_code', firstOk.value);
          }
        }}
      >
        <Form.Item name="work_date" label="Ngày đăng ký làm việc" rules={[{ required: true, message: 'Vui lòng chọn ngày làm việc' }]}><DateStringPicker minDate={todayDate} /></Form.Item>
        <Form.Item name="shift_code" label="Khung ca đăng ký" rules={[{ required: true, message: 'Vui lòng chọn khung ca' }, { validator: async (_, val) => { const endHm = endTimeMap[String(val)] || '12:00'; if (form.getFieldValue('work_date') === todayDate && dayjs().format('HH:mm') >= endHm) throw new Error(`Khung ca này trong ngày hôm nay đã kết thúc lúc ${endHm}, vui lòng chọn ca khác hoặc ngày tiếp theo`); } }]}><Select options={shiftOptionsForDate} /></Form.Item>
        <Form.Item name="note" label="Ghi chú ca làm việc"><Input placeholder="Ví dụ: Trực quản lý cửa hàng, ca sáng..." /></Form.Item>
      </Form>
    </Modal>
  );
}
