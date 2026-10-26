/**
 * Kiểu dữ liệu & ngữ cảnh dùng chung giữa các bước sinh dữ liệu mẫu.
 * Mọi bước chỉ ĐỌC dữ liệu hiện có trên hệ thống và GHI vào `out` (chưa ghi Google Sheets cho đến bước cuối).
 */
import type { Branch } from '@umbm/shared';
import type { Database } from '../../src/data/database.js';
import type { Rec, Rng, SeedOutput, UniquePool } from './kit.js';

export interface ShiftTpl { id: string; code: string; name: string; start: string; end: string; hours: number }

export interface StaffPlan {
  emp: Rec;
  user: Rec;
  branchId: string;
  stage: 'PROBATION' | 'OFFICIAL';
  officialFrom: string;
  startDate: string;
  weeklyOff: number;
  preferredShift: string;
  workRatio: number;
  isManager: boolean;
  pending: boolean;
}

export interface BranchPlan {
  branch: Branch;
  shifts: ShiftTpl[];
  staff: StaffPlan[];
  storeUserId: string;
  storeUserName: string;
}

export type Phase = 'PAST' | 'NOW' | 'FUTURE';

export interface AssignPlan {
  rec: Rec;
  bp: BranchPlan;
  tpl: ShiftTpl;
  owner: StaffPlan;
  performer: StaffPlan;
  phase: Phase;
  date: string;
  locked: boolean;
}

export interface SeedOptions { perBranch: number; daysBack: number; daysAhead: number; seed: number }

export interface SeedCtx {
  db: Database;
  rng: Rng;
  pool: UniquePool;
  out: SeedOutput;
  opts: SeedOptions;
  today: string;
  nowHm: string;
  nowIso: string;
  from: string;
  to: string;
  hrUserId: string;
  hrUserName: string;
  adminUserId: string;
  pinHash: string;
  pwHash: string;
  testId: string;
  testMaxAttempts: number;
  counters: { emp: number; off: number; swp: number; emg: number; adj: number; uv: number };
  branches: BranchPlan[];
  assignments: AssignPlan[];
  /** Ngày nghỉ OFF đã duyệt theo nhân sự: empId -> tập ngày (không được xếp ca). */
  approvedLeave: Map<string, Set<string>>;
  /** Lịch bận theo ngày: `${date}|${empId}` (đã có ca hoặc nghỉ) — chống trùng khi đổi ca / thay ca. */
  busy: Set<string>;
  /** Cảnh báo về dữ liệu cũ đang có (không chặn ghi). */
  warnings: Set<string>;
}

export const busyKey = (date: string, empId: string) => `${date}|${empId}`;
export const empId = (s: StaffPlan) => String(s.emp.id);
export const empCode = (s: StaffPlan) => String(s.emp.employee_code);
export const empName = (s: StaffPlan) => String(s.emp.full_name);
/** Giai đoạn của nhân sự tại một ngày cụ thể (để ghi đúng employee_stage trên ca làm). */
export const stageAt = (s: StaffPlan, date: string): 'PROBATION' | 'OFFICIAL' =>
  s.officialFrom && date >= s.officialFrom ? 'OFFICIAL' : 'PROBATION';
