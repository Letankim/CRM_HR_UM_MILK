/**
 * Bước 5 — Tuyển dụng: hồ sơ ứng viên theo đủ giai đoạn (Mới / Đã liên hệ / Đã hẹn phỏng vấn / Đạt / Chưa phù hợp)
 * và lịch phỏng vấn 30 phút không trùng khung giờ của người phỏng vấn. Ứng viên "Đạt" được nối với đúng hồ sơ
 * nhân sự thử việc đã tiếp nhận (employee.candidate_id) để giữ toàn vẹn luồng Tuyển dụng -> Tiếp nhận.
 */
import { STAFF_GROUP_LABELS } from '@umbm/shared';
import { newId } from '../../src/lib/time.js';
import * as C from './catalog.js';
import type { BranchPlan, SeedCtx, StaffPlan } from './context.js';
import { genPerson } from './identity.js';
import { addDays, addMin, iso, minIso, sys, type Rec } from './kit.js';

const GROUPS = ['BARISTA', 'CASHIER', 'SERVICE'] as const;
type CandStatus = 'NEW' | 'CONTACTED' | 'INTERVIEW_SCHEDULED' | 'HIRED' | 'REJECTED';

export function buildRecruitment(ctx: SeedCtx): void {
  const usedSlots = new Set<string>();
  const items: { rec: Rec; created: string }[] = [];
  for (const bp of ctx.branches) {
    const hiredSource = bp.staff.find((s) => s.stage === 'PROBATION' && !s.pending && !s.isManager);
    const plan: CandStatus[] = ['NEW', 'NEW', 'CONTACTED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_SCHEDULED', 'REJECTED'];
    for (const status of plan) items.push(makeCandidate(ctx, bp, status, usedSlots));
    if (hiredSource) items.push(makeCandidate(ctx, bp, 'HIRED', usedSlots, hiredSource));
  }
  items.sort((a, b) => a.created.localeCompare(b.created));
  for (const it of items) it.rec.candidate_code = `UV${String(++ctx.counters.uv).padStart(4, '0')}`;
  ctx.out.candidates.push(...items.map((i) => i.rec));
}

function nextSlot(ctx: SeedCtx, used: Set<string>, dayFrom: number, dayTo: number): string {
  for (let i = 0; i < 200; i++) {
    const date = addDays(ctx.today, ctx.rng.int(dayFrom, dayTo));
    const hm = addMin('09:00', ctx.rng.int(0, 15) * 30);
    const key = `${date}T${hm}`;
    if (!used.has(key)) { used.add(key); return key; }
  }
  throw new Error('Không tìm được khung giờ phỏng vấn trống');
}

