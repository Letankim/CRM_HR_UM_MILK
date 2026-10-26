/**
 * Bước 3 — Ngoại lệ vận hành: Đổi ca 3 bước và Báo nghỉ đột xuất, tuân thủ đúng ràng buộc của hệ thống:
 * người nhận ca phải cùng chi nhánh, không có ca và không nghỉ OFF trong ngày; đổi ca đã duyệt / thay ca đã điều phối
 * thì ca làm được chuyển hẳn sang người nhận (swapped_from_employee_id / replacement_for_employee_id) như luồng thật.
 */
import { SYSTEM_CONFIG } from '@umbm/shared';
import * as C from './catalog.js';
import { busyKey, empId, stageAt, type AssignPlan, type BranchPlan, type Phase, type SeedCtx, type StaffPlan } from './context.js';
import { addDays, addMin, iso, minIso, sys, toMin, type Rec } from './kit.js';

type SwapStatus = 'APPROVED' | 'REJECTED' | 'PENDING_PEER' | 'PEER_ACCEPTED';
interface Pending { rec: Rec; assign?: AssignPlan; kind: 'SWAP' | 'EMG' }

export function buildExceptions(ctx: SeedCtx): void {
  const pending: Pending[] = [];
  for (const bp of ctx.branches) {
    const plan: [SwapStatus, Phase][] = [['APPROVED', 'PAST'], ['APPROVED', 'PAST'], ['REJECTED', 'PAST'], ['PENDING_PEER', 'FUTURE'], ['PEER_ACCEPTED', 'FUTURE']];
    for (const [status, phase] of plan) {
      const rec = makeSwap(ctx, bp, status, phase, pending);
      if (rec) ctx.out.shiftSwaps.push(rec);
    }
    for (const status of ['RESOLVED', 'RESOLVED', 'REPORTED'] as const) {
      const rec = makeEmergency(ctx, bp, status, pending);
      if (rec) ctx.out.emergencyLeaves.push(rec);
    }
  }
  ctx.out.shiftSwaps.sort((a, b) => String(a.requested_at).localeCompare(String(b.requested_at)));
  for (const s of ctx.out.shiftSwaps) s.swap_code = `SWP-${String(++ctx.counters.swp).padStart(4, '0')}`;
  ctx.out.emergencyLeaves.sort((a, b) => String(a.reported_at).localeCompare(String(b.reported_at)));
  for (const e of ctx.out.emergencyLeaves) e.emergency_code = `EMG-${String(++ctx.counters.emg).padStart(4, '0')}`;
  for (const p of pending) {
    if (!p.assign) continue;
    p.assign.rec.note = p.kind === 'SWAP' ? `Đã đổi ca từ ${String(p.rec.swap_code)}` : `Thay ca nghỉ đột xuất ${String(p.rec.emergency_code)}`;
  }
}

function findTarget(ctx: SeedCtx, bp: BranchPlan, phase: Phase, window: [string, string]): { a: AssignPlan; peer: StaffPlan } | null {
  const { rng } = ctx;
  const candidates = rng.shuffle(ctx.assignments.filter((a) =>
    a.bp === bp && a.phase === phase && !a.locked && a.rec.day_type === 'WORK' && !a.owner.isManager &&
    a.rec.status !== 'DRAFT' && a.date >= window[0] && a.date <= window[1]));
  for (const a of candidates) {
    const peer = rng.shuffle(bp.staff).find((s) =>
      s !== a.owner && !s.pending && !s.isManager && s.startDate <= a.date && !ctx.busy.has(busyKey(a.date, empId(s))));
    if (peer) return { a, peer };
  }
  return null;
}

function reassign(ctx: SeedCtx, a: AssignPlan, to: StaffPlan, field: 'swapped_from_employee_id' | 'replacement_for_employee_id', at: string, by: string): void {
  const updatedAt = at > String(a.rec.updated_at) ? at : String(a.rec.updated_at);
  Object.assign(a.rec, { employee_id: empId(to), employee_stage: stageAt(to, a.date), [field]: empId(a.owner), version: Number(a.rec.version) + 1, updated_at: updatedAt, updated_by: by });
  a.performer = to;
  ctx.busy.add(busyKey(a.date, empId(to)));
}

