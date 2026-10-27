'use client';

import type { Key } from 'react';
import { STATUS_VISUAL_MAP } from '@umbm/shared';
import type { BulkActionItem } from './BulkActionBar';
import { isAbsentShiftRecord } from './QuickAbsentAdjustmentModal';

type RowObj = Record<string, unknown>;

export interface TableSelectionPreset<TRecord = unknown> {
  key: string;
  label: string;
  filter: (row: TRecord) => boolean;
}

export interface SelectionGroupSummary<TRecord = unknown> {
  label: string;
  rows: TRecord[];
  isActionable: boolean;
}

const ACTIONABLE_STATUSES = new Set([
  'PENDING', 'STORE_CONFIRMED', 'PENDING_PEER', 'PEER_ACCEPTED', 'REPORTED',
  'DRAFT', 'PENDING_ACTIVATION', 'LOCKED', 'NEW', 'INTERVIEW_SCHEDULED', 'UNREAD', 'MISSING',
]);

export function isRowActionable(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false;
  const r = row as RowObj;
  if (r.readStatus === 'UNREAD' || r.profileStatus === 'MISSING' || r.hasAnomaly) return true;
  if ('checkInEvent' in r && !('workDate' in r)) return Boolean(r.checkInEvent && !r.checkOutEvent);
  if (r.status && ACTIONABLE_STATUSES.has(String(r.status))) return true;
  if (r.decision && ACTIONABLE_STATUSES.has(String(r.decision))) return true;
  return r.stage === 'PROBATION' || isAbsentShiftRecord(r);
}

