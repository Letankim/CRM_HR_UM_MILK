'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Form, Input, Modal, Radio, Select } from 'antd';
import { CloseOutlined, SendOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { addDaysYmd, SHIFT_SWAP_KIND_LABELS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import type { ScheduleAssignmentItem } from './ScheduleFormModal';
import { cleanShiftName, type BranchPeerItem } from './self-attendance-shared';

type SwapKind = 'GIVE' | 'SWAP';

export interface ShiftSwapRequestModalProps {
  open: boolean; employeeId: string; stage?: string; shifts: Record<string, unknown>[]; peers: BranchPeerItem[];
  onClose: () => void; onSuccess: () => void;
}

const shiftLabelOf = (s: Record<string, unknown>) =>
  `${dayjs(String(s.workDate)).format('DD/MM/YYYY')} · ${cleanShiftName(s.shiftLabel)} (${String(s.startAt || '07:00')} – ${String(s.endAt || '12:00')})`;

/** Ca chưa bắt đầu (chỉ những ca này mới được nhường / đổi). */
function isUpcoming(s: Record<string, unknown>, today: string, nowHm: string) {
  const wd = String(s.workDate || '');
  return wd > today || (wd === today && nowHm < String(s.startAt || '07:00'));
}

/** Tạo yêu cầu Nhường ca (mọi nhân viên) hoặc Đổi ca 2 chiều (chỉ nhân viên chính thức, cùng chi nhánh). */
export function ShiftSwapRequestModal({ open, employeeId, stage, shifts, peers, onClose, onSuccess }: ShiftSwapRequestModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ kind: SwapKind; from_assignment_id?: string; peer_id?: string; to_assignment_id?: string; reason: string }>();
  const [loading, setLoading] = useState(false);
  const isOfficial = stage === 'OFFICIAL';
  const kind: SwapKind = Form.useWatch('kind', form) ?? 'GIVE';
  const peerId = Form.useWatch('peer_id', form);
  const fromId = Form.useWatch('from_assignment_id', form);
  const today = dayjs().format('YYYY-MM-DD'), nowHm = dayjs().format('HH:mm');

  const ownShifts = useMemo(
    () => shifts.filter((s) => s.status === 'PUBLISHED' && !s.checkInEvent && isUpcoming(s, today, nowHm)),
    [shifts, today, nowHm],
  );
  const ownOptions = ownShifts.map((s) => {
    const pending = String(s.pendingSwapCode || s.pendingLeaveCode || '');
    return { value: String(s.id), disabled: Boolean(pending), label: `${shiftLabelOf(s)}${pending ? ' · Đang có yêu cầu chờ xử lý' : ''}` };
  });
  const fromShift = ownShifts.find((s) => String(s.id) === String(fromId));
  const fromDate = String(fromShift?.workDate || '');

  const peerShiftsQ = useQuery({
    queryKey: ['swap-peer-shifts', today],
    queryFn: () => api.list<ScheduleAssignmentItem>(`/admin/schedules?per_page=1000&from_date=${today}&to_date=${addDaysYmd(today, 45)}`),
    enabled: open && kind === 'SWAP',
  });
  const peerPool = useMemo(
    () => (peerShiftsQ.data?.data ?? []).filter((a) => a.status === 'PUBLISHED' && a.employeeId !== employeeId && isUpcoming(a as unknown as Record<string, unknown>, today, nowHm)),
    [peerShiftsQ.data, employeeId, today, nowHm],
  );
  const peerShiftOptions = peerPool
    .filter((a) => a.employeeId === peerId && !a.pendingSwapCode && !a.pendingLeaveCode)
    .map((a) => ({ value: a.id, label: shiftLabelOf(a as unknown as Record<string, unknown>) }));

  const peerOptions = peers
    .filter((p) => kind === 'GIVE' || peerPool.some((a) => a.employeeId === p.id && (!a.employeeStage || a.employeeStage === 'OFFICIAL')))
    .map((p) => {
      const busy = kind === 'GIVE' && fromDate ? p.busyShiftsByDate?.[fromDate] : undefined;
      return { value: p.id, label: `${p.employeeCode} — ${p.fullName}${p.positionTitle ? ` (${p.positionTitle})` : ''}${busy ? ` · Đã có ${cleanShiftName(busy)} ngày ${dayjs(fromDate).format('DD/MM')}` : ''}` };
    });

  useEffect(() => {
    if (!open) return;
    const first = ownShifts.find((s) => !s.pendingSwapCode && !s.pendingLeaveCode);
    form.setFieldsValue({ kind: 'GIVE', from_assignment_id: first ? String(first.id) : undefined, peer_id: undefined, to_assignment_id: undefined, reason: '' });
  }, [open, ownShifts.length, form]);

  const handleSubmit = async () => {
    try {
      const vals = await form.validateFields();
      setLoading(true);
      await api.post('/admin/shift-swaps', {
        kind: vals.kind, requester_id: employeeId, peer_id: vals.peer_id, from_assignment_id: vals.from_assignment_id,
        ...(vals.kind === 'SWAP' ? { to_assignment_id: vals.to_assignment_id } : {}), reason: vals.reason,
      });
      message.success(vals.kind === 'SWAP' ? 'Đã gửi yêu cầu đổi ca 2 chiều — chờ đồng nghiệp xác nhận' : 'Đã gửi yêu cầu nhường ca — chờ người nhận xác nhận');
      form.resetFields(); onSuccess(); onClose();
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.details.length > 0) form.setFields(e.details.map((d) => ({ name: d.field as 'reason', errors: [d.message] })));
        message.error(e.message);
      }
    } finally { setLoading(false); }
  };

  return (
    <Modal
      width={640} open={open} forceRender title="Tạo yêu cầu Nhường ca / Đổi ca" onCancel={onClose} onOk={handleSubmit} confirmLoading={loading}
      okText="Gửi yêu cầu" cancelText="Đóng" okButtonProps={{ icon: <SendOutlined />, disabled: ownOptions.length === 0 }} cancelButtonProps={{ icon: <CloseOutlined /> }}
    >
      {ownOptions.length === 0 && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Bạn chưa có ca làm việc đã phát hành nào sắp tới (chưa bắt đầu) để nhường hoặc đổi." />}
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message={kind === 'SWAP' ? 'Đồng nghiệp đồng ý là lịch được đổi ngay, không cần HR duyệt.' : 'Nếu người nhận vượt 2 ca/ngày, yêu cầu sẽ chuyển HR duyệt.'}
      />
      <Form form={form} layout="vertical" initialValues={{ kind: 'GIVE' }} onValuesChange={(changed) => {
        if (changed.kind) form.setFieldsValue({ peer_id: undefined, to_assignment_id: undefined });
        if (changed.peer_id !== undefined) form.setFieldValue('to_assignment_id', undefined);
      }}>
        <Form.Item name="kind" label="Loại yêu cầu" rules={[{ required: true }]}>
          <Radio.Group optionType="button" buttonStyle="solid" options={[
            { value: 'GIVE', label: SHIFT_SWAP_KIND_LABELS.GIVE },
            { value: 'SWAP', label: SHIFT_SWAP_KIND_LABELS.SWAP, disabled: !isOfficial },
          ]} />
        </Form.Item>
        {!isOfficial && <div style={{ fontSize: 12, color: '#64748B', marginTop: -16, marginBottom: 12 }}>Đổi ca 2 chiều chỉ áp dụng cho nhân viên chính thức.</div>}
        <Form.Item name="from_assignment_id" label="Ca của bạn" rules={[{ required: true, message: 'Vui lòng chọn ca của bạn' }]}>
          <Select showSearch optionFilterProp="label" options={ownOptions} placeholder="Chọn ca đã phát hành, chưa bắt đầu" />
        </Form.Item>
        <Form.Item name="peer_id" label={kind === 'SWAP' ? 'Đồng nghiệp đổi ca' : 'Đồng nghiệp nhận ca'} rules={[{ required: true, message: 'Vui lòng chọn đồng nghiệp' }]}>
          <Select showSearch optionFilterProp="label" options={peerOptions} loading={kind === 'SWAP' && peerShiftsQ.isLoading} placeholder="Chọn đồng nghiệp cùng chi nhánh" notFoundContent="Không có đồng nghiệp phù hợp" />
        </Form.Item>
        {kind === 'SWAP' && (
          <Form.Item name="to_assignment_id" label="Ca của đồng nghiệp nhận về" rules={[{ required: true, message: 'Vui lòng chọn ca của đồng nghiệp' }]}>
            <Select showSearch optionFilterProp="label" options={peerShiftOptions} disabled={!peerId} loading={peerShiftsQ.isFetching} placeholder={peerId ? 'Chọn ca đã phát hành của đồng nghiệp' : 'Chọn đồng nghiệp trước'} notFoundContent="Đồng nghiệp chưa có ca phù hợp" />
          </Form.Item>
        )}
        <Form.Item name="reason" label="Lý do" rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập lý do' }]}>
          <Input.TextArea rows={2} placeholder="Nêu rõ lý do để đồng nghiệp xác nhận..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}
