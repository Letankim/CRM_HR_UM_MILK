/**
 * Khởi tạo ngữ cảnh từ DỮ LIỆU ĐANG CÓ trên hệ thống (chỉ đọc):
 * chi nhánh đang hoạt động, khung ca riêng từng chi nhánh (ưu tiên) + khung ca chung, quản lý cửa hàng hiện có,
 * tài khoản HR / Quản trị làm người duyệt, bộ đếm mã chứng từ tiếp nối, và kho định danh để chống trùng tuyệt đối.
 */
import type { ShiftTemplate } from '@umbm/shared';
import { parseBranchScope } from '../../src/auth/auth.service.js';
import type { Database } from '../../src/data/database.js';
import { dayjs } from '../../src/lib/time.js';
import type { BranchPlan, SeedCtx, SeedOptions, ShiftTpl } from './context.js';
import { addDays, createRng, emptyOutput, sys, UniquePool } from './kit.js';

const DEFAULT_SHIFTS = [
  { code: 'CA_SANG', name: 'Ca sáng', start_time: '07:00', end_time: '12:00', standard_hours: 5 },
  { code: 'CA_CHIEU', name: 'Ca chiều', start_time: '12:00', end_time: '17:00', standard_hours: 5 },
  { code: 'CA_TOI', name: 'Ca tối', start_time: '17:00', end_time: '22:00', standard_hours: 5 },
];

const maxCode = (codes: string[], prefix: RegExp) => codes.reduce((m, c) => Math.max(m, Number(prefix.exec(c)?.[1] ?? 0)), 0);
const toTpl = (s: Pick<ShiftTemplate, 'id' | 'code' | 'name' | 'start_time' | 'end_time' | 'standard_hours'>): ShiftTpl =>
  ({ id: s.id, code: s.code, name: s.name, start: s.start_time, end: s.end_time, hours: Number(s.standard_hours) || 5 });

export function createContext(db: Database, opts: SeedOptions, hashes: { pinHash: string; pwHash: string }): SeedCtx {
  const now = dayjs().tz('Asia/Ho_Chi_Minh');
  const today = now.format('YYYY-MM-DD');
  const out = emptyOutput();
  const pool = new UniquePool();
  for (const u of db.users.all(true)) { pool.add('username', u.username); pool.add('phone', u.phone); pool.add('email', u.email); }
  for (const e of db.employees.all(true)) {
    pool.add('empcode', e.employee_code); pool.add('phone', e.phone); pool.add('email', e.email); pool.add('cccd', e.citizen_id);
    pool.add('bank', e.bank_account_number); pool.add('tax', e.tax_code); pool.add('fullname', e.full_name); pool.add('phone', e.emergency_contact_phone);
  }
  for (const c of db.candidates.all(true)) { pool.add('phone', c.phone); pool.add('email', c.email); pool.add('fullname', c.full_name); }

  const admin = db.users.find((u) => u.role === 'ADMIN' && u.status === 'ACTIVE');
  const hr = db.users.find((u) => u.role === 'HR' && u.status === 'ACTIVE') ?? admin;
  if (!admin || !hr) throw new Error('Hệ thống chưa có tài khoản Quản trị viên / HR đang hoạt động để làm người duyệt dữ liệu mẫu');
  const test = db.testBank.find((t) => t.status === 'APPROVED');

  const ctx: SeedCtx = {
    db, rng: createRng(opts.seed), pool, out, opts, today, nowHm: now.format('HH:mm'), nowIso: now.format('YYYY-MM-DDTHH:mm:ssZ'),
    from: addDays(today, -opts.daysBack), to: addDays(today, opts.daysAhead),
    hrUserId: hr.id, hrUserName: hr.display_name || hr.username, adminUserId: admin.id, pinHash: hashes.pinHash, pwHash: hashes.pwHash,
    testId: test?.id ?? '', testMaxAttempts: test?.max_attempts ?? 3,
    counters: {
      emp: maxCode(db.employees.all(true).map((e) => e.employee_code), /^NV(\d+)$/i),
      off: Math.max(db.leaveRequests.all(true).length, maxCode(db.leaveRequests.all(true).map((x) => x.request_code), /^OFF-(\d+)$/)),
      swp: Math.max(db.shiftSwaps.all(true).length, maxCode(db.shiftSwaps.all(true).map((x) => x.swap_code), /^SWP-(\d+)$/)),
      adj: Math.max(db.attendanceAdjustments.all(true).length, maxCode(db.attendanceAdjustments.all(true).map((x) => x.adjustment_code), /^ADJ-(\d+)$/)),
      uv: Math.max(db.candidates.all(true).length, maxCode(db.candidates.all(true).map((x) => x.candidate_code), /^UV(\d+)$/)),
    },
    branches: [], assignments: [], approvedLeave: new Map(), busy: new Set(), warnings: new Set(),
  };
  ctx.branches = planBranches(ctx);
  return ctx;
}

