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
  return Boolean(r.shiftStatus && r.shiftStatus !== 'PUBLISHED');
}

export function getLeaveOffConflict(r: RowRec): LeaveRequestConflictInfo | null {
  const c = r.offConflict as LeaveRequestConflictInfo | undefined;
  return c && c.hasConflict ? c : null;
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

export function confirmWorkflowShiftOverride(
  modal: ModalHookAPI,
  kind: WorkflowConfirmKind,
  rows: RowRec[],
  onConfirm: () => void,
): void {
  const shiftWarnRows = rows.filter((r) => isShiftNonOfficialPublished(r));
  const offConflictRows = kind === 'leave' ? rows.filter((r) => Boolean(getLeaveOffConflict(r))) : [];
  if (shiftWarnRows.length === 0 && offConflictRows.length === 0) {
    onConfirm();
    return;
  }

  if (kind === 'leave' && offConflictRows.length > 0 && shiftWarnRows.length === 0) {
    const hasCritical = offConflictRows.some((r) => getLeaveOffConflict(r)?.severity === 'CRITICAL');
    modal.confirm({
      width: 620,
      icon: <ExclamationCircleOutlined style={{ color: hasCritical ? '#DC2626' : '#D97706' }} />,
      title: hasCritical
        ? 'Cảnh báo: Nhiều nhân sự cùng đăng ký nghỉ OFF gây thiếu / trống ca!'
        : 'Lưu ý: Có nhiều nhân sự cùng đăng ký nghỉ OFF trong một ngày',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <div style={{ maxHeight: 200, overflowY: 'auto', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {offConflictRows.map((r, idx) => {
              const info = getLeaveOffConflict(r)!;
              return (
                <div key={String(r.id || idx)} style={{ fontSize: 13, color: '#0F172A' }}>
                  • <strong>{String(r.employeeName || 'Nhân sự')}</strong> ({fmtDate(r.leave_date || r.leaveDate)}): {info.warningMessage}
                </div>
              );
            })}
          </div>
          <div style={{ color: hasCritical ? '#DC2626' : '#B45309', fontWeight: 500 }}>
            {hasCritical
              ? 'Nếu vẫn phê duyệt tất cả các đơn trùng ngày này, khung ca trên sẽ không đủ nhân sự trực theo định biên. Bạn có chắc chắn muốn tiếp tục phê duyệt không?'
              : 'Bạn có chắc chắn muốn phê duyệt đơn nghỉ OFF trong ngày đã có đồng nghiệp xin nghỉ không?'}
          </div>
        </div>
      ),
      okText: rows.length > 1 ? `Vẫn phê duyệt (${rows.length} đơn)` : 'Vẫn phê duyệt đơn OFF',
      okButtonProps: { danger: hasCritical, icon: <CheckOutlined /> },
      cancelText: 'Quay lại kiểm tra',
      cancelButtonProps: { icon: <CloseOutlined /> },
      onOk: () => onConfirm(),
    });
    return;
  }

  const warnRows = shiftWarnRows.length > 0 ? shiftWarnRows : offConflictRows;
  if (rows.length === 1 && warnRows[0]) {
    const r = warnRows[0], statusLabel = String(r.shiftStatusLabel || 'Đã hoàn thành ca');
    const dateStr = fmtDate(r.leave_date || r.from_work_date || r.work_date);
    const shiftName = cleanShift(r.shiftLabel || r.shift_code || r.from_shift_code);
    const empName = String(r.employeeName || r.requesterName || 'Nhân sự');
    const offInfo = kind === 'leave' ? getLeaveOffConflict(r) : null;
    const consequence = kind === 'swap'
      ? `Nếu xác nhận, ca (${statusLabel}) của ${empName} sẽ xóa trạng thái cũ và chuyển sang "Đã phân ca chính thức" cho ${String(r.peerName || 'đồng nghiệp')}.`
      : `Nếu xác nhận, ca (${statusLabel}) trên bảng lịch phân ca sẽ bị xóa do nghỉ OFF.`;
    modal.confirm({
      width: 580,
      icon: <ExclamationCircleOutlined style={{ color: '#D97706' }} />,
      title: `Cảnh báo: Ca làm việc đang ở trạng thái "${statusLabel}"`,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <div>Ca <strong>{shiftName}</strong> ngày <strong>{dateStr}</strong> của <strong>{empName}</strong> đang ở trạng thái <Tag color={shiftColor(r.shiftStatus)} style={{ margin: 0 }}>{statusLabel}</Tag>.</div>
          {offInfo && <Alert type={offInfo.severity === 'CRITICAL' ? 'error' : 'warning'} showIcon message={offInfo.warningMessage} />}
          <div style={{ color: '#DC2626', fontWeight: 500 }}>{consequence} Bạn có chắc chắn muốn chấp nhận không?</div>
        </div>
      ),
      okText: kind === 'swap' ? 'Chấp nhận đổi ca' : 'Chấp nhận & Xóa ca do OFF',
      okButtonProps: { danger: true, icon: <CheckOutlined /> },
      cancelText: 'Hủy bỏ',
      cancelButtonProps: { icon: <CloseOutlined /> },
      onOk: () => onConfirm(),
    });
    return;
  }

  modal.confirm({
    width: 600,
    icon: <ExclamationCircleOutlined style={{ color: '#D97706' }} />,
    title: `Cảnh báo: Có ${warnRows.length}/${rows.length} đơn ảnh hưởng ca làm việc hoặc trùng ngày nghỉ`,
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        <div style={{ maxHeight: 170, overflowY: 'auto', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {warnRows.map((r, idx) => (
            <div key={String(r.id || idx)} style={{ fontSize: 13 }}>
              • <strong>{String(r.employeeName || r.requesterName || 'Nhân sự')}</strong> — {cleanShift(r.shiftLabel || r.shift_code || r.from_shift_code)} ngày <strong>{fmtDate(r.leave_date || r.from_work_date || r.work_date)}</strong>
              {getLeaveOffConflict(r) ? ` (${getLeaveOffConflict(r)!.warningMessage})` : ''}
            </div>
          ))}
        </div>
        <div style={{ color: '#DC2626', fontWeight: 500 }}>Bạn có chắc chắn muốn tiếp tục phê duyệt ({rows.length} đơn) không?</div>
      </div>
    ),
    okText: kind === 'swap' ? `Chấp nhận đổi ca (${rows.length} đơn)` : `Chấp nhận & Duyệt (${rows.length} đơn)`,
    okButtonProps: { danger: true, icon: <CheckOutlined /> },
    cancelText: 'Hủy bỏ',
    cancelButtonProps: { icon: <CloseOutlined /> },
    onOk: () => onConfirm(),
  });
}
