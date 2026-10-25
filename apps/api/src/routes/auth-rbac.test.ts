import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEMO_PASSWORD, DEMO_PIN } from '../data/memory-seed.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let app: FastifyInstance;
let login: TestAppContext['login'];

beforeAll(async () => {
  ({ app, login } = await buildTestApp('x'));
});

afterAll(async () => {
  await app.close();
});

describe('Chuẩn API Envelope & Xác thực', () => {
  it('đăng nhập backoffice thành công, đúng envelope chuẩn và không trả password_hash', async () => {
    const { res, cookie } = await login('admin', DEMO_PASSWORD, 'backoffice');
    expect(res.statusCode).toBe(200);
    expect(cookie).not.toBe('');
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.message).toBe('string');
    expect(body.errors).toBeNull();
    expect(body.request_id).toMatch(/^req_[0-9a-f]{16}$/);
    expect(JSON.stringify(body)).not.toContain('password_hash');
  });

  it('nhân viên không đăng nhập được vào backoffice', async () => {
    const { res } = await login('nv.chinhthuc', DEMO_PIN, 'backoffice');
    expect(res.statusCode).toBe(401);
    expect(res.json().success).toBe(false);
  });

  it('nhân viên đăng nhập app bằng số điện thoại dạng 09...', async () => {
    const { res } = await login('0901000002', DEMO_PIN, 'employee');
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it('tài khoản PENDING_ACTIVATION bị chặn', async () => {
    const { res } = await login('0901000003', DEMO_PIN, 'employee');
    expect(res.statusCode).toBe(403);
    expect(res.json().success).toBe(false);
  });

  it('request thay đổi dữ liệu thiếu header CSRF bị từ chối', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(403);
  });
});

describe('Chuẩn danh sách (Pagination, Sort, Filter) & Validation Error chi tiết', () => {
  it('trả về đúng cấu trúc meta.pagination, meta.sort, meta.filters cho danh sách tài khoản', async () => {
    const { cookie } = await login('admin', DEMO_PASSWORD, 'backoffice');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/accounts?page=1&per_page=3&sort_by=username&sort_order=asc&status=ACTIVE',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Lấy danh sách tài khoản thành công');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(3);
    expect(body.meta).toEqual({
      pagination: {
        page: 1,
        per_page: 3,
        total: 7,
        last_page: 3,
        has_next_page: true,
        has_previous_page: false,
      },
      sort: {
        sort_by: 'username',
        sort_order: 'asc',
      },
      filters: {
        status: 'ACTIVE',
      },
    });
    expect(body.errors).toBeNull();
    expect(body.request_id).toMatch(/^req_[0-9a-f]{16}$/);
  });

  it('trả về đúng định dạng lỗi Validation (field, code, message tiếng Việt, rejected_value) khi số điện thoại sai', async () => {
    const { cookie } = await login('hr', DEMO_PASSWORD, 'backoffice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers: { cookie, 'x-umbm-client': 'web' },
      payload: {
        username: 'nv.testphone',
        display_name: 'Nhân Viên Kiểm Thử',
        phone_number: '1865341745',
        role: 'THU_VIEC',
        secret: '246810',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe('Dữ liệu gửi lên không hợp lệ');
    expect(body.data).toBeNull();
    expect(body.meta).toBeNull();
    expect(body.errors).toEqual({
      code: 'VALIDATION_ERROR',
      details: [
        {
          field: 'phone_number',
          code: 'INVALID_PHONE',
          message: 'Định dạng số điện thoại không hợp lệ',
          rejected_value: '1865341745',
        },
      ],
    });
    expect(body.request_id).toMatch(/^req_[0-9a-f]{16}$/);
  });
});

describe('Phân quyền (SEC-01, SEC-02)', () => {
  it('MKT không xem được danh sách tài khoản', async () => {
    const { cookie } = await login('mkt', DEMO_PASSWORD, 'backoffice');
    const res = await app.inject({ method: 'GET', url: '/api/admin/accounts', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('chưa đăng nhập nhận 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/accounts' });
    expect(res.statusCode).toBe(401);
  });

  it('HR xem được nhưng không kích hoạt được tài khoản', async () => {
    const { cookie } = await login('hr', DEMO_PASSWORD, 'backoffice');
    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/accounts?status=PENDING_ACTIVATION',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const target = list.json().data[0];
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/accounts/${target.id}/activate`,
      headers: { cookie, 'x-umbm-client': 'web' },
      payload: { version: target.version },
    });
    expect(res.statusCode).toBe(403);
  });
});
