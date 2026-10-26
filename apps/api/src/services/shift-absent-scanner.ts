import type { Database } from '../data/database.js';
import { dayjs } from '../lib/time.js';
import { singleFlight, tolerantWrite } from './background-write.js';

type SweepResult = { markedAbsent: number; restoredCompleted: number };
const sweepsInFlight = new WeakMap<Database, Promise<SweepResult>>();

export function getVnNowDateAndHm(): { todayStr: string; nowHm: string } {
  const vnNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  return { todayStr: dayjs(vnNow).format('YYYY-MM-DD'), nowHm: dayjs(vnNow).format('HH:mm') };
}

/**
 * Quét ngầm tự động các ca làm việc đã phát hành (PUBLISHED) nhưng đã qua giờ kết thúc ca
 * (ví dụ ca 07:00 - 12:00 mà hiện tại là 12:30 vẫn chưa có CHECK_IN và chưa có Phiếu bổ sung công được duyệt)
 * để khóa điểm danh và chuyển trạng thái sang Vắng mặt (ABSENT).
 * Đồng thời tự động khôi phục sang Đã hoàn thành (COMPLETED) nếu đã có Phiếu bổ sung công được HR phê duyệt.
 * Chỉ một lượt quét chạy tại một thời điểm; dòng bị xung đột phiên bản được bỏ qua và xử lý ở lượt sau.
 */
export function sweepExpiredShiftsAndMarkAbsent(
  db: Database,
  actorId = 'auto-absent-scanner',
  options?: { nowDate?: string; nowHm?: string; includeSeedInTests?: boolean },
): Promise<SweepResult> {
  if (options) return runSweep(db, actorId, options);
  return singleFlight(sweepsInFlight, db, () => runSweep(db, actorId));
}

async function runSweep(
  db: Database,
  actorId: string,
  options?: { nowDate?: string; nowHm?: string; includeSeedInTests?: boolean },
): Promise<SweepResult> {
  const vn = getVnNowDateAndHm();
  const todayStr = options?.nowDate ?? vn.todayStr;
  const nowHm = options?.nowHm ?? vn.nowHm;
  const isVitest = Boolean(process.env.VITEST) && !options?.includeSeedInTests;

  const allEvents = db.attendanceEvents.all();
  const allAdjustments = db.attendanceAdjustments.all();
  let markedAbsent = 0;
  let restoredCompleted = 0;

  for (const a of db.shiftAssignments.all()) {
    if (a.day_type === 'OFF' || a.status === 'ON_LEAVE') continue;

    const emp = db.employees.get(a.employee_id) ?? db.employees.find((e) => e.employee_code === a.employee_id);
    const matchEmp = (eid: string) =>
      eid === a.employee_id || Boolean(emp && (eid === emp.id || eid === emp.employee_code));

    const shiftEvs = allEvents.filter(
      (ev) => ev.assignment_id === a.id || (matchEmp(ev.employee_id) && ev.work_date === a.work_date && ev.shift_code === a.shift_code),
    );
    const hasIn = shiftEvs.some((ev) => ev.type === 'CHECK_IN');
    const hasOut = shiftEvs.some((ev) => ev.type === 'CHECK_OUT');

    const approvedAdj = allAdjustments.find(
      (adj) =>
        adj.status === 'APPROVED' &&
        (adj.assignment_id === a.id || (matchEmp(adj.employee_id) && adj.work_date === a.work_date && adj.shift_code === a.shift_code)),
    );

    if (a.status === 'ABSENT' && (approvedAdj || (hasIn && hasOut))) {
      const restored = await tolerantWrite(() => db.shiftAssignments.update(
        a.id,
        db.shiftAssignments.get(a.id)?.version ?? a.version,
        {
          status: 'COMPLETED',
          scheduled_hours: approvedAdj?.requested_hours ?? a.scheduled_hours,
          note: approvedAdj ? `Đã bù công theo phiếu ${approvedAdj.adjustment_code}` : 'Đã hoàn thành điểm danh Vào/Ra ca',
        },
        actorId,
      ));
      if (restored) restoredCompleted++;
      continue;
    }

    if (a.status !== 'PUBLISHED' || hasIn || approvedAdj) continue;
    if (isVitest && a.source === 'SEED') continue;

    const endAt = a.end_at || '12:00';
    const isExpired = a.work_date < todayStr || (a.work_date === todayStr && nowHm > endAt);
    if (!isExpired) continue;

    const marked = await tolerantWrite(() => db.shiftAssignments.update(
      a.id,
      db.shiftAssignments.get(a.id)?.version ?? a.version,
      {
        status: 'ABSENT',
        note: a.note && a.note.includes('Vắng mặt') ? a.note : 'Quá giờ kết thúc ca chưa điểm danh — Tự động chuyển Vắng mặt',
      },
      actorId,
    ));
    if (marked) markedAbsent++;
  }

  return { markedAbsent, restoredCompleted };
}

/**
 * Khi HR phê duyệt Phiếu bổ sung công (HR_APPROVE), tự động cập nhật ca làm việc tương ứng
 * từ Vắng mặt (ABSENT) hoặc Đã phân ca (PUBLISHED) sang Đã hoàn thành (COMPLETED).
 */
export async function applyApprovedAdjustmentToShift(
  db: Database,
  adjustmentId: string,
  actorId: string,
): Promise<string> {
  const adj = db.attendanceAdjustments.get(adjustmentId);
  if (!adj) return '';
  const emp = db.employees.get(adj.employee_id) ?? db.employees.find((e) => e.employee_code === adj.employee_id);
  const matchEmp = (eid: string) =>
    eid === adj.employee_id || Boolean(emp && (eid === emp.id || eid === emp.employee_code));

  const targetShift =
    (adj.assignment_id ? db.shiftAssignments.get(adj.assignment_id) : undefined) ??
    db.shiftAssignments.find((a) => matchEmp(a.employee_id) && a.work_date === adj.work_date && a.shift_code === adj.shift_code);

  if (!targetShift) return '';
  await db.shiftAssignments.update(
    targetShift.id,
    targetShift.version,
    {
      status: 'COMPLETED',
      scheduled_hours: adj.requested_hours || targetShift.scheduled_hours,
      note: `Đã bù công theo phiếu bổ sung ${adj.adjustment_code}`,
    },
    actorId,
  );
  return targetShift.id;
}
