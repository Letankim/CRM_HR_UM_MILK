'use client';

import type { ReactNode } from 'react';
import { Alert, Button, Space, Tooltip } from 'antd';
import { CameraOutlined, EyeOutlined, FileAddOutlined, LockOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { isBeforeShiftEnd, useCheckoutLateHours, useNowHm } from './self-attendance-shared';

export interface SelfShiftActionPanelProps {
  shift: Record<string, unknown> | null;
  todayDate: string;
  size?: 'large' | 'middle';
  showIncidentButton?: boolean;
  onCamera: (kind: 'CHECK_IN' | 'CHECK_OUT') => void;
  onAdjust: (shiftId: string) => void;
  onViewAttendance: (shiftId: string) => void;
}

/** Khối hành động điểm danh Vào ca / Ra ca cho một ca của chính nhân viên (dùng chung `/admin/my-attendance` và `/nv/diem-danh`). */
export function SelfShiftActionPanel({ shift, todayDate, size = 'large', showIncidentButton = true, onCamera, onAdjust, onViewAttendance }: SelfShiftActionPanelProps) {
  const nowHm = useNowHm();
  const lateHours = useCheckoutLateHours();
  if (!shift) return null;

  const id = String(shift.id);
  const workDate = String(shift.workDate || '');
  const startAt = String(shift.startAt || '07:00'), endAt = String(shift.endAt || '12:00');
  const isToday = workDate === todayDate;
  const hasIn = Boolean(shift.checkInEvent), hasOut = Boolean(shift.checkOutEvent);
  const isApproved = shift.status !== 'DRAFT';
  const isDone = shift.status === 'COMPLETED' || (hasIn && hasOut);
  const isExpired = shift.status === 'ABSENT' || Boolean(shift.isAbsentShift)
    || (!hasIn && shift.status === 'PUBLISHED' && (workDate < todayDate || (isToday && (Boolean(shift.isExpiredToday) || nowHm > endAt))));
  const isForgotOut = !isDone && hasIn && !hasOut && Boolean(shift.isForgotCheckout);
  const isWaitingEnd = !isDone && hasIn && !hasOut && !isForgotOut && isBeforeShiftEnd(shift, todayDate, nowHm);
  const canCheckOut = !isDone && hasIn && !hasOut && !isForgotOut && (Boolean(shift.canCheckOutNow) || isToday);
  const pendingAdj = shift.pendingAdjustmentCode ? String(shift.pendingAdjustmentCode) : '';
  const deadline = String(shift.checkoutGraceDeadlineHm || '');
  const adjustBtn = (label: string) => <Button type="primary" danger block icon={<FileAddOutlined />} onClick={() => onAdjust(id)}>{label}</Button>;

  let body: ReactNode;
  if (!isApproved) {
    body = <Alert type="warning" showIcon message="Ca đăng ký này đang chờ Quản lý cửa hàng hoặc HR phê duyệt. Chỉ được phép chấm công Vào/Ra ca sau khi ca đã chuyển sang Đã phân ca chính thức." />;
  } else if (isDone) {
    body = <Alert type="success" showIcon message="Bạn đã hoàn thành đầy đủ ca làm việc này." action={<Button size="small" type="primary" ghost icon={<EyeOutlined />} onClick={() => onViewAttendance(id)}>Chi tiết điểm danh</Button>} />;
  } else if (isExpired || isForgotOut) {
    body = (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {pendingAdj ? (
          <Alert type="warning" showIcon message={`Ca làm việc này đã gửi Phiếu bổ sung công (${pendingAdj}) và đang chờ Cửa hàng / HR phê duyệt.`} />
        ) : isForgotOut ? (
          <>
            <Alert type="error" showIcon message={`Ca làm việc (${startAt} – ${endAt}) đã quá ${lateHours} giờ sau giờ kết thúc ca mà chưa Ra ca nên không thể Ra ca trực tiếp.`} description="Vui lòng gửi phiếu Lỗi chấm công Ra ca kèm ảnh minh chứng. HR duyệt minh chứng Ra ca thì ca được ghi nhận hoàn thành." />
            {adjustBtn('Gửi phiếu lỗi chấm công Ra ca')}
          </>
        ) : (
          <>
            <Alert type="error" showIcon message={`Ca làm việc (${startAt} – ${endAt}) đã qua giờ kết thúc ca mà chưa điểm danh nên đã khóa Vào ca và chuyển sang Vắng mặt.`} description="Gửi phiếu bổ sung công kèm ảnh minh chứng để HR xem xét." />
            {adjustBtn('Gửi phiếu bổ sung công cho ca vắng mặt')}
          </>
        )}
      </Space>
    );
  } else if (isWaitingEnd) {
    body = (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Alert type="info" showIcon message={`Chưa đến giờ kết thúc ca (${endAt}) — không được ra ca sớm.`} description={`Bạn có thể Ra ca từ ${endAt} đến tối đa ${lateHours} giờ sau giờ kết thúc ca.`} />
        <Tooltip title={`Chưa đến giờ kết thúc ca (${endAt}) — không được ra ca sớm`}>
          <Button type="primary" size={size} block disabled icon={<LockOutlined />}>Ra ca (mở lúc {endAt})</Button>
        </Tooltip>
      </Space>
    );
  } else if (canCheckOut) {
    body = (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {Boolean(shift.isWithinCheckoutGrace) && <Alert type="info" showIcon message={`Ca đã qua giờ kết thúc (${endAt}). Bạn có thể Ra ca đến ${deadline} (tối đa ${lateHours} giờ sau giờ kết thúc ca); quá thời hạn phải gửi phiếu lỗi chấm công Ra ca.`} />}
        <Button type="primary" size={size} block icon={<CameraOutlined />} onClick={() => onCamera('CHECK_OUT')}>Ra ca (Chụp ảnh Camera &amp; GPS)</Button>
      </Space>
    );
  } else if (!isToday) {
    body = <Alert type="warning" showIcon message={`Ca đang chọn thuộc ngày ${dayjs(workDate).format('DD/MM/YYYY')}. Chỉ được điểm danh đúng ngày của ca (Hôm nay: ${dayjs(todayDate).format('DD/MM/YYYY')}).`} />;
  } else if (!hasIn) {
    body = <Button type="primary" size={size} block icon={<CameraOutlined />} onClick={() => onCamera('CHECK_IN')}>Vào ca (Chụp ảnh Camera &amp; GPS)</Button>;
  } else {
    body = <Alert type="success" showIcon message="Đã hoàn thành đầy đủ Vào ca và Ra ca cho ca làm việc này." />;
  }

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {body}
      {showIncidentButton && !pendingAdj && !isDone && isApproved && !isExpired && !isForgotOut && (isToday || canCheckOut) && (
        <Button size="small" block icon={<FileAddOutlined />} onClick={() => onAdjust(id)}>
          {hasIn ? 'Báo lỗi chấm công Ra ca (kèm ảnh minh chứng)' : 'Báo lỗi chấm công Vào ca (kèm ảnh minh chứng)'}
        </Button>
      )}
    </Space>
  );
}
