'use client';

import type { ReactNode } from 'react';
import { Alert, Tag, Tooltip } from 'antd';
import type { HookAPI as ModalHookAPI } from 'antd/es/modal/useModal';
import { CheckOutlined, CloseOutlined, ExclamationCircleOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { LeaveRequestConflictInfo } from './schedule-planner-types';

type RowRec = Record<string, unknown>;
export type WorkflowConfirmKind = 'leave' | 'swap';

const cleanShift = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();
const fmtDate = (raw: unknown) => (raw ? dayjs(String(raw)).format('DD/MM/YYYY') : '—');
const shiftColor = (st: unknown) => (st === 'COMPLETED' ? 'green' : st === 'ABSENT' ? 'red' : st === 'PUBLISHED' ? 'blue' : 'volcano');

export function isWorkflowPending(r: RowRec): boolean {
  return ['PENDING', 'DRAFT', 'PENDING_PEER', 'PEER_ACCEPTED'].includes(String(r.status || ''));
}

export function isShiftNonOfficialPublished(r: RowRec): boolean {
  return Boolean(r.shiftStatus && r.shiftStatus !== 'PUBLISHED' && r.shiftStatus !== 'MISSING');
}

export function getLeaveOffConflict(r: RowRec): LeaveRequestConflictInfo | null {
  const c = r.offConflict as (LeaveRequestConflictInfo & { hasSameDayConflict?: boolean }) | undefined;
  return c && (c.hasConflict || c.hasSameDayConflict) ? c : null;
}

export function renderLeaveOffConflictTag(r: RowRec): ReactNode {
  const c = getLeaveOffConflict(r);
  if (!c) return null;
  const isCrit = c.severity === 'CRITICAL';
  const label = isCrit
    ? (c.sameShiftOffCount >= 2 ? `Trùng ${c.sameShiftOffCount}/${c.sameShiftTotalStaff} NV ${c.shiftLabel} · Thiếu người` : `Thiếu người (${c.remainingGroupStaff}/${c.minStaffRequired})`)
    : `Trùng ngày nghỉ (${c.sameBranchOffCount} NV)`;
  return (
    <Tooltip title={c.warningMessage}>
      <Tag color={isCrit ? 'red' : 'orange'} icon={<WarningOutlined />} style={{ margin: 0, cursor: 'help' }}>
        {label}
      </Tag>
    </Tooltip>
  );
}

export function renderWorkflowShiftStateTag(r: RowRec): ReactNode {
  if (!isWorkflowPending(r) || !isShiftNonOfficialPublished(r)) return null;
  const label = String(r.shiftStatusLabel || 'Đã hoàn thành ca');
  return <Tag color={shiftColor(r.shiftStatus)} style={{ margin: 0 }}>Ca trên lịch: {label}</Tag>;
}

export function renderDetailShiftStateAlert(kind: string, r: RowRec): ReactNode {
  const offConflict = kind === 'leave' ? getLeaveOffConflict(r) : null;
  const showShiftState = ['leave', 'swap'].includes(kind) && isWorkflowPending(r) && isShiftNonOfficialPublished(r);
  if (!offConflict && !showShiftState) return null;

  const statusLabel = String(r.shiftStatusLabel || 'Đã hoàn thành ca');
  const actionNote = kind === 'swap'
    ? `Nếu chấp nhận duyệt đổi ca, ca làm việc hiện tại (${statusLabel}) sẽ bị xóa trạng thái hoàn thành của người xin đổi và chuyển sang trạng thái "Đã phân ca chính thức" cho đồng nghiệp nhận ca thay.`
    : `Nếu chấp nhận đơn này, ca làm việc hiện tại (${statusLabel}) trên bảng lịch làm việc sẽ bị xóa khỏi lịch phân ca do nhân sự nghỉ OFF.`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
      {offConflict && (
        <Alert
          type={offConflict.severity === 'CRITICAL' ? 'error' : 'warning'}
          showIcon
          message={offConflict.severity === 'CRITICAL' ? 'Cảnh báo trùng lịch nghỉ OFF làm thiếu / trống người trực ca' : 'Lưu ý nhiều nhân sự đăng ký nghỉ OFF cùng ngày'}
          description={offConflict.warningMessage}
        />
      )}
      {showShiftState && (
        <Alert
          type="warning"
          showIcon
          message={`Lưu ý: Ca làm việc trên lịch hiện đang ở trạng thái "${statusLabel}" (không ở trạng thái "Đã phân ca chính thức"). ${actionNote}`}
        />
      )}
    </div>
  );
}

