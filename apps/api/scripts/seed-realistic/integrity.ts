/**
 * Tự kiểm tra toàn vẹn TRƯỚC KHI GHI: mô phỏng đúng các quy tắc mà hệ thống (bộ quét vắng mặt, đồng bộ chi nhánh,
 * bộ đối soát ReconciliationService, bộ tổng hợp công tính lương) sẽ áp dụng, để bảo đảm dữ liệu mẫu không bị hệ thống
 * tự sửa / không sinh cảnh báo đối soát / không lệch bảng lương. Có bất kỳ vi phạm nào -> dừng, không ghi dòng nào.
 */
import type { SeedCtx } from './context.js';
import type { Rec } from './kit.js';

export function verifyIntegrity(ctx: SeedCtx): string[] {
  const { out, db, nowIso, today, nowHm } = ctx;
  const errors: string[] = [];
  const fail = (msg: string) => { if (errors.length < 40) errors.push(msg); };
  const s = (v: unknown) => String(v ?? '');

  const branchIds = new Set(db.branches.all().map((b) => b.id));
  const empById = new Map(out.employees.map((e) => [s(e.id), e]));
  const userById = new Map(out.users.map((u) => [s(u.id), u]));

  for (const e of out.employees) {
    const u = userById.get(s(e.user_id));
    if (!u || s(u.employee_id) !== s(e.employee_code)) fail(`Liên kết 2 chiều nhân sự - tài khoản lệch: ${s(e.employee_code)}`);
    if (u && s(u.branch_scope) !== s(e.branch_id)) fail(`Phạm vi chi nhánh tài khoản khác chi nhánh hồ sơ: ${s(e.employee_code)}`);
    if (!branchIds.has(s(e.branch_id))) fail(`Chi nhánh không tồn tại trên hồ sơ ${s(e.employee_code)}`);
    if (!/^0\d{9}$/.test(s(e.phone))) fail(`Số điện thoại sai chuẩn 0xxxxxxxxx: ${s(e.phone)}`);
  }
  /** Chỉ chặn khi giá trị MỚI trùng với dữ liệu đang có hoặc trùng nhau; trùng lặp sẵn có trong dữ liệu cũ chỉ cảnh báo. */
  const dupCheck = (label: string, existing: string[], fresh: string[]) => {
    const norm = (x: string) => x.trim().toLowerCase();
    const old = new Set<string>();
    for (const v of existing.filter(Boolean).map(norm)) {
      if (old.has(v)) ctx.warnings.add(`Dữ liệu hiện có đang trùng ${label}: ${v} (không do dữ liệu mẫu gây ra)`);
      old.add(v);
    }
    const seen = new Set<string>();
    for (const v of fresh.filter(Boolean).map(norm)) { if (old.has(v) || seen.has(v)) fail(`Dữ liệu mẫu trùng ${label}: ${v}`); seen.add(v); }
  };
  dupCheck('tên đăng nhập', db.users.all(true).map((u) => u.username), out.users.map((u) => s(u.username)));
  dupCheck('số điện thoại tài khoản', db.users.all(true).map((u) => u.phone), out.users.map((u) => s(u.phone)));
  dupCheck('mã nhân sự', db.employees.all(true).map((e) => e.employee_code), out.employees.map((e) => s(e.employee_code)));
  dupCheck('CCCD', db.employees.all(true).map((e) => e.citizen_id), out.employees.map((e) => s(e.citizen_id)));
  dupCheck('số tài khoản ngân hàng', db.employees.all(true).map((e) => e.bank_account_number), out.employees.map((e) => s(e.bank_account_number)));
  dupCheck('email', [...db.users.all(true).map((u) => u.email), ...db.employees.all(true).map((e) => e.email)], out.employees.map((e) => s(e.email)));

  const approved = new Set(out.leaveRequests.filter((l) => l.status === 'APPROVED').map((l) => `${s(l.employee_id)}|${s(l.leave_date)}`));
  const slot = new Set<string>();
  const eventsByAssign = new Map<string, Rec[]>();
  for (const ev of out.attendanceEvents) eventsByAssign.set(s(ev.assignment_id), [...(eventsByAssign.get(s(ev.assignment_id)) ?? []), ev]);
  const approvedAdj = new Set(out.attendanceAdjustments.filter((a) => a.status === 'APPROVED').map((a) => s(a.assignment_id)));
  const ratesByEmp = new Map<string, Rec[]>();
  for (const r of out.payRates) ratesByEmp.set(s(r.employee_id), [...(ratesByEmp.get(s(r.employee_id)) ?? []), r]);

  for (const a of out.shiftAssignments) {
    const eid = s(a.employee_id), date = s(a.work_date), key = `${eid}|${date}|${s(a.shift_code)}`;
    if (!empById.has(eid)) fail(`Ca làm tham chiếu nhân sự không tồn tại: ${s(a.id)}`);
    if (slot.has(key)) fail(`Trùng ca cùng nhân sự / ngày / khung ca: ${key}`);
    slot.add(key);
    if (approved.has(`${eid}|${date}`)) fail(`Xếp ca vào ngày đã được duyệt nghỉ OFF: ${key}`);
    const evs = eventsByAssign.get(s(a.id)) ?? [];
    const ended = date < today || (date === today && s(a.end_at) <= nowHm);
    if (a.status === 'PUBLISHED' && ended && !evs.some((e) => e.type === 'CHECK_IN')) fail(`Ca đã kết thúc chưa điểm danh nhưng chưa chuyển Vắng mặt: ${key}`);
    if (a.status === 'ABSENT' && evs.length > 0) fail(`Ca Vắng mặt nhưng có dữ liệu điểm danh: ${key}`);
    if (a.status === 'ABSENT' && approvedAdj.has(s(a.id))) fail(`Ca Vắng mặt đã có phiếu bổ sung được duyệt (phải là Đã hoàn thành): ${key}`);
    if (a.status === 'COMPLETED' && !approvedAdj.has(s(a.id))) fail(`Ca Đã hoàn thành không có phiếu bổ sung duyệt: ${key}`);
    if (['PUBLISHED', 'COMPLETED'].includes(s(a.status)) && ended) {
      const covered = (ratesByEmp.get(eid) ?? []).some((r) => s(r.effective_from) <= date && (!s(r.effective_to) || s(r.effective_to) >= date));
      if (!covered) fail(`Ngày công ${date} của ${eid} không có hồ sơ lương hiệu lực`);
    }
    for (const ev of evs) if (s(ev.employee_id) !== eid) fail(`Sự kiện điểm danh không khớp người làm ca: ${s(ev.id)}`);
  }

  for (const sw of out.shiftSwaps.filter((x) => x.status === 'APPROVED')) {
    const a = out.shiftAssignments.find((x) => x.id === sw.from_assignment_id);
    if (!a || a.employee_id !== sw.peer_id || a.swapped_from_employee_id !== sw.requester_id) fail(`Đổi ca đã duyệt chưa chuyển ca sang người nhận: ${s(sw.swap_code)}`);
  }

  for (const [table, rows] of Object.entries(out)) {
    for (const r of rows) {
      if (s(r.created_at) > nowIso || s(r.updated_at) > nowIso) fail(`Bản ghi ${table}/${s(r.id)} có thời điểm nằm trong tương lai`);
      if (s(r.updated_at) < s(r.created_at)) fail(`Bản ghi ${table}/${s(r.id)} có updated_at trước created_at`);
    }
  }
  return errors;
}
