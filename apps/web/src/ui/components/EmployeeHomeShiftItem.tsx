'use client';

import type { ReactNode } from 'react';
import { Button, Space, Tag, Tooltip } from 'antd';
import { CheckCircleOutlined, EyeOutlined, LockOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import Link from 'next/link';
import { BRAND } from '@/ui/theme';
import { cleanShiftName, isBeforeShiftEnd } from './self-attendance-shared';

type Row = Record<string, unknown>;

export interface EmployeeHomeShiftItemProps {
  shift: Row; events: Row[]; todayDate: string; nowHm: string; lateHours: number; onViewAttendance: (shiftId: string) => void;
}

/** Một dòng ca làm việc trên Trang chủ Cổng nhân viên, kèm trạng thái và nút Vào ca / Ra ca phù hợp. */
export function EmployeeHomeShiftItem({ shift: s, events, todayDate, nowHm, lateHours, onViewAttendance }: EmployeeHomeShiftItemProps) {
  const sEvs = events.filter((e) => String(e.assignment_id) === String(s.id));
  const inEv = sEvs.find((e) => e.type === 'CHECK_IN') ?? (s.checkInEvent as Row | null | undefined) ?? undefined;
  const outEv = sEvs.find((e) => e.type === 'CHECK_OUT') ?? (s.checkOutEvent as Row | null | undefined) ?? undefined;
  const isTodayShift = String(s.workDate) === todayDate;
  const endAt = String(s.endAt || '12:00');
  const detailBtn = <Button size="small" icon={<EyeOutlined />} onClick={() => onViewAttendance(String(s.id))}>Chi tiết điểm danh</Button>;

  let action: ReactNode;
  if (s.status === 'DRAFT') {
    action = <Tag color="gold" style={{ margin: 0 }}>Chờ HR duyệt ca</Tag>;
  } else if (s.status === 'COMPLETED' || (inEv && outEv)) {
    action = <Space size={6}><Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0, fontWeight: 600 }}>Đã hoàn thành ca</Tag>{detailBtn}</Space>;
  } else if (s.status === 'ABSENT' || Boolean(s.isAbsentShift)) {
    action = <Space size={6}><Tag color="red" style={{ margin: 0 }}>Vắng mặt (Quá giờ ca)</Tag><Link href="/nv/cong"><Button size="small" danger>Bổ sung công</Button></Link></Space>;
  } else if (Boolean(s.isForgotCheckout)) {
    action = <Space size={6}><Tag color="volcano" style={{ margin: 0 }}>Quên Ra ca (quá {lateHours} giờ sau giờ kết thúc ca)</Tag><Link href="/nv/cong"><Button size="small" danger>Gửi phiếu lỗi Ra ca</Button></Link></Space>;
  } else if (inEv && !outEv && isBeforeShiftEnd(s, todayDate, nowHm)) {
    action = (
      <Space size={6}>
        <Tag color="processing" style={{ margin: 0 }}>Đã vào ca</Tag>
        <Tooltip title={`Chưa đến giờ kết thúc ca (${endAt}) — không được ra ca sớm`}>
          <Button size="small" disabled icon={<LockOutlined />}>Ra ca từ {endAt}</Button>
        </Tooltip>
      </Space>
    );
  } else if (Boolean(s.canCheckOutNow) || (isTodayShift && inEv && !outEv)) {
    action = <Space size={6}><Tag color={s.isWithinCheckoutGrace ? 'processing' : 'green'} style={{ margin: 0 }}>{s.isWithinCheckoutGrace ? `Còn hạn Ra ca đến ${String(s.checkoutGraceDeadlineHm || '')}` : 'Đã vào ca'}</Tag><Link href="/nv/diem-danh"><Button size="small" type="primary" icon={<CheckCircleOutlined />}>Ra ca</Button></Link></Space>;
  } else if (!isTodayShift) {
    action = <Tag color="gold" style={{ margin: 0 }}>Ca ngày {dayjs(String(s.workDate)).format('DD/MM')}</Tag>;
  } else if (!inEv) {
    action = <Link href="/nv/diem-danh"><Button size="small" type="primary" icon={<CheckCircleOutlined />}>Vào ca</Button></Link>;
  } else {
    action = <Space size={6}><Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>Đã hoàn thành ca</Tag>{detailBtn}</Space>;
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '8px 10px', background: '#F8FAFC', border: `1px solid ${BRAND.border}`, borderRadius: 4 }}>
      <div>
        <div style={{ fontWeight: 600 }}>{cleanShiftName(s.shiftLabel)} ({String(s.startAt || '07:00')} – {endAt})</div>
        <div style={{ fontSize: 12, color: BRAND.textSecondary }}>Ngày {dayjs(String(s.workDate)).format('DD/MM/YYYY')} · {String(s.branchName || '')}</div>
        {(inEv || outEv) && (
          <Space size={4} wrap style={{ marginTop: 4 }}>
            {inEv && <Tag color={inEv.punctualityStatus === 'LATE' ? 'volcano' : 'green'} style={{ margin: 0, fontSize: 11 }}>Vào: {String(inEv.checkTimeFormatted || '').slice(0, 5)} ({String(inEv.punctualityLabel || '')})</Tag>}
            {outEv && <Tag color={outEv.punctualityStatus === 'EARLY_LEAVE' ? 'orange' : 'green'} style={{ margin: 0, fontSize: 11 }}>Ra: {String(outEv.checkTimeFormatted || '').slice(0, 5)} ({String(outEv.punctualityLabel || '')})</Tag>}
          </Space>
        )}
      </div>
      {action}
    </div>
  );
}