/** Trả về nhãn trạng thái / phân nhóm tiếng Việt đặc trưng theo từng loại bảng cho bản ghi. */
export function getRowStateLabel(row: unknown): string {
  if (!row || typeof row !== 'object') return 'Bản ghi';
  const r = row as RowObj;
  if ('adjustment_code' in r || 'requested_hours' in r) {
    return r.status === 'PENDING' ? 'Chờ duyệt' : r.status === 'STORE_CONFIRMED' ? 'CH đã xác nhận' : r.status === 'APPROVED' ? 'Đã phê duyệt' : 'Đã từ chối';
  }
  if ('request_code' in r || 'leave_date' in r) {
    return r.status === 'PENDING' ? 'Chờ duyệt nghỉ OFF' : r.status === 'APPROVED' ? 'Đã phê duyệt nghỉ OFF' : 'Đã từ chối';
  }
  if ('swap_code' in r || 'from_work_date' in r) {
    return r.status === 'PENDING_PEER' ? 'Chờ đồng nghiệp nhận' : r.status === 'PEER_ACCEPTED' ? 'Đồng nghiệp đã nhận' : r.status === 'APPROVED' ? 'Đã duyệt đổi ca' : 'Đã từ chối';
  }
  if ('emergency_code' in r) {
    return r.status === 'REPORTED' ? 'Mới báo nghỉ khẩn' : r.status === 'RESOLVED' ? 'Đã có người thay ca' : 'Thiếu ca (Cảnh báo HR)';
  }
  if (('checkInEvent' in r || 'checkTimeHm' in r || 'punctualityStatus' in r) && !('workDate' in r)) {
    const inEv = (r.checkInEvent as RowObj | null) ?? (r.type === 'CHECK_IN' ? r : null);
    const outEv = (r.checkOutEvent as RowObj | null) ?? (r.type === 'CHECK_OUT' ? r : null);
    if (inEv && !outEv) return 'Đang trong ca (Chưa ra)';
    if (inEv?.punctualityStatus === 'LATE' || outEv?.punctualityStatus === 'EARLY_LEAVE') return 'Vào trễ / Ra sớm';
    return 'Hoàn thành Vào & Ra ca';
  }
  if ('workDate' in r && ('shiftCode' in r || 'shiftLabel' in r)) {
    if (r.status === 'DRAFT') return 'Chờ duyệt phân ca';
    if (r.status === 'ABSENT' || isAbsentShiftRecord(r)) return 'Vắng mặt (Cần bù công)';
    if (r.status === 'COMPLETED' || Boolean(r.checkInEvent && r.checkOutEvent)) return 'Đã hoàn thành ca';
    return 'Đã phân ca chính thức';
  }
  if ('username' in r && 'roleLabel' in r) {
    return r.status === 'PENDING_ACTIVATION' ? 'Chờ kích hoạt' : r.status === 'LOCKED' || Number(r.failedLoginCount ?? 0) > 0 ? 'Đang khóa' : r.status === 'REVOKED' ? 'Đã thu hồi' : 'Đang hoạt động';
  }
  if ('profileStatus' in r && 'historyCount' in r) return String(r.profileStatusLabel || (r.profileStatus === 'ACTIVE' ? 'Đang áp dụng' : 'Chưa thiết lập lương'));
  if ('probationHours' in r && 'officialHours' in r) return r.hasAnomaly ? 'Cần đối soát công' : 'Đã khớp công hợp lệ';
  if ('itemTypeLabel' in r && 'direction' in r) return r.direction === 'ADD' ? 'Khoản cộng (Thưởng/Phụ cấp)' : 'Khoản trừ (Khấu trừ)';
  if ('employeeCode' in r && 'stage' in r && 'staffGroup' in r) return r.stage === 'PROBATION' ? 'Nhân viên Thử việc' : 'Nhân viên Chính thức';
  if ('readStatus' in r && 'severity' in r) return r.readStatus === 'UNREAD' ? 'Chưa đọc' : 'Đã đọc';
  if ('actorUsername' in r && 'actionLabel' in r) return r.isArchived ? 'Đã lưu trữ' : String(r.entityLabel || 'Hiện hành');
  if ('candidate_code' in r) return STATUS_VISUAL_MAP[String(r.stage || r.status)]?.label ?? String(r.stage || r.status || 'Ứng viên');
  if ('candidateName' in r && 'decision' in r) return r.reschedule_requested ? 'Cần đổi lịch' : r.decision === 'PENDING' ? 'Chờ kết quả phỏng vấn' : r.decision === 'PASS' ? 'Đạt phỏng vấn' : 'Đã chấm phỏng vấn';
  if ('assignment_code' in r && 'attempts_used' in r) return Number(r.best_score_percent ?? 0) >= 80 || r.status === 'PASSED' ? 'Đã đạt TEST' : 'Chưa đạt / Đang thi';
  if ('attempt_no' in r && 'score_percent' in r) return r.passed ? 'Đạt yêu cầu' : 'Chưa đạt';
  if ('is_locked_policy' in r) return r.is_locked_policy ? 'Khóa cốt lõi' : 'Đang áp dụng';
  if ('backup_code' in r) return r.verified_restore ? 'Đã kiểm chứng' : 'Bản sao lưu';
  if ('readReceiptLabel' in r) return r.ack_at ? 'Đã xác nhận đọc' : 'Chưa xác nhận đọc';
  if ('announcement_code' in r) return r.status === 'SENT' ? 'Đã phát hành' : r.status === 'SCHEDULED' ? 'Đã lên lịch' : 'Bản nháp';
  if ('recipientCount' in r) return r.isCustom ? 'Nhóm đã cấu hình' : 'Nhóm mặc định';
  if ('campaign_code' in r) return r.status === 'RUNNING' || r.status === 'ACTIVE' ? 'Đang chạy' : 'Bản nháp / Kết thúc';
  if ('mime_type' in r && 'drive_url' in r) return r.is_internal_only ? 'Lưu hành nội bộ' : 'Đã duyệt';
  if ('min_staff' in r && 'enforcement' in r) return r.enforcement === 'HARD_BLOCK' ? 'Chặn cứng định biên' : 'Cảnh báo mềm';
  if ('department' in r && 'code' in r) return String(r.department || 'Cửa hàng');
  if (r.status) return STATUS_VISUAL_MAP[String(r.status)]?.label ?? String(r.statusLabel || r.status);
  return 'Bản ghi';
}

type PresetTuple = [key: string, label: string, fn: (r: RowObj) => boolean];

