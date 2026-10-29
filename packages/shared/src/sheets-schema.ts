/**
 * Định nghĩa 7 spreadsheet và toàn bộ cấu trúc cột chuẩn xác cho 75 Tab nghiệp vụ Ụm Bò Milk HR V5.1.
 * Thứ tự cột là hợp đồng dữ liệu: giữ nguyên thứ tự các cột gốc và bổ sung đầy đủ các trường
 * cho Hồ sơ Nhân sự, Lịch ca, Chấm công GPS, Kỳ lương Snapshot & Phiếu lương chi tiết.
 */

export const SYSTEM_COLUMNS = ['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version', 'is_deleted'] as const;
const cols = (...extra: string[]) => [...SYSTEM_COLUMNS, ...extra];

export const SPREADSHEETS = {
  CORE: {
    title: 'UMBM_CORE',
    tabs: {
      BRANCHES: cols('code', 'name', 'address', 'lat', 'lng', 'radius_m', 'max_accuracy_m', 'timezone', 'status', 'phone_contact', 'manager_employee_id', 'open_time', 'close_time', 'effective_from', 'note'),
      SHIFT_TEMPLATES: cols('code', 'name', 'start_time', 'end_time', 'effective_from', 'effective_to', 'status', 'shift_group', 'break_minutes', 'standard_hours', 'is_overnight', 'note'),
      STAFFING_RULES: cols('branch_id', 'shift_template_id', 'min_staff', 'max_staff', 'enforcement', 'effective_from', 'day_of_week', 'required_groups_json', 'approved_by', 'note'),
      POLICIES: cols('key', 'value_json', 'policy_version', 'effective_from', 'approved_by', 'note', 'category', 'title', 'is_locked_policy', 'effective_to', 'approved_at'),
      USERS: cols(
        'username', 'phone', 'display_name', 'password_hash', 'role', 'permissions_json', 'branch_scope',
        'employee_id', 'status', 'session_version', 'failed_login_count', 'locked_until', 'last_login_at',
        'activated_by', 'activated_at', 'revoked_at', 'email', 'revoked_by', 'revoke_reason',
      ),
      SYSTEM_SETTINGS: cols('key', 'value', 'note', 'category', 'label', 'value_type'),
      MAINTENANCE: cols('scope', 'enabled', 'message', 'expected_end_at', 'target_module', 'title', 'started_at'),
    },
  },
  HR: {
    title: 'UMBM_HR',
    tabs: {
      CANDIDATES: cols(
        'source_row', 'full_name', 'phone', 'position', 'branch_pref', 'status', 'hr_note',
        'candidate_code', 'source_channel', 'email', 'birth_year', 'gender', 'staff_group',
        'shift_pref', 'experience_note', 'cv_file_id', 'assigned_hr_id', 'contacted_at',
      ),
      INTERVIEWS: cols(
        'candidate_id', 'start_at', 'end_at', 'meet_link', 'interviewer_id', 'status', 'score', 'comment', 'decision',
        'branch_id', 'duration_minutes', 'calendar_event_id', 'candidate_confirmed', 'reschedule_requested',
        'reschedule_reason', 'appearance_score', 'attitude_score', 'skill_score', 'decided_at',
      ),
      EMPLOYEES: cols(
        'employee_code', 'full_name', 'phone', 'branch_id', 'staff_group', 'stage', 'probation_start',
        'probation_end', 'official_from', 'status', 'user_id', 'candidate_id', 'email', 'date_of_birth',
        'gender', 'citizen_id', 'citizen_issue_date', 'permanent_address', 'current_address',
        'emergency_contact_name', 'emergency_contact_phone', 'position_title', 'employment_type',
        'default_shift_code', 'probation_cycle_days', 'probation_work_days', 'probation_off_days',
        'resigned_at', 'resign_reason', 'bank_name', 'bank_account_number', 'bank_account_holder',
        'tax_code', 'base_hourly_rate_vnd', 'note',
      ),
      EMPLOYEE_STAGE_HISTORY: cols(
        'employee_id', 'from_stage', 'to_stage', 'effective_from', 'decided_by', 'note',
        'change_type', 'from_branch_id', 'to_branch_id', 'from_shift_code', 'to_shift_code',
        'probation_hours_completed', 'test_score_percent', 'evaluation_summary', 'approved_by',
      ),
      TEST_BANK: cols('code', 'title', 'questions_json', 'duration_minutes', 'pass_percent', 'max_attempts', 'status', 'target_stage', 'staff_group', 'total_questions', 'approved_by', 'approved_at'),
      TEST_ASSIGNMENTS: cols('test_id', 'employee_id', 'open_at', 'close_at', 'assigned_by', 'status', 'branch_id', 'max_attempts', 'attempts_used', 'best_score_percent', 'passed', 'note'),
      TEST_ATTEMPTS: cols(
        'assignment_id', 'employee_id', 'started_at', 'expires_at', 'submitted_at', 'answers_json',
        'score_percent', 'passed', 'auto_submitted', 'test_id', 'attempt_no', 'duration_seconds',
        'correct_count', 'total_questions', 'client_ip',
      ),
    },
  },
  SCHEDULE: {
    title: 'UMBM_SCHEDULE',
    tabs: {
      SCHEDULE_WEEKS: cols('branch_id', 'week_start', 'status', 'published_by', 'published_at', 'code', 'schedule_kind', 'week_end', 'store_confirmed_by', 'store_confirmed_at', 'locked_at', 'note'),
      SHIFT_ASSIGNMENTS: cols(
        'schedule_week_id', 'employee_id', 'branch_id', 'work_date', 'shift_template_id', 'start_at', 'end_at', 'status', 'source',
        'employee_stage', 'day_type', 'shift_code', 'scheduled_hours', 'swapped_from_employee_id', 'replacement_for_employee_id', 'published_at', 'note',
      ),
      LEAVE_REQUESTS: cols(
        'employee_id', 'branch_id', 'leave_date', 'kind', 'reason', 'status', 'decided_by', 'decision_reason',
        'request_code', 'employee_stage', 'schedule_week_id', 'assignment_id', 'shift_code',
        'quota_cycle_used', 'quota_cycle_limit', 'staffing_after_leave', 'min_staff_required',
        'submitted_at', 'store_reviewed_by', 'store_reviewed_at', 'decided_at',
      ),
      SHIFT_SWAPS: cols(
        'requester_id', 'peer_id', 'from_assignment_id', 'to_assignment_id', 'reason', 'status',
        'peer_responded_at', 'decided_by', 'decision_reason', 'allowance_eligible', 'swap_code', 'branch_id',
        'from_work_date', 'from_shift_code', 'to_work_date', 'to_shift_code', 'has_conflict', 'staffing_valid',
        'requested_at', 'peer_note', 'decided_at', 'allowance_amount_vnd',
      ),
      EMERGENCY_LEAVES: cols(
        'employee_id', 'assignment_id', 'reason', 'replacement_id', 'status', 'escalated', 'handled_by',
        'emergency_code', 'branch_id', 'work_date', 'shift_code', 'reported_at', 'minutes_before_shift',
        'evidence_file_id', 'replacement_confirmed_at', 'shift_coverage_status', 'escalated_at',
        'escalated_to_role', 'handled_at', 'resolution_note',
      ),
    },
  },
  ATTENDANCE: {
    title: 'UMBM_ATTENDANCE',
    tabs: {
      ATTENDANCE_EVENTS: cols(
        'idempotency_key', 'employee_id', 'assignment_id', 'branch_id', 'type', 'server_time', 'lat', 'lng',
        'accuracy_m', 'distance_m', 'within_radius', 'photo_id', 'photo_sha256', 'device_info', 'result',
        'work_date', 'shift_code', 'scheduled_time', 'late_minutes', 'early_leave_minutes',
        'allowed_radius_m', 'gps_status', 'photo_drive_file_id', 'ip_address', 'anomaly_flags_json', 'note',
      ),
      ATTENDANCE_RECORDS: cols(
        'assignment_id', 'employee_id', 'employee_stage', 'branch_id', 'work_date', 'shift_template_id',
        'shift_code', 'scheduled_start_at', 'scheduled_end_at', 'scheduled_hours', 'check_in_event_id',
        'check_in_at', 'check_out_event_id', 'check_out_at', 'actual_hours', 'approved_hours', 'ot_hours',
        'late_minutes', 'early_leave_minutes', 'missing_punch_flag', 'attendance_status', 'store_confirmed',
        'store_confirmed_by', 'store_confirmed_at', 'hr_verified', 'hr_verified_by', 'hr_verified_at',
        'locked_for_payroll', 'period_id', 'note',
      ),
      ATTENDANCE_ADJUSTMENTS: cols(
        'event_id', 'assignment_id', 'employee_id', 'kind', 'requested_time', 'reason', 'evidence_file_id',
        'store_confirmed_by', 'store_confirmed_at', 'hr_decision', 'decided_by', 'decision_reason',
        'adjustment_code', 'record_id', 'branch_id', 'work_date', 'shift_code', 'exception_source',
        'requested_check_in_at', 'requested_check_out_at', 'requested_hours', 'status', 'store_note',
        'decided_at', 'applied_to_record',
      ),
      ATTENDANCE_CONFIRMATIONS: cols('branch_id', 'work_date', 'confirmed_by', 'note', 'from_date', 'to_date', 'total_shifts', 'confirmed_shifts', 'pending_adjustments_count', 'status', 'confirmed_at'),
      PHOTOS: cols('event_id', 'local_path', 'sha256', 'size_bytes', 'drive_file_id', 'sync_status', 'synced_at', 'employee_id', 'branch_id', 'work_date', 'mime_type', 'drive_folder_id', 'last_error'),
    },
  },
  PAYROLL: {
    title: 'UMBM_PAYROLL',
    tabs: {
      PAY_RATES: cols(
        'employee_id', 'rate_type', 'amount_vnd', 'effective_from', 'effective_to', 'approved_by',
        'stage', 'staff_group', 'ot_multiplier', 'night_shift_allowance_vnd', 'attendance_bonus_vnd',
        'meal_allowance_per_shift_vnd', 'transport_allowance_vnd', 'responsibility_allowance_vnd',
        'approved_at', 'status', 'note',
        'probation_percent', 'standard_work_days', 'standard_hours_per_day', 'other_allowance_vnd',
        'change_reason', 'previous_rate_id',
      ),
      PAY_PERIODS: cols(
        'name', 'from_date', 'to_date', 'status', 'snapshot_hash', 'approved_by', 'published_at', 'paid_at',
        'period_code', 'month_key', 'branch_scope', 'total_employees', 'total_approved_hours', 'total_ot_hours',
        'total_gross_vnd', 'total_deductions_vnd', 'total_net_vnd', 'unreconciled_records_count',
        'reconciled_by', 'reconciled_at', 'approved_at', 'published_by', 'paid_by', 'note',
      ),
      PAYROLL_ITEMS: cols(
        'period_id', 'employee_id', 'branch_id', 'work_date', 'item_type', 'category_code', 'title',
        'direction', 'quantity', 'unit_amount_vnd', 'total_amount_vnd', 'source_ref_id', 'policy_version',
        'approval_status', 'approved_by', 'approved_at', 'note',
      ),
      PAYROLL_SNAPSHOTS: cols(
        'period_id', 'employee_id', 'approved_hours', 'rate_vnd', 'ot_hours', 'allowances_json',
        'adjustments_json', 'gross_vnd', 'net_vnd', 'data_hash', 'period_code', 'employee_code', 'full_name',
        'branch_id', 'branch_name', 'staff_group', 'stage', 'pay_rate_id', 'probation_hours',
        'probation_hourly_rate_vnd', 'probation_pay_vnd', 'official_hours', 'official_hourly_rate_vnd',
        'official_pay_vnd', 'total_shifts_count', 'base_salary_vnd', 'ot_rate_vnd', 'ot_pay_vnd',
        'shift_swap_count', 'shift_swap_allowance_vnd', 'meal_allowance_vnd', 'transport_allowance_vnd',
        'attendance_bonus_vnd', 'kpi_bonus_vnd', 'other_allowances_vnd', 'positive_adjustments_vnd',
        'approved_deductions_vnd', 'advance_deduction_vnd', 'late_count', 'late_minutes_total',
        'bank_name', 'bank_account_number', 'bank_account_holder', 'snapshot_at',
      ),
      PAYSLIPS: cols(
        'period_id', 'employee_id', 'snapshot_id', 'revision', 'status', 'published_at', 'payslip_code',
        'period_name', 'from_date', 'to_date', 'employee_code', 'full_name', 'branch_id', 'branch_name',
        'stage', 'total_shifts_count', 'approved_hours', 'ot_hours', 'base_salary_vnd', 'ot_pay_vnd',
        'total_allowances_vnd', 'total_bonus_vnd', 'total_adjustments_vnd', 'total_deductions_vnd',
        'gross_vnd', 'net_vnd', 'breakdown_json', 'viewed_by_employee_at', 'employee_confirmed_at',
        'dispute_status', 'dispute_reason', 'pdf_drive_file_id',
      ),
      PAYSLIP_REVISIONS: cols('payslip_id', 'revision', 'reason', 'delta_vnd', 'created_reason_by', 'period_id', 'employee_id', 'field_changed', 'before_amount_vnd', 'after_amount_vnd', 'details_json', 'status', 'approved_by', 'approved_at'),
      PAYMENTS: cols('period_id', 'employee_id', 'amount_vnd', 'paid_at', 'reference', 'recorded_by', 'payment_code', 'payslip_id', 'branch_id', 'payment_method', 'bank_name', 'bank_account_number', 'bank_account_holder', 'evidence_file_id', 'status', 'note'),
      REVENUE_INPUTS: cols('period_id', 'branch_id', 'revenue_vnd', 'source', 'from_date', 'to_date', 'payroll_cost_vnd', 'labor_cost_percent', 'verified_by', 'verified_at', 'note'),
    },
  },
  COMMS: {
    title: 'UMBM_COMMS',
    tabs: {
      NOTIFICATIONS: cols('recipient_user_id', 'category', 'title', 'body', 'link', 'severity', 'read_at', 'recipient_role', 'branch_id', 'entity_type', 'entity_id'),
      CAMPAIGNS: cols('name', 'status', 'owner_id', 'note', 'code', 'description', 'start_at', 'end_at', 'total_announcements'),
      ANNOUNCEMENTS: cols('campaign_id', 'title', 'body', 'cta_link', 'media_ids', 'audience_json', 'status', 'scheduled_at', 'sent_at', 'code', 'summary', 'cta_label', 'priority', 'audience_scope', 'requires_ack', 'approved_by'),
      DELIVERY_LOGS: cols('announcement_id', 'recipient_user_id', 'channel', 'status', 'attempts', 'last_error', 'branch_id', 'sent_at', 'delivered_at', 'read_at', 'ack_at'),
      MEDIA_ASSETS: cols('drive_file_id', 'file_name', 'mime_type', 'size_bytes', 'uploaded_by', 'code', 'category', 'is_internal_only'),
      SUPPORT_TICKETS: cols('ticket_code', 'requester_user_id', 'requester_employee_id', 'branch_id', 'category', 'priority', 'target_department', 'assignee_user_id', 'subject', 'description', 'related_entity_type', 'related_entity_id', 'related_label', 'status', 'messages_json', 'resolution_note', 'resolved_by', 'resolved_at', 'closed_at'),
    },
  },
  SYSTEM: {
    title: 'UMBM_SYSTEM',
    tabs: {
      AUDIT_LOG: cols('at', 'actor_user_id', 'actor_role', 'action', 'entity', 'entity_id', 'before_json', 'after_json', 'ip', 'user_agent', 'request_id'),
      SYNC_DEAD_LETTER: cols('spreadsheet', 'tab', 'operation', 'payload_json', 'error', 'attempts', 'resolved_at'),
      BACKUP_LOG: cols('kind', 'started_at', 'finished_at', 'status', 'drive_folder_id', 'files_count', 'rows_json', 'error'),
      JOB_RUNS: cols('job', 'started_at', 'finished_at', 'status', 'detail'),
      OPERATION_JOURNAL: cols('saga_key', 'operation', 'actor_id', 'status', 'steps_json', 'error', 'completed_at'),
    },
  },
} as const;

export type SpreadsheetKey = keyof typeof SPREADSHEETS;
export type TabName<K extends SpreadsheetKey> = keyof (typeof SPREADSHEETS)[K]['tabs'] & string;
export const MONTHLY_TABS: Partial<Record<SpreadsheetKey, readonly string[]>> = { SYSTEM: ['AUDIT_LOG'] };

export function monthlyTabName(base: string, date: Date = new Date()): string {
  const local = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  return `${base}_${local.getFullYear()}_${String(local.getMonth() + 1).padStart(2, '0')}`;
}

export const MAX_CELL_CHARS = 45_000;
export const DRIVE_FOLDERS = {
  DATABASE: '00_DATABASE',
  ATTENDANCE_PHOTOS: '01_ATTENDANCE_PHOTOS',
  EMPLOYEE_DOCUMENTS: '02_EMPLOYEE_DOCUMENTS',
  ADJUSTMENT_EVIDENCE: '03_ADJUSTMENT_EVIDENCE',
  PAYSLIPS: '04_PAYSLIPS',
  MKT_MEDIA: '05_MKT_MEDIA',
  EXPORTS: '06_EXPORTS',
  BACKUPS: '90_BACKUPS',
} as const;
