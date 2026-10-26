/**
 * Bước 2 — Lịch làm việc: lập đơn nghỉ OFF trước (đơn đã duyệt chặn xếp ca đúng như luồng thật),
 * sau đó xếp ca từng ngày cho từng chi nhánh theo khung ca của chính chi nhánh đó:
 * ngày nghỉ cố định hằng tuần, nhân sự thử việc làm ~7/12 ngày, cân bằng tối thiểu 2 người/ca, tăng ca cuối tuần.
 * Ca quá khứ -> chờ bước điểm danh quyết định; tuần tới -> Đã phân ca; tuần sau nữa -> Nhân viên đăng ký chờ duyệt.
 */
import { SYSTEM_CONFIG } from '@umbm/shared';
import * as C from './catalog.js';
import { busyKey, empId, stageAt, type BranchPlan, type Phase, type SeedCtx, type ShiftTpl, type StaffPlan } from './context.js';
import { addDays, iso, minIso, sys, weekday, type Rec } from './kit.js';

const maxIso = (a: string, b: string) => (a > b ? a : b);
const hm = (ctx: SeedCtx, h1: number, h2: number) => `${String(ctx.rng.int(h1, h2)).padStart(2, '0')}:${String(ctx.rng.int(0, 59)).padStart(2, '0')}`;

export function buildRoster(ctx: SeedCtx): void {
  for (const bp of ctx.branches) {
    planLeaves(ctx, bp);
    for (let d = ctx.from; d <= ctx.to; d = addDays(d, 1)) scheduleDay(ctx, bp, d);
  }
  finalizeLeaves(ctx);
}

function planLeaves(ctx: SeedCtx, bp: BranchPlan): void {
  const { rng, today } = ctx;
  for (const s of bp.staff.filter((x) => !x.pending && !x.isManager)) {
    const count = s.stage === 'OFFICIAL' ? (rng.chance(0.55) ? (rng.chance(0.3) ? 2 : 1) : 0) : rng.chance(0.5) ? 1 : 0;
    const lo = maxIso(addDays(s.startDate, 1), ctx.from);
    const hi = minIso(addDays(today, 10), ctx.to);
    const days: string[] = [];
    for (let d = lo; d <= hi; d = addDays(d, 1)) if (weekday(d) !== s.weeklyOff) days.push(d);
    for (const date of rng.shuffle(days).slice(0, count)) {
      const status = date < today ? (rng.chance(0.8) ? 'APPROVED' : 'REJECTED') : rng.chance(0.55) ? 'PENDING' : rng.chance(0.7) ? 'APPROVED' : 'REJECTED';
      const submittedAt = minIso(maxIso(iso(addDays(date, -rng.int(2, 6)), hm(ctx, 19, 22)), iso(s.startDate, '21:00')), ctx.nowIso);
      const decided = status !== 'PENDING';
      const decidedAt = decided ? minIso(iso(addDays(submittedAt.slice(0, 10), 1), hm(ctx, 8, 11)), ctx.nowIso) : '';
      ctx.out.leaveRequests.push({
        ...sys(submittedAt), ...(decided ? { version: 2, updated_at: decidedAt, updated_by: bp.storeUserId } : {}),
        employee_id: empId(s), branch_id: bp.branch.id, leave_date: date,
        kind: s.stage === 'PROBATION' ? 'PROBATION_OFF' : rng.chance(0.8) ? 'WEEKLY_OFF' : 'UNPAID_LEAVE', reason: rng.pick(C.LEAVE_REASONS), status,
        decided_by: decided ? bp.storeUserId : '', decision_reason: status === 'APPROVED' ? 'Đảm bảo đủ định biên ca, đồng ý cho nghỉ' : status === 'REJECTED' ? 'Ca đang thiếu định biên, vui lòng chọn ngày khác' : '',
        request_code: '', employee_stage: stageAt(s, date), schedule_week_id: `WK-${date.slice(0, 7)}`, assignment_id: '', shift_code: s.preferredShift,
        quota_cycle_used: 1, quota_cycle_limit: s.stage === 'PROBATION' ? SYSTEM_CONFIG.defaults.probationOffDays : 4,
        staffing_after_leave: rng.int(2, 3), min_staff_required: 2, submitted_at: submittedAt,
        store_reviewed_by: decided ? bp.storeUserId : '', store_reviewed_at: decidedAt, decided_at: decidedAt,
      });
      if (status === 'APPROVED') {
        if (!ctx.approvedLeave.has(empId(s))) ctx.approvedLeave.set(empId(s), new Set());
        ctx.approvedLeave.get(empId(s))!.add(date);
        ctx.busy.add(busyKey(date, empId(s)));
      }
    }
  }
}

