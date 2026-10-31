'use client';

import { Space, Tag, Typography } from 'antd';
import { TABLE_DISPLAY_LABELS } from '@umbm/shared';
import { StatusTag } from '../StatusTag';
import { buildOpsQuickDetailSpec, type OpsQuickDetailKind, type QuickDetailField, type QuickDetailSpec } from './record-quick-detail-ops';

export type { QuickDetailField, QuickDetailSpec };

export type QuickDetailKind =
  | 'staffingRule' | 'partition' | 'sheetTableStat' | 'reconcileIssue'
  | 'dashboardBranch' | 'hrBranchReport' | 'campaign' | 'deliveryLog'
  | OpsQuickDetailKind;

type Rec = Record<string, unknown>;
const s = (v: unknown, fb = '—') => (v === null || v === undefined || v === '' ? fb : String(v));
const dt = (v: unknown) => (v ? String(v).slice(0, 19).replace('T', ' ') : '—');
const CHANNEL_MAP: Record<string, string> = { IN_APP: 'Thông báo trên hệ thống', EMAIL: 'Thư điện tử (Email)', MULTI: 'Đa kênh (Hệ thống & Email)', ALL: 'Đa kênh (Hệ thống & Email)' };
const SCOPE_MAP: Record<string, string> = { ALL: 'Toàn hệ thống', BRANCH: 'Theo chi nhánh', ROLE: 'Theo vai trò', STAGE: 'Theo giai đoạn nhân sự', STAFF_GROUP: 'Theo khối nhân sự', CUSTOM: 'Nhóm tùy chỉnh' };

