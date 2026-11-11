import type { AttendanceAdjustment, Employee } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { getEmployeePartitionMonths } from './data-partition-employee.helper.js';
import { getPartitionStore } from './partition-write-router.js';

/**
 * Tải phiếu bổ sung công của nhân viên xuyên các tệp phân vùng tháng trong DATA_PARTITIONS_REGISTRY,
 * đảm bảo nhân viên không bị mất phiếu bù công (ADJ-xxxx) khi quản trị viên chuyển tháng dữ liệu.
 */
export async function loadCrossPartitionEmployeeAdjustments(
  ctx: AppContext,
  emp: Pick<Employee, 'id' | 'employee_code'>,
  todayStr: string,
): Promise<AttendanceAdjustment[]> {
  const isMine = (eid: string) => eid === emp.id || eid === emp.employee_code;
  const months = getEmployeePartitionMonths(ctx, todayStr);

  const adjMap = new Map<string, AttendanceAdjustment>();
  for (const mk of months) {
    const store = await getPartitionStore<AttendanceAdjustment>(ctx.db, 'ATTENDANCE_ADJUSTMENTS', mk).catch(() => undefined);
    if (!store) continue;
    for (const a of store.all()) {
      if (isMine(a.employee_id) && !a.is_deleted) adjMap.set(a.id, a);
    }
  }
  return Array.from(adjMap.values()).reverse();
}