/** Khối cảnh báo hợp nhất (trùng ngày nghỉ OFF + ghi đè trạng thái ca trên lịch) hiển thị trực tiếp bên trong WorkflowDecisionModal. */
export function renderWorkflowDecisionAlert(kind: WorkflowConfirmKind, rows: RowRec[]): ReactNode {
  const offConflictRows = kind === 'leave' ? rows.filter((r) => Boolean(getLeaveOffConflict(r))) : [];
  const shiftWarnRows = rows.filter((r) => isShiftNonOfficialPublished(r));
  const activeShiftRows = kind === 'leave' && shiftWarnRows.length === 0
    ? rows.filter((r) => Boolean(r.hasActiveShiftOnWorkflow || r.shiftStatus === 'PUBLISHED' || r.assignment_id || r.shiftAssignmentId))
    : [];

  if (offConflictRows.length === 0 && shiftWarnRows.length === 0 && activeShiftRows.length === 0) return null;
  const hasCritical = offConflictRows.some((r) => getLeaveOffConflict(r)?.severity === 'CRITICAL');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {offConflictRows.length > 0 && (
        <Alert
          type={hasCritical ? 'error' : 'warning'}
          showIcon
          message={
            hasCritical
              ? 'Cảnh báo: Nhiều nhân sự cùng đăng ký nghỉ OFF gây thiếu / trống ca trực'
              : 'Lưu ý: Có nhiều nhân sự cùng đăng ký nghỉ OFF trong một ngày'
          }
          description={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
              {offConflictRows.map((r, idx) => (
                <div key={String(r.id || idx)} style={{ fontSize: 12.5 }}>
                  • <strong>{String(r.employeeName || 'Nhân sự')}</strong> ({fmtDate(r.leave_date || r.leaveDate)}): {getLeaveOffConflict(r)?.warningMessage}
                </div>
              ))}
            </div>
          }
        />
      )}
      {shiftWarnRows.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={
            rows.length === 1 && shiftWarnRows[0]
              ? `Cảnh báo ghi đè ca: Ca làm việc trên lịch hiện đang ở trạng thái "${String(shiftWarnRows[0].shiftStatusLabel || 'Đã hoàn thành ca')}"`
              : `Cảnh báo ghi đè ca: Có ${shiftWarnRows.length}/${rows.length} đơn ảnh hưởng ca làm việc đã ghi nhận trạng thái trên lịch`
          }
          description={
            kind === 'swap'
              ? 'Khi xác nhận đồng ý đổi / nhận ca, trạng thái cũ của ca sẽ được làm mới và chuyển sang "Đã phân ca chính thức" cho người nhận ca.'
              : 'Khi phê duyệt đơn nghỉ OFF, ca làm việc trùng ngày trên bảng lịch phân ca sẽ tự động được gỡ bỏ khỏi lịch làm việc.'
          }
        />
      )}
      {activeShiftRows.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="Lưu ý ghi đè lịch phân ca hiện có"
          description="Nhân sự đã được phân công ca làm việc trong ngày xin nghỉ. Khi phê duyệt đơn nghỉ OFF, ca làm việc trùng ngày sẽ tự động được gỡ khỏi lịch."
        />
      )}
    </div>
  );
}

export function getShiftExpiryInfo(r: RowRec): { isPassed: boolean; label: string } {
  const workDate = String(r.from_work_date || '');
  const endAt = String(r.endAt || (r.shiftTimeRange ? String(r.shiftTimeRange).split('–')[1]?.trim() : '') || '22:30');
  const todayYmd = dayjs().format('YYYY-MM-DD'), nowHm = dayjs().format('HH:mm');
  const isPassed = Boolean(workDate && (workDate < todayYmd || (workDate === todayYmd && endAt && nowHm >= endAt)));
  const formattedDate = workDate ? dayjs(workDate).format('DD/MM/YYYY') : '—';
  return { isPassed, label: `kết thúc lúc ${endAt} ngày ${formattedDate}` };
}

export function confirmWorkflowShiftOverride(modal: ModalHookAPI, kind: WorkflowConfirmKind, rows: RowRec[], onConfirm: () => void): void {
  const alertNode = renderWorkflowDecisionAlert(kind, rows);
  if (!alertNode) { onConfirm(); return; }
  modal.confirm({
    width: 600,
    icon: <ExclamationCircleOutlined style={{ color: '#D97706' }} />,
    title: kind === 'swap' ? 'Xác nhận ảnh hưởng lịch ca khi đổi / nhận ca' : 'Xác nhận cảnh báo định biên & lịch ca khi duyệt nghỉ OFF',
    content: alertNode,
    okText: 'Tiếp tục xác nhận',
    okButtonProps: { danger: true, icon: <CheckOutlined /> },
    cancelText: 'Hủy bỏ',
    cancelButtonProps: { icon: <CloseOutlined /> },
    onOk: () => onConfirm(),
  });
}