const TABLE_PRESET_RULES: { match: (s: RowObj) => boolean; items: PresetTuple[] }[] = [
  { match: (s) => 'adjustment_code' in s || 'requested_hours' in s, items: [['adj-p', 'Chỉ chọn: Chờ duyệt', (r) => r.status === 'PENDING'], ['adj-s', 'Chỉ chọn: CH đã xác nhận', (r) => r.status === 'STORE_CONFIRMED'], ['adj-a', 'Chỉ chọn: Đã phê duyệt', (r) => r.status === 'APPROVED'], ['adj-r', 'Chỉ chọn: Đã từ chối', (r) => r.status === 'REJECTED']] },
  { match: (s) => 'request_code' in s || 'leave_date' in s, items: [['lv-p', 'Chỉ chọn: Chờ duyệt nghỉ OFF', (r) => r.status === 'PENDING'], ['lv-a', 'Chỉ chọn: Đã phê duyệt nghỉ OFF', (r) => r.status === 'APPROVED'], ['lv-r', 'Chỉ chọn: Đã từ chối', (r) => r.status === 'REJECTED']] },
  { match: (s) => 'swap_code' in s || 'from_work_date' in s, items: [['sw-1', 'Chỉ chọn: Chờ đồng nghiệp nhận ca', (r) => r.status === 'PENDING_PEER'], ['sw-2', 'Chỉ chọn: Đồng nghiệp đã nhận (Chờ QL duyệt)', (r) => r.status === 'PEER_ACCEPTED'], ['sw-3', 'Chỉ chọn: Đã phê duyệt đổi ca', (r) => r.status === 'APPROVED'], ['sw-4', 'Chỉ chọn: Đã từ chối', (r) => r.status === 'REJECTED']] },
  { match: (s) => 'emergency_code' in s, items: [['em-1', 'Chỉ chọn: Mới báo nghỉ khẩn (Chờ xử lý)', (r) => r.status === 'REPORTED'], ['em-2', 'Chỉ chọn: Đã bố trí người thay ca', (r) => r.status === 'RESOLVED'], ['em-3', 'Chỉ chọn: Thiếu ca (Cảnh báo HR)', (r) => r.status === 'ESCALATED']] },
  { match: (s) => ('checkInEvent' in s || 'checkTimeHm' in s || 'punctualityStatus' in s) && !('workDate' in s), items: [['at-1', 'Chỉ chọn: Hoàn thành Vào & Ra ca', (r) => Boolean(r.checkInEvent && r.checkOutEvent)], ['at-2', 'Chỉ chọn: Đang trong ca (Chưa ra ca)', (r) => Boolean(r.checkInEvent && !r.checkOutEvent)], ['at-3', 'Chỉ chọn: Vào trễ / Ra sớm', (r) => (r.checkInEvent as RowObj | undefined)?.punctualityStatus === 'LATE' || (r.checkOutEvent as RowObj | undefined)?.punctualityStatus === 'EARLY_LEAVE' || r.punctualityStatus === 'LATE']] },
  { match: (s) => 'workDate' in s && ('shiftCode' in s || 'shiftLabel' in s), items: [['sc-1', 'Chỉ chọn: Chờ duyệt phân ca', (r) => r.status === 'DRAFT'], ['sc-2', 'Chỉ chọn: Đã phân ca chính thức', (r) => r.status === 'PUBLISHED' && !isAbsentShiftRecord(r)], ['sc-3', 'Chỉ chọn: Vắng mặt — Cần bổ sung công', (r) => r.status === 'ABSENT' || isAbsentShiftRecord(r)], ['sc-4', 'Chỉ chọn: Đã hoàn thành ca', (r) => r.status === 'COMPLETED' || Boolean(r.checkInEvent && r.checkOutEvent)]] },
  { match: (s) => 'username' in s && 'roleLabel' in s, items: [['ac-1', 'Chỉ chọn: Chờ kích hoạt', (r) => r.status === 'PENDING_ACTIVATION'], ['ac-2', 'Chỉ chọn: Đang hoạt động', (r) => r.status === 'ACTIVE'], ['ac-3', 'Chỉ chọn: Đang khóa / Đăng nhập sai', (r) => r.status === 'LOCKED' || Number(r.failedLoginCount ?? 0) > 0], ['ac-4', 'Chỉ chọn: Đã thu hồi', (r) => r.status === 'REVOKED']] },
  { match: (s) => 'profileStatus' in s && 'historyCount' in s, items: [['sp-1', 'Chỉ chọn: Đang áp dụng mức lương', (r) => r.profileStatus === 'ACTIVE'], ['sp-2', 'Chỉ chọn: Chưa thiết lập lương', (r) => r.profileStatus === 'MISSING' || !r.profile], ['sp-3', 'Chỉ chọn: Lương theo giờ', (r) => (r.profile as RowObj | undefined)?.rateType === 'HOURLY'], ['sp-4', 'Chỉ chọn: Lương theo tháng', (r) => (r.profile as RowObj | undefined)?.rateType === 'MONTHLY']] },
  { match: (s) => 'probationHours' in s && 'officialHours' in s, items: [['py-1', 'Chỉ chọn: Cần đối soát / Đơn bù công chờ duyệt', (r) => Boolean(r.hasAnomaly) || Number(r.pendingAdjCount ?? 0) > 0 || Number(r.missingCheckoutCount ?? 0) > 0], ['py-2', 'Chỉ chọn: Đã khớp công hợp lệ', (r) => !r.hasAnomaly], ['py-3', 'Chỉ chọn: Có giờ công Chính thức', (r) => Number(r.officialHours ?? 0) > 0], ['py-4', 'Chỉ chọn: Có giờ công Thử việc', (r) => Number(r.probationHours ?? 0) > 0]] },
  { match: (s) => 'itemTypeLabel' in s && 'direction' in s, items: [['pi-1', 'Chỉ chọn: Khoản cộng (Thưởng & Phụ cấp)', (r) => r.direction === 'ADD'], ['pi-2', 'Chỉ chọn: Khoản trừ (Khấu trừ)', (r) => r.direction === 'DEDUCT']] },
  { match: (s) => 'employeeCode' in s && 'stage' in s && 'staffGroup' in s, items: [['em-p', 'Chỉ chọn: Nhân viên Thử việc', (r) => r.stage === 'PROBATION'], ['em-o', 'Chỉ chọn: Nhân viên Chính thức', (r) => r.stage === 'OFFICIAL'], ['em-a', 'Chỉ chọn: Đang làm việc', (r) => r.status === 'ACTIVE'], ['em-i', 'Chỉ chọn: Đã nghỉ việc / Tạm nghỉ', (r) => r.status !== 'ACTIVE']] },
  { match: (s) => 'radiusM' in s && 'openTime' in s, items: [['br-1', 'Chỉ chọn: Chi nhánh Đang hoạt động', (r) => r.status === 'ACTIVE'], ['br-2', 'Chỉ chọn: Chi nhánh Tạm ngưng', (r) => r.status !== 'ACTIVE']] },
  { match: (s) => 'standardHours' in s && 'startTime' in s, items: [['st-1', 'Chỉ chọn: Mẫu ca Đang áp dụng', (r) => r.status === 'ACTIVE'], ['st-2', 'Chỉ chọn: Áp dụng Tất cả chi nhánh', (r) => !r.branchId || r.branchId === 'ALL'], ['st-3', 'Chỉ chọn: Áp dụng Chi nhánh riêng', (r) => Boolean(r.branchId && r.branchId !== 'ALL')]] },
  { match: (s) => 'min_staff' in s && 'enforcement' in s, items: [['sr-1', 'Chỉ chọn: Chặn cứng khi thiếu định biên', (r) => r.enforcement === 'HARD_BLOCK'], ['sr-2', 'Chỉ chọn: Cảnh báo mềm khi thiếu người', (r) => r.enforcement !== 'HARD_BLOCK']] },
  { match: (s) => 'department' in s && 'code' in s && 'label' in s, items: [['jp-1', 'Chỉ chọn: Khối Cửa hàng', (r) => String(r.department || '').includes('Cửa hàng')], ['jp-2', 'Chỉ chọn: Khối Văn phòng / Kho / Marketing', (r) => !String(r.department || '').includes('Cửa hàng')], ['jp-3', 'Chỉ chọn: Vị trí đang có nhân sự', (r) => Number(r.employeeCount ?? 0) > 0]] },
  { match: (s) => 'readStatus' in s && 'severity' in s, items: [['nt-1', 'Chỉ chọn: Thông báo Chưa đọc', (r) => r.readStatus === 'UNREAD'], ['nt-2', 'Chỉ chọn: Thông báo Đã đọc', (r) => r.readStatus === 'READ'], ['nt-3', 'Chỉ chọn: Mức độ Quan trọng & Khẩn cấp', (r) => r.severity === 'CRITICAL' || r.severity === 'WARNING']] },
  { match: (s) => 'actorUsername' in s && 'actionLabel' in s, items: [['au-1', 'Chỉ chọn: Nhật ký Hiện hành', (r) => !r.isArchived], ['au-2', 'Chỉ chọn: Đã lưu trữ', (r) => Boolean(r.isArchived)]] },
  { match: (s) => 'candidate_code' in s, items: [['cn-1', 'Chỉ chọn: Ứng viên Mới tiếp nhận', (r) => (r.status || r.stage) === 'NEW'], ['cn-2', 'Chỉ chọn: Đã liên hệ', (r) => (r.status || r.stage) === 'CONTACTED'], ['cn-3', 'Chỉ chọn: Đã xếp lịch phỏng vấn', (r) => (r.status || r.stage) === 'INTERVIEW_SCHEDULED'], ['cn-4', 'Chỉ chọn: Đạt phỏng vấn / Mời thử việc', (r) => (r.status || r.stage) === 'HIRED'], ['cn-5', 'Chỉ chọn: Chưa phù hợp', (r) => (r.status || r.stage) === 'REJECTED']] },
  { match: (s) => 'candidateName' in s && 'decision' in s, items: [['iv-1', 'Chỉ chọn: Chờ kết quả phỏng vấn', (r) => r.decision === 'PENDING'], ['iv-2', 'Chỉ chọn: Cần đổi lịch phỏng vấn', (r) => Boolean(r.reschedule_requested) || r.status === 'RESCHEDULE_NEEDED'], ['iv-3', 'Chỉ chọn: Đạt phỏng vấn', (r) => r.decision === 'PASS'], ['iv-4', 'Chỉ chọn: Cân nhắc / Chưa phù hợp', (r) => r.decision === 'HOLD' || r.decision === 'FAIL']] },
  { match: (s) => 'pass_percent' in s && 'duration_minutes' in s, items: [['tb-1', 'Chỉ chọn: Bộ đề Đang áp dụng', (r) => r.status === 'APPROVED' || r.status === 'ACTIVE'], ['tb-2', 'Chỉ chọn: Bộ đề Bản nháp', (r) => r.status === 'DRAFT']] },
  { match: (s) => 'assignment_code' in s && 'attempts_used' in s, items: [['ta-1', 'Chỉ chọn: Chưa đạt / Đang làm bài', (r) => Number(r.best_score_percent ?? 0) < 80 && r.status !== 'PASSED'], ['ta-2', 'Chỉ chọn: Đã đạt bài kiểm tra', (r) => Number(r.best_score_percent ?? 0) >= 80 || r.status === 'PASSED'], ['ta-3', 'Chỉ chọn: Chưa thi lượt nào (0 lượt)', (r) => Number(r.attempts_used ?? 0) === 0]] },
  { match: (s) => 'attempt_no' in s && 'score_percent' in s, items: [['atp-1', 'Chỉ chọn: Lượt thi Đạt yêu cầu', (r) => Boolean(r.passed)], ['atp-2', 'Chỉ chọn: Lượt thi Chưa đạt', (r) => !r.passed]] },
  { match: (s) => 'is_locked_policy' in s, items: [['pl-1', 'Chỉ chọn: Chính sách Đang áp dụng', (r) => !r.is_locked_policy], ['pl-2', 'Chỉ chọn: Chính sách Khóa cốt lõi', (r) => Boolean(r.is_locked_policy)]] },
  { match: (s) => 'backup_code' in s, items: [['bk-1', 'Chỉ chọn: Sao lưu Thành công', (r) => r.status === 'SUCCESS'], ['bk-2', 'Chỉ chọn: Đã diễn tập kiểm chứng', (r) => Boolean(r.verified_restore)]] },
  { match: (s) => 'announcement_code' in s, items: [['mk-1', 'Chỉ chọn: Bản tin Đã phát hành', (r) => r.status === 'SENT'], ['mk-2', 'Chỉ chọn: Bản nháp / Đã lên lịch', (r) => r.status !== 'SENT'], ['mk-3', 'Chỉ chọn: Mức độ Khẩn cấp / Quan trọng', (r) => r.priority === 'URGENT' || r.priority === 'HIGH']] },
  { match: (s) => 'recipientCount' in s, items: [['aud-1', 'Chỉ chọn: Nhóm mặc định hệ thống', (r) => !r.isCustom], ['aud-2', 'Chỉ chọn: Nhóm tùy chỉnh đã cấu hình', (r) => Boolean(r.isCustom)]] },
  { match: (s) => 'campaign_code' in s, items: [['cmp-1', 'Chỉ chọn: Chiến dịch Đang chạy', (r) => r.status === 'RUNNING' || r.status === 'ACTIVE'], ['cmp-2', 'Chỉ chọn: Bản nháp / Đã kết thúc', (r) => r.status !== 'RUNNING' && r.status !== 'ACTIVE']] },
  { match: (s) => 'mime_type' in s && 'drive_url' in s, items: [['med-1', 'Chỉ chọn: Chỉ lưu hành nội bộ', (r) => Boolean(r.is_internal_only)], ['med-2', 'Chỉ chọn: Đã duyệt công khai', (r) => !r.is_internal_only]] },
  { match: (s) => 'readReceiptLabel' in s, items: [['dlv-1', 'Chỉ chọn: Chưa xác nhận đọc', (r) => !r.ack_at], ['dlv-2', 'Chỉ chọn: Đã xác nhận đọc', (r) => Boolean(r.ack_at)]] },
];

