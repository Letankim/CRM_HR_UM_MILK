import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearDriveFolderCache, ensureFolderPath, type drive_v3 } from '@umbm/google';
import { resolveRateLimitKey } from '../app.js';
import { APP_TZ, dayjs } from '../lib/time.js';
import { detectDueCatchUpBackup, resolveBackupTargets } from '../services/backup-targets.helper.js';
import type { InMemorySheetsGateway } from '../sheets/gateway.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';
import { flushCoalescedPhotoPatches, queueAttendancePhotoDrivePatch } from './attendance-photo-storage.js';

let t: TestAppContext;

beforeAll(async () => {
  t = await buildTestApp('cb');
});
afterAll(async () => {
  await t.app.close();
});

describe('Tối ưu tốc độ Upload Drive, Chịu tải đa nhân viên & Sao lưu tệp Google Sheets theo tháng', () => {
  it('gộp truy vấn thư mục Google Drive song song (Single-Flight + Prefix Cache) và tự làm mới khi xóa cache', async () => {
    let listCalls = 0;
    let createCalls = 0;
    const createdByKey = new Map<string, string>();
    const fakeDrive = {
      files: {
        list: async ({ q }: { q?: string }) => {
          listCalls++;
          await new Promise((r) => setTimeout(r, 8));
          const m = String(q ?? '').match(/name='([^']+)' and trashed=false and '([^']+)' in parents/);
          const found = m ? createdByKey.get(`${m[2]}::${m[1]}`) : undefined;
          return { data: { files: found ? [{ id: found, name: m![1] }] : [] } };
        },
        create: async ({ requestBody }: { requestBody?: { name?: string; parents?: string[] } }) => {
          createCalls++;
          await new Promise((r) => setTimeout(r, 8));
          const name = requestBody?.name ?? 'folder';
          const parent = requestBody?.parents?.[0] ?? 'ROOT';
          const id = `fld_${createCalls}_${name.replace(/\s+/g, '_')}`;
          createdByKey.set(`${parent}::${name}`, id);
          return { data: { id } };
        },
      },
    } as unknown as drive_v3.Drive;

    const jobs = [
      ...Array.from({ length: 6 }, () => ensureFolderPath(fakeDrive, 'root_umbm', ['01_ATTENDANCE_PHOTOS', '2026-11', '2026-11-01', 'Ca Sang'])),
      ...Array.from({ length: 6 }, () => ensureFolderPath(fakeDrive, 'root_umbm', ['01_ATTENDANCE_PHOTOS', '2026-11', '2026-11-01', 'Ca Chieu'])),
    ];
    const results = await Promise.all(jobs);
    expect(new Set(results.slice(0, 6)).size).toBe(1);
    expect(new Set(results.slice(6)).size).toBe(1);
    expect(results[0]).not.toBe(results[6]);
    // Chỉ có đúng 5 thư mục duy nhất trong cây: 01_ATTENDANCE_PHOTOS -> 2026-11 -> 2026-11-01 -> (Ca Sang | Ca Chieu)
    expect(listCalls).toBe(5);
    expect(createCalls).toBe(5);

    // Gọi lần tiếp theo trúng 100% RAM cache -> 0 lượt gọi Drive API
    const cachedId = await ensureFolderPath(fakeDrive, 'root_umbm', ['01_ATTENDANCE_PHOTOS', '2026-11', '2026-11-01', 'Ca Sang']);
    expect(cachedId).toBe(results[0]);
    expect(listCalls).toBe(5);

    // Xóa cache khi tự phục hồi lỗi 404 -> tra cứu lại từ Drive mà không tạo trùng
    clearDriveFolderCache(fakeDrive);
    const recoveredId = await ensureFolderPath(fakeDrive, 'root_umbm', ['01_ATTENDANCE_PHOTOS', '2026-11', '2026-11-01', 'Ca Sang']);
    expect(recoveredId).toBe(results[0]);
    expect(createCalls).toBe(5);
    expect(listCalls).toBe(9);
  });

  it('tách biệt hạn mức Rate-Limit cho từng nhân viên dùng chung Wi-Fi cửa hàng, chống ghi trùng Idempotency và gộp Batch ghi ID ảnh Drive', async () => {
    const sharedStoreIp = '203.113.188.10';
    const keyAnon = resolveRateLimitKey({ ip: sharedStoreIp, headers: {} });
    const keyEmp1 = resolveRateLimitKey({ ip: sharedStoreIp, headers: { authorization: 'Bearer tok_employee_01' } });
    const keyEmp2 = resolveRateLimitKey({ ip: sharedStoreIp, headers: {}, cookies: { umbm_at: 'tok_employee_02' } });
    expect(keyAnon).toBe(`ip_${sharedStoreIp}`);
    expect(keyEmp1).toMatch(/^usr_[0-9a-f]{16}$/);
    expect(keyEmp2).toMatch(/^usr_[0-9a-f]{16}$/);
    expect(keyEmp1).not.toBe(keyEmp2);

    const admin = await t.loginHeaders('admin');
    const publishedAssign = t.db.shiftAssignments.find((a) => a.status === 'PUBLISHED');
    expect(publishedAssign).toBeDefined();
    const branch = t.db.branches.get(publishedAssign!.branch_id) ?? t.db.branches.all()[0]!;

    const idemKey = `idem_morning_rush_${Date.now()}`;
    const checkPayload = {
      assignment_id: publishedAssign!.id,
      type: 'CHECK_IN',
      lat: branch.lat,
      lng: branch.lng,
      accuracy_m: 10,
      idempotency_key: idemKey,
    };
    const firstCheck = await t.app.inject({ method: 'POST', url: '/api/attendance/check', headers: admin, payload: checkPayload });
    expect(firstCheck.statusCode).toBe(201);
    const firstId = firstCheck.json().data.id as string;

    const retryCheck = await t.app.inject({ method: 'POST', url: '/api/attendance/check', headers: admin, payload: checkPayload });
    expect(retryCheck.statusCode).toBe(200);
    expect(retryCheck.json().data.id).toBe(firstId);
    expect(t.db.attendanceEvents.filter((e) => e.idempotency_key === idemKey)).toHaveLength(1);

    // Gộp nhiều ID ảnh Google Drive từ nhiều nhân viên vào đúng 1 lệnh batchUpdate duy nhất (0 Read + 1 Write)
    const extraEvents = await Promise.all(
      [1, 2, 3, 4].map((idx) =>
        t.db.attendanceEvents.insert({
          idempotency_key: `batch_photo_ev_${idx}_${Date.now()}`,
          employee_id: publishedAssign!.employee_id,
          assignment_id: publishedAssign!.id,
          branch_id: branch.id,
          type: 'CHECK_IN',
          server_time: '2026-10-28T07:00:00+07:00',
          lat: branch.lat,
          lng: branch.lng,
          accuracy_m: 12,
          distance_m: 5,
          within_radius: true,
          photo_id: `p_${idx}`,
          photo_sha256: 'sha256_test',
          device_info: 'Test Mobile',
          result: 'VALID',
          work_date: publishedAssign!.work_date,
          shift_code: publishedAssign!.shift_code,
          scheduled_time: '07:00',
          late_minutes: 0,
          early_leave_minutes: 0,
          allowed_radius_m: branch.radius_m,
          gps_status: 'OK',
          photo_drive_file_id: `local_temp_${idx}`,
          ip_address: sharedStoreIp,
          anomaly_flags_json: '[]',
          note: 'Test batch photo',
        }, 'system-test'),
      ),
    );
    await t.db.flushAllWrites();
    const gw = t.db.gateway as InMemorySheetsGateway;
    const readsBefore = gw.calls.read, writesBefore = gw.calls.write;

    extraEvents.forEach((ev, idx) => queueAttendancePhotoDrivePatch(t.ctx, ev.id, `drive_real_photo_00${idx + 1}`));
    await flushCoalescedPhotoPatches(t.ctx);

    expect(gw.calls.read - readsBefore).toBe(0);
    expect(gw.calls.write - writesBefore).toBe(1);
    extraEvents.forEach((ev, idx) => {
      expect(t.db.attendanceEvents.get(ev.id)?.photo_drive_file_id).toBe(`drive_real_photo_00${idx + 1}`);
    });
  });

  it('tự động sao lưu đầy đủ cả tệp Google Sheets tháng mới, tháng đang đối soát lương liền trước và phát hiện chạy bù khi Render ngủ đông', async () => {
    const admin = await t.loginHeaders('admin');

    const roll09 = await t.app.inject({ method: 'POST', url: '/api/admin/data-partitions/rollover', headers: admin, payload: { month_key: '2026_09', carry_forward: false } });
    expect(roll09.statusCode).toBe(201);
    const roll10 = await t.app.inject({ method: 'POST', url: '/api/admin/data-partitions/rollover', headers: admin, payload: { month_key: '2026_10', carry_forward: false } });
    expect(roll10.statusCode).toBe(201);
    const roll11 = await t.app.inject({ method: 'POST', url: '/api/admin/data-partitions/rollover', headers: admin, payload: { month_key: '2026_11', carry_forward: false } });
    expect(roll11.statusCode).toBe(201);

    // Rollover tự động kích hoạt bản chụp PRE_OPERATION bảo vệ dữ liệu trước và sau khi chuyển tháng
    const preOpLogs = t.db.backupLog.filter((b) => b.kind === 'PRE_OPERATION' && b.status === 'SUCCESS');
    expect(preOpLogs.length).toBeGreaterThanOrEqual(1);

    // Giả lập thời điểm ngày 02/11/2026: CRITICAL và DAILY bắt buộc bao phủ cả 2026_11 (đang dùng) và 2026_10 (tháng liền trước đang chốt lương)
    const nov2 = dayjs.tz('2026-11-02T10:00:00', APP_TZ);
    const critTargets = resolveBackupTargets(t.db, t.db.ids, 'CRITICAL', ['CORE', 'ATTENDANCE', 'PAYROLL'], nov2);
    expect(critTargets.map((x) => x.title)).toEqual(
      expect.arrayContaining(['UMBM_CORE', 'UMBM_ATTENDANCE', 'UMBM_PAYROLL', 'UMBM_MONTHLY_2026_11', 'UMBM_MONTHLY_2026_10']),
    );
    expect(critTargets.some((x) => x.title === 'UMBM_MONTHLY_2026_09')).toBe(false);

    // Kể cả khi Quản trị tạm chuyển sang xem tháng cũ 2026_09, DAILY vẫn sao lưu đủ cả 2026_09 (đang mở) + 2026_11 (tháng hiện tại) + 2026_10 (tháng trước)
    await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '2026_09' } });
    const dailyWhileViewingOld = resolveBackupTargets(t.db, t.db.ids, 'DAILY', ['CORE', 'HR', 'SCHEDULE', 'ATTENDANCE', 'PAYROLL', 'COMMS', 'SYSTEM'], nov2);
    expect(dailyWhileViewingOld.map((x) => x.title)).toEqual(
      expect.arrayContaining(['UMBM_MONTHLY_2026_09', 'UMBM_MONTHLY_2026_10', 'UMBM_MONTHLY_2026_11']),
    );

    // Chuyển lại về 2026_11, kiểm tra WEEKLY/MONTHLY bao phủ 100% toàn bộ các tệp tháng trong sổ đăng ký
    await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '2026_11' } });
    const monthlyTargets = resolveBackupTargets(t.db, t.db.ids, 'MONTHLY', ['CORE', 'HR', 'SCHEDULE', 'ATTENDANCE', 'PAYROLL', 'COMMS', 'SYSTEM'], nov2);
    expect(monthlyTargets.filter((x) => x.sourceKind === 'MONTHLY_FILE')).toHaveLength(3);

    // Endpoint nội bộ /api/internal/spreadsheets trả đầy đủ danh sách monthlySpreadsheets cho Worker độc lập
    const internalRes = await t.app.inject({
      method: 'GET',
      url: '/api/internal/spreadsheets',
      headers: { 'x-internal-token': t.ctx.env.INTERNAL_API_TOKEN },
    });
    expect(internalRes.statusCode).toBe(200);
    expect(internalRes.json().data.activePartitionMonth).toBe('2026_11');
    expect(internalRes.json().data.monthlySpreadsheets.map((m: { monthKey: string }) => m.monthKey)).toEqual(['2026_11', '2026_10', '2026_09']);

    // Chạy thực tế POST /api/admin/backups (MONTHLY -> 7 tệp gốc + 3 tệp tháng = 10 tệp x 2 (.gsheet + .xlsx) = 20 tệp)
    const manualMonthly = await t.app.inject({ method: 'POST', url: '/api/admin/backups', headers: admin, payload: { kind: 'MONTHLY', action: 'BACKUP' } });
    expect(manualMonthly.statusCode).toBe(201);
    expect(manualMonthly.json().data.files_count).toBe(20);
    const parsedRows = JSON.parse(manualMonthly.json().data.rows_json as string);
    expect(parsedRows.activePartitionMonth).toBe('2026_11');
    expect(parsedRows.monthlySpreadsheets).toEqual(['UMBM_MONTHLY_2026_11', 'UMBM_MONTHLY_2026_10', 'UMBM_MONTHLY_2026_09']);

    // Kiểm tra logic phát hiện chạy bù (catch-up) khi Render Free Tier thức dậy sau giờ cron
    expect(detectDueCatchUpBackup(t.db, dayjs.tz('2027-01-15T08:15:00', APP_TZ))).toBe('DAILY');
  });
});
