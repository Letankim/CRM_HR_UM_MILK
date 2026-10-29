'use client';

import { CheckCircleOutlined, ClockCircleOutlined, LockOutlined, MessageOutlined } from '@ant-design/icons';
import { Space, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { exportToExcel } from '@/lib/export-excel';
import { allowancesOf, bonusesOf, deductionsOf, fmtVnd, type PayPeriodRow, type PayrollSnapshotItem, type ShiftPayrollLog } from './payroll-types';

export interface PayslipLine {
  label: string;
  detail: string;
  amount: number;
}

export const LOG_STATUS_COLORS: Record<ShiftPayrollLog['status'], string> = {
  ATTENDANCE_FULL: 'green',
  ATTENDANCE_CHECKIN: 'processing',
  ADJUSTMENT_APPROVED: 'cyan',
  SCHEDULE_PUBLISHED: 'blue',
  LEAVE_OFF: 'gold',
  SWAPPED_OUT: 'purple',
  EMERGENCY_LEAVE: 'volcano',
  ABSENT: 'red',
};

/** Dựng các dòng phiếu lương (dùng chung cho Drawer và Xuất Excel phiếu lương) */
export function payslipLines(s: PayrollSnapshotItem): PayslipLine[] {
  const lines: PayslipLine[] = s.segments.map((seg) => ({
    label: `Lương ${seg.stage === 'PROBATION' ? `thử việc (${seg.percent}%)` : 'chính thức'}`,
    detail: `${seg.quantity} ${seg.unit} x ${fmtVnd(seg.unitRateVnd)} (${dayjs(seg.fromDate).format('DD/MM')} - ${dayjs(seg.toDate).format('DD/MM')}, ${seg.hours} giờ)`,
    amount: seg.amountVnd,
  }));
  if (s.otPayVnd > 0) lines.push({ label: 'Tăng ca (OT)', detail: `${s.otHours} giờ x ${fmtVnd(s.otRateVnd)}`, amount: s.otPayVnd });
  for (const a of s.allowanceLines) {
    lines.push({ label: a.label, detail: a.code === 'ALLOWANCE_SWAP' ? `${s.shiftSwapCount} ca nhận đổi` : 'Theo hồ sơ lương / khoản mục đã duyệt', amount: a.amount });
  }
  if (s.kpiBonusVnd > 0) lines.push({ label: 'Thưởng KPI / Doanh số', detail: 'Khoản thưởng đã duyệt trong kỳ', amount: s.kpiBonusVnd });
  if (s.positiveAdjustmentsVnd > 0) lines.push({ label: 'Điều chỉnh cộng', detail: 'Khoản bổ sung đã duyệt', amount: s.positiveAdjustmentsVnd });
  if (deductionsOf(s) > 0) lines.push({ label: 'Khấu trừ & tạm ứng đã duyệt', detail: 'Chỉ áp dụng khoản đã phê duyệt', amount: -deductionsOf(s) });
  return lines;
}

const sumRows = (rows: PayrollSnapshotItem[], f: (r: PayrollSnapshotItem) => number) => rows.reduce((s, r) => s + f(r), 0);

/** Xuất Bảng lương tổng hợp chuẩn kế toán (kèm trạng thái xác nhận của nhân sự) */
export function exportPayrollSheet(period: PayPeriodRow, rows: PayrollSnapshotItem[]) {
  exportToExcel({
    fileName: `Bang_Luong_${period.period_code}_${dayjs().format('YYYYMMDD')}.xls`,
    sheetTitle: `BẢNG TỔNG HỢP LƯƠNG & THƯỞNG — ${period.name} (${period.from_date} đến ${period.to_date})`,
    subtitle: `Trạng thái: ${period.statusLabel} | Tổng nhân sự: ${rows.length} | Đã xác nhận: ${rows.filter((r) => Boolean(r.employeeConfirmedAt)).length}/${rows.length} | Tổng thực lĩnh: ${fmtVnd(period.total_net_vnd)}`,
    columns: [
      { header: 'Mã NV', key: 'employeeCode' },
      { header: 'Họ và tên', key: 'fullName' },
      { header: 'Chi nhánh', key: 'branchName' },
      { header: 'Hình thức lương', key: 'rateTypeLabel' },
      { header: 'Lương chính thức', key: 'rateVnd', isCurrency: true },
      { header: 'Giờ thử việc', key: 'probationHours', align: 'right' },
      { header: 'Lương thử việc', key: 'probationPayVnd', isCurrency: true },
      { header: 'Giờ chính thức', key: 'officialHours', align: 'right' },
      { header: 'Lương chính thức (kỳ)', key: 'officialPayVnd', isCurrency: true },
      { header: 'Tăng ca', key: 'otPayVnd', isCurrency: true },
      { header: 'Phụ cấp', render: allowancesOf, isCurrency: true },
      { header: 'Thưởng', render: bonusesOf, isCurrency: true },
      { header: 'Khấu trừ', render: deductionsOf, isCurrency: true },
      { header: 'Tổng thu nhập', key: 'grossVnd', isCurrency: true },
      { header: 'THỰC LĨNH', key: 'netVnd', isCurrency: true },
      { header: 'Xác nhận của NV', render: (r: PayrollSnapshotItem) => r.confirmationLabel || 'Chưa phát hành' },
      { header: 'Thời gian xác nhận', render: (r: PayrollSnapshotItem) => (r.employeeConfirmedAt ? dayjs(r.employeeConfirmedAt).format('HH:mm DD/MM/YYYY') : '—') },
      { header: 'Ngân hàng', key: 'bankName' },
      { header: 'Số tài khoản', key: 'bankAccountNumber' },
    ],
    rows,
    summaryRow: [
      'TỔNG CỘNG', `${rows.length} nhân sự`, '', '', '',
      sumRows(rows, (r) => r.probationHours), sumRows(rows, (r) => r.probationPayVnd), sumRows(rows, (r) => r.officialHours), sumRows(rows, (r) => r.officialPayVnd),
      sumRows(rows, (r) => r.otPayVnd), sumRows(rows, allowancesOf), sumRows(rows, bonusesOf), sumRows(rows, deductionsOf), sumRows(rows, (r) => r.grossVnd), sumRows(rows, (r) => r.netVnd),
      `${rows.filter((r) => Boolean(r.employeeConfirmedAt)).length}/${rows.length} đã XN`, '', '', '',
    ],
  });
}

export function PayrollConfirmationCell({ row, periodStatus, onOpenTickets }: { row: PayrollSnapshotItem; periodStatus: PayPeriodRow['status']; onOpenTickets: () => void }) {
  const isPaid = periodStatus === 'PAID' || row.payslipStatus === 'PAID';
  if (row.employeeConfirmedAt) {
    return (
      <div>
        <Space size={4} wrap>
          <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0, borderRadius: 2 }}>Đã xác nhận</Tag>
          {(row.payslipRevision ?? 0) > 1 && <Tag color="blue" style={{ margin: 0, borderRadius: 2 }}>ĐC #{row.payslipRevision}</Tag>}
        </Space>
        <div className="num" style={{ fontSize: 11, color: '#15803D', marginTop: 2 }}>{dayjs(row.employeeConfirmedAt).format('HH:mm DD/MM/YYYY')}</div>
        <div style={{ fontSize: 11, color: '#64748B' }}><LockOutlined /> Đã khóa điều chỉnh</div>
      </div>
    );
  }
  if (row.disputeStatus === 'OPEN') {
    return (
      <div>
        <Tooltip title={row.disputeReason ? `Thắc mắc: ${row.disputeReason} (Bấm để mở Trung tâm Phiếu hỗ trợ)` : 'Mở Trung tâm Phiếu hỗ trợ'}>
          <Tag color="volcano" icon={<MessageOutlined />} style={{ margin: 0, cursor: 'pointer', borderRadius: 2 }} onClick={onOpenTickets}>
            Đang thắc mắc{row.disputeTicketCode ? ` (${row.disputeTicketCode})` : ''}
          </Tag>
        </Tooltip>
        <div style={{ fontSize: 11, color: isPaid ? '#64748B' : '#2563EB', marginTop: 2 }}>{isPaid ? 'Đã chi trả — Khóa ĐC' : 'Còn điều chỉnh được'}</div>
      </div>
    );
  }
  if (periodStatus === 'PUBLISHED' || isPaid || row.confirmationStatus === 'PENDING') {
    return (
      <div>
        <Space size={4} wrap>
          <Tag color={isPaid ? 'default' : row.disputeStatus === 'RESOLVED' ? 'cyan' : 'gold'} icon={isPaid ? <LockOutlined /> : <ClockCircleOutlined />} style={{ margin: 0, borderRadius: 2 }}>
            {isPaid ? 'Đã chi trả (Chưa bấm XN)' : row.disputeStatus === 'RESOLVED' ? 'Đã phản hồi · Chờ XN' : 'Chờ xác nhận'}
          </Tag>
          {(row.payslipRevision ?? 0) > 1 && <Tag color="blue" style={{ margin: 0, borderRadius: 2 }}>ĐC #{row.payslipRevision}</Tag>}
        </Space>
        {row.viewedByEmployeeAt && <div className="num" style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Đã xem: {dayjs(row.viewedByEmployeeAt).format('HH:mm DD/MM')}</div>}
        {!isPaid && <div style={{ fontSize: 11, color: '#2563EB', marginTop: 1 }}>Còn điều chỉnh được</div>}
      </div>
    );
  }
  return <Tag style={{ margin: 0, borderRadius: 2 }}>Chưa phát hành</Tag>;
}