export function detectTablePresets<TRecord>(dataSource: readonly TRecord[]): TableSelectionPreset<TRecord>[] {
  const sample = (dataSource[0] ?? {}) as RowObj;
  const matchedRule = TABLE_PRESET_RULES.find((rule) => rule.match(sample));
  if (matchedRule) {
    return matchedRule.items.map(([key, label, fn]) => ({ key, label, filter: (row) => fn(row as unknown as RowObj) }));
  }
  const labels = Array.from(new Set(dataSource.map((r) => getRowStateLabel(r)).filter((l) => l && l !== 'Bản ghi')));
  return labels.map((lbl, idx) => ({ key: `state-${idx}`, label: `Chỉ chọn: ${lbl}`, filter: (row) => getRowStateLabel(row) === lbl }));
}

export function buildTableSelections<TRecord>(
  dataSource: readonly TRecord[],
  getKey: (row: TRecord) => Key,
  setSelectedRowKeys: (keys: Key[]) => void,
  actions: BulkActionItem<TRecord>[] = [],
  customPresets?: TableSelectionPreset<TRecord>[],
) {
  const presets = customPresets ?? detectTablePresets(dataSource);
  const presetItems = presets.map((p) => {
    const matched = dataSource.filter(p.filter);
    return { key: p.key, text: `${p.label} (${matched.length})`, onSelect: () => setSelectedRowKeys(matched.map(getKey)) };
  });
  return [
    { key: 'all-page', text: `Chọn tất cả trang này (${dataSource.length})`, onSelect: () => setSelectedRowKeys(dataSource.map(getKey)) },
    ...presetItems,
    { key: 'clear-all', text: 'Bỏ chọn tất cả', onSelect: () => setSelectedRowKeys([]) },
  ];
}

export function describeSelectionBreakdown<TRecord>(
  selectedRows: readonly TRecord[],
  actions: BulkActionItem<TRecord>[] = [],
): SelectionGroupSummary<TRecord>[] {
  const filterable = actions.filter((a) => typeof a.eligibleFilter === 'function');
  const groups = new Map<string, TRecord[]>();
  for (const row of selectedRows) {
    const lbl = getRowStateLabel(row);
    const list = groups.get(lbl) ?? [];
    list.push(row);
    groups.set(lbl, list);
  }
  return Array.from(groups.entries()).map(([label, rows]) => ({
    label,
    rows,
    isActionable: rows.some((r) => (filterable.length > 0 ? filterable.some((a) => a.eligibleFilter!(r)) : isRowActionable(r))),
  }));
}
