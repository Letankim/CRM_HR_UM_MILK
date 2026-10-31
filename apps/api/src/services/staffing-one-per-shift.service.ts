import type { Branch, Employee, ShiftAssignment, ShiftTemplate } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { resolveEmployeeBranchId } from '../routes/account-employee-sync.js';
import { isOfficialSwapEligibleEmployee } from '../routes/employee-mapper.js';
import { getVnNowDateAndHm } from './shift-absent-scanner.js';

export const SINGLE_STAFF_MIGRATION_KEY = 'SINGLE_STAFF_RULE_MIGRATED_V1';
const STD_RULE_NOTE = 'Định biên chuẩn: 1 nhân sự / ca (không nhiều hơn, không ít hơn)';

/** Lấy danh sách khung ca vận hành cửa hàng đang hoạt động của 1 chi nhánh, sắp theo giờ bắt đầu. */
export function listBranchStoreShiftTemplates(ctx: AppContext, branchId: string): ShiftTemplate[] {
  const branch = ctx.db.branches.get(branchId) ?? ctx.db.branches.find((b) => b.code.toUpperCase() === branchId.trim().toUpperCase());
  const bId = branch?.id ?? branchId;
  const bCode = branch?.code?.toUpperCase() ?? '';
  const active = ctx.db.shiftTemplates.filter((s) => s.status === 'ACTIVE');
  const byCode = new Map<string, ShiftTemplate>();
  for (const s of active) {
    if (!s.shift_group || s.shift_group === 'STORE' || s.shift_group === 'ALL') byCode.set(s.code.toUpperCase(), s);
  }
  for (const s of active) {
    const g = (s.shift_group || '').trim();
    if (g === bId || (bCode && g.toUpperCase() === bCode)) byCode.set(s.code.toUpperCase(), s);
  }
  const all = [...byCode.values()].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const storeOnly = all.filter((s) => Number(s.standard_hours || 5) < 7.5);
  return storeOnly.length > 0 ? storeOnly : all;
}

function isProbationStoreStaff(e: Employee): boolean {
  if (e.status !== 'ACTIVE' || e.stage !== 'PROBATION') return false;
  if (e.staff_group === 'BACKOFFICE' || e.staff_group === 'STORE_MANAGER') return false;
  if (e.note === 'Hồ sơ nhân sự liên kết tài khoản hệ thống') return false;
  return true;
}

export interface NormalizeOnePerShiftResult {
  updatedRules: number;
  createdRules: number;
  deletedDuplicateRules: number;
  rebalancedEmployees: number;
  trimmedFutureShifts: number;
}

/**
 * Chuẩn hóa toàn hệ thống theo quy tắc:
 * 1. Mỗi khung ca tại mỗi chi nhánh có định biên đúng 1 – 1 nhân sự/ca (HARD_BLOCK — không nhiều hơn, không ít hơn).
 * 2. Phân bổ đều ca mặc định (default_shift_code) của nhân sự chính thức & thử việc theo từng chi nhánh để xếp đủ kín tuần khi có người đăng ký OFF.
 * 3. Gỡ bớt các ca tương lai (chưa phát sinh điểm danh / đổi ca) đang bị xếp trùng > 1 người/ca từ dữ liệu cũ.
 */
