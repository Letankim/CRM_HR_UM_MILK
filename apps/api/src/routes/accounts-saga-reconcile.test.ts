import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../data/database.js';
import { DEMO_PASSWORD, DEMO_PIN } from '../data/memory-seed.js';
import type { EmailService } from '../services/email.service.js';
import type { ReconciliationService } from '../services/reconciliation.service.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let app: FastifyInstance;
let db: Database;
let reconciliation: ReconciliationService;
let email: EmailService;
let login: TestAppContext['login'];

beforeAll(async () => {
  ({ app, db, reconciliation, email, login } = await buildTestApp('z'));
});

afterAll(async () => {
  await app.close();
});

describe('Kích hoạt, Thu hồi (FLOW-01), Saga & Đối soát toàn vẹn dữ liệu', () => {
  it('Admin kích hoạt -> nhân viên đăng nhập được -> Admin thu hồi -> token cũ mất hiệu lực và ghi Saga + Email', async () => {
    const admin = await login('admin', DEMO_PASSWORD, 'backoffice');
    const pending = db.users.find((u) => u.username === 'nv.moi')!;

    const act = await app.inject({
      method: 'POST',
      url: `/api/admin/accounts/${pending.id}/activate`,
      headers: { cookie: admin.cookie, 'x-umbm-client': 'web' },
      payload: { version: pending.version },
    });
    expect(act.statusCode).toBe(200);
    expect(act.json().success).toBe(true);

    const emp = await login('0901000003', DEMO_PIN, 'employee');
    expect(emp.res.statusCode).toBe(200);
    const me1 = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: emp.cookie } });
    expect(me1.statusCode).toBe(200);

    const current = db.users.get(pending.id)!;
    const rev = await app.inject({
      method: 'POST',
      url: `/api/admin/accounts/${pending.id}/revoke`,
      headers: { cookie: admin.cookie, 'x-umbm-client': 'web' },
      payload: { version: current.version, reason: 'Nghỉ việc' },
    });
    expect(rev.statusCode).toBe(200);

    const me2 = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: emp.cookie } });
    expect(me2.statusCode).toBe(401);

    // Kiểm tra Saga đã lưu trạng thái COMMITTED và Email đã được phát sinh
    expect(db.operationJournal.all().some((j) => j.status === 'COMMITTED')).toBe(true);
    expect(email.recent().length).toBeGreaterThanOrEqual(2);
  });

  it('gửi version cũ nhận 409', async () => {
    const admin = await login('admin', DEMO_PASSWORD, 'backoffice');
    const user = db.users.find((u) => u.username === 'nv.thuviec')!;
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/accounts/${user.id}/revoke`,
      headers: { cookie: admin.cookie, 'x-umbm-client': 'web' },
      payload: { version: user.version + 5 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('Saga tự động bù trừ (compensate) khi bước sau gặp lỗi', async () => {
    let state = 'INITIAL';
    await expect(
      reconciliation.executeSaga({
        sagaKey: 'test-compensate',
        operation: 'test.saga',
        actorId: 'admin',
        initialContext: {},
        steps: [
          {
            name: 'step1',
            run: async () => {
              state = 'MODIFIED';
            },
            compensate: async () => {
              state = 'REVERTED';
            },
          },
          {
            name: 'step2-fail',
            run: async () => {
              throw new Error('Bước 2 lỗi giả lập');
            },
          },
        ],
        resultSelector: () => state,
      }),
    ).rejects.toThrow('Bước 2 lỗi giả lập');

    expect(state).toBe('REVERTED');
    const journal = db.operationJournal.find((j) => j.saga_key === 'test-compensate');
    expect(journal?.status).toBe('COMPENSATED');
  });

  it('Quét đối soát dữ liệu (Reconciliation) và xem trước mẫu Email doanh nghiệp hoạt động chuẩn', async () => {
    const admin = await login('admin', DEMO_PASSWORD, 'backoffice');

    const recRes = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/reconcile',
      headers: { cookie: admin.cookie, 'x-umbm-client': 'web' },
      payload: {},
    });
    expect(recRes.statusCode).toBe(200);
    expect(recRes.json().data.status).toBe('ok');

    const mailRes = await app.inject({ method: 'GET', url: '/api/admin/integrations/email-templates?template=PAYSLIP_PUBLISHED', headers: { cookie: admin.cookie } });
    expect(mailRes.statusCode).toBe(200);
    expect(mailRes.json().data.preview.html).toContain('ỤM BÒ MILK');
    expect(mailRes.json().data.templates.length).toBe(10);
    expect(mailRes.json().data.queueStats.batchSize).toBe(3);
    const flushRes = await app.inject({ method: 'POST', url: '/api/admin/integrations/email-queue/flush', headers: { cookie: admin.cookie, 'x-umbm-client': 'web' }, payload: {} });
    expect(flushRes.statusCode).toBe(200);
  });

  it('Hỗ trợ làm mới dữ liệu trực tiếp (?refresh=1) và thao tác hàng loạt (bulk-action: ACTIVATE, UNLOCK, REVOKE)', async () => {
    const admin = await login('admin', DEMO_PASSWORD, 'backoffice');
    const pending = db.users.find((u) => u.username === 'nv.moi')!;
    const active = db.users.find((u) => u.username === 'nv.thuviec')!;

    const refreshRes = await app.inject({
      method: 'GET',
      url: '/api/admin/accounts?refresh=1&per_page=12',
      headers: { cookie: admin.cookie },
    });
    expect(refreshRes.statusCode).toBe(200);
    expect(refreshRes.json().success).toBe(true);

    const bulkActivate = await app.inject({
      method: 'POST',
      url: '/api/admin/accounts/bulk-action',
      headers: { cookie: admin.cookie, 'x-umbm-client': 'web' },
      payload: {
        action: 'ACTIVATE',
        items: [
          { id: pending.id, version: pending.version },
          { id: active.id, version: active.version },
        ],
      },
    });
    expect(bulkActivate.statusCode).toBe(200);
    expect(bulkActivate.json().data.processedCount).toBe(1);
    expect(bulkActivate.json().data.skippedCount).toBe(1);
    expect(db.users.get(pending.id)?.status).toBe('ACTIVE');

    const updatedPending = db.users.get(pending.id)!;
    const bulkRevoke = await app.inject({
      method: 'POST',
      url: '/api/admin/accounts/bulk-action',
      headers: { cookie: admin.cookie, 'x-umbm-client': 'web' },
      payload: {
        action: 'REVOKE',
        reason: 'Kiểm thử thu hồi hàng loạt',
        items: [{ id: updatedPending.id, version: updatedPending.version }],
      },
    });
    expect(bulkRevoke.statusCode).toBe(200);
    expect(bulkRevoke.json().data.processedCount).toBe(1);
    expect(db.users.get(pending.id)?.status).toBe('REVOKED');
  });

  it('Quản lý Permission bổ sung (extra_permissions), Khóa/Mở khóa tạm thời (lock/unlock) và Lịch sử thay đổi quyền (ADM-02)', async () => {
    const admin = await login('admin', DEMO_PASSWORD, 'backoffice');
    const hrUser = db.users.find((u) => u.username === 'hr')!;

    // 1. Chặn cấp quyền bị cấm (HR không được cấp payroll.manage)
    const forbiddenRes = await app.inject({
      method: 'PUT', url: `/api/admin/accounts/${hrUser.id}`,
      headers: { cookie: admin.cookie, 'x-umbm-client': 'web' },
      payload: { version: hrUser.version, extra_permissions: ['payroll.manage'] },
    });
    expect(forbiddenRes.statusCode).toBe(400);
    expect(forbiddenRes.json().errors.code).toBe('VALIDATION_ERROR');

    // 2. Cấp permission bổ sung hợp lệ (HR được phê duyệt xem lương payroll.read)
    const grantRes = await app.inject({
      method: 'PUT', url: `/api/admin/accounts/${hrUser.id}`,
      headers: { cookie: admin.cookie, 'x-umbm-client': 'web' },
      payload: { version: hrUser.version, extra_permissions: ['payroll.read'], reason: 'Ban Giám đốc phê duyệt quyền đối chiếu lương' },
    });
    expect(grantRes.statusCode).toBe(200);
    expect(grantRes.json().data.user.extraPermissions).toEqual(['payroll.read']);
    expect(grantRes.json().data.user.permissions).toContain('payroll.read');

    // 3. Khóa tạm thời và Mở khóa lại tài khoản
    const lockRes = await app.inject({
      method: 'POST', url: `/api/admin/accounts/${hrUser.id}/lock`,
      headers: { cookie: admin.cookie, 'x-umbm-client': 'web' },
      payload: { version: grantRes.json().data.version, reason: 'Tạm khóa kiểm tra định kỳ' },
    });
    expect(lockRes.statusCode).toBe(200);
    expect(db.users.get(hrUser.id)?.status).toBe('LOCKED');

    const unlockRes = await app.inject({
      method: 'POST', url: `/api/admin/accounts/${hrUser.id}/unlock`,
      headers: { cookie: admin.cookie, 'x-umbm-client': 'web' },
      payload: { version: lockRes.json().data.version },
    });
    expect(unlockRes.statusCode).toBe(200);
    expect(db.users.get(hrUser.id)?.status).toBe('ACTIVE');

    // 4. Kiểm tra API Lịch sử thay đổi quyền và trạng thái
    const histRes = await app.inject({ method: 'GET', url: `/api/admin/accounts/${hrUser.id}/history`, headers: { cookie: admin.cookie } });
    expect(histRes.statusCode).toBe(200);
    const hist = histRes.json().data as { action: string; summary: string }[];
    expect(hist.some((h) => h.action === 'account.permissions_update' && h.summary.includes('Quyền bổ sung'))).toBe(true);
    expect(hist.some((h) => h.action === 'account.lock')).toBe(true);
  });
});