export function buildQuickDetailSpec(kind: QuickDetailKind, raw: unknown): QuickDetailSpec {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Rec;
  switch (kind) {
    case 'staffingRule':
      return {
        title: `Chi tiết Định biên Nhân sự — ${s(r.branchCode)} (${s(r.shiftName)})`,
        fields: [
          { label: 'Chi nhánh áp dụng', value: `${s(r.branchCode)} — ${s(r.branchName)}` },
          { label: 'Khung ca áp dụng', value: `${s(r.shiftName)}${r.shiftTimeRange ? ` (${s(r.shiftTimeRange)})` : ''}` },
          { label: 'Định biên nhân sự / ca', value: Number(r.min_staff) === 1 && Number(r.max_staff) === 1 ? <Tag color="green">Đúng 1 nhân sự / ca</Tag> : `${s(r.min_staff)} – ${s(r.max_staff)} nhân sự / ca` },
          { label: 'Chế độ kiểm soát', value: r.enforcement === 'HARD_BLOCK' ? <Tag color="red">Chặn cứng khi sai định biên</Tag> : <Tag color="gold">Cảnh báo mềm khi thiếu người</Tag> },
          { label: 'Ghi chú vận hành', value: s(r.note, 'Không có ghi chú'), span: 2 },
        ],
      };
    case 'partition': {
      const tabs = Array.isArray(r.tabs) ? (r.tabs as string[]) : [];
      return {
        title: `Chi tiết Phân vùng Dữ liệu — ${s(r.label)}`,
        externalLink: r.webViewLink ? { label: 'Mở tệp Google Sheets trên Drive', href: String(r.webViewLink) } : undefined,
        fields: [
          { label: 'Kỳ phân vùng', value: <Typography.Text strong>{s(r.label)}</Typography.Text> },
          { label: 'Trạng thái vận hành', value: r.isActive ? <Tag color="green">Đang ghi & đọc chính thức</Tag> : <Tag>Lưu trữ lịch sử</Tag> },
          { label: 'Chế độ tệp lưu trữ', value: r.mode === 'MONTHLY_FILE' ? 'Tệp Google Sheets độc lập theo tháng' : 'Tệp Google Sheets gốc mặc định' },
          { label: 'Thời điểm khởi tạo', value: dt(r.createdAt) },
          { label: 'Tên tệp trên Google Drive', value: s(r.fileName, 'Tệp mặc định hệ thống'), span: 2 },
          { label: 'Thư mục lưu trữ Drive', value: s(r.folderPath, 'Thư mục gốc hệ thống'), span: 2 },
          { label: 'Các bảng dữ liệu trong tệp', value: tabs.length ? <Space size={[4, 4]} wrap>{tabs.map((t) => <Tag key={t} color="blue">{TABLE_DISPLAY_LABELS[t] ?? t}</Tag>)}</Space> : '5 bảng lịch làm việc & chấm công chuẩn', span: 2 },
        ],
      };
    }
    case 'sheetTableStat': {
      const tblLabel = TABLE_DISPLAY_LABELS[String(r.table)] ?? s(r.table);
      const invalidList = Array.isArray(r.invalid) ? (r.invalid as { row: number; issues: string[] }[]) : [];
      return {
        title: `Chi tiết Đồng bộ Bảng Dữ liệu — ${tblLabel}`,
        fields: [
          { label: 'Tên bảng nghiệp vụ', value: <Typography.Text strong>{tblLabel}</Typography.Text> },
          { label: 'Thời điểm nạp gần nhất', value: dt(r.loadedAt) },
          { label: 'Số bản ghi hợp lệ', value: <span className="num" style={{ fontWeight: 600 }}>{Number(r.rows ?? 0)} bản ghi</span> },
          { label: 'Dòng sai cấu trúc', value: Number(r.invalidRows ?? 0) > 0 ? <Tag color="red">{s(r.invalidRows)} dòng cần kiểm tra</Tag> : <Tag color="green">0 dòng lỗi (Chuẩn 100%)</Tag> },
          { label: 'Chi tiết kiểm tra dòng', value: invalidList.length ? invalidList.map((it) => `Dòng #${it.row}: ${it.issues.join('; ')}`).join(' | ') : 'Toàn bộ dữ liệu trong bảng khớp hoàn toàn với chuẩn cấu trúc hệ thống.', span: 2 },
        ],
      };
    }
    case 'reconcileIssue':
      return {
        title: `Chi tiết Cảnh báo Đối soát — ${s(r.label)}`,
        fields: [
          { label: 'Bảng dữ liệu kiểm tra', value: TABLE_DISPLAY_LABELS[String(r.table)] ?? s(r.table) },
          { label: 'Mức độ cảnh báo', value: r.severity === 'error' ? <Tag color="red">Sai lệch nghiêm trọng</Tag> : <Tag color="gold">Cảnh báo đối soát</Tag> },
          { label: 'Hạng mục phát hiện', value: s(r.label) },
          { label: 'Trạng thái tự sửa chữa', value: r.autoRepaired ? <Tag color="green">Đã tự động đồng bộ</Tag> : <Tag color="orange">Cần quản trị viên kiểm tra</Tag> },
          { label: 'Nội dung chi tiết', value: s(r.message), span: 2 },
        ],
      };
    case 'dashboardBranch': {
      const pNames = Array.isArray(r.presentNames) ? (r.presentNames as string[]) : [], wNames = Array.isArray(r.notCheckedInNames) ? (r.notCheckedInNames as string[]) : [];
      return {
        title: `Tình hình Nhân sự & Vận hành — ${s(r.code)} (${s(r.name)})`,
        fields: [
          { label: 'Chi nhánh', value: `${s(r.code)} — ${s(r.name)}` },
          { label: 'Trạng thái định biên', value: r.isUnderstaffed ? <Tag color="red">Đang thiếu định biên ca</Tag> : <Tag color="green">Đảm bảo đủ định biên</Tag> },
          { label: 'Tổng nhân sự chi nhánh', value: `${s(r.totalStaff, '0')} nhân sự (${s(r.officialCount, '0')} chính thức · ${s(r.probationCount, '0')} thử việc)` },
          { label: 'Số ca trực', value: `Hôm nay: ${s(r.todayShiftCount, '0')} ca · Trong kỳ lọc: ${s(r.periodShiftCount, '0')} ca` },
          { label: 'Điểm danh hôm nay', value: `Có mặt: ${s(r.present, '0')} · Chưa vào ca: ${s(r.notCheckedIn, '0')} · Vắng: ${s(r.absent, '0')} · Nghỉ OFF: ${s(r.offCount, '0')}`, span: 2 },
          { label: 'Nhân sự đã vào ca', value: pNames.length ? pNames.join(', ') : 'Chưa có nhân sự chấm công vào ca', span: 2 },
          { label: 'Nhân sự chưa vào ca', value: wNames.length ? wNames.join(', ') : 'Không có nhân sự chờ vào ca', span: 2 },
        ],
      };
    }
    case 'hrBranchReport':
      return {
        title: `Báo cáo Vận hành Cửa hàng — ${s(r.branchCode)} (${s(r.branchName)})`,
        fields: [
          { label: 'Chi nhánh', value: `${s(r.branchCode)} — ${s(r.branchName)}` },
          { label: 'Tỷ lệ phủ kín ca', value: <Tag color={Number(r.coverageRate ?? 100) >= 95 ? 'green' : 'gold'}>{s(r.coverageRate, '0')}%</Tag> },
          { label: 'Quy mô nhân sự', value: `${s(r.headcount, '0')} nhân sự (${s(r.officialCount, '0')} chính thức · ${s(r.probationCount, '0')} thử việc)` },
          { label: 'Ứng viên đang tuyển', value: `${s(r.candidateCount, '0')} ứng viên` },
          { label: 'Khối lượng lịch & giờ công', value: `${s(r.workDaysCount, '0')} ngày có lịch · ${s(r.shiftCount, '0')} lượt ca · ${s(r.totalHours, '0')} giờ` },
          { label: 'Kỷ luật chấm công & định biên', value: `Đi trễ: ${s(r.lateCount, '0')} · Vắng mặt: ${s(r.absentCount, '0')} · Thiếu định biên: ${s(r.understaffedCount, '0')} ca` },
        ],
      };
    case 'campaign':
      return {
        title: `Chi tiết Chiến dịch Truyền thông — ${s(r.name)}`,
        fields: [
          { label: 'Mã chiến dịch', value: <span className="mono">{s(r.campaign_code || r.code)}</span> },
          { label: 'Trạng thái', value: <StatusTag value={String(r.status || 'DRAFT')} /> },
          { label: 'Tên chiến dịch', value: <Typography.Text strong>{s(r.name)}</Typography.Text>, span: 2 },
          { label: 'Kênh phát hành', value: CHANNEL_MAP[String(r.channel)] ?? s(r.channel, 'Thông báo hệ thống') },
          { label: 'Phạm vi đối tượng', value: SCOPE_MAP[String(r.audience_scope)] ?? s(r.audience_scope, 'Toàn hệ thống') },
          { label: 'Thời gian triển khai', value: `${dt(r.start_at || r.scheduled_at)} → ${dt(r.end_at)}` },
          { label: 'Tiến độ bản tin', value: `Đã phát hành ${s(r.sentCount, '0')} / ${s(r.totalAnnouncements, '0')} bản tin` },
          { label: 'Mô tả & Ghi chú', value: s(r.description || r.note, 'Không có ghi chú'), span: 2 },
        ],
      };
    case 'deliveryLog':
      return {
        title: `Chi tiết Nhật ký Gửi Thông báo — ${s(r.announcementCode || r.announcementTitle)}`,
        fields: [
          { label: 'Bản tin thông báo', value: <Typography.Text strong>{s(r.announcementTitle)}</Typography.Text>, span: 2 },
          { label: 'Người nhận', value: s(r.recipientName) },
          { label: 'Kênh gửi', value: CHANNEL_MAP[String(r.channel)] ?? s(r.channel) },
          { label: 'Trạng thái phân phối', value: <StatusTag value={String(r.status || 'SENT')} /> },
          { label: 'Trạng thái đọc & xác nhận', value: `${s(r.readReceiptLabel, 'Chưa đọc')} (Lần gửi: ${s(r.attempts, '1')})` },
          { label: 'Thời điểm gửi / nhận', value: `Gửi: ${dt(r.sent_at)} · Nhận: ${dt(r.delivered_at)}` },
          { label: 'Thời điểm đọc / xác nhận', value: `Đọc: ${dt(r.read_at)} · Xác nhận: ${dt(r.ack_at)}` },
          ...(r.last_error ? [{ label: 'Chi tiết lỗi gửi', value: <Typography.Text type="danger">{s(r.last_error)}</Typography.Text>, span: 2 as const }] : []),
        ],
      };
    default:
      return buildOpsQuickDetailSpec(kind, r);
  }
}
