'use client';

import type { ReactNode } from 'react';
import { Alert, Tag } from 'antd';
import type { HookAPI as ModalHookAPI } from 'antd/es/modal/useModal';
import { CheckOutlined, CloseOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

type RowRec = Record<string, unknown>;
export type WorkflowConfirmKind = 'leave' | 'swap';

const cleanShift = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();
const fmtDate = (raw: unknown) => (raw ? dayjs(String(raw)).format('DD/MM/YYYY') : '—');
const shiftColor = (st: unknown) => (st === 'COMPLETED' ? 'green' : st === 'ABSENT' ? 'red' : st === 'PUBLISHED' ? 'blue' : 'volcano');

export function isWorkflowPending(r: RowRec): boolean {
  return ['PENDING', 'PENDING_PEER', 'PEER_ACCEPTED'].includes(String(r.status || ''));
}

export function isShiftNonOfficialPublished(r: RowRec): boolean {
  return Boolean(r.shiftStatus && r.shiftStatus !== 'PUBLISHED');
}

export function renderWorkflowShiftStateTag(r: RowRec): ReactNode {
  if (!isWorkflowPending(r) || !isShiftNonOfficialPublished(r)) return null;
  const label = String(r.shiftStatusLabel || 'Đã hoàn thành ca');
  return (
    <Tag color={shiftColor(r.shiftStatus)} style={{ margin: 0 }}>
      Ca trên lịch: {label}
    </Tag>
  );
}

export function renderDetailShiftStateAlert(kind: string, r: RowRec): ReactNode {
  if (!['leave', 'swap'].includes(kind) || !isWorkflowPending(r) || !isShiftNonOfficialPublished(r)) return null;
  const statusLabel = String(r.shiftStatusLabel || 'Đã hoàn thành ca');
  const actionNote =
    kind === 'swap'
      ? `Nếu chấp nhận duyệt đổi ca, ca làm việc hiện tại (${statusLabel}) sẽ bị xóa trạng thái hoàn thành của người xin đổi và chuyển sang trạng thái "Đã phân ca chính thức" cho đồng nghiệp nhận ca thay.`
      : `Nếu chấp nhận đơn này, ca làm việc hiện tại (${statusLabel}) trên bảng lịch làm việc sẽ bị xóa khỏi lịch phân ca do nhân sự nghỉ OFF.`;
  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 10 }}
      message={`Lưu ý: Ca làm việc trên lịch hiện đang ở trạng thái "${statusLabel}" (không ở trạng thái "Đã phân ca chính thức"). ${actionNote}`}
    />
  );
}

export function confirmWorkflowShiftOverride(
  modal: ModalHookAPI,
  kind: WorkflowConfirmKind,
  rows: RowRec[],
  onConfirm: () => void,
): void {
  const warnRows = rows.filter((r) => isShiftNonOfficialPublished(r));
  if (warnRows.length === 0) {
    onConfirm();
    return;
  }

  if (rows.length === 1 && warnRows[0]) {
    const r = warnRows[0];
    const statusLabel = String(r.shiftStatusLabel || 'Đã hoàn thành ca');
    const dateStr = fmtDate(r.leave_date || r.from_work_date || r.work_date);
    const shiftName = cleanShift(r.shiftLabel || r.shift_code || r.from_shift_code);
    const empName = String(r.employeeName || r.requesterName || 'Nhân sự');
    const consequence =
      kind === 'swap'
        ? `Nếu bạn xác nhận chấp nhận yêu cầu này, ca làm việc (${statusLabel}) của ${empName} sẽ bị xóa trạng thái cũ và chuyển sang trạng thái "Đã phân ca chính thức" cho người nhận ca (${String(r.peerName || 'đồng nghiệp')}).`
        : `Nếu bạn xác nhận chấp nhận đơn xin nghỉ OFF này, ca làm việc (${statusLabel}) trên bảng lịch phân ca sẽ bị xóa do nghỉ OFF.`;

    modal.confirm({
      width: 560,
      icon: <ExclamationCircleOutlined style={{ color: '#D97706' }} />,
      title: `Cảnh báo: Ca làm việc đang ở trạng thái "${statusLabel}"`,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <div>
            Ca làm việc <strong>{shiftName}</strong> ngày <strong>{dateStr}</strong> của nhân sự <strong>{empName}</strong> hiện đang ở trạng thái{' '}
            <Tag color={shiftColor(r.shiftStatus)} style={{ margin: 0 }}>{statusLabel}</Tag> (không ở trạng thái <strong>Đã phân ca chính thức</strong>).
          </div>
          <div style={{ color: '#DC2626', fontWeight: 500 }}>
            {consequence} Bạn có chắc chắn muốn chấp nhận không?
          </div>
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
    title: `Cảnh báo: Có ${warnRows.length}/${rows.length} đơn mà ca làm việc không ở trạng thái "Đã phân ca chính thức"`,
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        <div>Các ca làm việc dưới đây hiện đã hoàn thành hoặc không còn ở trạng thái <strong>Đã phân ca chính thức</strong>:</div>
        <div style={{ maxHeight: 160, overflowY: 'auto', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {warnRows.map((r, idx) => (
            <div key={String(r.id || idx)} style={{ fontSize: 13 }}>
              • <strong>{String(r.employeeName || r.requesterName || 'Nhân sự')}</strong> — {cleanShift(r.shiftLabel || r.shift_code || r.from_shift_code)} ngày <strong>{fmtDate(r.leave_date || r.from_work_date || r.work_date)}</strong>:{' '}
              <Tag color={shiftColor(r.shiftStatus)} style={{ margin: 0 }}>{String(r.shiftStatusLabel || 'Đã hoàn thành ca')}</Tag>
            </div>
          ))}
        </div>
        <div style={{ color: '#DC2626', fontWeight: 500 }}>
          {kind === 'swap'
            ? 'Nếu bạn xác nhận chấp nhận, các ca làm việc trên sẽ bị xóa trạng thái hiện tại và chuyển sang cho người nhận đổi ca.'
            : 'Nếu bạn xác nhận chấp nhận, các ca làm việc trên sẽ bị xóa khỏi lịch phân ca do nghỉ OFF.'}{' '}
          Bạn có chắc chắn muốn tiếp tục chấp nhận không?
        </div>
      </div>
    ),
    okText: kind === 'swap' ? `Chấp nhận đổi ca (${rows.length} đơn)` : `Chấp nhận & Xóa ca (${rows.length} đơn)`,
    okButtonProps: { danger: true, icon: <CheckOutlined /> },
    cancelText: 'Hủy bỏ',
    cancelButtonProps: { icon: <CloseOutlined /> },
    onOk: () => onConfirm(),
  });
}
