'use client';

import { useState } from 'react';
import { Alert, Button, Descriptions, Modal, Space, Tag } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, CloseOutlined, DollarOutlined, EyeOutlined, FileAddOutlined } from '@ant-design/icons';
import { ADJUSTMENT_PUNCH_TYPE_LABELS } from '@umbm/shared';
import dayjs from 'dayjs';
import { StatusTag } from '../StatusTag';
import { formatAdjustmentProposal } from './AdjustmentEvidenceFields';
import { FancyboxImage } from './FancyboxPreview';
import { hasPendingAdjustmentRecord, isAbsentShiftRecord, QuickAbsentAdjustmentModal } from './QuickAbsentAdjustmentModal';
import { renderProbationExtraTags } from './ScheduleShiftRegistrationsPane';
import { canViewShiftAttendanceDetail, ShiftAttendanceDetailModal } from './ShiftAttendanceDetailModal';
import { renderSwapAllowanceTag } from './ShiftSwapApproveModal';
import { renderDetailShiftStateAlert, renderWorkflowShiftStateTag } from './workflow-shift-warning';

export type ScheduleDetailKind = 'shift' | 'leave' | 'swap' | 'adjustment';

export interface ScheduleDetailTarget {
  kind: ScheduleDetailKind;
  record: Record<string, unknown>;
}

const cleanShiftName = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();
const fmtShiftTime = (r: Record<string, unknown>) =>
  `${String(r.startAt || r.start_at || '07:00')} – ${String(r.endAt || r.end_at || '12:00')}${r.scheduledHours || r.scheduled_hours ? ` (${r.scheduledHours || r.scheduled_hours} giờ)` : ''}`;
const fmtDate = (raw: unknown) => (raw ? dayjs(String(raw)).format('DD/MM/YYYY') : '—');
const fmtTs = (raw: unknown) => (raw ? dayjs(String(raw)).format('HH:mm · DD/MM/YYYY') : '—');

const TITLES: Record<ScheduleDetailKind, string> = {
  shift: 'Chi tiết Ca làm việc & Điểm danh',
  leave: 'Chi tiết Đơn đăng ký nghỉ phép (OFF)',
  swap: 'Chi tiết Yêu cầu đổi ca / nhường ca',
  adjustment: 'Chi tiết Phiếu giải trình / Bổ sung công',
};