export async function normalizeOnePersonPerShiftAndDefaults(
  ctx: AppContext,
  actorId: string,
  opts: { createMissingRules?: boolean; rebalanceDefaults?: boolean; trimFutureOverstaffed?: boolean } = {},
): Promise<NormalizeOnePerShiftResult> {
  const { createMissingRules = true, rebalanceDefaults = true, trimFutureOverstaffed = false } = opts;
  const { todayStr } = getVnNowDateAndHm();
  const branches: Branch[] = ctx.db.branches.filter((b) => b.status === 'ACTIVE').sort((a, b) => a.code.localeCompare(b.code));
  const allTemplates = ctx.db.shiftTemplates.all(true);

  const canonicalRuleKey = (branchRaw: string, shiftRaw: string) => {
    const rb = (branchRaw || 'ALL').trim();
    const b = rb !== 'ALL' ? (ctx.db.branches.get(rb) ?? ctx.db.branches.find((x) => x.code.toUpperCase() === rb.toUpperCase())) : undefined;
    const rs = (shiftRaw || 'ALL').trim();
    const tpl = rs !== 'ALL' ? allTemplates.find((s) => s.id === rs || s.code.toUpperCase() === rs.toUpperCase()) : undefined;
    return `${b?.id ?? rb}|${tpl?.code.toUpperCase() ?? rs.toUpperCase()}`;
  };

  const seenRuleKeys = new Set<string>();
  const rulePatches: { id: string; expectedVersion: number; patch: Record<string, unknown> }[] = [];
  let updatedRules = 0;
  let deletedDuplicateRules = 0;

  for (const r of ctx.db.staffingRules.all()) {
    const k = canonicalRuleKey(r.branch_id, r.shift_template_id);
    if (seenRuleKeys.has(k)) {
      rulePatches.push({ id: r.id, expectedVersion: r.version, patch: { is_deleted: true } });
      deletedDuplicateRules++;
      continue;
    }
    seenRuleKeys.add(k);
    if (r.min_staff !== 1 || r.max_staff !== 1 || r.enforcement !== 'HARD_BLOCK') {
      rulePatches.push({
        id: r.id,
        expectedVersion: r.version,
        patch: { min_staff: 1, max_staff: 1, enforcement: 'HARD_BLOCK', note: STD_RULE_NOTE },
      });
      updatedRules++;
    }
  }
  if (rulePatches.length > 0) await ctx.db.staffingRules.batchUpdate(rulePatches, actorId);

  let createdRules = 0;
  if (createMissingRules) {
    for (const b of branches) {
      for (const tpl of listBranchStoreShiftTemplates(ctx, b.id)) {
        const k = `${b.id}|${tpl.code.toUpperCase()}`;
        if (seenRuleKeys.has(k)) continue;
        seenRuleKeys.add(k);
        await ctx.db.staffingRules.insert({
          branch_id: b.id, shift_template_id: tpl.id, min_staff: 1, max_staff: 1, enforcement: 'HARD_BLOCK',
          effective_from: todayStr, day_of_week: 'ALL', required_groups_json: '["BARISTA"]',
          approved_by: 'Hệ thống', note: `Định biên chuẩn ${tpl.name} tại ${b.code}: 1 nhân sự / ca`,
        }, actorId);
        createdRules++;
      }
    }
  }

  let rebalancedEmployees = 0;
  const nextDefaultByEmpId = new Map<string, string>();
  if (rebalanceDefaults) {
    const empPatches: { id: string; expectedVersion: number; patch: Partial<Employee> }[] = [];
    for (const b of branches) {
      const shifts = listBranchStoreShiftTemplates(ctx, b.id);
      if (shifts.length === 0) continue;
      const officials = ctx.db.employees.filter((e) => e.branch_id === b.id && isOfficialSwapEligibleEmployee(ctx, e))
        .sort((a, x) => a.employee_code.localeCompare(x.employee_code));
      officials.forEach((emp, idx) => {
        const targetCode = shifts[idx % shifts.length]!.code;
        nextDefaultByEmpId.set(emp.id, targetCode);
        if (emp.default_shift_code !== targetCode) {
          empPatches.push({ id: emp.id, expectedVersion: emp.version, patch: { default_shift_code: targetCode } });
        }
      });
      const probationers = ctx.db.employees.filter((e) => e.branch_id === b.id && isProbationStoreStaff(e))
        .sort((a, x) => a.employee_code.localeCompare(x.employee_code));
      probationers.forEach((emp, idx) => {
        const targetCode = shifts[(officials.length + idx) % shifts.length]!.code;
        nextDefaultByEmpId.set(emp.id, targetCode);
        if (emp.default_shift_code !== targetCode) {
          empPatches.push({ id: emp.id, expectedVersion: emp.version, patch: { default_shift_code: targetCode } });
        }
      });
    }
    if (empPatches.length > 0) {
      await ctx.db.employees.batchUpdate(empPatches, actorId);
      rebalancedEmployees = empPatches.length;
    }
  }

  let trimmedFutureShifts = 0;
  if (trimFutureOverstaffed) {
    const protectedIds = new Set<string>();
    for (const ev of ctx.db.attendanceEvents.all()) if (ev.assignment_id) protectedIds.add(ev.assignment_id);
    for (const adj of ctx.db.attendanceAdjustments.all()) if (adj.assignment_id && adj.status !== 'REJECTED') protectedIds.add(adj.assignment_id);
    for (const sw of ctx.db.shiftSwaps.all()) {
      if (sw.status === 'PENDING_PEER' || sw.status === 'PEER_ACCEPTED') {
        if (sw.from_assignment_id) protectedIds.add(sw.from_assignment_id);
        if (sw.to_assignment_id) protectedIds.add(sw.to_assignment_id);
      }
    }
    const groups = new Map<string, ShiftAssignment[]>();
    for (const a of ctx.db.shiftAssignments.all()) {
      if (a.work_date <= todayStr || a.day_type === 'OFF' || a.status === 'ON_LEAVE' || a.status === 'SWAPPED') continue;
      const bId = resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id);
      const gk = `${bId}|${a.work_date}|${a.shift_code}`;
      const arr = groups.get(gk) ?? [];
      arr.push(a);
      groups.set(gk, arr);
    }
    const trimPatches: { id: string; expectedVersion: number; patch: Partial<ShiftAssignment> }[] = [];
    for (const rows of groups.values()) {
      if (rows.length <= 1) continue;
      const score = (a: ShiftAssignment) => {
        const emp = ctx.db.employees.get(a.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === a.employee_id);
        const def = (emp ? nextDefaultByEmpId.get(emp.id) ?? emp.default_shift_code : '') || '';
        return (protectedIds.has(a.id) ? 100 : 0)
          + (a.status === 'PUBLISHED' || a.status === 'COMPLETED' ? 20 : 0)
          + (def === a.shift_code ? 10 : 0)
          + (emp?.stage === 'OFFICIAL' ? 5 : 0);
      };
      const sorted = [...rows].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
      for (const extra of sorted.slice(1)) {
        if (protectedIds.has(extra.id)) continue;
        trimPatches.push({ id: extra.id, expectedVersion: extra.version, patch: { is_deleted: true } });
      }
    }
    if (trimPatches.length > 0) {
      await ctx.db.shiftAssignments.batchUpdate(trimPatches, actorId);
      trimmedFutureShifts = trimPatches.length;
    }
  }

  return { updatedRules, createdRules, deletedDuplicateRules, rebalancedEmployees, trimmedFutureShifts };
}

/** Chạy tự động 1 lần khi máy chủ khởi động để đồng bộ toàn bộ Google Sheets hiện có sang chuẩn 1 người / 1 ca. */
export async function ensureStartupOnePersonPerShiftMigration(ctx: AppContext, actorId: string): Promise<NormalizeOnePerShiftResult | null> {
  const done = ctx.db.systemSettings.find((s) => s.key === SINGLE_STAFF_MIGRATION_KEY);
  if (done?.value === 'true') return null;
  const res = await normalizeOnePersonPerShiftAndDefaults(ctx, actorId, {
    createMissingRules: true,
    rebalanceDefaults: true,
    trimFutureOverstaffed: true,
  });
  if (done) {
    await ctx.db.systemSettings.update(done.id, done.version, { value: 'true' }, actorId);
  } else {
    await ctx.db.systemSettings.insert({
      key: SINGLE_STAFF_MIGRATION_KEY, value: 'true',
      label: 'Đã chuẩn hóa định biên 1 người/ca & cân bằng ca mặc định',
      category: 'SCHEDULE', value_type: 'BOOLEAN', note: STD_RULE_NOTE,
    }, actorId);
  }
  return res;
}
