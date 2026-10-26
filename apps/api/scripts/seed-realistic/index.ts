/**
 * Sinh DỮ LIỆU MẪU SÁT THỰC TẾ cho toàn bộ chi nhánh đang hoạt động (Google Sheets).
 *
 *   pnpm --filter @umbm/api seed:realistic                      # Chạy thử: chỉ đọc + kiểm tra, KHÔNG ghi
 *   pnpm --filter @umbm/api seed:realistic -- --apply           # Ghi dữ liệu lên Google Sheets
 *   pnpm --filter @umbm/api seed:realistic -- --purge           # Xem trước số dòng mẫu sẽ gỡ
 *   pnpm --filter @umbm/api seed:realistic -- --purge --apply   # Gỡ sạch (xóa mềm) toàn bộ dữ liệu mẫu
 *   pnpm --filter @umbm/api seed:realistic -- --repair --apply  # Sửa ca mẫu bị chuyển nhầm Vắng mặt trong lúc ghi
 *
 * Tham số: --per-branch 8  --days-back 21  --days-ahead 14  --seed 2026
 * Toàn bộ bản ghi mang created_by = seed-realistic. Mật khẩu nhân viên = PIN demo, quản lý cửa hàng = mật khẩu demo.
 */
import { createGoogleClients } from '@umbm/google';
import { hashSecret } from '../../src/auth/password.js';
import { loadEnv, sheetIds } from '../../src/config/env.js';
import { Database } from '../../src/data/database.js';
import { DEMO_PASSWORD, DEMO_PIN } from '../../src/data/memory-seed.js';
import { newId, nowIso } from '../../src/lib/time.js';
import { GoogleSheetsGateway } from '../../src/sheets/gateway.js';
import { WriteQueue } from '../../src/sheets/write-queue.js';
import { recordToRow } from '../../src/sheets/table-store-codec.js';
import { buildAttendance } from './attendance.js';
import type { SeedCtx } from './context.js';
import { buildExceptions } from './exceptions.js';
import { verifyIntegrity } from './integrity.js';
import { appendTable, headersOf, SEED_ACTOR, TABLES, validateAll, WRITE_ORDER } from './kit.js';
import { buildPeople } from './people.js';
import { purgeSeed } from './purge.js';
import { buildRecruitment } from './recruitment.js';
import { repairSeedShifts } from './repair.js';
import { buildRoster } from './roster.js';
import { createContext } from './setup.js';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const num = (name: string, fallback: number, min: number, max: number) => {
  const i = argv.indexOf(`--${name}`);
  const v = i > -1 ? Number(argv[i + 1]) : fallback;
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(`Tham số --${name} phải nằm trong khoảng ${min}–${max}`);
  return Math.floor(v);
};

function printSummary(ctx: SeedCtx): void {
  console.log(`\nKhung thời gian: ${ctx.from} → ${ctx.to} (hôm nay ${ctx.today} ${ctx.nowHm})`);
  for (const bp of ctx.branches) {
    const mine = ctx.assignments.filter((a) => a.bp === bp);
    const st = (s: string) => mine.filter((a) => a.rec.status === s).length;
    console.log(
      `  ${bp.branch.code} — ${bp.branch.name}: ${bp.staff.length} nhân sự mới, khung ca [${bp.shifts.map((s) => `${s.code} ${s.start}-${s.end}`).join(', ')}], ` +
      `${mine.length} ca (Đã phân ${st('PUBLISHED')}, Hoàn thành ${st('COMPLETED')}, Vắng ${st('ABSENT')}, Chờ duyệt ${st('DRAFT')}), quản lý: ${bp.storeUserName || 'tạo mới'}`,
    );
  }
  console.log('\nSố dòng theo bảng:');
  for (const t of WRITE_ORDER) if (ctx.out[t].length) console.log(`  ${TABLES[t].key}.${TABLES[t].tab}: ${ctx.out[t].length}`);
}

