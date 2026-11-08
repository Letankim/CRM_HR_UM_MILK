import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../data/database.js';
import { createMemoryGateway, MEMORY_IDS } from '../data/memory-seed.js';
import { rolloverToMonth, switchPartition } from '../services/data-partition.service.js';
import type { InMemorySheetsGateway } from '../sheets/gateway.js';
import { WriteQueue } from '../sheets/write-queue.js';
import { PostgresSyncedSheetsGateway } from './pg-synced-gateway.js';
import { getAllPgTableDescriptors } from './pg-table-registry.js';

const TEST_CONN = 'Host=localhost;Port=5432;Database=umbm_db;Username=postgres;Password=sa';

describe('PostgreSQL 42 Relational Tables + Google Sheets Outbox + Auto Failover + Monthly Partitioning', () => {
  let remote: InMemorySheetsGateway;
  let pgGw: PostgresSyncedSheetsGateway;
  let db: Database;

  async function cleanupMemRows() {
    if (!pgGw || pgGw.getMode() !== 'PG_PRIMARY') return;
    await pgGw.pool.query(`DELETE FROM umbm_sheet_outbox WHERE spreadsheet_id LIKE 'mem%'`);
    await pgGw.pool.query(`DELETE FROM umbm_sheet_tabs WHERE spreadsheet_id LIKE 'mem%'`);
    for (const d of getAllPgTableDescriptors()) {
      await pgGw.pool.query(`DELETE FROM public.${d.pgTableName} WHERE _spreadsheet_id LIKE 'mem%'`);
    }
  }

  beforeAll(async () => {
    remote = await createMemoryGateway();
    const connected = await PostgresSyncedSheetsGateway.connectOrFallback(remote, TEST_CONN, 200);
    expect(connected).not.toBeNull();
    pgGw = connected!;
    await cleanupMemRows();

    db = new Database(pgGw, new WriteQueue(), MEMORY_IDS);
    await db.loadAll();
  });

  afterAll(async () => {
    await cleanupMemRows();
    await pgGw?.close();
  });

  it('1. Tạo đầy đủ 42 bảng quan hệ có cột tường minh (xóa bảng gộp umbm_sheet_rows), Hydrate và đẩy ngầm qua Outbox', async () => {
    expect(pgGw.getMode()).toBe('PG_PRIMARY');

    const legacyTable = await pgGw.pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'umbm_sheet_rows'`,
    );
    expect(legacyTable.rowCount).toBe(0);

    const relTables = await pgGw.pool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_name NOT LIKE 'umbm_sheet_%'`,
    );
    expect(relTables.rows[0]!.cnt).toBeGreaterThanOrEqual(42);

    const newBranch = await db.branches.insert(
      {
        code: 'CN_PG_01',
        name: 'Ụm Bò Milk Chi nhánh Postgres 01',
        address: '123 Nguyễn Huệ, Quận 1, TP.HCM',
        lat: 10.77,
        lng: 106.7,
        radius_m: 120,
        max_accuracy_m: 100,
        timezone: 'Asia/Ho_Chi_Minh',
        status: 'ACTIVE',
        phone_contact: '0901234567',
        manager_employee_id: '',
        open_time: '07:00',
        close_time: '22:30',
        effective_from: '2026-01-01',
        note: 'Kiểm thử ghi bảng core_branches',
      },
      'u-admin',
    );

    const pgRow = await pgGw.pool.query<{ id: string; code: string; name: string; version: string; _synced_to_remote: boolean }>(
      `SELECT "id", "code", "name", "version", _synced_to_remote
       FROM public.core_branches WHERE _spreadsheet_id = $1 AND _tab_name = $2 AND "id" = $3`,
      [MEMORY_IDS.CORE, 'BRANCHES', newBranch.id],
    );
    expect(pgRow.rowCount).toBe(1);
    expect(pgRow.rows[0]!.code).toBe('CN_PG_01');
    expect(pgRow.rows[0]!.name).toBe('Ụm Bò Milk Chi nhánh Postgres 01');
    expect(pgRow.rows[0]!.version).toBe('1');

    await db.flushAllWrites();

    const remoteBranchRows = await remote.readTab(MEMORY_IDS.CORE, 'BRANCHES');
    const foundOnSheet = remoteBranchRows.find((r) => r[0] === newBranch.id);
    expect(foundOnSheet).toBeDefined();
    expect(foundOnSheet).toContain('CN_PG_01');

    const pgRowAfterSync = await pgGw.pool.query<{ _synced_to_remote: boolean }>(
      `SELECT _synced_to_remote FROM public.core_branches WHERE _spreadsheet_id = $1 AND _tab_name = $2 AND "id" = $3`,
      [MEMORY_IDS.CORE, 'BRANCHES', newBranch.id],
    );
    expect(pgRowAfterSync.rows[0]!._synced_to_remote).toBe(true);
  });

  it('2. Tự động Failover sang Google Sheets khi mất kết nối PostgreSQL và đồng bộ ngược về bảng core_branches khi kết nối lại', async () => {
    await pgGw.setSimulatedOffline(true);
    try {
      expect(pgGw.getMode()).toBe('SHEETS_FALLBACK');

      const fallbackBranch = await db.branches.insert(
        {
          code: 'CN_FB_02',
          name: 'Chi nhánh Dự phòng Khi Mất Postgres',
          address: '456 Lê Lợi, Quận 1, TP.HCM',
          lat: 10.77,
          lng: 106.69,
          radius_m: 100,
          max_accuracy_m: 100,
          timezone: 'Asia/Ho_Chi_Minh',
          status: 'ACTIVE',
          phone_contact: '0909999888',
          manager_employee_id: '',
          open_time: '07:00',
          close_time: '22:30',
          effective_from: '2026-01-01',
          note: 'Ghi trực tiếp lên Sheet khi mất PG',
        },
        'u-admin',
      );
      await db.flushAllWrites();

      const remoteRowsWhileDown = await remote.readTab(MEMORY_IDS.CORE, 'BRANCHES');
      expect(remoteRowsWhileDown.some((r) => r[0] === fallbackBranch.id)).toBe(true);

      await pgGw.setSimulatedOffline(false);
      expect(pgGw.getMode()).toBe('PG_PRIMARY');

      const pgRowRecovered = await pgGw.pool.query<{ id: string; code: string; name: string; phone_contact: string }>(
        `SELECT "id", "code", "name", "phone_contact"
         FROM public.core_branches WHERE _spreadsheet_id = $1 AND _tab_name = $2 AND "id" = $3`,
        [MEMORY_IDS.CORE, 'BRANCHES', fallbackBranch.id],
      );
      expect(pgRowRecovered.rowCount).toBe(1);
      expect(pgRowRecovered.rows[0]!.code).toBe('CN_FB_02');
      expect(pgRowRecovered.rows[0]!.phone_contact).toBe('0909999888');
    } finally {
      if (pgGw.getMode() !== 'PG_PRIMARY') await pgGw.setSimulatedOffline(false);
    }
  });

  it('3. Hỗ trợ đầy đủ Chuyển đổi dữ liệu theo tháng (rolloverToMonth & switchPartition) trên bảng thật schedule_shift_assignments', async () => {
    const rolloverRes = await rolloverToMonth(db, '2026_12', 'u-admin', false);
    expect(rolloverRes.monthKey).toBe('2026_12');
    expect(db.partitionMonth).toBe('2026_12');
    const decSpreadsheetId = rolloverRes.file!.spreadsheetId;

    const decShift = await db.shiftAssignments.insert(
      {
        schedule_week_id: 'SW-2026-12',
        branch_id: 'b-hcm-01',
        employee_id: 'e-prob-01',
        work_date: '2026-12-05',
        shift_template_id: 'tpl-sang',
        shift_code: 'CA_SANG',
        start_at: '07:00',
        end_at: '12:00',
        scheduled_hours: 5,
        day_type: 'WORK',
        status: 'PUBLISHED',
        source: 'HR_MANUAL',
        employee_stage: 'PROBATION',
        swapped_from_employee_id: '',
        replacement_for_employee_id: '',
        published_at: '2026-12-01T08:00:00Z',
        note: 'Ca tháng 12 lưu qua bảng schedule_shift_assignments',
        linked_assignment_id: '',
      },
      'u-admin',
    );
    await db.flushAllWrites();

    const pgDecRow = await pgGw.pool.query<{ id: string; work_date: string; shift_code: string }>(
      `SELECT "id", "work_date", "shift_code"
       FROM public.schedule_shift_assignments WHERE _spreadsheet_id = $1 AND _tab_name = $2 AND "id" = $3`,
      [decSpreadsheetId, 'SHIFT_ASSIGNMENTS', decShift.id],
    );
    expect(pgDecRow.rowCount).toBe(1);
    expect(pgDecRow.rows[0]!.work_date).toBe('2026-12-05');
    expect(pgDecRow.rows[0]!.shift_code).toBe('CA_SANG');

    await switchPartition(db, '', 'u-admin');
    expect(db.partitionMonth).toBe('');
    expect(db.shiftAssignments.get(decShift.id)).toBeUndefined();

    await switchPartition(db, '2026_12', 'u-admin');
    expect(db.partitionMonth).toBe('2026_12');
    expect(db.shiftAssignments.get(decShift.id)?.work_date).toBe('2026-12-05');

    const parity = await pgGw.flushAndReconcileAll();
    expect(parity.tabsChecked).toBeGreaterThanOrEqual(30);
  });
});
