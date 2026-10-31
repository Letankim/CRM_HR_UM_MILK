'use client';

import { Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { DEFAULT_SHIFT_LABELS, EMPLOYEE_STAGE_LABELS, type DefaultShiftCode, type EmployeeStage } from '@umbm/shared';
import { StatusTag } from '../StatusTag';

export type OpsQuickDetailKind =
  | 'revenueInput' | 'payPeriod' | 'payslipRevision' | 'accountAuditHistory'
  | 'plannerProbation' | 'plannerOff' | 'plannerShift'
  | 'employeeTestAssignment' | 'testQuestion';

export interface QuickDetailField { label: string; value: ReactNode; span?: 1 | 2; }
export interface QuickDetailSpec { title: string; fields: QuickDetailField[]; externalLink?: { label: string; href: string }; }

type Rec = Record<string, unknown>;
const s = (v: unknown, fb = '—') => (v === null || v === undefined || v === '' ? fb : String(v));
const dt = (v: unknown) => (v ? String(v).slice(0, 19).replace('T', ' ') : '—');
const vnd = (v: unknown) => `${Number(v ?? 0).toLocaleString('vi-VN')} ₫`;
const stageLbl = (v: unknown) => EMPLOYEE_STAGE_LABELS[String(v) as EmployeeStage] ?? s(v);
const shiftLbl = (v: unknown) => DEFAULT_SHIFT_LABELS[String(v) as DefaultShiftCode] ?? s(v);

export function buildOpsQuickDetailSpec(kind: OpsQuickDetailKind, r: Rec): QuickDetailSpec {
  switch (kind) {
    case 'revenueInput':
      return {
        title: `Chi tiết Đối chiếu Doanh thu & Quỹ lương — ${s(r.branchName)}`,
        fields: [
          { label: 'Kỳ lương đối chiếu', value: s(r.periodName) },
          { label: 'Chi nhánh', value: s(r.branchName) },
          { label: 'Khoảng thời gian', value: `${s(r.from_date)} → ${s(r.to_date)}` },
          { label: 'Tỷ lệ Chi phí Lương / Doanh thu', value: <Tag color="blue">{s(r.labor_cost_percent, '0')}%</Tag> },
          { label: 'Doanh thu cửa hàng', value: <Typography.Text strong>{vnd(r.revenue_vnd)}</Typography.Text> },
          { label: 'Quỹ lương thực tế', value: <Typography.Text strong>{vnd(r.payroll_cost_vnd)}</Typography.Text> },
          { label: 'Ghi chú đối soát', value: s(r.note, 'Không có ghi chú'), span: 2 },
        ],
      };
    case 'payPeriod':
      return {
        title: `Chi tiết Tổng hợp Kỳ lương — ${s(r.period_code)} (${s(r.name)})`,
        fields: [
          { label: 'Mã & Tên kỳ lương', value: `${s(r.period_code)} — ${s(r.name)}` },
          { label: 'Trạng thái kỳ lương', value: <StatusTag value={String(r.status)} label={r.statusLabel ? String(r.statusLabel) : undefined} /> },
          { label: 'Chu kỳ tính lương', value: `${s(r.from_date)} → ${s(r.to_date)}` },
          { label: 'Quy mô & Tổng giờ công', value: `${s(r.total_employees, '0')} nhân sự · ${s(r.total_approved_hours, '0')} giờ công duyệt` },
          { label: 'Tổng thu nhập (Gross)', value: vnd(r.total_gross_vnd) },
          { label: 'Tổng khấu trừ', value: vnd(r.total_deductions_vnd) },
          { label: 'Tổng thực lĩnh (Net)', value: <Typography.Text strong style={{ color: '#2563EB' }}>{vnd(r.total_net_vnd)}</Typography.Text> },
          { label: 'Tình trạng phiếu lương', value: `Phát hành: ${s(r.issued_payslips_count, '0')} · Đã xác nhận: ${s(r.confirmed_count, '0')} · Thắc mắc: ${s(r.disputed_count, '0')}` },
          { label: 'Ghi chú kỳ lương', value: s(r.note, 'Không có ghi chú'), span: 2 },
        ],
      };
    case 'payslipRevision':
      return {
        title: `Chi tiết Phiếu Điều chỉnh Lương — Lần #${s(r.revision, '1')}`,
        fields: [
          { label: 'Lần điều chỉnh', value: `Lần #${s(r.revision, '1')}` },
          { label: 'Trạng thái', value: <StatusTag value={String(r.status || 'APPROVED')} /> },
          { label: 'Số tiền trước / sau', value: `${vnd(r.before_amount_vnd)} → ${vnd(r.after_amount_vnd)}` },
          { label: 'Chênh lệch điều chỉnh', value: <Typography.Text strong style={{ color: Number(r.delta_vnd ?? 0) >= 0 ? '#16A34A' : '#DC2626' }}>{Number(r.delta_vnd ?? 0) >= 0 ? '+' : ''}{vnd(r.delta_vnd)}</Typography.Text> },
          { label: 'Thời điểm ghi nhận', value: dt(r.approved_at || r.created_at), span: 2 },
          { label: 'Lý do điều chỉnh', value: s(r.reason), span: 2 },
        ],
      };
    case 'accountAuditHistory':
      return {
        title: `Chi tiết Lịch sử Thay đổi Tài khoản — ${s(r.actionLabel)}`,
        fields: [
          { label: 'Thao tác thực hiện', value: <Tag color="blue">{s(r.actionLabel)}</Tag> },
          { label: 'Thời điểm ghi nhận', value: dt(r.created_at) },
          { label: 'Người thực hiện', value: `${s(r.actorDisplayName)} (@${s(r.actorUsername)})` },
          { label: 'Vai trò người thực hiện', value: s(r.actorRoleLabel) },
          { label: 'Chi tiết thay đổi', value: s(r.summary), span: 2 },
        ],
      };
    case 'plannerProbation':
      return {
        title: `Chi tiết Chu kỳ 12 ngày Thử việc — ${s(r.employeeName)} (${s(r.employeeCode)})`,
        fields: [
          { label: 'Nhân sự thử việc', value: `${s(r.employeeCode)} — ${s(r.employeeName)}` },
          { label: 'Chi nhánh & Ca mặc định', value: `${s(r.branchName)} · ${shiftLbl(r.defaultShiftCode)}` },
          { label: 'Chu kỳ 12 ngày', value: `${s(r.cycleStart)} → ${s(r.cycleEnd)}` },
          { label: 'Định mức chu kỳ', value: `Yêu cầu ${s(r.workRequired)} ca làm · Tối đa ${s(r.offLimit)} ngày OFF` },
          { label: 'Tiến độ thực tế', value: `Đã phân công: ${s(r.existingCount, '0')} ca · Hoàn thành: ${s(r.completedCount, '0')} ca` },
          { label: 'Điều kiện lên chính thức', value: r.readyForOfficial ? <Tag color="green">Đủ điều kiện xét Chính thức</Tag> : <Tag color="gold">Đang tích lũy chu kỳ thử việc</Tag> },
        ],
      };
    case 'plannerOff':
      return {
        title: `Chi tiết Đơn Đăng ký Nghỉ OFF — ${s(r.requestCode)}`,
        fields: [
          { label: 'Mã đơn OFF', value: <span className="mono">{s(r.requestCode)}</span> },
          { label: 'Trạng thái đơn', value: <StatusTag value={String(r.status)} label={r.statusLabel ? String(r.statusLabel) : undefined} /> },
          { label: 'Nhân sự đăng ký', value: `${s(r.employeeCode)} — ${s(r.employeeName)} (${stageLbl(r.stage)})` },
          { label: 'Chi nhánh & Ngày nghỉ', value: `${s(r.branchName)} · Ngày ${s(r.leaveDate)}` },
          { label: 'Lý do xin nghỉ', value: s(r.reason, 'Nghỉ định kỳ theo chu kỳ'), span: 2 },
        ],
      };
    case 'plannerShift':
      return {
        title: `Chi tiết Ca Dự kiến Phân bổ — ${s(r.workDate)} (${s(r.shiftLabel)})`,
        fields: [
          { label: 'Ngày & Khung ca', value: `${s(r.workDate)} · ${s(r.shiftLabel)} (${s(r.startAt)}–${s(r.endAt)})` },
          { label: 'Số giờ công', value: `${s(r.hours)} giờ` },
          { label: 'Nhân sự dự kiến', value: `${s(r.employeeCode)} — ${s(r.employeeName)} (${stageLbl(r.stage)})` },
          { label: 'Loại phân bổ', value: r.isCoverShift ? <Tag color="cyan">Ca điều phối trám lịch OFF</Tag> : <Tag color="blue">Ca chuẩn theo chu kỳ</Tag> },
        ],
      };
    case 'employeeTestAssignment':
      return {
        title: `Chi tiết Bài Kiểm tra Nghiệp vụ — ${s(r.testTitle)}`,
        fields: [
          { label: 'Mã giao bài', value: <span className="mono">{s(r.assignment_code)}</span> },
          { label: 'Kết quả hiện tại', value: r.passed ? <Tag color="green">Đã đạt yêu cầu</Tag> : <StatusTag value={String(r.status || 'ASSIGNED')} /> },
          { label: 'Tên bộ đề kiểm tra', value: <Typography.Text strong>{s(r.testTitle)}</Typography.Text>, span: 2 },
          { label: 'Thời lượng & Lượt làm bài', value: `${s(r.durationMinutes, '15')} phút · Đã làm ${s(r.attempts_used, '0')}/${s(r.max_attempts, '3')} lượt` },
          { label: 'Điểm cao nhất đạt được', value: <span className="num" style={{ fontWeight: 700 }}>{s(r.best_score_percent, '0')}%</span> },
          { label: 'Thời hạn mở – đóng đề', value: `${dt(r.open_at)} → ${dt(r.close_at)}`, span: 2 },
          { label: 'Ghi chú hướng dẫn', value: s(r.note, 'Hoàn thành bài kiểm tra đúng thời hạn quy định'), span: 2 },
        ],
      };
    case 'testQuestion': {
      const opts = Array.isArray(r.options) ? (r.options as string[]) : [], ansIdx = typeof r.answer === 'number' ? r.answer : -1;
      return {
        title: 'Chi tiết Câu hỏi Trắc nghiệm Nghiệp vụ',
        fields: [
          { label: 'Nội dung câu hỏi', value: <Typography.Text strong>{s(r.q)}</Typography.Text>, span: 2 },
          ...opts.map((opt, idx) => ({ label: `Phương án ${String.fromCharCode(65 + idx)}`, value: idx === ansIdx ? <Space size={6}><Typography.Text strong style={{ color: '#16A34A' }}>{opt}</Typography.Text><Tag color="green">Đáp án đúng</Tag></Space> : opt, span: 2 as const })),
        ],
      };
    }
  }
}
