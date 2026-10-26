/**
 * Bước 4 — Điểm danh GPS & Camera: sinh sự kiện Vào/Ra ca gốc cho người THỰC SỰ làm ca (sau đổi ca / thay ca),
 * tọa độ nằm trong bán kính chi nhánh, độ chính xác GPS, đi trễ / về sớm / ở lại tăng ca theo tỷ lệ thực tế.
 * Bất thường: quên chấm ra, vắng mặt (bộ quét tự chuyển Vắng mặt) kèm Phiếu bổ sung công ở đủ các trạng thái duyệt;
 * trạng thái ca được đặt đúng như hệ thống sẽ tự tính, nên bộ quét tự động không phải sửa lại bất kỳ dòng nào.
 */
import * as C from './catalog.js';
import { empCode, empId, type AssignPlan, type SeedCtx } from './context.js';
import { addDays, addMin, iso, minIso, sys, toMin, type Rec } from './kit.js';

const toRad = (d: number) => (d * Math.PI) / 180;
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
const durationVi = (m: number) => (m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ${m % 60 ? ` ${m % 60} phút` : ''}`);

export function buildAttendance(ctx: SeedCtx): void {
  const adjustments: Rec[] = [];
  for (const a of [...ctx.assignments].sort((x, y) => x.date.localeCompare(y.date))) {
    if (a.phase === 'FUTURE') continue;
    if (a.phase === 'NOW') { pushEvent(ctx, a, 'CHECK_IN', checkInHm(ctx, a)); continue; }
    const r = ctx.rng.next();
    if (!a.locked && r < 0.025) markAbsent(ctx, a, adjustments);
    else if (!a.locked && r < 0.06) forgotCheckout(ctx, a, adjustments);
    else {
      pushEvent(ctx, a, 'CHECK_IN', checkInHm(ctx, a));
      pushEvent(ctx, a, 'CHECK_OUT', checkOutHm(ctx, a));
    }
  }
  adjustments.sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
  for (const adj of adjustments) {
    adj.adjustment_code = `ADJ-${String(++ctx.counters.adj).padStart(4, '0')}`;
    const target = ctx.assignments.find((x) => x.rec.id === adj.assignment_id);
    if (target && adj.status === 'APPROVED') target.rec.note = `Đã bù công theo phiếu bổ sung ${String(adj.adjustment_code)}`;
  }
  ctx.out.attendanceAdjustments.push(...adjustments);
}

function checkInHm(ctx: SeedCtx, a: AssignPlan): string {
  const { rng } = ctx;
  const hm = rng.chance(0.1) ? addMin(a.tpl.start, rng.int(5, 25)) : addMin(a.tpl.start, -rng.int(2, 15));
  return a.phase === 'NOW' && hm > ctx.nowHm ? addMin(ctx.nowHm, -1) : hm;
}

function checkOutHm(ctx: SeedCtx, a: AssignPlan): string {
  const { rng } = ctx;
  const r = rng.next();
  if (r < 0.04) return addMin(a.tpl.end, -rng.int(10, 20));
  if (r < 0.1 && a.rec.day_type !== 'OT') return addMin(a.tpl.end, rng.int(30, 55));
  return addMin(a.tpl.end, rng.int(0, 12));
}

function pushEvent(ctx: SeedCtx, a: AssignPlan, type: 'CHECK_IN' | 'CHECK_OUT', hm: string): Rec {
  const { rng } = ctx;
  const b = a.bp.branch;
  const meters = rng.int(4, Math.max(8, Math.min(b.radius_m - 10, 70)));
  const bearing = rng.next() * 2 * Math.PI;
  const lat = Number((b.lat + (meters * Math.cos(bearing)) / 111_320).toFixed(6));
  const lng = Number((b.lng + (meters * Math.sin(bearing)) / (111_320 * Math.cos(toRad(b.lat)))).toFixed(6));
  const distance = haversine(lat, lng, b.lat, b.lng);
  const lowAcc = rng.chance(0.06);
  const accuracy = lowAcc ? b.max_accuracy_m + rng.int(5, 40) : rng.int(6, Math.min(30, b.max_accuracy_m));
  const sched = type === 'CHECK_IN' ? a.tpl.start : a.tpl.end;
  const late = type === 'CHECK_IN' ? Math.max(0, toMin(hm) - toMin(sched)) : 0;
  const early = type === 'CHECK_OUT' ? Math.max(0, toMin(sched) - toMin(hm)) : 0;
  const label = type === 'CHECK_IN' ? (late > 0 ? `Vào trễ ${durationVi(late)}` : 'Vào đúng giờ') : early > 0 ? `Ra sớm ${durationVi(early)}` : 'Ra đúng giờ';
  const serverTime = iso(a.date, hm, rng.int(0, 59));
  const ts = Date.parse(serverTime);
  const ev: Rec = {
    ...sys(serverTime), idempotency_key: `chk_${String(a.rec.id)}_${type}_${ts}`, employee_id: empId(a.performer), assignment_id: a.rec.id,
    branch_id: b.id, type, server_time: serverTime, lat, lng, accuracy_m: accuracy, distance_m: distance, within_radius: distance <= b.radius_m,
    photo_id: `photo_${ts}`, photo_sha256: `sha256_${rng.digits(12)}`, device_info: rng.pick(C.DEVICES), result: lowAcc ? 'LOW_ACCURACY' : 'VALID',
    work_date: a.date, shift_code: a.tpl.code, scheduled_time: sched, late_minutes: late, early_leave_minutes: early,
    allowed_radius_m: b.radius_m, gps_status: lowAcc ? 'WARNING' : 'OK', photo_drive_file_id: 'demo_camera_selfie',
    ip_address: `113.161.${rng.int(1, 254)}.${rng.int(1, 254)}`, anomaly_flags_json: '[]', note: `${label} · Khoảng cách GPS ${distance}m · ${empCode(a.performer)}`,
  };
  ctx.out.attendanceEvents.push(ev);
  return ev;
}

type AdjStatus = 'PENDING' | 'STORE_CONFIRMED' | 'APPROVED' | 'REJECTED';

function adjustment(ctx: SeedCtx, a: AssignPlan, kind: keyof typeof C.ADJ_REASONS, wanted: AdjStatus, eventId: string): Rec {
  const { rng } = ctx;
  let status = wanted;
  const submitted = minIso(iso(a.date, addMin(a.tpl.end, rng.int(40, 180))), ctx.nowIso);
  let storeAt = status === 'PENDING' ? '' : iso(addDays(a.date, 1), `08:${String(rng.int(10, 59)).padStart(2, '0')}`);
  let hrAt = status === 'APPROVED' || status === 'REJECTED' ? iso(addDays(a.date, 1), `15:${String(rng.int(0, 59)).padStart(2, '0')}`) : '';
  if (hrAt && hrAt > ctx.nowIso) { hrAt = ''; status = 'STORE_CONFIRMED'; }
  if (storeAt && storeAt > ctx.nowIso) { storeAt = ''; status = 'PENDING'; }
  const storeId = a.bp.storeUserId;
  return {
    ...sys(submitted), ...(storeAt ? { version: hrAt ? 3 : 2, updated_at: hrAt || storeAt, updated_by: hrAt ? ctx.hrUserId : storeId } : {}),
    event_id: eventId, assignment_id: a.rec.id, employee_id: empId(a.performer), kind, requested_time: a.tpl.end, reason: rng.pick(C.ADJ_REASONS[kind]),
    evidence_file_id: '', store_confirmed_by: storeAt ? storeId : '', store_confirmed_at: storeAt, hr_decision: hrAt ? status : 'PENDING',
    decided_by: hrAt ? ctx.hrUserId : '', decision_reason: status === 'APPROVED' ? 'Cửa hàng xác nhận có làm thực tế, đồng ý bù công' : status === 'REJECTED' ? 'Không đủ căn cứ xác nhận có mặt làm việc' : '',
    adjustment_code: '', record_id: '', branch_id: a.bp.branch.id, work_date: a.date, shift_code: a.tpl.code, exception_source: 'EMPLOYEE',
    requested_check_in_at: a.tpl.start, requested_check_out_at: a.tpl.end, requested_hours: a.tpl.hours, status,
    store_note: storeAt ? 'Quản lý cửa hàng xác nhận nhân sự có mặt đúng ca' : '', decided_at: hrAt, applied_to_record: status === 'APPROVED',
  };
}

/** Quên chấm ra: có CHECK_IN, ca giữ Đã phân ca cho tới khi phiếu bổ sung được HR duyệt (-> Đã hoàn thành). */
function forgotCheckout(ctx: SeedCtx, a: AssignPlan, out: Rec[]): void {
  const checkIn = pushEvent(ctx, a, 'CHECK_IN', checkInHm(ctx, a));
  const old = a.date < addDays(ctx.today, -2);
  const status: AdjStatus = old ? (ctx.rng.chance(0.8) ? 'APPROVED' : 'STORE_CONFIRMED') : ctx.rng.chance(0.5) ? 'PENDING' : 'STORE_CONFIRMED';
  const adj = adjustment(ctx, a, 'FORGOT_CHECK_OUT', status, String(checkIn.id));
  out.push(adj);
  if (adj.status === 'APPROVED') {
    Object.assign(a.rec, { status: 'COMPLETED', version: Number(a.rec.version) + 1, updated_at: adj.decided_at, updated_by: ctx.hrUserId });
  }
}

/** Vắng mặt: không có sự kiện, bộ quét đã chuyển Vắng mặt; một phần có phiếu bổ sung (duyệt -> Đã hoàn thành). */
function markAbsent(ctx: SeedCtx, a: AssignPlan, out: Rec[]): void {
  const absentAt = minIso(iso(a.date, addMin(a.tpl.end, 1)), ctx.nowIso);
  Object.assign(a.rec, {
    status: 'ABSENT', version: Number(a.rec.version) + 1, updated_at: absentAt, updated_by: 'auto-absent-scanner',
    note: 'Quá giờ kết thúc ca chưa điểm danh — Tự động chuyển Vắng mặt',
  });
  if (!ctx.rng.chance(0.55)) return;
  const kind = ctx.rng.chance(0.5) ? 'GPS_ERROR' : 'CAMERA_ERROR';
  const status: AdjStatus = ctx.rng.pick(['APPROVED', 'APPROVED', 'REJECTED', 'PENDING'] as const);
  const adj = adjustment(ctx, a, kind, status, '');
  out.push(adj);
  if (adj.status === 'APPROVED') {
    Object.assign(a.rec, { status: 'COMPLETED', version: Number(a.rec.version) + 1, updated_at: adj.decided_at, updated_by: ctx.hrUserId });
  }
}
