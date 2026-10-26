/**
 * Sửa trạng thái ca mẫu bị máy chủ chuyển nhầm sang Vắng mặt trong lúc dữ liệu điểm danh chưa kịp xuất hiện.
 * Chỉ xử lý dòng created_by = seed-realistic, áp dụng đúng quy tắc của bộ quét vắng mặt:
 *  - Có CHECK_IN + CHECK_OUT -> Đã hoàn thành;  - Chỉ có CHECK_IN -> Đã phân ca (chờ phiếu bổ sung công);
 *  - Có phiếu bổ sung đã duyệt -> Đã hoàn thành (bù công). Ca thực sự không điểm danh giữ nguyên Vắng mặt.
 */
import type { Database } from '../../src/data/database.js';
import { tolerantWrite } from '../../src/services/background-write.js';
import { SEED_ACTOR } from './kit.js';

export async function repairSeedShifts(db: Database, apply: boolean): Promise<{ toPublished: number; toCompleted: number }> {
  const events = db.attendanceEvents.all();
  const approvedAdj = new Map(db.attendanceAdjustments.all().filter((a) => a.status === 'APPROVED').map((a) => [a.assignment_id, a]));
  let toPublished = 0;
  let toCompleted = 0;
  for (const a of db.shiftAssignments.all().filter((x) => x.created_by === SEED_ACTOR && x.status === 'ABSENT')) {
    const evs = events.filter((e) => e.assignment_id === a.id);
    const hasIn = evs.some((e) => e.type === 'CHECK_IN');
    const hasOut = evs.some((e) => e.type === 'CHECK_OUT');
    const adj = approvedAdj.get(a.id);
    if (!hasIn && !adj) continue;
    const complete = Boolean(adj) || (hasIn && hasOut);
    if (complete) toCompleted++; else toPublished++;
    if (!apply) continue;
    const latest = db.shiftAssignments.get(a.id) ?? a;
    await tolerantWrite(() => db.shiftAssignments.update(a.id, latest.version, complete
      ? { status: 'COMPLETED', note: adj ? `Đã bù công theo phiếu bổ sung ${adj.adjustment_code}` : 'Đã hoàn thành điểm danh Vào/Ra ca' }
      : { status: 'PUBLISHED', note: 'Đã vào ca, chưa chấm ra — chờ phiếu bổ sung công' }, 'seed-repair'));
  }
  return { toPublished, toCompleted };
}
