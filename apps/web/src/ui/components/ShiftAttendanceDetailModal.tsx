'use client';

import { Alert, Button, Card, Col, Descriptions, Empty, Modal, Row, Space, Spin, Tag, Typography } from 'antd';
import { CameraOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { StatusTag } from '../StatusTag';
import { BRAND } from '../theme';
import type { AttendanceEventRow } from './AttendanceEventsTable';
import { FancyboxImage, type FancyboxSlideItem } from './FancyboxPreview';

export interface ShiftAttendanceAdjustmentInfo {
  id: string; adjustment_code: string; kind: string; status: string;
  punch_type?: 'CHECK_IN' | 'CHECK_OUT' | 'FULL_SHIFT'; punchTypeLabel?: string;
  requested_check_in_at: string; requested_check_out_at: string; requested_hours: number;
  reason: string; decision_reason?: string; decided_at?: string;
}

export interface ShiftAttendanceDetailData extends AttendanceEventRow {
  assignmentId: string; scheduledHours?: number; shiftStatus?: string; shiftNote?: string;
  hasRawCheckIn?: boolean; hasRawCheckOut?: boolean; isAutoOut?: boolean;
  adjustment?: ShiftAttendanceAdjustmentInfo | null;
  adjustments?: ShiftAttendanceAdjustmentInfo[];
}

const ADJ_KIND_LABELS: Record<string, string> = {
  FORGOT_CHECK_IN: 'Quên điểm danh Vào ca', FORGOT_CHECK_OUT: 'Quên điểm danh Ra ca',
  GPS_ERROR: 'Sự cố định vị GPS', CAMERA_ERROR: 'Sự cố Camera thiết bị', OTHER: 'Giải trình bổ sung công',
};

function formatShiftAdjustmentTitle(a: ShiftAttendanceAdjustmentInfo): string {
  const cause = ADJ_KIND_LABELS[a.kind] || 'Bổ sung công';
  if (a.punch_type === 'CHECK_IN') return `Phiếu xác nhận Vào ca ${a.adjustment_code} (${cause}) — Giờ Vào ca đề nghị: ${a.requested_check_in_at}`;
  if (a.punch_type === 'CHECK_OUT') return `Phiếu xác nhận Ra ca ${a.adjustment_code} (${cause}) — Giờ Ra ca đề nghị: ${a.requested_check_out_at}`;
  return `Phiếu bổ sung công cả ca ${a.adjustment_code} (${cause}) — Khung giờ bù công: ${a.requested_check_in_at} – ${a.requested_check_out_at} (${a.requested_hours}h)`;
}

export function canViewShiftAttendanceDetail(
  item?: { status?: string; attendanceStatusLabel?: string; checkInEvent?: unknown; checkOutEvent?: unknown } | null,
): boolean {
  if (!item) return false;
  if (item.status === 'COMPLETED' || item.checkInEvent || item.checkOutEvent) return true;
  const lbl = String(item.attendanceStatusLabel || '');
  return lbl.includes('Đã hoàn thành') || lbl.includes('Đã vào ca') || lbl.includes('Quên Ra ca');
}

function renderShiftCheckPane(
  ev: AttendanceEventRow | null | undefined, kind: 'CHECK_IN' | 'CHECK_OUT',
  gallerySlides: FancyboxSlideItem[], canViewMedia: boolean, isCompletedByAdjustment: boolean, hasCheckIn = false,
) {
  const isCheckIn = kind === 'CHECK_IN';
  const titleLabel = isCheckIn ? 'Chi tiết Vào ca (Check-In)' : 'Chi tiết Ra ca (Check-Out)';
  const slideIdx = ev?.photoUrl ? Math.max(0, gallerySlides.findIndex((s) => s.src === ev.photoUrl)) : 0;
  return (
    <Card
      size="small"
      styles={{ body: { padding: 10 } }}
      title={
        <Space size={6}>
          <Tag color={isCheckIn ? 'blue' : 'purple'} style={{ margin: 0 }}>{isCheckIn ? 'Vào ca' : 'Ra ca'}</Tag>
          <Typography.Text strong style={{ fontSize: 13 }}>{titleLabel}</Typography.Text>
        </Space>
      }
    >
      {!ev ? (
        <div style={{ padding: '22px 12px', textAlign: 'center' }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              isCompletedByAdjustment
                ? `Đã xác nhận ${isCheckIn ? 'giờ Vào ca' : 'giờ Ra ca'} qua Phiếu bổ sung công`
                : isCheckIn
                  ? 'Chưa có bản ghi điểm danh Vào ca'
                  : (hasCheckIn ? 'Chưa điểm danh Ra ca (Đang trong ca làm việc)' : 'Chưa có bản ghi điểm danh Ra ca')
            }
          />
        </div>
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {canViewMedia && (
            <div style={{ background: '#0F172A', borderRadius: 4, overflow: 'hidden', textAlign: 'center', border: `1px solid ${BRAND.border}` }}>
              {ev.photoUrl ? (
                <FancyboxImage
                  src={ev.photoUrl}
                  alt={titleLabel}
                  caption={`${titleLabel} — ${ev.employeeName || ''} (${ev.checkTimeFormatted || ev.checkTimeHm || ''})`}
                  gallerySlides={gallerySlides}
                  slideIndex={slideIdx}
                  height={176}
                />
              ) : (
                <div style={{ height: 176, display: 'grid', placeItems: 'center', color: '#94A3B8' }}>
                  <div><CameraOutlined style={{ fontSize: 24 }} /><div>Ảnh xác thực Camera</div></div>
                </div>
              )}
            </div>
          )}
          <Descriptions column={1} bordered size="small" styles={{ label: { width: 102, whiteSpace: 'nowrap', padding: '6px 10px' }, content: { padding: '6px 10px' } }}>
            <Descriptions.Item label="Thời gian">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <Typography.Text strong className="num">{ev.checkTimeFormatted || ev.checkTimeHm || '—'}</Typography.Text>
                <Tag color={ev.punctualityStatus === 'LATE' ? 'volcano' : ev.punctualityStatus === 'EARLY_LEAVE' ? 'orange' : 'green'} icon={ev.punctualityStatus === 'ON_TIME' ? <CheckCircleOutlined /> : <ClockCircleOutlined />} style={{ margin: 0, fontWeight: 600 }}>
                  {ev.punctualityLabel || 'Đúng giờ'}
                </Tag>
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="Vị trí GPS">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                <Tag color="green" icon={<EnvironmentOutlined />} style={{ margin: 0 }}>Cách CH {Number(ev.distance_m ?? 0)}m · Hợp lệ</Tag>
                {canViewMedia && ev.lat !== undefined && ev.lng !== undefined && (
                  <Button size="small" type="link" icon={<EnvironmentOutlined />} style={{ padding: 0, height: 20, fontSize: 12 }} href={`https://www.google.com/maps?q=${Number(ev.lat)},${Number(ev.lng)}`} target="_blank" rel="noopener noreferrer">
                    Xem trên Google Maps
                  </Button>
                )}
              </div>
              {canViewMedia && ev.lat !== undefined && ev.lng !== undefined && (
                <div className="mono" style={{ fontSize: 11, color: BRAND.textSecondary, marginTop: 3 }}>Tọa độ thiết bị: ({Number(ev.lat).toFixed(5)}, {Number(ev.lng).toFixed(5)})</div>
              )}
            </Descriptions.Item>
          </Descriptions>
        </Space>
      )}
    </Card>
  );
}

export function ShiftAttendanceDetailModal({ assignmentId, onClose }: { assignmentId: string | null; onClose: () => void }) {
  const can = useCan();
  const canViewMedia = can('attendance.media.read', 'self.attendance');
  const detailQ = useQuery({
    queryKey: ['shift-attendance-detail', assignmentId],
    queryFn: () => api.get<ShiftAttendanceDetailData>(`/admin/attendance/shift-detail/${assignmentId}`),
    enabled: Boolean(assignmentId),
  });

  const data = detailQ.data ?? null;
  const inEv = data?.checkInEvent ?? null;
  const outEv = data?.checkOutEvent ?? null;
  const adjList = data?.adjustments?.length ? data.adjustments : (data?.adjustment ? [data.adjustment] : []);
  const effectiveShiftStatus = data?.shiftStatus === 'COMPLETED' ? 'COMPLETED' : (inEv && !outEv ? 'CHECKED_IN' : data?.shiftStatus);
  const inCompletedByAdj = data?.shiftStatus === 'COMPLETED' && adjList.some((a) => a.status === 'APPROVED' && a.punch_type === 'FULL_SHIFT');
  const outCompletedByAdj = data?.shiftStatus === 'COMPLETED' && adjList.some((a) => a.status === 'APPROVED' && a.punch_type !== 'CHECK_IN');
  const hasBranchCoords = data?.branchLat !== undefined && data?.branchLat !== null && data?.branchLng !== undefined && data?.branchLng !== null;
  const gallerySlides: FancyboxSlideItem[] = [
    ...(inEv?.photoUrl ? [{ src: inEv.photoUrl, caption: `Vào ca (Check-In) — ${data?.employeeName || ''} · ${inEv.checkTimeFormatted || inEv.checkTimeHm || ''} · Cách CH ${Number(inEv.distance_m ?? 0)}m` }] : []),
    ...(outEv?.photoUrl ? [{ src: outEv.photoUrl, caption: `Ra ca (Check-Out) — ${data?.employeeName || ''} · ${outEv.checkTimeFormatted || outEv.checkTimeHm || ''} · Cách CH ${Number(outEv.distance_m ?? 0)}m` }] : []),
  ];

  return (
    <Modal
      open={Boolean(assignmentId)}
      title={data ? `Chi tiết Điểm danh Ca làm việc — ${data.employeeName}` : 'Chi tiết Điểm danh Ca làm việc'}
      onCancel={onClose}
      footer={<Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>}
      width={860}
      style={{ top: 18, maxWidth: '95vw' }}
      destroyOnHidden
    >
      <Spin spinning={detailQ.isLoading} tip="Đang tải chi tiết điểm danh...">
        {data && (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Descriptions column={1} bordered size="small" styles={{ label: { width: 140, whiteSpace: 'nowrap', padding: '6px 12px' }, content: { padding: '6px 12px' } }}>
              <Descriptions.Item label="Nhân sự & Ca làm">
                <Space size={8} wrap>
                  <strong>{data.employeeName}</strong><span>·</span>
                  <Tag color="blue" style={{ margin: 0 }}>{data.shiftLabel || 'Ca làm việc'} ({data.shiftTimeRange || '07:00 – 12:00'})</Tag>
                  <span className="num" style={{ color: BRAND.textSecondary }}>Ngày: {data.work_date ? dayjs(data.work_date).format('DD/MM/YYYY') : '—'}</span>
                  {effectiveShiftStatus && <StatusTag value={effectiveShiftStatus} />}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Chi nhánh làm việc">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <Space size={6} wrap>
                    <strong>{data.branchName || 'Chi nhánh làm việc'}</strong>
                    {data.branchRadiusM && <Tag color="geekblue" style={{ margin: 0 }}>Bán kính {data.branchRadiusM}m</Tag>}
                    {canViewMedia && hasBranchCoords && <span className="mono" style={{ fontSize: 12, color: BRAND.textSecondary }}>Tọa độ: ({Number(data.branchLat).toFixed(5)}, {Number(data.branchLng).toFixed(5)})</span>}
                  </Space>
                  {canViewMedia && hasBranchCoords && (
                    <Button size="small" type="primary" ghost icon={<EnvironmentOutlined />} href={`https://www.google.com/maps?q=${Number(data.branchLat)},${Number(data.branchLng)}`} target="_blank" rel="noopener noreferrer">
                      Xem trên Google Maps
                    </Button>
                  )}
                </div>
              </Descriptions.Item>
            </Descriptions>

            {adjList.map((a) => (
              <Alert
                key={a.id}
                type={a.status === 'APPROVED' ? 'success' : a.status === 'REJECTED' ? 'error' : 'warning'}
                showIcon
                message={formatShiftAdjustmentTitle(a)}
                description={`Lý do: ${a.reason}${a.decision_reason ? ` · Phản hồi phê duyệt: ${a.decision_reason}` : ''}${a.status === 'APPROVED' && a.punch_type === 'CHECK_IN' && !outEv ? ' · Đã ghi nhận Vào ca — nhân sự vẫn cần điểm danh Ra ca khi kết thúc ca.' : ''}`}
              />
            ))}

            {data.shiftStatus === 'COMPLETED' && !inEv && !outEv && adjList.length === 0 && (
              <Alert type="info" showIcon message="Ca làm việc này đã được xác nhận hoàn thành trên bảng phân công lịch làm việc (không có bản ghi chụp ảnh GPS trực tiếp)." />
            )}

            <Row gutter={[12, 12]}>
              <Col xs={24} md={12}>{renderShiftCheckPane(inEv, 'CHECK_IN', gallerySlides, canViewMedia, Boolean(inCompletedByAdj), Boolean(inEv))}</Col>
              <Col xs={24} md={12}>{renderShiftCheckPane(outEv, 'CHECK_OUT', gallerySlides, canViewMedia, Boolean(outCompletedByAdj), Boolean(inEv))}</Col>
            </Row>
          </Space>
        )}
      </Spin>
    </Modal>
  );
}
