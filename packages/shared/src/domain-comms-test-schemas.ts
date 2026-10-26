import { z } from 'zod';
import { zBool, zSystemColumns } from './schemas.js';

/**
 * Schema Tuyển dụng (CANDIDATES, INTERVIEWS), Thi TEST (TEST_BANK, TEST_ASSIGNMENTS, TEST_ATTEMPTS),
 * Chính sách & Bảo trì (POLICIES, MAINTENANCE, SYSTEM_SETTINGS) và Truyền thông MKT (NOTIFICATIONS, CAMPAIGNS, ANNOUNCEMENTS).
 */

export const zCandidate = zSystemColumns.extend({
  source_row: z.string().default(''),
  full_name: z.string().min(2),
  phone: z.string(),
  position: z.string().default('Pha chế'),
  branch_pref: z.string().default(''),
  status: z.enum(['NEW', 'CONTACTED', 'INTERVIEW_SCHEDULED', 'HIRED', 'REJECTED']).default('NEW'),
  hr_note: z.string().default(''),
  candidate_code: z.string().default(''),
  source_channel: z.string().default('GOOGLE_FORM'),
  email: z.string().default(''),
  birth_year: z.string().default(''),
  gender: z.string().default(''),
  staff_group: z.string().default('BARISTA'),
  shift_pref: z.string().default('CA_SANG'),
  experience_note: z.string().default(''),
  cv_file_id: z.string().default(''),
  assigned_hr_id: z.string().default(''),
  contacted_at: z.string().default(''),
});
export type Candidate = z.infer<typeof zCandidate>;

export const zInterview = zSystemColumns.extend({
  candidate_id: z.string(),
  start_at: z.string(),
  end_at: z.string(),
  meet_link: z.string().default(''),
  interviewer_id: z.string().default(''),
  status: z.enum(['SCHEDULED', 'CONFIRMED', 'RESCHEDULE_NEEDED', 'COMPLETED', 'CANCELLED']).default('SCHEDULED'),
  score: z.coerce.number().default(0),
  comment: z.string().default(''),
  decision: z.enum(['PENDING', 'PASS', 'FAIL', 'HOLD']).default('PENDING'),
  branch_id: z.string().default(''),
  duration_minutes: z.coerce.number().int().default(30),
  calendar_event_id: z.string().default(''),
  candidate_confirmed: zBool.default(false),
  reschedule_requested: zBool.default(false),
  reschedule_reason: z.string().default(''),
  appearance_score: z.coerce.number().default(0),
  attitude_score: z.coerce.number().default(0),
  skill_score: z.coerce.number().default(0),
  decided_at: z.string().default(''),
});
export type Interview = z.infer<typeof zInterview>;

export const zTestBank = zSystemColumns.extend({
  code: z.string(),
  title: z.string(),
  questions_json: z.string().default('[]'),
  duration_minutes: z.coerce.number().int().default(15),
  pass_percent: z.coerce.number().default(80),
  max_attempts: z.coerce.number().int().default(3),
  status: z.enum(['DRAFT', 'APPROVED', 'ARCHIVED']).default('APPROVED'),
  target_stage: z.string().default('PROBATION'),
  staff_group: z.string().default('BARISTA'),
  total_questions: z.coerce.number().int().default(5),
  approved_by: z.string().default(''),
  approved_at: z.string().default(''),
});
export type TestBank = z.infer<typeof zTestBank>;

export const zTestAssignment = zSystemColumns.extend({
  test_id: z.string(),
  employee_id: z.string(),
  open_at: z.string(),
  close_at: z.string(),
  assigned_by: z.string().default(''),
  status: z.enum(['ASSIGNED', 'IN_PROGRESS', 'PASSED', 'FAILED', 'EXPIRED']).default('ASSIGNED'),
  branch_id: z.string().default(''),
  max_attempts: z.coerce.number().int().default(3),
  attempts_used: z.coerce.number().int().default(0),
  best_score_percent: z.coerce.number().default(0),
  passed: zBool.default(false),
  note: z.string().default(''),
});
export type TestAssignment = z.infer<typeof zTestAssignment>;

export const zTestAttempt = zSystemColumns.extend({
  assignment_id: z.string(),
  employee_id: z.string(),
  started_at: z.string(),
  expires_at: z.string(),
  submitted_at: z.string().default(''),
  answers_json: z.string().default('{}'),
  score_percent: z.coerce.number().default(0),
  passed: zBool.default(false),
  auto_submitted: zBool.default(false),
  test_id: z.string().default(''),
  attempt_no: z.coerce.number().int().default(1),
  duration_seconds: z.coerce.number().int().default(0),
  correct_count: z.coerce.number().int().default(0),
  total_questions: z.coerce.number().int().default(5),
  client_ip: z.string().default(''),
});
export type TestAttempt = z.infer<typeof zTestAttempt>;

export const zPolicy = zSystemColumns.extend({
  key: z.string(),
  value_json: z.string(),
  policy_version: z.string().default('v5.1'),
  effective_from: z.string().default('2026-01-01'),
  approved_by: z.string().default(''),
  note: z.string().default(''),
  category: z.string().default('ATTENDANCE'),
  title: z.string().default(''),
  is_locked_policy: zBool.default(false),
  effective_to: z.string().default(''),
  approved_at: z.string().default(''),
});
export type Policy = z.infer<typeof zPolicy>;

