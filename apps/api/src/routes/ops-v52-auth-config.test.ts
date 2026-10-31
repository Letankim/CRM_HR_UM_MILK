import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPERATION_SETTINGS, DRIVE_FOLDERS, OPERATION_SETTING_KEYS, evaluateOffWindow, normalizeOperationSettings, parsePartitionRegistry } from '@umbm/shared';
import { Database } from '../data/database.js';
import { dayjs } from '../lib/time.js';
import { createGoogleMonthlySpreadsheet } from '../sheets/monthly-spreadsheet.js';
import { WriteQueue } from '../sheets/write-queue.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
const web = { 'x-umbm-client': 'web' };

beforeAll(async () => { t = await buildTestApp('p'); });
afterAll(async () => { await t.app.close(); });

describe('Ops V5.2 — Cổng OFF theo tuần (hàm thuần)', () => {
  it('mở 09:00 Thứ 6 → 09:00 Thứ 7 cho tuần kế tiếp, đóng ngoài khung giờ', () => {
    const s = DEFAULT_OPERATION_SETTINGS;
    const fri = evaluateOffWindow(s, '2026-10-30', '10:00');
    expect(fri.isOpen).toBe(true);
    expect(fri.targetWeekStart).toBe('2026-11-02');
    expect(fri.targetWeekEnd).toBe('2026-11-08');
    expect(evaluateOffWindow(s, '2026-10-30', '08:59').isOpen).toBe(false);
    const satAfter = evaluateOffWindow(s, '2026-10-31', '09:00');
    expect(satAfter.isOpen).toBe(false);
    expect(satAfter.targetWeekStart).toBe('2026-11-09');
    const wed = evaluateOffWindow(s, '2026-10-28', '12:00');
    expect(wed.isOpen).toBe(false);
    expect(wed.opensAt).toBe('2026-10-30 09:00');
    expect(wed.message).toContain('Cổng đăng ký nghỉ OFF đang đóng');
  });

  it('chuẩn hóa cấu hình sai về giá trị mặc định', () => {
    const n = normalizeOperationSettings({ pinRotationDays: -5, offWindowOpenTime: '25:00', maxShiftsPerDay: 9, dataPartitionMonth: '2026-11' });
    expect(n.pinRotationDays).toBe(DEFAULT_OPERATION_SETTINGS.pinRotationDays);
    expect(n.offWindowOpenTime).toBe('09:00');
    expect(n.maxShiftsPerDay).toBe(2);
    expect(n.dataPartitionMonth).toBe('');
  });
});

