import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../data/database.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

import { DEMO_PIN } from '../data/memory-seed.js';
import { ACCESS_COOKIE } from '../auth/tokens.js';

let app: FastifyInstance;
let db: Database;
let loginHeaders: TestAppContext['loginHeaders'];
let login: TestAppContext['login'];

// Tiny 1x1 white JPEG base64
const SAMPLE_AVATAR_BASE64 =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

beforeAll(async () => {
  ({ app, db, loginHeaders, login } = await buildTestApp('employee-avatar-test'));
});

afterAll(async () => {
  await app.close();
});

describe('Avatar Hồ sơ Nhân sự & Đồng bộ Google Drive (Section 4.1)', () => {
  it('Admin/HR tải lên ảnh đại diện cho nhân sự -> lưu thành công và trả về avatarUrl', async () => {
    const hrHeaders = await loginHeaders('hr');
    const targetEmp = db.employees.all().find((e) => e.status === 'ACTIVE')!;

    const uploadRes = await app.inject({
      method: 'POST',
      url: `/api/admin/employees/${targetEmp.id}/avatar`,
      headers: hrHeaders,
      payload: { avatar_base64: SAMPLE_AVATAR_BASE64 },
    });

    expect(uploadRes.statusCode).toBe(200);
    const body = uploadRes.json();
    expect(body.success).toBe(true);
    expect(body.data.fileId).toBeTruthy();
    expect(body.data.url).toContain('/api/employees/avatars/');

    // Kiểm tra trực tiếp trong DB
    const refreshed = db.employees.get(targetEmp.id)!;
    expect(refreshed.avatar_file_id).toBe(body.data.fileId);

    // Kiểm tra API lấy danh sách nhân viên trả về avatarUrl
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/admin/employees?search=${targetEmp.employee_code}`,
      headers: hrHeaders,
    });
    expect(listRes.statusCode).toBe(200);
    const matched = listRes.json().data.find((e: { id: string }) => e.id === targetEmp.id);
    expect(matched.avatarUrl).toBe(body.data.url);
  });

  it('Tải ảnh đại diện qua GET /api/employees/avatars/:fileId trả về buffer JPEG hợp lệ', async () => {
    const hrHeaders = await loginHeaders('hr');
    const targetEmp = db.employees.all().find((e) => e.status === 'ACTIVE')!;

    const uploadRes = await app.inject({
      method: 'POST',
      url: `/api/admin/employees/${targetEmp.id}/avatar`,
      headers: hrHeaders,
      payload: { avatar_base64: SAMPLE_AVATAR_BASE64 },
    });
    const fileId = uploadRes.json().data.fileId;

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/employees/avatars/${fileId}`,
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers['content-type']).toContain('image/jpeg');
    expect(getRes.rawPayload.length).toBeGreaterThan(10);
  });

  it('Nhân viên tự tải lên và gỡ ảnh đại diện của mình qua /api/auth/profile/avatar', async () => {
    // Đăng nhập với tài khoản nhân viên (đã gắn với hồ sơ nhân sự)
    const { cookie } = await login('0901000002', DEMO_PIN, 'employee');
    const empHeaders = { cookie, 'x-umbm-client': 'web' };

    // 1. Tải lên avatar cá nhân
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/auth/profile/avatar',
      headers: empHeaders,
      payload: { avatar_base64: SAMPLE_AVATAR_BASE64 },
    });
    expect(uploadRes.statusCode).toBe(200);
    expect(uploadRes.json().success).toBe(true);

    // 2. Kiểm tra GET /api/auth/profile thấy avatarUrl
    const profileRes = await app.inject({
      method: 'GET',
      url: '/api/auth/profile',
      headers: empHeaders,
    });
    expect(profileRes.statusCode).toBe(200);
    expect(profileRes.json().data.avatarUrl).toBeTruthy();

    // 3. Gỡ ảnh đại diện cá nhân
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/auth/profile/avatar',
      headers: empHeaders,
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().data.url).toBeNull();

    // 4. Kiểm tra lại profile thấy avatarUrl = null
    const profileAfterRes = await app.inject({
      method: 'GET',
      url: '/api/auth/profile',
      headers: empHeaders,
    });
    expect(profileAfterRes.json().data.avatarUrl).toBeNull();
  });

  it('Báo lỗi tiếng Việt khi gửi dữ liệu ảnh đại diện không hợp lệ', async () => {
    const hrHeaders = await loginHeaders('hr');
    const targetEmp = db.employees.all().find((e) => e.status === 'ACTIVE')!;

    const badRes = await app.inject({
      method: 'POST',
      url: `/api/admin/employees/${targetEmp.id}/avatar`,
      headers: hrHeaders,
      payload: { avatar_base64: 'chuoi-khong-phai-base64-anh' },
    });

    expect(badRes.statusCode).toBe(400);
    expect(badRes.json().success).toBe(false);
    expect(badRes.json().message).toBe('Dữ liệu gửi lên không hợp lệ');
  });

  it('HR tạo mới nhân viên kèm avatar_base64 -> nhân viên tạo xong đã có avatar ngay', async () => {
    const hrHeaders = await loginHeaders('hr');
    const branchId = db.branches.all()[0]!.id;

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/employees',
      headers: hrHeaders,
      payload: {
        full_name: 'Trần Thị Thu Avatar',
        phone: '0901239999',
        branch_id: branchId,
        staff_group: 'BARISTA',
        stage: 'PROBATION',
        employment_type: 'PART_TIME',
        default_shift_code: 'CA_SANG',
        avatar_base64: SAMPLE_AVATAR_BASE64,
        create_account: false,
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createdData = createRes.json().data;
    expect(createdData.avatarUrl).toBeTruthy();
    expect(createdData.avatarFileId).toBeTruthy();
  });
});