export const zMaintenance = zSystemColumns.extend({
  scope: z
    .preprocess((v) => (v === 'GLOBAL' || !v ? 'ALL' : v), z.enum(['ALL', 'EMPLOYEE_APP', 'BACKOFFICE', 'MODULE', 'ATTENDANCE', 'PAYROLL']))
    .default('EMPLOYEE_APP'),
  enabled: zBool.default(false),
  message: z.string().default(''),
  expected_end_at: z.string().default(''),
  target_module: z.string().default('ALL'),
  title: z.string().default(''),
  started_at: z.string().default(''),
});
export type Maintenance = z.infer<typeof zMaintenance>;

export const zNotification = zSystemColumns.extend({
  recipient_user_id: z.string().default('ALL'),
  category: z.string().default('SYSTEM'),
  title: z.string(),
  body: z.string(),
  link: z.string().default('/dashboard'),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).default('INFO'),
  read_at: z.string().default(''),
  recipient_role: z.string().default('ALL'),
  branch_id: z.string().default('ALL'),
  entity_type: z.string().default(''),
  entity_id: z.string().default(''),
});
export type NotificationRow = z.infer<typeof zNotification>;

export const zCampaign = zSystemColumns.extend({
  name: z.string(),
  status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED']).default('ACTIVE'),
  owner_id: z.string().default(''),
  note: z.string().default(''),
  code: z.string().default(''),
  description: z.string().default(''),
  start_at: z.string().default(''),
  end_at: z.string().default(''),
  total_announcements: z.coerce.number().int().default(0),
});
export type Campaign = z.infer<typeof zCampaign>;

export const zAnnouncement = zSystemColumns.extend({
  campaign_id: z.string().default(''),
  title: z.string(),
  body: z.string(),
  cta_link: z.string().default(''),
  media_ids: z.string().default('[]'),
  audience_json: z.string().default('{"scope":"ALL"}'),
  status: z.enum(['DRAFT', 'SCHEDULED', 'SENT', 'FAILED']).default('DRAFT'),
  scheduled_at: z.string().default(''),
  sent_at: z.string().default(''),
  code: z.string().default(''),
  summary: z.string().default(''),
  cta_label: z.string().default(''),
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  audience_scope: z.string().default('ALL'),
  requires_ack: zBool.default(false),
  approved_by: z.string().default(''),
});
export type Announcement = z.infer<typeof zAnnouncement>;

export const zDeliveryLog = zSystemColumns.extend({
  announcement_id: z.string().default(''), recipient_user_id: z.string().default('ALL'),
  channel: z.string().default('IN_APP_SOCKET'), status: z.enum(['PENDING', 'SENT', 'FAILED']).default('SENT'),
  attempts: z.coerce.number().int().default(1), last_error: z.string().default(''),
  branch_id: z.string().default('ALL'), sent_at: z.string().default(''),
  delivered_at: z.string().default(''), read_at: z.string().default(''), ack_at: z.string().default(''),
});
export type DeliveryLog = z.infer<typeof zDeliveryLog>;

export const zMediaAsset = zSystemColumns.extend({
  drive_file_id: z.string().default(''), file_name: z.string().default(''),
  mime_type: z.string().default('image/png'), size_bytes: z.coerce.number().int().default(0),
  uploaded_by: z.string().default(''), code: z.string().default(''),
  category: z.string().default('BANNER'), is_internal_only: zBool.default(true),
});
export type MediaAsset = z.infer<typeof zMediaAsset>;

export const zSystemSetting = zSystemColumns.extend({
  key: z.string(), value: z.string().default(''), note: z.string().default(''),
  category: z.string().default('GENERAL'), label: z.string().default(''), value_type: z.string().default('STRING'),
});
export type SystemSetting = z.infer<typeof zSystemSetting>;

export const zStaffingRule = zSystemColumns.extend({
  branch_id: z.string().default('ALL'), shift_template_id: z.string().default('ALL'),
  min_staff: z.coerce.number().int().default(2), max_staff: z.coerce.number().int().default(6),
  enforcement: z.enum(['HARD_BLOCK', 'SOFT_WARN']).default('HARD_BLOCK'),
  effective_from: z.string().default('2026-01-01'), day_of_week: z.string().default('ALL'),
  required_groups_json: z.string().default('["BARISTA"]'), approved_by: z.string().default(''), note: z.string().default(''),
});
export type StaffingRule = z.infer<typeof zStaffingRule>;

export const zRevenueInput = zSystemColumns.extend({
  period_id: z.string().default(''), branch_id: z.string().default('ALL'),
  revenue_vnd: z.coerce.number().default(0), source: z.string().default('FINANCE_INPUT'),
  from_date: z.string().default(''), to_date: z.string().default(''),
  payroll_cost_vnd: z.coerce.number().default(0), labor_cost_percent: z.coerce.number().default(0),
  verified_by: z.string().default(''), verified_at: z.string().default(''), note: z.string().default(''),
});
export type RevenueInput = z.infer<typeof zRevenueInput>;