function scheduleDay(ctx: SeedCtx, bp: BranchPlan, date: string): void {
  const { rng } = ctx;
  const wd = weekday(date);
  const avail = bp.staff.filter((s) =>
    date >= s.startDate && (s.isManager ? wd !== 0 : wd !== s.weeklyOff) &&
    !ctx.approvedLeave.get(empId(s))?.has(date) && (s.workRatio >= 1 || rng.chance(s.workRatio)));

  const buckets = new Map<string, StaffPlan[]>(bp.shifts.map((t) => [t.code, []]));
  for (const s of avail) (buckets.get(s.isManager ? bp.shifts[0]!.code : s.preferredShift) ?? buckets.get(bp.shifts[0]!.code)!).push(s);
  const movable = (list: StaffPlan[]) => list.filter((s) => !s.isManager);
  const target = Math.min(2, Math.floor(avail.filter((s) => !s.isManager).length / bp.shifts.length));
  for (let guard = 0; guard < 30; guard++) {
    const sorted = [...buckets.entries()].sort((a, b) => movable(a[1]).length - movable(b[1]).length);
    const [lowCode, low] = sorted[0]!;
    const [, high] = sorted[sorted.length - 1]!;
    if (movable(low).length >= target || movable(high).length <= target) break;
    const candidates = movable(high);
    const moved = candidates.find((s) => s.emp.staff_group !== 'SHIFT_LEADER') ?? candidates[0]!;
    high.splice(high.indexOf(moved), 1);
    buckets.get(lowCode)!.push(moved);
  }

  for (const tpl of bp.shifts) for (const s of buckets.get(tpl.code) ?? []) pushAssignment(ctx, bp, s, tpl, date, 'WORK');

  const isWeekend = wd === 0 || wd === 6;
  const lastTpl = bp.shifts[bp.shifts.length - 1]!;
  if (isWeekend && bp.shifts.length > 1 && rng.chance(0.4)) {
    const helper = rng.shuffle(movable(buckets.get(bp.shifts[0]!.code) ?? [])).find((s) => s.stage === 'OFFICIAL');
    if (helper) pushAssignment(ctx, bp, helper, lastTpl, date, 'OT');
  }
}

function phaseOf(ctx: SeedCtx, date: string, tpl: ShiftTpl): Phase {
  if (date < ctx.today || (date === ctx.today && tpl.end <= ctx.nowHm)) return 'PAST';
  if (date === ctx.today && tpl.start <= ctx.nowHm) return 'NOW';
  return 'FUTURE';
}

function pushAssignment(ctx: SeedCtx, bp: BranchPlan, s: StaffPlan, tpl: ShiftTpl, date: string, dayType: 'WORK' | 'OT'): void {
  const { rng } = ctx;
  const phase = phaseOf(ctx, date, tpl);
  const isDraft = phase === 'FUTURE' && date > addDays(ctx.today, 6);
  const source = isDraft ? (rng.chance(0.75) ? 'EMPLOYEE_REGISTER' : 'MANUAL') : rng.chance(0.35) ? 'EMPLOYEE_REGISTER' : 'MANUAL';
  const empCreated = String(s.emp.created_at);
  const rawCreated = source === 'EMPLOYEE_REGISTER' ? iso(addDays(date, -rng.int(5, 9)), hm(ctx, 19, 22)) : iso(addDays(date, -rng.int(6, 8)), hm(ctx, 14, 17));
  const createdAt = minIso(maxIso(rawCreated, empCreated), ctx.nowIso);
  const publishedAt = isDraft ? '' : minIso(maxIso(iso(addDays(date, -rng.int(3, 5)), '20:30'), createdAt), ctx.nowIso);
  const rec: Rec = {
    ...sys(createdAt), ...(publishedAt && publishedAt !== createdAt ? { version: 2, updated_at: publishedAt, updated_by: bp.storeUserId } : {}),
    schedule_week_id: `WK-${date.slice(0, 7)}`, employee_id: empId(s), branch_id: bp.branch.id, work_date: date,
    shift_template_id: tpl.id, start_at: tpl.start, end_at: tpl.end, status: isDraft ? 'DRAFT' : 'PUBLISHED',
    source, employee_stage: stageAt(s, date), day_type: dayType, shift_code: tpl.code, scheduled_hours: tpl.hours,
    swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: publishedAt,
    note: dayType === 'OT' ? 'Tăng ca hỗ trợ cao điểm cuối tuần' : source === 'EMPLOYEE_REGISTER' && isDraft ? 'Nhân viên tự đăng ký ca — chờ Quản lý cửa hàng duyệt' : '',
  };
  ctx.out.shiftAssignments.push(rec);
  ctx.assignments.push({ rec, bp, tpl, owner: s, performer: s, phase, date, locked: false });
  ctx.busy.add(busyKey(date, empId(s)));
}

/** Đánh mã OFF-#### theo thứ tự thời gian gửi đơn, tính định mức đã dùng và gắn ca bị ảnh hưởng (đơn chờ duyệt / từ chối). */
function finalizeLeaves(ctx: SeedCtx): void {
  const used = new Map<string, number>();
  ctx.out.leaveRequests.sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)));
  for (const l of ctx.out.leaveRequests) {
    l.request_code = `OFF-${String(++ctx.counters.off).padStart(4, '0')}`;
    const eid = String(l.employee_id);
    const n = used.get(eid) ?? 0;
    l.quota_cycle_used = n + 1;
    if (l.status !== 'REJECTED') used.set(eid, n + 1);
    const a = ctx.assignments.find((x) => String(x.rec.employee_id) === eid && x.date === l.leave_date && x.rec.day_type === 'WORK');
    if (a) { l.assignment_id = a.rec.id; l.shift_code = a.tpl.code; }
  }
}
