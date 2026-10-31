import { SPREADSHEETS } from '@umbm/shared';
import { serializeCell } from '../sheets/a1.js';
import type { InMemorySheetsGateway } from '../sheets/gateway.js';
import { newId, nowIso } from '../lib/time.js';
import { MEMORY_IDS } from './memory-seed.js';

function row(headers: readonly string[], data: Record<string, unknown>): string[] {
  return headers.map((h) => serializeCell(data[h]));
}

export function seedExtraTables(gw: InMemorySheetsGateway, ctx: { cn1: string; emp1Id: string; emp2Id: string; assign1Id: string; assign2Id: string }) {
  const now = nowIso();
  const sys = (id = newId()) => ({ id, created_at: now, created_by: 'seed', updated_at: now, updated_by: 'seed', version: 1, is_deleted: false });

  const polH = SPREADSHEETS.CORE.tabs.POLICIES;
  const policies = [
    { key: 'ATTENDANCE_WINDOW', title: 'Khung thời gian mở cổng điểm danh trước/sau ca', category: 'ATTENDANCE', value_json: '{"before_minutes":15,"after_minutes":30}', policy_version: 'v5.1', effective_from: '2026-01-01', approved_by: 'admin', is_locked_policy: false, note: 'Cho phép điểm danh sớm 15 phút' },
    { key: 'PROBATION_OFF_QUOTA', title: 'Định mức ngày nghỉ OFF trong chu kỳ thử việc 12 ngày', category: 'LEAVE', value_json: '{"cycle_days":12,"max_off_days":5}', policy_version: 'v5.1', effective_from: '2026-01-01', approved_by: 'admin', is_locked_policy: false, note: '7 ngày làm / 5 ngày nghỉ' },
    { key: 'OT_PENALTY_POLICY', title: 'Chính sách hệ số OT & khấu trừ lương đã phê duyệt', category: 'PAYROLL', value_json: '{"ot_multiplier":1.5,"swap_allowance_vnd":30000}', policy_version: 'v5.1', effective_from: '2026-01-01', approved_by: 'owner', is_locked_policy: true, note: 'Khóa chỉnh sửa tự do nếu chưa có phê duyệt Chủ dự án' },
  ].map((p) => ({ ...sys(), effective_to: '', approved_at: now, ...p }));
  gw.seed(MEMORY_IDS.CORE, 'POLICIES', [[...polH], ...policies.map((p) => row(polH, p))]);

  const maintH = SPREADSHEETS.CORE.tabs.MAINTENANCE;
  const maint = [
    { ...sys(), scope: 'EMPLOYEE_APP', enabled: false, title: 'Bảo trì Cổng Nhân viên Mobile', message: 'Hệ thống đang nâng cấp định kỳ, dự kiến hoàn tất sau 15 phút.', expected_end_at: '2026-10-25T02:00:00+07:00', target_module: 'ATTENDANCE', started_at: '' },
  ];
  gw.seed(MEMORY_IDS.CORE, 'MAINTENANCE', [[...maintH], ...maint.map((m) => row(maintH, m))]);

  const candId = newId();
  const candH = SPREADSHEETS.HR.tabs.CANDIDATES;
  const candidates = [
    { ...sys(candId), candidate_code: 'UV0001', source_row: 'WEB-101', full_name: 'Lê Hoàng Bảo Ngọc', phone: '0901000088', email: 'baongoc.uv@gmail.com', position: 'Pha chế', staff_group: 'BARISTA', branch_pref: ctx.cn1, shift_pref: 'CA_SANG', status: 'INTERVIEW_SCHEDULED', source_channel: 'WEB', birth_year: '2004', gender: 'Nữ', experience_note: '1 năm pha chế trà sữa', hr_note: 'Ứng viên tiềm năng, hẹn phỏng vấn 30 phút', cv_file_id: '', assigned_hr_id: 'hr', contacted_at: now },
  ];
  gw.seed(MEMORY_IDS.HR, 'CANDIDATES', [[...candH], ...candidates.map((c) => row(candH, c))]);

  const histH = SPREADSHEETS.HR.tabs.EMPLOYEE_STAGE_HISTORY;
  const stageHist = [
    { ...sys(), employee_id: ctx.emp2Id, from_stage: 'PROBATION', to_stage: 'OFFICIAL', effective_from: '2026-08-01', decided_by: 'hr', note: 'Hoàn thành xuất sắc 12 ngày thử việc và đạt 90% bài thi TEST SOP', change_type: 'PROMOTE_OFFICIAL', from_branch_id: ctx.cn1, to_branch_id: ctx.cn1, from_shift_code: 'CA_CHIEU', to_shift_code: 'CA_CHIEU', probation_hours_completed: 60, test_score_percent: 90, evaluation_summary: 'Đạt chuẩn kỹ năng pha chế & thu ngân V5.1', approved_by: 'hr' },
  ];
  gw.seed(MEMORY_IDS.HR, 'EMPLOYEE_STAGE_HISTORY', [[...histH], ...stageHist.map((h) => row(histH, h))]);

  const intH = SPREADSHEETS.HR.tabs.INTERVIEWS;
  const interviews = [
    { ...sys(), candidate_id: candId, branch_id: ctx.cn1, start_at: '2026-10-25T09:00:00+07:00', end_at: '2026-10-25T09:30:00+07:00', duration_minutes: 30, meet_link: 'https://meet.google.com/umb-hr-v51', interviewer_id: 'hr', status: 'CONFIRMED', candidate_confirmed: true, reschedule_requested: false, reschedule_reason: '', appearance_score: 9, attitude_score: 9, skill_score: 8, score: 8.7, comment: 'Thái độ tốt, nắm vững quy trình vệ sinh quầy', decision: 'PASS', calendar_event_id: 'cal_01', decided_at: now },
  ];
  gw.seed(MEMORY_IDS.HR, 'INTERVIEWS', [[...intH], ...interviews.map((i) => row(intH, i))]);

  const testId = newId();
  const tbH = SPREADSHEETS.HR.tabs.TEST_BANK;
  const questions = JSON.stringify([
    { id: 'q1', text: 'Nhiệt độ bảo quản sữa tươi chuẩn tại quầy Ụm Bò Milk là bao nhiêu?', options: ['0°C - 4°C', '10°C - 15°C', 'Nhiệt độ phòng'], answer: 0 },
    { id: 'q2', text: 'Chu kỳ thử việc tiêu chuẩn của nhân viên mới là bao nhiêu ngày?', options: ['7 ngày', '12 ngày', '30 ngày'], answer: 1 },
  ]);
  gw.seed(MEMORY_IDS.HR, 'TEST_BANK', [[...tbH], row(tbH, { ...sys(testId), code: 'TEST_SOP_01', title: 'Kiểm tra Quy trình Pha chế & An toàn Vệ sinh V5.1', questions_json: questions, duration_minutes: 15, pass_percent: 80, max_attempts: 3, status: 'APPROVED', target_stage: 'PROBATION', staff_group: 'BARISTA', total_questions: 2, approved_by: 'hr', approved_at: now })]);

  const taH = SPREADSHEETS.HR.tabs.TEST_ASSIGNMENTS;
  gw.seed(MEMORY_IDS.HR, 'TEST_ASSIGNMENTS', [[...taH], row(taH, { ...sys(), test_id: testId, employee_id: ctx.emp1Id, branch_id: ctx.cn1, open_at: '2026-10-20T00:00:00+07:00', close_at: '2026-11-30T23:59:59+07:00', assigned_by: 'hr', status: 'ASSIGNED', max_attempts: 3, attempts_used: 0, best_score_percent: 0, passed: false, note: 'Bài thi bắt buộc trước khi chuyển chính thức' })]);

  const lrH = SPREADSHEETS.SCHEDULE.tabs.LEAVE_REQUESTS;
  gw.seed(MEMORY_IDS.SCHEDULE, 'LEAVE_REQUESTS', [[...lrH], row(lrH, { ...sys(), request_code: 'OFF-0001', employee_id: ctx.emp1Id, branch_id: ctx.cn1, leave_date: '2026-10-26', kind: 'PROBATION_OFF', shift_code: 'CA_SANG', reason: 'Nghỉ định kỳ trong chu kỳ thử việc 12 ngày', status: 'PENDING', employee_stage: 'PROBATION', schedule_week_id: 'WK-2026-10', assignment_id: '', quota_cycle_used: 1, quota_cycle_limit: 5, staffing_after_leave: 0, min_staff_required: 1, submitted_at: now, store_reviewed_by: '', store_reviewed_at: '', decided_by: '', decision_reason: '', decided_at: '' })]);

  const swH = SPREADSHEETS.SCHEDULE.tabs.SHIFT_SWAPS;
  gw.seed(MEMORY_IDS.SCHEDULE, 'SHIFT_SWAPS', [[...swH], row(swH, { ...sys(), swap_code: 'SWP-0001', requester_id: ctx.emp2Id, peer_id: ctx.emp1Id, from_assignment_id: ctx.assign2Id, to_assignment_id: '', branch_id: ctx.cn1, from_work_date: '2026-10-26', from_shift_code: 'CA_CHIEU', to_work_date: '2026-10-26', to_shift_code: 'CA_CHIEU', reason: 'Bận lịch học buổi chiều tại trường', status: 'PEER_ACCEPTED', has_conflict: false, staffing_valid: true, requested_at: now, peer_responded_at: now, peer_note: 'Đồng ý hỗ trợ đổi ca', decided_by: '', decision_reason: '', decided_at: '', allowance_eligible: true, allowance_amount_vnd: 30000 })]);


  const evId = newId();
  const attEvH = SPREADSHEETS.ATTENDANCE.tabs.ATTENDANCE_EVENTS;
  gw.seed(MEMORY_IDS.ATTENDANCE, 'ATTENDANCE_EVENTS', [[...attEvH], row(attEvH, { ...sys(evId), idempotency_key: 'idem_seed_01', employee_id: ctx.emp1Id, assignment_id: ctx.assign1Id, branch_id: ctx.cn1, type: 'CHECK_IN', server_time: '2026-10-24T06:55:00+07:00', lat: 10.7769, lng: 106.7009, accuracy_m: 12, distance_m: 8, within_radius: true, photo_id: 'photo_01', photo_sha256: 'sha256_demo_01', device_info: 'iPhone 15 Safari HTTPS', result: 'VALID', work_date: '2026-10-24', shift_code: 'CA_SANG', scheduled_time: '07:00', late_minutes: 0, early_leave_minutes: 0, allowed_radius_m: 100, gps_status: 'OK', photo_drive_file_id: '', ip_address: '127.0.0.1', anomaly_flags_json: '[]', note: 'Điểm danh vào ca đúng giờ' })]);

  const adjH = SPREADSHEETS.ATTENDANCE.tabs.ATTENDANCE_ADJUSTMENTS;
  gw.seed(MEMORY_IDS.ATTENDANCE, 'ATTENDANCE_ADJUSTMENTS', [[...adjH], row(adjH, { ...sys(), adjustment_code: 'ADJ-0001', event_id: evId, assignment_id: ctx.assign1Id, employee_id: ctx.emp1Id, branch_id: ctx.cn1, work_date: '2026-10-24', shift_code: 'CA_SANG', kind: 'FORGOT_CHECK_OUT', requested_time: '12:02', requested_check_in_at: '06:55', requested_check_out_at: '12:02', requested_hours: 5, reason: 'Quên bấm check-out lúc hết ca do đông khách', evidence_file_id: '', exception_source: 'EMPLOYEE', status: 'PENDING', store_confirmed_by: '', store_confirmed_at: '', store_note: '', hr_decision: 'PENDING', decided_by: '', decision_reason: '', decided_at: '', record_id: '', applied_to_record: false })]);

  const notifH = SPREADSHEETS.COMMS.tabs.NOTIFICATIONS;
  gw.seed(MEMORY_IDS.COMMS, 'NOTIFICATIONS', [[...notifH], row(notifH, { ...sys(), recipient_user_id: 'ALL', recipient_role: 'ALL', branch_id: 'ALL', category: 'ACCOUNT', title: '1 nhân sự thử việc mới đang chờ kích hoạt tài khoản', body: 'Nhân sự Bùi Thị Mới (NV0003) đã được HR tiếp nhận, chờ Admin kích hoạt.', link: '/admin/accounts', severity: 'WARNING', read_at: '', entity_type: 'USERS', entity_id: 'NV0003' })]);

  const campId = newId();
  const campH = SPREADSHEETS.COMMS.tabs.CAMPAIGNS;
  gw.seed(MEMORY_IDS.COMMS, 'CAMPAIGNS', [[...campH], row(campH, { ...sys(campId), code: 'CMP-2026-10', name: 'Chiến dịch Menu Sữa Tươi Trân Châu Đường Đen Mùa Thu', status: 'ACTIVE', owner_id: 'mkt', description: 'Phổ biến công thức mới và quy chuẩn phục vụ toàn chuỗi 4 chi nhánh', start_at: '2026-10-01', end_at: '2026-10-31', total_announcements: 1, note: '' })]);

  const annH = SPREADSHEETS.COMMS.tabs.ANNOUNCEMENTS;
  gw.seed(MEMORY_IDS.COMMS, 'ANNOUNCEMENTS', [[...annH], row(annH, { ...sys(), code: 'ANN-0001', campaign_id: campId, title: 'Hướng dẫn định lượng Menu Mùa Thu V5.1 cho toàn bộ Cửa hàng', summary: 'Áp dụng thống nhất tại 4 chi nhánh từ ngày 25/10/2026', body: 'Toàn bộ nhân viên Pha chế và Thu ngân lưu ý cập nhật bảng định lượng mới.', cta_label: 'Xem tài liệu hướng dẫn', cta_link: '/nv', media_ids: '[]', audience_scope: 'ALL', audience_json: '{"scope":"ALL"}', priority: 'HIGH', status: 'SENT', requires_ack: true, scheduled_at: now, sent_at: now, approved_by: 'mkt' })]);
}