describe('Ops V5.2 — Mã PIN 6 số, đăng nhập 2 bước & bắt buộc đổi PIN', () => {
  it('cấp tài khoản nhân viên yêu cầu PIN 6 số, tra cứu SĐT, đăng nhập và bắt buộc đổi PIN trước khi dùng API', async () => {
    const admin = await t.loginHeaders('admin');
    const badPin = await t.app.inject({ method: 'POST', url: '/api/admin/accounts', headers: admin, payload: { username: 'nv.pin.sai', display_name: 'Nhân Viên PIN Sai', phone_number: '0912000111', role: 'THU_VIEC', secret: 'abc12345' } });
    expect(badPin.statusCode).toBe(400);
    expect(badPin.json().errors.details[0].field).toBe('secret');

    const created = await t.app.inject({ method: 'POST', url: '/api/admin/accounts', headers: admin, payload: { username: 'nv.pin.moi', display_name: 'Lý Thị PIN Mới', phone_number: '0912000222', role: 'THU_VIEC', secret: '135790' } });
    expect(created.statusCode).toBe(201);
    const user = created.json().data.user;
    const act = await t.app.inject({ method: 'POST', url: '/api/admin/accounts/bulk-action', headers: admin, payload: { action: 'ACTIVATE', items: [{ id: user.id, version: created.json().data.version }] } });
    expect(act.statusCode).toBe(200);

    const unknown = await t.app.inject({ method: 'POST', url: '/api/auth/employee/lookup', headers: web, payload: { phone: '0999999999' } });
    expect(unknown.statusCode).toBe(400);
    const lookup = await t.app.inject({ method: 'POST', url: '/api/auth/employee/lookup', headers: web, payload: { phone: '0912000222' } });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().data.maskedPhone).toBe('0912***222');
    expect(lookup.json().data.pinLength).toBe(6);

    const byUsername = await t.login('nv.pin.moi', '135790', 'employee');
    expect(byUsername.res.statusCode).toBe(400);
    const wrongFormat = await t.login('0912000222', '13579', 'employee');
    expect(wrongFormat.res.statusCode).toBe(400);

    const { res, cookie } = await t.login('0912000222', '135790', 'employee');
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.mustChangePin).toBe(true);
    expect(res.json().data.user.pinChangeReason).toBe('FIRST_LOGIN');
    const headers = { ...web, cookie };

    const blocked = await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().errors.code).toBe('PIN_CHANGE_REQUIRED');
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/me', headers })).statusCode).toBe(200);

    const notDigits = await t.app.inject({ method: 'PUT', url: '/api/auth/password', headers, payload: { current_secret: '135790', new_secret: 'matkhau1', confirm_secret: 'matkhau1' } });
    expect(notDigits.statusCode).toBe(400);
    const same = await t.app.inject({ method: 'PUT', url: '/api/auth/password', headers, payload: { current_secret: '135790', new_secret: '135790', confirm_secret: '135790' } });
    expect(same.statusCode).toBe(400);
    const changed = await t.app.inject({ method: 'PUT', url: '/api/auth/password', headers, payload: { current_secret: '135790', new_secret: '246802', confirm_secret: '246802' } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().data.user.mustChangePin).toBe(false);
    expect((await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers })).statusCode).toBe(200);

    const reset = await t.app.inject({ method: 'PUT', url: `/api/admin/accounts/${user.id}`, headers: admin, payload: { version: t.db.users.get(user.id)!.version, secret: '112233' } });
    expect(reset.statusCode).toBe(200);
    const relog = await t.login('0912000222', '112233', 'employee');
    expect(relog.res.json().data.user.pinChangeReason).toBe('RESET');
  });

  it('Quản trị cấu hình chu kỳ đổi PIN định kỳ → tài khoản quá hạn bị yêu cầu đổi PIN (EXPIRED)', async () => {
    const admin = await t.loginHeaders('admin');
    const hr = await t.loginHeaders('hr');
    const forbidden = await t.app.inject({ method: 'PUT', url: '/api/admin/operations-config', headers: hr, payload: { pin_rotation_days: 30 } });
    expect(forbidden.statusCode).toBe(403);
    const invalid = await t.app.inject({ method: 'PUT', url: '/api/admin/operations-config', headers: admin, payload: { off_window_open_time: '9h' } });
    expect(invalid.statusCode).toBe(400);
    const saved = await t.app.inject({ method: 'PUT', url: '/api/admin/operations-config', headers: admin, payload: { pin_rotation_days: 30, checkout_max_late_hours: 3, off_window_open_weekday: 5, off_window_close_weekday: 6 } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.settings.pinRotationDays).toBe(30);

    const nv = t.db.users.find((u) => u.username === 'nv.chinhthuc')!;
    await t.db.users.update(nv.id, nv.version, { pin_changed_at: dayjs().subtract(40, 'day').format('YYYY-MM-DDTHH:mm:ssZ') }, 'test');
    const { res } = await t.login('0901000002', '246810', 'employee');
    expect(res.json().data.user.mustChangePin).toBe(true);
    expect(res.json().data.user.pinChangeReason).toBe('EXPIRED');

    await t.app.inject({ method: 'PUT', url: '/api/admin/operations-config', headers: admin, payload: { pin_rotation_days: 0 } });
    const after = await t.login('0901000002', '246810', 'employee');
    expect(after.res.json().data.user.mustChangePin).toBe(false);
  });
});

