'use client';

import { useEffect, useState } from 'react';
import { App, Button, Card, Col, Descriptions, Empty, Form, Input, InputNumber, Modal, Row, Select, Space, Tag, Typography } from 'antd';
import { CameraOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseOutlined, EnvironmentOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import { BRAND } from '../theme';
import { AttendanceCameraModal } from './AttendanceCameraModal';
import type { AttendanceEventRow } from './AttendanceEventsTable';
import { DateStringPicker, TimeStringPicker } from './DateTimePickers';
import { FancyboxImage, type FancyboxSlideItem } from './FancyboxPreview';

interface DetailProps {
  event: AttendanceEventRow | null;
  onClose: () => void;
}

function renderCheckEventPane(ev: AttendanceEventRow | null | undefined, kind: 'CHECK_IN' | 'CHECK_OUT', gallerySlides: FancyboxSlideItem[], canViewMedia: boolean) {
  const isCheckIn = kind === 'CHECK_IN';
  const titleLabel = isCheckIn ? 'Chi tiết Vào ca (Check-In)' : 'Chi tiết Ra ca (Check-Out)';
  const slideIdx = ev?.photoUrl ? Math.max(0, gallerySlides.findIndex((s) => s.src === ev.photoUrl)) : 0;
  return (
    <Card
      size="small" styles={{ body: { padding: 10 } }}
      title={<Space size={6}><Tag color={isCheckIn ? 'blue' : 'purple'} style={{ margin: 0 }}>{isCheckIn ? 'Vào ca' : 'Ra ca'}</Tag><Typography.Text strong style={{ fontSize: 13 }}>{titleLabel}</Typography.Text></Space>}
    >
      {!ev ? (
        <div style={{ padding: '24px 12px', textAlign: 'center' }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={isCheckIn ? 'Chưa có dữ liệu điểm danh Vào ca' : 'Nhân sự chưa điểm danh Ra ca (Đang trong ca)'} />
        </div>
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {canViewMedia && (
            <div style={{ background: '#0F172A', borderRadius: 4, padding: 0, overflow: 'hidden', textAlign: 'center', border: `1px solid ${BRAND.border}` }}>
              {ev.photoUrl ? (
                <FancyboxImage src={ev.photoUrl} alt={titleLabel} caption={`${titleLabel} — ${ev.employeeName || ''} (${ev.checkTimeFormatted || ev.checkTimeHm || ''})`} gallerySlides={gallerySlides} slideIndex={slideIdx} height={180} />
              ) : (
                <div style={{ height: 180, display: 'grid', placeItems: 'center', color: '#94A3B8' }}><div><CameraOutlined style={{ fontSize: 24 }} /><div>Ảnh xác thực Camera</div></div></div>
              )}
            </div>
          )}
          <Descriptions column={1} bordered size="small" styles={{ label: { width: 102, whiteSpace: 'nowrap', padding: '6px 10px' }, content: { padding: '6px 10px' } }}>
            <Descriptions.Item label="Thời gian">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <Typography.Text strong className="num">{ev.checkTimeFormatted || ev.checkTimeHm || '—'}</Typography.Text>
                <Tag color={ev.punctualityStatus === 'LATE' ? 'volcano' : ev.punctualityStatus === 'EARLY_LEAVE' ? 'orange' : 'green'} icon={ev.punctualityStatus === 'ON_TIME' ? <CheckCircleOutlined /> : <ClockCircleOutlined />} style={{ margin: 0, fontWeight: 600 }}>{ev.punctualityLabel || 'Đúng giờ'}</Tag>
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="Vị trí GPS">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                <Tag color="green" icon={<EnvironmentOutlined />} style={{ margin: 0 }}>Cách CH {Number(ev.distance_m ?? 0)}m · Hợp lệ</Tag>
                {canViewMedia && ev.lat !== undefined && ev.lng !== undefined && <Button size="small" type="link" icon={<EnvironmentOutlined />} style={{ padding: 0, height: 20, fontSize: 12 }} href={`https://www.google.com/maps?q=${Number(ev.lat)},${Number(ev.lng)}`} target="_blank" rel="noopener noreferrer">Xem trên Google Maps</Button>}
              </div>
              {canViewMedia && ev.lat !== undefined && ev.lng !== undefined && <div className="mono" style={{ fontSize: 11, color: BRAND.textSecondary, marginTop: 3 }}>Tọa độ thiết bị: ({Number(ev.lat).toFixed(5)}, {Number(ev.lng).toFixed(5)})</div>}
            </Descriptions.Item>
          </Descriptions>
        </Space>
      )}
    </Card>
  );
}

export function AttendanceEventDetailModal({ event, onClose }: DetailProps) {
  const can = useCan(), canViewMedia = can('attendance.media.read', 'self.attendance');
  const inEv = event ? (event.checkInEvent ?? (event.type === 'CHECK_IN' ? event : null)) : null;
  const outEv = event ? (event.checkOutEvent ?? (event.type === 'CHECK_OUT' ? event : null)) : null;
  const hasBranchCoords = event?.branchLat !== undefined && event?.branchLat !== null && event?.branchLng !== undefined && event?.branchLng !== null;
  const gallerySlides: FancyboxSlideItem[] = [
    ...(inEv?.photoUrl ? [{ src: inEv.photoUrl, caption: `Vào ca (Check-In) — ${event?.employeeName || ''} · ${inEv.checkTimeFormatted || inEv.checkTimeHm || ''} · Cách CH ${Number(inEv.distance_m ?? 0)}m` }] : []),
    ...(outEv?.photoUrl ? [{ src: outEv.photoUrl, caption: `Ra ca (Check-Out) — ${event?.employeeName || ''} · ${outEv.checkTimeFormatted || outEv.checkTimeHm || ''} · Cách CH ${Number(outEv.distance_m ?? 0)}m` }] : []),
  ];

  return (
    <Modal
      open={Boolean(event)} title={event ? `Chi tiết Điểm danh Ca làm việc — ${event.employeeName}` : 'Chi tiết Điểm danh'}
      onCancel={onClose} footer={<Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>}
      width={840} style={{ top: 18, maxWidth: '95vw' }} destroyOnHidden
    >
      {event && (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Descriptions column={1} bordered size="small" styles={{ label: { width: 135, whiteSpace: 'nowrap', padding: '6px 12px' }, content: { padding: '6px 12px' } }}>
            <Descriptions.Item label="Nhân sự & Ca làm">
              <Space size={8} wrap>
                <strong>{event.employeeName}</strong><span>·</span>
                <Tag color="blue" style={{ margin: 0 }}>{event.shiftLabel || 'Ca làm việc'} ({event.shiftTimeRange || '07:00 – 12:00'})</Tag>
                <span className="num" style={{ color: BRAND.textSecondary }}>Ngày: {event.work_date ? dayjs(event.work_date).format('DD/MM/YYYY') : '—'}</span>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Chi nhánh làm việc">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <Space size={6} wrap>
                  <strong>{event.branchName || 'Chi nhánh làm việc'}</strong>
                  {event.branchRadiusM && <Tag color="geekblue" style={{ margin: 0 }}>Bán kính {event.branchRadiusM}m</Tag>}
                  {canViewMedia && hasBranchCoords && <span className="mono" style={{ fontSize: 12, color: BRAND.textSecondary }}>Tọa độ: ({Number(event.branchLat).toFixed(5)}, {Number(event.branchLng).toFixed(5)})</span>}
                </Space>
                {canViewMedia && hasBranchCoords && (
                  <Button size="small" type="primary" ghost icon={<EnvironmentOutlined />} href={`https://www.google.com/maps?q=${Number(event.branchLat)},${Number(event.branchLng)}`} target="_blank" rel="noopener noreferrer">Xem trên Google Maps</Button>
                )}
              </div>
            </Descriptions.Item>
          </Descriptions>
          <Row gutter={[12, 12]}>
            <Col xs={24} md={12}>{renderCheckEventPane(inEv, 'CHECK_IN', gallerySlides, canViewMedia)}</Col>
            <Col xs={24} md={12}>{renderCheckEventPane(outEv, 'CHECK_OUT', gallerySlides, canViewMedia)}</Col>
          </Row>
        </Space>
      )}
    </Modal>
  );
}

interface EditProps {
  event: AttendanceEventRow | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function AttendanceEventEditModal({ event, onClose, onSuccess }: EditProps) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const selectedType = Form.useWatch('type', form) as 'CHECK_IN' | 'CHECK_OUT' | undefined;
  const { options: shiftOptions } = useShiftTemplates(event?.branch_id);

  const resolveTargetEvent = (typeVal?: 'CHECK_IN' | 'CHECK_OUT'): AttendanceEventRow | null => {
    if (!event) return null;
    if (typeVal === 'CHECK_OUT' && event.checkOutEvent) return event.checkOutEvent;
    if (typeVal === 'CHECK_IN' && event.checkInEvent) return event.checkInEvent;
    return event.checkInEvent ?? event.checkOutEvent ?? event;
  };

  useEffect(() => {
    if (!event) return;
    const initEv = event.checkInEvent ?? event.checkOutEvent ?? event;
    form.setFieldsValue({
      type: initEv.type || 'CHECK_IN', work_date: initEv.work_date || '2026-10-25', shift_code: initEv.shift_code || 'CA_SANG',
      check_time_hm: initEv.checkTimeHm || String(initEv.checkTimeFormatted || '07:00').slice(0, 5),
      distance_m: Number(initEv.distance_m ?? 10), note: initEv.note || '',
    });
  }, [event, form]);

  const handleTypeChange = (nextType: 'CHECK_IN' | 'CHECK_OUT') => {
    const target = resolveTargetEvent(nextType);
    if (!target) return;
    form.setFieldsValue({
      check_time_hm: target.checkTimeHm || String(target.checkTimeFormatted || (nextType === 'CHECK_IN' ? '07:00' : '12:00')).slice(0, 5),
      distance_m: Number(target.distance_m ?? 10), note: target.note || '',
    });
  };

  const saveMut = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      const target = resolveTargetEvent(selectedType) ?? event!;
      return api.put(`/admin/attendance/events/${target.id}`, { ...values, version: target.version ?? 1 });
    },
    onSuccess: () => { message.success('Đã cập nhật bản ghi điểm danh thành công'); onSuccess(); onClose(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể cập nhật điểm danh'),
  });

  return (
    <Modal
      open={Boolean(event)} title={event ? `Chỉnh sửa Điểm danh — ${event.employeeName}` : 'Chỉnh sửa Điểm danh'}
      onCancel={onClose} onOk={() => form.submit()} okText="Lưu cập nhật" cancelText="Hủy bỏ"
      okButtonProps={{ icon: <SaveOutlined />, loading: saveMut.isPending }} cancelButtonProps={{ icon: <CloseOutlined /> }} forceRender
    >
      <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)} style={{ marginTop: 10 }}>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="type" label="Lượt điểm danh cần sửa" rules={[{ required: true }]}><Select onChange={handleTypeChange} options={[{ value: 'CHECK_IN', label: 'Lượt Vào ca (Check-In)' }, { value: 'CHECK_OUT', label: 'Lượt Ra ca (Check-Out)', disabled: Boolean(event && !event.checkOutEvent && event.type !== 'CHECK_OUT') }]} /></Form.Item></Col>
          <Col span={12}><Form.Item name="check_time_hm" label="Giờ chấm thực tế (HH:mm)" rules={[{ required: true, pattern: /^\d{2}:\d{2}$/, message: 'Vui lòng chọn giờ chấm' }]}><TimeStringPicker placeholder="Chọn giờ chấm (HH:mm)" /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="work_date" label="Ngày ca làm việc" rules={[{ required: true }]}><DateStringPicker /></Form.Item></Col>
          <Col span={12}><Form.Item name="shift_code" label="Khung ca (theo chi nhánh)" rules={[{ required: true }]}><Select options={shiftOptions} /></Form.Item></Col>
        </Row>
        <Form.Item name="distance_m" label="Khoảng cách GPS tới cửa hàng (mét)"><InputNumber min={0} max={2000} style={{ width: '100%' }} suffix="m" /></Form.Item>
        <Form.Item name="note" label="Ghi chú kiểm tra / điều chỉnh"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}