function makeSwap(ctx: SeedCtx, bp: BranchPlan, status: SwapStatus, phase: Phase, pending: Pending[]): Rec | null {
  const { rng, today } = ctx;
  const window: [string, string] = phase === 'PAST' ? [addDays(today, -16), addDays(today, -1)] : [addDays(today, 1), addDays(today, 6)];
  const target = findTarget(ctx, bp, phase, window);
  if (!target) return null;
  const { a, peer } = target;
  a.locked = true;
  const reqDay = phase === 'PAST' ? addDays(a.date, -2) : addDays(today, -rng.int(0, 1));
  const requestedAt = minIso(iso(reqDay, `${rng.int(9, 20)}:${String(rng.int(0, 59)).padStart(2, '0')}`), ctx.nowIso);
  const peerAt = status === 'PENDING_PEER' ? '' : minIso(iso(reqDay, '22:30'), ctx.nowIso);
  const decided = status === 'APPROVED' || status === 'REJECTED';
  const decidedAt = decided ? minIso(iso(addDays(reqDay, 1), `09:${String(rng.int(0, 59)).padStart(2, '0')}`), ctx.nowIso) : '';
  const rec: Rec = {
    ...sys(requestedAt), ...(peerAt ? { version: decided ? 3 : 2, updated_at: decidedAt || peerAt, updated_by: decided ? bp.storeUserId : String(peer.user.id) } : {}),
    requester_id: empId(a.owner), peer_id: empId(peer), from_assignment_id: a.rec.id, to_assignment_id: '', reason: rng.pick(C.SWAP_REASONS), status,
    peer_responded_at: peerAt, decided_by: decided ? bp.storeUserId : '',
    decision_reason: status === 'APPROVED' ? 'Hợp lệ, người nhận ca đủ kỹ năng vị trí' : status === 'REJECTED' ? 'Người nhận ca chưa đủ kinh nghiệm vị trí khung ca này' : '',
    allowance_eligible: status === 'APPROVED', swap_code: '', branch_id: bp.branch.id, from_work_date: a.date, from_shift_code: a.tpl.code,
    to_work_date: a.date, to_shift_code: a.tpl.code, has_conflict: false, staffing_valid: true, requested_at: requestedAt,
    peer_note: peerAt ? 'Đồng ý nhận ca thay' : '', decided_at: decidedAt, allowance_amount_vnd: SYSTEM_CONFIG.defaults.shiftSwapAllowanceVnd,
  };
  if (status === 'APPROVED') {
    reassign(ctx, a, peer, 'swapped_from_employee_id', decidedAt, bp.storeUserId);
    pending.push({ rec, assign: a, kind: 'SWAP' });
  } else {
    ctx.busy.add(busyKey(a.date, empId(peer)));
    pending.push({ rec, kind: 'SWAP' });
  }
  return rec;
}

function makeEmergency(ctx: SeedCtx, bp: BranchPlan, status: 'RESOLVED' | 'REPORTED', pending: Pending[]): Rec | null {
  const { rng, today, nowHm } = ctx;
  const isPast = status === 'RESOLVED';
  const target = isPast
    ? findTarget(ctx, bp, 'PAST', [addDays(today, -18), addDays(today, -1)])
    : findTarget(ctx, bp, 'FUTURE', [today, addDays(today, 1)]);
  if (!target) return null;
  const { a, peer } = target;
  if (!isPast && a.date === today && toMin(a.tpl.start) - toMin(nowHm) < 40) return null;
  a.locked = true;
  const before = isPast ? rng.int(45, 150) : 0;
  const reportedAt = isPast
    ? iso(a.date, addMin(a.tpl.start, -before))
    : iso(today, addMin(nowHm, -Math.min(rng.int(5, 30), toMin(nowHm))));
  const minutesBefore = isPast ? before : (a.date === today ? 0 : 1440) + toMin(a.tpl.start) - toMin(reportedAt.slice(11, 16));
  const handledAt = isPast ? iso(a.date, addMin(a.tpl.start, -before + 25)) : '';
  const rec: Rec = {
    ...sys(reportedAt), ...(isPast ? { version: 2, updated_at: handledAt, updated_by: bp.storeUserId } : {}),
    employee_id: empId(a.owner), assignment_id: a.rec.id, reason: rng.pick(C.EMERGENCY_REASONS), replacement_id: isPast ? empId(peer) : '',
    status, escalated: false, handled_by: isPast ? bp.storeUserId : '', emergency_code: '', branch_id: bp.branch.id, work_date: a.date,
    shift_code: a.tpl.code, reported_at: reportedAt, minutes_before_shift: minutesBefore, evidence_file_id: '',
    replacement_confirmed_at: isPast ? iso(a.date, addMin(a.tpl.start, -before + 20)) : '', shift_coverage_status: isPast ? 'COVERED' : 'UNCOVERED',
    escalated_at: '', escalated_to_role: '', handled_at: handledAt,
    resolution_note: isPast ? `Đã điều phối ${String(peer.emp.full_name)} nhận thay ca` : '',
  };
  if (isPast) {
    reassign(ctx, a, peer, 'replacement_for_employee_id', handledAt, bp.storeUserId);
    pending.push({ rec, assign: a, kind: 'EMG' });
  } else {
    pending.push({ rec, kind: 'EMG' });
  }
  return rec;
}