describe('Ops V5.2 — Phân vùng dữ liệu theo tháng (Tạo 1 File Google Spreadsheet độc lập mỗi tháng)', () => {
  it('tạo hẳn 1 File Google Spreadsheet mới chứa đủ 5 bảng sạch, lưu sổ đăng ký vào SYSTEM_SETTINGS, giữ qua khởi động lại và chuyển qua lại file gốc', async () => {
    const admin = await t.loginHeaders('admin');
    const hr = await t.loginHeaders('hr');
    const emp = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    const future = await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: emp.id, work_date: '2099-01-05', shift_code: 'CA_SANG', status: 'PUBLISHED' } });
    expect(future.statusCode).toBe(201);
    const futureId = future.json().data.id as string;
    const oldCount = t.db.shiftAssignments.all().length;

    const bad = await t.app.inject({ method: 'POST', url: '/api/admin/data-partitions/rollover', headers: admin, payload: { month_key: '2099-01' } });
    expect(bad.statusCode).toBe(400);
    const roll = await t.app.inject({ method: 'POST', url: '/api/admin/data-partitions/rollover', headers: admin, payload: { month_key: '2099_01' } });
    expect(roll.statusCode).toBe(201);
    expect(roll.json().data.carried.SHIFT_ASSIGNMENTS).toBe(1);
    expect(roll.json().data.file.fileName).toBe('UMBM_MONTHLY_2099_01');
    expect(roll.json().data.file.spreadsheetId).toBe('mem-monthly-2099_01');
    expect(roll.json().data.file.folderPath).toBe(`${DRIVE_FOLDERS.MONTHLY_DATABASES}/2099-01`);

    expect(t.db.partitionMonth).toBe('2099_01');
    expect(t.db.shiftAssignments.spreadsheetId).toBe('mem-monthly-2099_01');
    expect(t.db.attendanceEvents.spreadsheetId).toBe('mem-monthly-2099_01');
    expect(t.db.shiftAssignments.tab).toBe('SHIFT_ASSIGNMENTS');
    expect(t.db.attendanceEvents.tab).toBe('ATTENDANCE_EVENTS');
    expect(t.db.shiftAssignments.get(futureId)).toBeTruthy();
    expect(t.db.shiftAssignments.all().length).toBe(1);

    const monthlyTabs = await t.db.gateway.listTabs('mem-monthly-2099_01');
    expect(monthlyTabs).toEqual(expect.arrayContaining(['SHIFT_ASSIGNMENTS', 'LEAVE_REQUESTS', 'SHIFT_SWAPS', 'ATTENDANCE_EVENTS', 'ATTENDANCE_ADJUSTMENTS']));
    expect(await t.db.gateway.listTabs(t.db.ids.SCHEDULE)).not.toContain('SHIFT_ASSIGNMENTS_2099_01');
    expect(await t.db.gateway.listTabs(t.db.ids.ATTENDANCE)).not.toContain('ATTENDANCE_EVENTS_2099_01');

    const regRow = t.db.systemSettings.find((s) => s.key === OPERATION_SETTING_KEYS.DATA_PARTITIONS_REGISTRY);
    const parsedReg = parsePartitionRegistry(regRow?.value);
    expect(parsedReg.find((r) => r.monthKey === '2099_01')?.spreadsheetId).toBe('mem-monthly-2099_01');

    // Mô phỏng Render khởi động lại: Database mới tự đọc SYSTEM_SETTINGS và gắn đúng file tháng 2099_01 mà không cần sửa .env
    const rebootedDb = new Database(t.db.gateway, new WriteQueue(), t.db.ids);
    await rebootedDb.loadAll();
    expect(rebootedDb.partitionMonth).toBe('2099_01');
    expect(rebootedDb.shiftAssignments.spreadsheetId).toBe('mem-monthly-2099_01');
    expect(rebootedDb.attendanceEvents.spreadsheetId).toBe('mem-monthly-2099_01');
    expect(rebootedDb.shiftAssignments.get(futureId)).toBeTruthy();

    const list = await t.app.inject({ method: 'GET', url: '/api/admin/data-partitions', headers: admin });
    const foundItem = list.json().data.items.find((i: { monthKey: string }) => i.monthKey === '2099_01');
    expect(foundItem).toMatchObject({ monthKey: '2099_01', isActive: true, mode: 'MONTHLY_FILE', fileName: 'UMBM_MONTHLY_2099_01' });

    const back = await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '' } });
    expect(back.statusCode).toBe(200);
    expect(t.db.shiftAssignments.spreadsheetId).toBe(t.db.ids.SCHEDULE);
    expect(t.db.attendanceEvents.spreadsheetId).toBe(t.db.ids.ATTENDANCE);
    expect(t.db.shiftAssignments.tab).toBe('SHIFT_ASSIGNMENTS');
    expect(t.db.shiftAssignments.get(futureId)).toBeUndefined();
    expect(t.db.shiftAssignments.all().length).toBe(oldCount - 1);

    const forwardAgain = await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '2099_01' } });
    expect(forwardAgain.statusCode).toBe(200);
    expect(t.db.shiftAssignments.spreadsheetId).toBe('mem-monthly-2099_01');
    expect(t.db.shiftAssignments.get(futureId)).toBeTruthy();
    await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '' } });
  });

  it('createGoogleMonthlySpreadsheet tạo đúng 1 file trên Google Drive folder tháng, ghi header, đóng băng dòng 1 và chống tạo trùng khi gọi lại', async () => {
    const createSpreadsheet = vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'gdrive-sheet-2026-11',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/gdrive-sheet-2026-11/edit',
        sheets: [{ properties: { title: 'SHIFT_ASSIGNMENTS', sheetId: 101 } }, { properties: { title: 'ATTENDANCE_EVENTS', sheetId: 102 } }],
      },
    });
    const valuesBatchUpdate = vi.fn().mockResolvedValue({ data: {} });
    const sheetsBatchUpdate = vi.fn().mockResolvedValue({ data: {} });
    const mockSheets = { spreadsheets: { create: createSpreadsheet, batchUpdate: sheetsBatchUpdate, values: { batchUpdate: valuesBatchUpdate } } } as never;

    let fileExistsInFolder = false;
    const filesList = vi.fn().mockImplementation(async ({ q }: { q: string }) => {
      if (q.includes("mimeType='application/vnd.google-apps.folder'")) return { data: { files: [{ id: 'folder-id-1' }] } };
      return { data: { files: fileExistsInFolder ? [{ id: 'gdrive-sheet-2026-11', name: 'UMBM_MONTHLY_2026_11', webViewLink: 'https://docs.google.com/spreadsheets/d/gdrive-sheet-2026-11/edit' }] : [] } };
    });
    const filesGet = vi.fn().mockResolvedValue({ data: { parents: ['root-parent'] } });
    const filesUpdate = vi.fn().mockImplementation(async () => {
      fileExistsInFolder = true;
      return { data: { id: 'gdrive-sheet-2026-11', webViewLink: 'https://docs.google.com/spreadsheets/d/gdrive-sheet-2026-11/edit' } };
    });
    const mockDrive = { files: { list: filesList, create: vi.fn(), get: filesGet, update: filesUpdate } } as never;

    const params = {
      monthKey: '2026_11', title: 'UMBM_MONTHLY_2026_11', folderSegments: ['07_MONTHLY_DATABASES', '2026-11'],
      tabs: [{ name: 'SHIFT_ASSIGNMENTS', headers: ['id', 'work_date'] }, { name: 'ATTENDANCE_EVENTS', headers: ['id', 'server_time'] }],
    };
    const first = await createGoogleMonthlySpreadsheet(mockSheets, { drive: mockDrive, rootFolderId: 'drive-root' }, params);
    expect(first).toMatchObject({ spreadsheetId: 'gdrive-sheet-2026-11', fileName: 'UMBM_MONTHLY_2026_11', folderId: 'folder-id-1', folderPath: '07_MONTHLY_DATABASES/2026-11' });
    expect(createSpreadsheet).toHaveBeenCalledTimes(1);
    expect(filesUpdate).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'gdrive-sheet-2026-11', addParents: 'folder-id-1', removeParents: 'root-parent' }));
    expect(valuesBatchUpdate).toHaveBeenCalledTimes(1);
    expect(sheetsBatchUpdate).toHaveBeenCalledTimes(1);

    const second = await createGoogleMonthlySpreadsheet(mockSheets, { drive: mockDrive, rootFolderId: 'drive-root' }, params);
    expect(second.spreadsheetId).toBe('gdrive-sheet-2026-11');
    expect(createSpreadsheet).toHaveBeenCalledTimes(1);
  });
});