export function ScheduleRequestDetailModal({
  target, onClose, onApproveSwap, onEditSwapAllowance,
}: {
  target: ScheduleDetailTarget | null; onClose: () => void;
  onApproveSwap?: (record: Record<string, unknown>) => void;
  onEditSwapAllowance?: (record: Record<string, unknown>) => void;
}) {
  const [quickAdjOpen, setQuickAdjOpen] = useState(false);
  const [attShiftId, setAttShiftId] = useState<string | null>(null);
  if (!target) return null;
  const { kind, record: r } = target;
  const isAbsentShift = kind === 'shift' && isAbsentShiftRecord(r);
  const hasPendingAdj = kind === 'shift' && hasPendingAdjustmentRecord(r);
  const canViewAtt = kind === 'shift' && Boolean(r.id) && canViewShiftAttendanceDetail(r as { status?: string; attendanceStatusLabel?: string; checkInEvent?: unknown; checkOutEvent?: unknown });

  return (
    <Modal
      width="min(860px, 94vw)" open title={TITLES[kind]} onCancel={onClose}
      footer={
        <Space wrap size={8}>
          {canViewAtt && <Button type="primary" ghost icon={<EyeOutlined />} onClick={() => setAttShiftId(String(r.id))}>Xem chi tiết điểm danh</Button>}
          {kind === 'swap' && r.status === 'PEER_ACCEPTED' && onApproveSwap && (
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => { onApproveSwap(r); onClose(); }}>HR phê duyệt yêu cầu</Button>
          )}
          {kind === 'swap' && r.status === 'APPROVED' && onEditSwapAllowance && (
            <Button icon={<DollarOutlined />} onClick={() => { onEditSwapAllowance(r); onClose(); }}>Điều chỉnh phụ cấp đổi ca</Button>
          )}
          {isAbsentShift && <Button type="primary" danger icon={<FileAddOutlined />} onClick={() => setQuickAdjOpen(true)}>Tạo phiếu bổ sung công từ ca này</Button>}
          <Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
        </Space>
      }
    >
      {renderDetailShiftStateAlert(kind, r)}
      {hasPendingAdj && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message={`Ca làm việc này đã gửi Phiếu bổ sung công (${String(r.pendingAdjustmentCode || 'Chờ duyệt')}) và đang chờ Cửa hàng / HR phê duyệt. Không được phép gửi trùng yêu cầu.`} />}
      {isAbsentShift && <Alert type="error" showIcon style={{ marginBottom: 10 }} message="Ca làm việc này đang ở trạng thái Vắng mặt (Cần bổ sung công). Bấm nút 'Tạo phiếu bổ sung công từ ca này' để gửi phiếu giải trình bù công." action={<Button size="small" type="primary" danger icon={<FileAddOutlined />} onClick={() => setQuickAdjOpen(true)}>Tạo phiếu bổ sung công</Button>} />}
      <Descriptions bordered size="small" column={1} style={{ marginTop: 8 }} styles={{ label: { width: 220, fontWeight: 600, background: '#F8FAFC' } }}>
        {kind === 'swap' && (
          <>
            <Descriptions.Item label="Mã yêu cầu & Loại">
              <Space size={6} wrap>
                <Tag color="purple" style={{ margin: 0 }}>{String(r.swap_code || r.id)}</Tag>
                <Tag color={r.kind === 'SWAP' ? 'geekblue' : 'cyan'} style={{ margin: 0 }}>{String(r.kindLabel || (r.kind === 'SWAP' ? 'Đổi ca 2 chiều' : 'Nhường ca'))}</Tag>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Trạng thái hiện tại">
              <Space size={6} wrap>
                <StatusTag value={String(r.status)} label={String(r.statusLabel || '') || undefined} />
                {Boolean(r.requiresHrApproval) && <Tag color="volcano" style={{ margin: 0 }}>Vượt 2 ca/ngày — cần HR duyệt</Tag>}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Ngày làm việc của ca"><strong className="num">{fmtDate(r.from_work_date)}</strong></Descriptions.Item>
            <Descriptions.Item label="Khung ca & Thời gian">
              <Space size={6} wrap>
                <strong>{cleanShiftName(r.shiftLabel || r.from_shift_code)}</strong>
                <Tag color="geekblue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag>
                {renderWorkflowShiftStateTag(r)}
              </Space>
            </Descriptions.Item>
            {r.kind === 'SWAP' && (
              <Descriptions.Item label="Ca nhận lại từ đồng nghiệp">
                <Space size={6} wrap>
                  <strong className="num">{fmtDate(r.to_work_date)}</strong>
                  <strong>{cleanShiftName((r.toShiftDetails as Record<string, unknown> | null)?.shiftLabel || r.to_shift_code)}</strong>
                  {Boolean(r.toShiftDetails) && <Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r.toShiftDetails as Record<string, unknown>)}</Tag>}
                </Space>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Chi nhánh làm việc">{String(r.branchName || '—')}</Descriptions.Item>
            <Descriptions.Item label="Người gửi yêu cầu">{String(r.requesterName || r.requester_id || '—')}</Descriptions.Item>
            <Descriptions.Item label="Đồng nghiệp nhận ca">{String(r.peerName || r.peer_id || '—')}</Descriptions.Item>
            <Descriptions.Item label="Phụ cấp nhận đổi ca">{renderSwapAllowanceTag(r)}</Descriptions.Item>
            <Descriptions.Item label="Kiểm tra chồng ca & Định biên">
              <Space size={6} wrap>
                <Tag color={r.has_conflict ? 'red' : 'green'} style={{ margin: 0 }}>{r.has_conflict ? 'Phát hiện chồng ca' : 'Không chồng ca'}</Tag>
                <Tag color={r.staffing_valid === false ? 'volcano' : 'green'} style={{ margin: 0 }}>{r.staffing_valid === false ? 'Thiếu định biên' : 'Đảm bảo định biên ca'}</Tag>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Lý do">{String(r.reason || '—')}</Descriptions.Item>
            <Descriptions.Item label="Thời điểm gửi yêu cầu"><span className="num">{fmtTs(r.requested_at || r.created_at)}</span></Descriptions.Item>
            <Descriptions.Item label="Đồng nghiệp phản hồi">
              {r.peer_responded_at ? <span className="num">{fmtTs(r.peer_responded_at)}{r.peer_note ? ` — "${String(r.peer_note)}"` : ''}</span> : 'Chưa phản hồi'}
            </Descriptions.Item>
            <Descriptions.Item label="HR phê duyệt">
              {r.decided_at ? <span className="num">{fmtTs(r.decided_at)}{r.decision_reason ? ` — "${String(r.decision_reason)}"` : ''}</span> : r.requiresHrApproval ? 'Chưa phê duyệt' : 'Không cần HR duyệt (lịch cập nhật ngay khi đồng nghiệp đồng ý)'}
            </Descriptions.Item>
          </>
        )}

        {kind === 'leave' && (
          <>
            <Descriptions.Item label="Mã đơn nghỉ OFF"><Tag color="geekblue" style={{ margin: 0 }}>{String(r.request_code || r.id)}</Tag></Descriptions.Item>
            <Descriptions.Item label="Trạng thái duyệt"><StatusTag value={String(r.status)} /></Descriptions.Item>
            <Descriptions.Item label="Phân loại nghỉ OFF">
              <Tag color={r.employee_stage === 'PROBATION' || r.kind === 'PROBATION_OFF' ? 'gold' : 'blue'} style={{ margin: 0 }}>
                {r.employee_stage === 'PROBATION' || r.kind === 'PROBATION_OFF' ? 'OFF chu kỳ Thử việc (2 ngày / 12 ngày)' : 'OFF định kỳ Nhân viên Chính thức'}
              </Tag>
            </Descriptions.Item>
            {r.employeeName ? <Descriptions.Item label="Nhân sự đăng ký">{String(r.employeeName)} {r.employeeCode ? `(${String(r.employeeCode)})` : ''}</Descriptions.Item> : null}
            <Descriptions.Item label="Ngày xin nghỉ"><strong className="num">{fmtDate(r.leave_date)}</strong></Descriptions.Item>
            <Descriptions.Item label="Khung ca & Thời gian">
              <Space size={6} wrap>
                <strong>{cleanShiftName(r.shiftLabel || r.shift_code)}</strong>
                <Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag>
                {renderWorkflowShiftStateTag(r)}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Chi nhánh">{String(r.branchName || '—')}</Descriptions.Item>
            {r.quota_cycle_limit ? <Descriptions.Item label="Định mức OFF chu kỳ"><Tag color="blue" style={{ margin: 0 }}>{String(r.quota_cycle_used || 1)} / {String(r.quota_cycle_limit)} ngày</Tag></Descriptions.Item> : null}
            <Descriptions.Item label="Định biên ca sau khi nghỉ">
              <Space size={6} wrap>
                <Tag color={Number(r.staffing_after_leave ?? 2) >= Number(r.min_staff_required ?? 2) ? 'green' : 'volcano'} style={{ margin: 0 }}>
                  Còn {String(r.staffing_after_leave ?? 2)} nhân sự trực ca (Tối thiểu {String(r.min_staff_required ?? 2)} NV)
                </Tag>
                <span style={{ fontSize: 12, color: '#64748B' }}>{Number(r.staffing_after_leave ?? 2) >= Number(r.min_staff_required ?? 2) ? 'Đảm bảo định biên' : 'Cảnh báo thiếu định biên ca'}</span>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Lý do xin nghỉ">{String(r.reason || '—')}</Descriptions.Item>
            <Descriptions.Item label="Thời điểm gửi đơn"><span className="num">{fmtTs(r.submitted_at || r.created_at)}</span></Descriptions.Item>
            <Descriptions.Item label="Thời điểm phê duyệt">{r.decided_at ? <span className="num">{fmtTs(r.decided_at)}</span> : 'Đang chờ duyệt'}</Descriptions.Item>
            <Descriptions.Item label="Ghi chú phê duyệt">{String(r.decision_reason || '—')}</Descriptions.Item>
          </>
        )}

        {kind === 'adjustment' && (
          <>
            <Descriptions.Item label="Mã phiếu bổ sung"><Tag color="geekblue" style={{ margin: 0 }}>{String(r.adjustment_code || r.id)}</Tag></Descriptions.Item>
            <Descriptions.Item label="Trạng thái duyệt"><StatusTag value={String(r.status)} label={String(r.statusLabel || '') || undefined} /></Descriptions.Item>
            <Descriptions.Item label="Loại lỗi chấm công">
              <Space size={6} wrap>
                <Tag color="purple" style={{ margin: 0 }}>{String(r.punchTypeLabel || ADJUSTMENT_PUNCH_TYPE_LABELS[r.punch_type as keyof typeof ADJUSTMENT_PUNCH_TYPE_LABELS] || 'Bổ sung công cả ca')}</Tag>
                <Tag color="orange" style={{ margin: 0 }}>
                  {r.kind === 'FORGOT_CHECK_IN' ? 'Quên chấm công Vào ca' : r.kind === 'FORGOT_CHECK_OUT' ? 'Quên chấm công Ra ca' : r.kind === 'GPS_ERROR' ? 'Lỗi định vị GPS' : r.kind === 'CAMERA_ERROR' ? 'Lỗi Camera thiết bị' : 'Sự cố hợp lệ khác'}
                </Tag>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Ảnh minh chứng">
              {r.evidencePhotoUrl ? <div style={{ width: 180 }}><FancyboxImage src={String(r.evidencePhotoUrl)} alt="Ảnh minh chứng" caption={`Minh chứng ${String(r.adjustment_code || '')}`} height={120} /></div> : <span style={{ color: '#64748B' }}>Không kèm ảnh minh chứng</span>}
            </Descriptions.Item>
            {r.employeeName ? <Descriptions.Item label="Nhân sự đề nghị">{String(r.employeeName)}</Descriptions.Item> : null}
            <Descriptions.Item label="Ngày công"><strong className="num">{fmtDate(r.work_date)}</strong></Descriptions.Item>
            <Descriptions.Item label="Khung ca & Thời gian">
              <Space size={6} wrap>
                <strong>{cleanShiftName(r.shiftLabel || r.shift_code)}</strong>
                <Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag>
                {renderWorkflowShiftStateTag(r)}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Nội dung giờ đề nghị"><strong className="num">{formatAdjustmentProposal(r)}</strong></Descriptions.Item>
            <Descriptions.Item label="Lý do giải trình">{String(r.reason || '—')}</Descriptions.Item>
            <Descriptions.Item label="Xác nhận từ Cửa hàng">{r.store_confirmed_at ? `${fmtTs(r.store_confirmed_at)}${r.store_note ? ` — "${String(r.store_note)}"` : ''}` : 'Chưa xác nhận'}</Descriptions.Item>
            <Descriptions.Item label="Thời điểm gửi phiếu"><span className="num">{fmtTs(r.created_at)}</span></Descriptions.Item>
            <Descriptions.Item label="Ghi chú phê duyệt HR">{String(r.decision_reason || '—')}</Descriptions.Item>
          </>
        )}

        {kind === 'shift' && (
          <>
            <Descriptions.Item label="Ngày làm việc"><strong className="num">{fmtDate(r.workDate || r.work_date)}</strong></Descriptions.Item>
            <Descriptions.Item label="Khung ca & Thời gian">
              <Space size={6} wrap>
                <strong>{cleanShiftName(r.shiftLabel || r.shift_code)}</strong>
                <Tag color="geekblue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Chi nhánh">{String(r.branchName || '—')}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái phân ca"><Space size={6} wrap><StatusTag value={String(r.status)} label={String(r.statusLabel || '') || undefined} />{renderProbationExtraTags(r)}</Space></Descriptions.Item>
            <Descriptions.Item label="Trạng thái điểm danh"><Tag color={String(r.attendanceStatusColor || 'default')} style={{ margin: 0 }}>{String(r.attendanceStatusLabel || 'Chưa điểm danh')}</Tag></Descriptions.Item>
            <Descriptions.Item label="Ghi chú ca làm việc">{String(r.note || '—')}</Descriptions.Item>
            <Descriptions.Item label="Thời điểm tạo / đăng ký"><span className="num">{fmtTs(r.created_at)}</span></Descriptions.Item>
          </>
        )}
      </Descriptions>
      <QuickAbsentAdjustmentModal shift={isAbsentShift ? r : null} open={quickAdjOpen} onClose={() => setQuickAdjOpen(false)} onSuccess={onClose} />
      <ShiftAttendanceDetailModal assignmentId={attShiftId} onClose={() => setAttShiftId(null)} />
    </Modal>
  );
}