interface CheckInLauncherProps {
  open: boolean; assignments: Record<string, unknown>[]; events: AttendanceEventRow[]; onClose: () => void; onSuccess: () => void;
}

export function BackofficeCheckInLauncherModal({ open, assignments, events, onClose, onSuccess }: CheckInLauncherProps) {
  const { message } = App.useApp();
  const todayStr = dayjs().format('YYYY-MM-DD');
  const published = assignments.filter((a) => a.status === 'PUBLISHED' || !a.status).sort((a, b) => (String(b.workDate === todayStr ? 1 : 0).localeCompare(String(a.workDate === todayStr ? 1 : 0))) || String(b.workDate || '').localeCompare(String(a.workDate || '')));
  const [shiftId, setShiftId] = useState<string>('');
  const [cameraKind, setCameraKind] = useState<'CHECK_IN' | 'CHECK_OUT' | null>(null);
  const selectedShift = published.find((a) => String(a.id) === shiftId) ?? published.find((a) => String(a.workDate) === todayStr && !events.some((e) => String(e.assignment_id) === String(a.id) && e.type === 'CHECK_OUT')) ?? published.find((a) => String(a.workDate) === todayStr) ?? published[0] ?? null;
  const sEvs = events.filter((e) => selectedShift && String(e.assignment_id) === String(selectedShift.id));
  const hasIn = sEvs.some((e) => e.type === 'CHECK_IN'), hasOut = sEvs.some((e) => e.type === 'CHECK_OUT');

  const checkMut = useMutation({
    mutationFn: (payload: unknown) => api.post('/attendance/check', payload),
    onSuccess: () => { message.success('Đã ghi nhận điểm danh Camera & GPS thành công'); setCameraKind(null); onSuccess(); onClose(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Điểm danh thất bại'),
  });

  return (
    <>
      <Modal open={open && !cameraKind} title="Chấm công Vào ca / Ra ca (Dành cho Nhân sự, Quản lý & Nhân viên)" onCancel={onClose} footer={<Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>} destroyOnHidden>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: BRAND.textSecondary, marginBottom: 6 }}>Chọn ca làm việc đã phát hành để chấm công</div>
          <Select style={{ width: '100%' }} showSearch optionFilterProp="label" value={selectedShift ? String(selectedShift.id) : undefined} onChange={setShiftId} options={published.map((s) => ({ value: String(s.id), label: `${s.workDate} · ${String(s.shiftLabel || 'Ca làm').replace(/\s*\([^)]*\)\s*/g, '').trim()} (${s.startAt || '07:00'}–${s.endAt || '12:00'}) — ${s.employeeName}` }))} />
        </div>
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button type="primary" icon={<CameraOutlined />} disabled={!selectedShift || hasIn} onClick={() => setCameraKind('CHECK_IN')}>{hasIn ? 'Đã vào ca' : 'Chấm Vào ca (Camera & GPS)'}</Button>
          <Button type="primary" icon={<CheckCircleOutlined />} disabled={!selectedShift || !hasIn || hasOut} onClick={() => setCameraKind('CHECK_OUT')}>{hasOut ? 'Đã hoàn thành ca' : 'Chấm Ra ca (Camera & GPS)'}</Button>
        </Space>
      </Modal>
      <AttendanceCameraModal open={Boolean(cameraKind)} kind={cameraKind ?? 'CHECK_IN'} shift={selectedShift} loading={checkMut.isPending} onClose={() => setCameraKind(null)} onConfirm={(payload) => checkMut.mutate(payload)} />
    </>
  );
}
