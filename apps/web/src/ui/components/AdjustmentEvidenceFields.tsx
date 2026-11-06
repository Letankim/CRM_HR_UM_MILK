'use client';

import { Alert, Col, Form, Row, Select } from 'antd';
import { ADJUSTMENT_PUNCH_TYPE_LABELS, ADJUSTMENT_PUNCH_TYPE_OPTIONS } from '@umbm/shared';
import { useMe } from '@/lib/auth';
import { EvidencePhotoUpload } from './EvidencePhotoUpload';

export type AdjustmentPunchType = 'CHECK_IN' | 'CHECK_OUT' | 'FULL_SHIFT';

/** Nguyên nhân sự cố chấm công (trường `kind` của phiếu bổ sung công). */
export const ADJUSTMENT_CAUSE_OPTIONS = [
  { value: 'FORGOT_CHECK_IN', label: 'Vắng mặt / Quên chấm công Vào ca' },
  { value: 'FORGOT_CHECK_OUT', label: 'Quên chấm công Ra ca' },
  { value: 'GPS_ERROR', label: 'Thiết bị lỗi định vị GPS tại cửa hàng' },
  { value: 'CAMERA_ERROR', label: 'Thiết bị lỗi Camera không chụp được ảnh' },
  { value: 'OTHER', label: 'Lý do công việc / Điều động khác' },
];

/** Suy ra loại phiếu mặc định: ca đang mở chưa Vào ca -> lỗi Vào ca; đã Vào ca chưa Ra ca -> lỗi Ra ca; vắng mặt -> bù công cả ca. */
export function inferAdjustmentPunchType(s?: Record<string, unknown> | null): AdjustmentPunchType {
  if (!s) return 'FULL_SHIFT';
  const forgotOut = Boolean(s.isForgotCheckout) || Boolean(s.checkInEvent && !s.checkOutEvent) || String(s.attendanceStatusLabel || '').includes('Quên Ra ca');
  if (forgotOut) return 'CHECK_OUT';
  if (!s.checkInEvent && s.status === 'PUBLISHED' && !s.isAbsentShift && !s.isExpiredToday) return 'CHECK_IN';
  return 'FULL_SHIFT';
}

/** Kind cũ tương ứng với loại phiếu (giữ tương thích báo cáo cũ). */
export function kindFromPunchType(punchType: AdjustmentPunchType): string {
  return punchType === 'CHECK_OUT' ? 'FORGOT_CHECK_OUT' : 'FORGOT_CHECK_IN';
}

/** Hiển thị nội dung đề nghị đúng theo loại phiếu (chỉ Vào ca, chỉ Ra ca, hoặc Bù công cả ca). */
export function formatAdjustmentProposal(r?: Record<string, unknown> | null): string {
  if (!r) return '—';
  if (r.punch_type === 'CHECK_IN') return `Vào ca ${String(r.requested_check_in_at || r.startAt || r.start_at || '07:00')}`;
  if (r.punch_type === 'CHECK_OUT') return `Ra ca ${String(r.requested_check_out_at || r.endAt || r.end_at || '12:00')}`;
  return `${Number(r.requested_hours || r.scheduledHours || r.scheduled_hours || 5)} giờ`;
}

/** Nhóm trường "Loại phiếu" + "Ảnh minh chứng chụp trực tiếp" bắt buộc khi nhân viên gửi phiếu lỗi chấm công / bổ sung công. */
export function AdjustmentEvidenceFields({ evidenceRequired = true }: { evidenceRequired?: boolean }) {
  const form = Form.useFormInstance();
  const punchType = (Form.useWatch('punch_type', form) as AdjustmentPunchType | undefined) ?? 'FULL_SHIFT';
  const workDate = (Form.useWatch('work_date', form) as string | undefined) ?? '';
  const shiftCode = (Form.useWatch('shift_code', form) as string | undefined) ?? '';
  const me = useMe().data?.user;
  const punchLabel = ADJUSTMENT_PUNCH_TYPE_LABELS[punchType] || 'Bổ sung công';
  const empLabel = me?.displayName || me?.username || 'Nhân sự';
  const watermarkTitle = `${punchLabel.toUpperCase()} · ${empLabel}${workDate ? ` · Ca ngày ${workDate}` : ''}${shiftCode ? ` (${shiftCode})` : ''}`;

  return (
    <>
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="HR duyệt minh chứng Vào ca -> ghi nhận Vào ca thành công; duyệt minh chứng Ra ca -> ca hoàn thành."
      />
      <Row gutter={12}>
        <Col xs={24} md={10}>
          <Form.Item name="punch_type" label="Loại phiếu" rules={[{ required: true, message: 'Vui lòng chọn loại phiếu' }]}>
            <Select options={ADJUSTMENT_PUNCH_TYPE_OPTIONS} placeholder="Chọn loại phiếu" />
          </Form.Item>
        </Col>
        <Col xs={24} md={14}>
          <Form.Item
            name="evidence_photo_base64" label="Ảnh minh chứng (Chụp ảnh trực tiếp)"
            rules={evidenceRequired ? [{ required: true, message: 'Vui lòng mở Camera chụp ảnh minh chứng trực tiếp' }] : []}
          >
            <EvidencePhotoUpload watermarkTitle={watermarkTitle} />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
}