function makeCandidate(ctx: SeedCtx, bp: BranchPlan, status: CandStatus, used: Set<string>, hired?: StaffPlan): { rec: Rec; created: string } {
  const { rng } = ctx;
  const person = hired ? null : genPerson(rng, ctx.pool, [2000, 2007]);
  const group = hired ? String(hired.emp.staff_group) : rng.pick(GROUPS);
  const hireStart = hired ? hired.startDate : '';
  const created = hired
    ? iso(addDays(hireStart, -rng.int(6, 9)), '10:20')
    : minIso(iso(addDays(ctx.today, -(status === 'NEW' ? rng.int(0, 3) : status === 'REJECTED' ? rng.int(10, 14) : rng.int(3, 9))), `${rng.int(8, 21)}:${String(rng.int(0, 59)).padStart(2, '0')}`), ctx.nowIso);
  const contactedAt = status === 'NEW' ? '' : minIso(iso(addDays(created.slice(0, 10), 1), '09:40'), ctx.nowIso);
  const cid = newId();
  const rec: Rec = {
    ...sys(created, cid), ...(status === 'NEW' ? {} : { version: 2, updated_at: contactedAt, updated_by: ctx.hrUserId }),
    source_row: '', full_name: hired ? hired.emp.full_name : person!.fullName, phone: hired ? hired.emp.phone : person!.phone,
    position: STAFF_GROUP_LABELS[group] ?? group, branch_pref: bp.branch.id, status,
    hr_note: status === 'REJECTED' ? 'Chưa phù hợp yêu cầu khung ca tối cuối tuần' : status === 'HIRED' ? 'Đạt phỏng vấn, đã tiếp nhận thử việc' : status === 'NEW' ? '' : 'Đã gọi xác nhận nhu cầu và khung ca mong muốn',
    candidate_code: '', source_channel: rng.pick(C.SOURCE_CHANNELS), email: hired ? hired.emp.email : person!.email,
    birth_year: String(hired ? String(hired.emp.date_of_birth).slice(0, 4) : person!.dob.slice(0, 4)),
    gender: hired ? hired.emp.gender : person!.gender, staff_group: group, shift_pref: hired ? hired.preferredShift : rng.pick(bp.shifts).code,
    experience_note: rng.pick(C.EXPERIENCE_NOTES), cv_file_id: '', assigned_hr_id: ctx.hrUserId, contacted_at: contactedAt,
  };
  if (status === 'INTERVIEW_SCHEDULED') pushInterview(ctx, bp, cid, nextSlot(ctx, used, 1, 5), 'UPCOMING', created);
  if (status === 'REJECTED') pushInterview(ctx, bp, cid, nextSlot(ctx, used, -8, -2), 'FAIL', created);
  if (status === 'HIRED' && hired) {
    let slot = '';
    for (let i = 0; i < 50 && (!slot || used.has(slot)); i++) slot = `${addDays(hireStart, -rng.int(3, 5))}T${addMin('09:00', rng.int(0, 12) * 30)}`;
    used.add(slot);
    pushInterview(ctx, bp, cid, slot, 'PASS', created);
    hired.emp.candidate_id = cid;
  }
  return { rec, created };
}

function pushInterview(ctx: SeedCtx, bp: BranchPlan, candidateId: string, slot: string, kind: 'UPCOMING' | 'PASS' | 'FAIL', candCreated: string): void {
  const { rng } = ctx;
  const [date, hm] = slot.split('T') as [string, string];
  const startAt = iso(date, hm);
  const endAt = iso(date, addMin(hm, 30));
  const done = kind !== 'UPCOMING';
  const decidedAt = done ? iso(date, addMin(hm, 45)) : '';
  const scores = [rng.int(60, 95), rng.int(60, 95), rng.int(55, 95)].map((v) => (kind === 'FAIL' ? Math.min(v, 68) : kind === 'PASS' ? Math.max(v, 78) : 0));
  const avg = done ? Math.round(((scores[0]! + scores[1]! + scores[2]!) / 3) * 10) / 10 : 0;
  const confirmed = done || rng.chance(0.6);
  const rawScheduled = minIso(minIso(iso(addDays(candCreated.slice(0, 10), 1), '10:00'), ctx.nowIso), iso(addDays(date, -1), '16:00'));
  const scheduledAt = rawScheduled < candCreated ? candCreated : rawScheduled;
  ctx.out.interviews.push({
    ...sys(scheduledAt), ...(done ? { version: 2, updated_at: decidedAt, updated_by: ctx.hrUserId } : {}),
    candidate_id: candidateId, start_at: startAt, end_at: endAt, meet_link: 'https://meet.google.com/umb-milk-hr',
    interviewer_id: [ctx.hrUserId, bp.storeUserId].filter(Boolean).join(', '), status: done ? 'COMPLETED' : confirmed ? 'CONFIRMED' : 'SCHEDULED',
    score: avg, comment: kind === 'PASS' ? 'Thái độ tích cực, giao tiếp tốt, phù hợp khung ca đăng ký' : kind === 'FAIL' ? 'Chưa đáp ứng được lịch làm cuối tuần, kỹ năng giao tiếp cần cải thiện' : '',
    decision: kind === 'PASS' ? 'PASS' : kind === 'FAIL' ? 'FAIL' : 'PENDING', branch_id: bp.branch.id, duration_minutes: 30,
    calendar_event_id: `CAL-${Date.parse(startAt)}`, candidate_confirmed: confirmed, reschedule_requested: false, reschedule_reason: '',
    appearance_score: done ? scores[0] : 0, attitude_score: done ? scores[1] : 0, skill_score: done ? scores[2] : 0, decided_at: decidedAt,
  });
}