async function main() {
  const env = loadEnv();
  if (env.DATA_BACKEND !== 'google') throw new Error('Script chỉ áp dụng cho DATA_BACKEND=google (chế độ memory tự sinh dữ liệu khi khởi động)');
  const apply = flag('apply');
  const clients = createGoogleClients({ clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET, refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN });
  const ids = sheetIds(env);
  const gw = new GoogleSheetsGateway(clients.sheets, (attempt) => console.log(`  ... Google giới hạn tốc độ, thử lại lần ${attempt}`));

  if (flag('purge')) {
    const report = await purgeSeed(clients.sheets, gw, ids, apply);
    for (const [tab, n] of Object.entries(report)) if (n) console.log(`  ${tab}: ${n} dòng mẫu`);
    console.log(apply ? '\nĐã gỡ (xóa mềm) toàn bộ dữ liệu mẫu. Bấm "Làm mới" trên giao diện để đồng bộ.' : '\nChạy thử gỡ dữ liệu — thêm --apply để thực hiện.');
    return;
  }

  const opts = { perBranch: num('per-branch', 8, 3, 20), daysBack: num('days-back', 21, 1, 60), daysAhead: num('days-ahead', 14, 1, 21), seed: num('seed', Date.now() % 100000, 0, 1e9) };
  console.log('Đang tải dữ liệu hiện có từ Google Sheets...');
  const db = new Database(gw, new WriteQueue(), ids);
  await db.loadAll();
  if (flag('repair')) {
    const r = await repairSeedShifts(db, apply);
    console.log(`Ca mẫu bị chuyển nhầm Vắng mặt: ${r.toCompleted} ca -> Đã hoàn thành, ${r.toPublished} ca -> Đã phân ca.${apply ? ' Đã sửa xong.' : ' Thêm --apply để sửa.'}`);
    return;
  }
  const already = db.employees.all().filter((e) => e.created_by === SEED_ACTOR).length;
  if (already > 0 && !flag('force')) {
    throw new Error(`Đã có ${already} nhân sự mẫu từ lần chạy trước. Chạy "--purge --apply" để gỡ trước, hoặc thêm --force để sinh bổ sung.`);
  }

  const [pinHash, pwHash] = await Promise.all([hashSecret(DEMO_PIN), hashSecret(DEMO_PASSWORD)]);
  const ctx = createContext(db, opts, { pinHash, pwHash });
  buildPeople(ctx);
  buildRecruitment(ctx);
  buildRoster(ctx);
  buildExceptions(ctx);
  buildAttendance(ctx);

  const errors = verifyIntegrity(ctx);
  if (errors.length) throw new Error(`Kiểm tra toàn vẹn thất bại, không ghi dữ liệu:\n  - ${errors.join('\n  - ')}`);
  const cells = validateAll(ctx.out);
  printSummary(ctx);
  for (const w of ctx.warnings) console.log(`  [Cảnh báo] ${w}`);
  console.log(`\nKiểm tra schema Zod & toàn vẹn: ĐẠT 100% (seed ngẫu nhiên = ${opts.seed}).`);
  if (!apply) { console.log('Chạy thử — chưa ghi dòng nào. Thêm --apply để ghi lên Google Sheets.'); return; }

  for (const t of WRITE_ORDER) {
    const rows = cells.get(t) ?? [];
    if (!rows.length) continue;
    await appendTable(gw, ids[TABLES[t].key], TABLES[t].tab, rows);
    console.log(`  Đã ghi ${TABLES[t].tab}: ${rows.length} dòng`);
  }
  const journal = {
    id: newId(), created_at: nowIso(), created_by: SEED_ACTOR, updated_at: nowIso(), updated_by: SEED_ACTOR, version: 1, is_deleted: false,
    saga_key: `seed-realistic-${opts.seed}-${Date.now()}`, operation: 'SEED_REALISTIC_DATA', actor_id: SEED_ACTOR, status: 'COMMITTED',
    steps_json: JSON.stringify(WRITE_ORDER.map((t) => ({ table: TABLES[t].tab, rows: ctx.out[t].length }))), error: '', completed_at: nowIso(),
  };
  await appendTable(gw, ids.SYSTEM, TABLES.operationJournal.tab, [recordToRow(headersOf('operationJournal'), journal)]);
  console.log(`\nHoàn tất. Đăng nhập nhân viên: nv.<mã NV> / PIN ${DEMO_PIN}; quản lý cửa hàng mới: ql.<mã CN> / ${DEMO_PASSWORD}.`);
  console.log('Máy chủ API tự làm mới bộ nhớ đệm sau ~45 giây (hoặc bấm "Làm mới" trên giao diện).');
}

main().catch((err) => {
  const details = (err as { details?: unknown[] }).details;
  console.error(`\n[Dừng] ${(err as Error).message}${Array.isArray(details) && details.length ? `\n${JSON.stringify(details.slice(0, 5), null, 2)}` : ''}`);
  process.exit(1);
});