function planBranches(ctx: SeedCtx): BranchPlan[] {
  const { db, out } = ctx;
  const branches = db.branches.all().filter((b) => b.status === 'ACTIVE').sort((a, b) => a.code.localeCompare(b.code));
  if (branches.length === 0) throw new Error('Chưa có chi nhánh đang hoạt động — vui lòng tạo chi nhánh trước khi sinh dữ liệu mẫu');
  const active = db.shiftTemplates.all().filter((s) => s.status === 'ACTIVE');
  let globals = active.filter((s) => !s.shift_group || s.shift_group === 'STORE' || s.shift_group === 'ALL').map(toTpl);
  if (globals.length === 0 && !branches.every((b) => active.some((s) => s.shift_group === b.id))) {
    const createdAt = ctx.nowIso;
    globals = DEFAULT_SHIFTS.map((d) => {
      const rec = { ...sys(createdAt), ...d, effective_from: addDays(ctx.today, -400), effective_to: '', status: 'ACTIVE', shift_group: 'STORE', break_minutes: 0, is_overnight: false, note: 'Khung ca chuẩn toàn chuỗi' };
      out.shiftTemplates.push(rec);
      return toTpl(rec as unknown as ShiftTemplate);
    });
  }

  return branches.map((branch) => {
    const byCode = new Map<string, ShiftTpl>(globals.map((g) => [g.code, g]));
    for (const own of active.filter((s) => s.shift_group === branch.id)) byCode.set(own.code, toTpl(own));
    let shifts = [...byCode.values()].sort((a, b) => a.start.localeCompare(b.start));
    const storeShifts = shifts.filter((s) => s.hours < 7.5);
    if (storeShifts.length >= 2) shifts = storeShifts;

    for (const tpl of shifts) {
      if (db.staffingRules.find((r) => r.branch_id === branch.id && r.shift_template_id === tpl.id)) continue;
      out.staffingRules.push({
        ...sys(ctx.nowIso), branch_id: branch.id, shift_template_id: tpl.id, min_staff: 1, max_staff: 1,
        enforcement: 'HARD_BLOCK', effective_from: addDays(ctx.today, -ctx.opts.daysBack), day_of_week: 'ALL',
        required_groups_json: JSON.stringify(['BARISTA']), approved_by: ctx.hrUserName,
        note: `Định biên chuẩn ${tpl.name} tại ${branch.code}: 1 nhân sự / ca`,
      });
    }

    const store = db.users.find((u) => u.role === 'STORE' && u.status === 'ACTIVE' && (() => {
      const scope = parseBranchScope(u.branch_scope);
      return scope !== 'ALL' && (scope.includes(branch.id) || scope.includes(branch.code));
    })());
    return { branch, shifts, staff: [], storeUserId: store?.id ?? '', storeUserName: store?.display_name ?? '' };
  });
}
