'use client';

import { Alert, Col, Form, Row, Select } from 'antd';
import { ADJUSTMENT_PUNCH_TYPE_OPTIONS } from '@umbm/shared';
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

/** Nhóm trường "Loại phiếu" + "Ảnh minh chứng" bắt buộc khi nhân viên gửi phiếu lỗi chấm công / bổ sung công. */
export function AdjustmentEvidenceFields({ evidenceRequired = true }: { evidenceRequired?: boolean }) {
  return (
    <>
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="HR duyệt minh chứng Vào ca -> ghi nhận Vào ca thành công; duyệt minh chứng Ra ca -> ca hoàn thành."
        description="Bù công cả ca: HR duyệt thì ca được ghi nhận hoàn thành. Ảnh minh chứng nên thể hiện rõ thời điểm và địa điểm làm việc."
      />
      <Row gutter={12}>
        <Col xs={24} md={10}>
          <Form.Item name="punch_type" label="Loại phiếu" rules={[{ required: true, message: 'Vui lòng chọn loại phiếu' }]}>
            <Select options={ADJUSTMENT_PUNCH_TYPE_OPTIONS} placeholder="Chọn loại phiếu" />
          </Form.Item>
        </Col>
        <Col xs={24} md={14}>
          <Form.Item
            name="evidence_photo_base64" label="Ảnh minh chứng"
            rules={evidenceRequired ? [{ required: true, message: 'Vui lòng chụp hoặc chọn ảnh minh chứng' }] : []}
          >
            <EvidencePhotoUpload />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
}
