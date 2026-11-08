import { createGoogleClients } from '@umbm/google';
import { loadEnv, sheetIds } from '../config/env.js';
import { Database } from '../data/database.js';
import { createMemoryGateway, MEMORY_IDS } from '../data/memory-seed.js';
import { GoogleSheetsGateway, type SheetsGateway } from '../sheets/gateway.js';
import { WriteQueue } from '../sheets/write-queue.js';
import { PostgresSyncedSheetsGateway } from './pg-synced-gateway.js';
import { getAllPgTableDescriptors } from './pg-table-registry.js';

async function main() {
  const env = loadEnv();
  if (!env.DATABASE_URL.trim()) {
    throw new Error('Chưa cấu hình DATABASE_URL trong .env');
  }
  let remote: SheetsGateway;
  let ids = sheetIds(env);
  if (env.DATA_BACKEND === 'google') {
    const clients = createGoogleClients({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN,
    });
    remote = new GoogleSheetsGateway(clients.sheets, undefined, {
      drive: clients.drive,
      rootFolderId: env.DRIVE_ROOT_FOLDER_ID,
    });
  } else {
    remote = await createMemoryGateway();
    ids = MEMORY_IDS;
  }

  const pgGw = await PostgresSyncedSheetsGateway.connectOrFallback(remote, env.DATABASE_URL, env.POSTGRES_SYNC_INTERVAL_MS);
  if (!pgGw) throw new Error('Không thể khởi tạo PostgresSyncedSheetsGateway');

  if (env.DATA_BACKEND === 'google' && pgGw.getMode() === 'PG_PRIMARY') {
    await pgGw.pool.query(`DELETE FROM umbm_sheet_outbox WHERE spreadsheet_id LIKE 'mem%'`);
    await pgGw.pool.query(`DELETE FROM umbm_sheet_tabs WHERE spreadsheet_id LIKE 'mem%'`);
    await pgGw.pool.query(`UPDATE umbm_sheet_tabs SET hydrated_at = NULL WHERE headers_json->>0 IS DISTINCT FROM 'id'`);
    for (const d of getAllPgTableDescriptors()) {
      await pgGw.pool.query(`DELETE FROM public.${d.pgTableName} WHERE _spreadsheet_id LIKE 'mem%'`);
    }
  }

  const db = new Database(pgGw, new WriteQueue(), ids);
  await db.loadAll();
  const report = await pgGw.flushAndReconcileAll();
  console.log(
    JSON.stringify(
      {
        mode: pgGw.getMode(),
        tabsChecked: report.tabsChecked,
        pushedToSheets: report.pushedToSheets,
        pulledToPostgres: report.pulledToPostgres,
        realignedRows: report.realignedRows,
      },
      null,
      2,
    ),
  );
  await pgGw.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
