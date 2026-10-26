/**
 * Bộ công cụ dùng chung cho script sinh dữ liệu mẫu thực tế:
 * RNG có seed (tái lập được), tiện ích ngày giờ theo múi giờ VN, sinh định danh duy nhất,
 * danh mục bảng đích và hàm kiểm tra schema + ghi theo lô lên Google Sheets.
 */
import * as S from '@umbm/shared';
import { zOperationJournalRow } from '../../src/data/system-schemas.js';
import { dayjs, newId } from '../../src/lib/time.js';
import type { SheetsGateway } from '../../src/sheets/gateway.js';
import { recordToRow, validateRecord } from '../../src/sheets/table-store-codec.js';

/** Dấu vết bắt buộc trên mọi bản ghi do script tạo — dùng để gỡ sạch (purge) an toàn. */
export const SEED_ACTOR = 'seed-realistic';
export type Rec = Record<string, unknown>;

export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min;
  return {
    next,
    int,
    chance: (p: number) => next() < p,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)]!,
    step: (min: number, max: number, stepBy: number) => min + int(0, Math.floor((max - min) / stepBy)) * stepBy,
    shuffle: <T>(arr: readonly T[]): T[] => {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    digits: (len: number) => Array.from({ length: len }, () => int(0, 9)).join(''),
  };
}
export type Rng = ReturnType<typeof createRng>;

/* ------------------------------ Ngày giờ (Asia/Ho_Chi_Minh) ------------------------------ */
export const addDays = (date: string, n: number) => dayjs.utc(date).add(n, 'day').format('YYYY-MM-DD');
export const weekday = (date: string) => dayjs.utc(date).day();
export const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map((x) => Number(x) || 0);
  return (h ?? 0) * 60 + (m ?? 0);
};
export const fromMin = (mins: number) => {
  const v = Math.max(0, Math.min(23 * 60 + 59, Math.round(mins)));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
export const addMin = (hm: string, mins: number) => fromMin(toMin(hm) + mins);
/** ISO 8601 có offset +07:00 đúng định dạng nowIso() của hệ thống (tự chuẩn hóa giờ/phút 2 chữ số). */
export const iso = (date: string, hm: string, sec = 0) => {
  const [h = '0', m = '0'] = hm.split(':');
  return `${date}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:${String(sec).padStart(2, '0')}+07:00`;
};
export const daysBetween = (from: string, to: string) => dayjs.utc(to).diff(dayjs.utc(from), 'day');
export const minIso = (a: string, b: string) => (a < b ? a : b);

/** Cột hệ thống cho bản ghi mới, cho phép lùi ngày tạo đúng thời điểm nghiệp vụ phát sinh. */
export function sys(createdAt: string, id: string = newId()) {
  return { id, created_at: createdAt, created_by: SEED_ACTOR, updated_at: createdAt, updated_by: SEED_ACTOR, version: 1, is_deleted: false };
}

/** Bỏ dấu tiếng Việt để sinh email / tên đăng nhập. */
export const slugVi = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Kho định danh đã dùng (gồm cả dữ liệu đang có trên hệ thống) để không bao giờ sinh trùng. */
export class UniquePool {
  private readonly sets = new Map<string, Set<string>>();
  has(kind: string, v: string) { return this.sets.get(kind)?.has(v.trim().toLowerCase()) ?? false; }
  add(kind: string, v: string) {
    if (!v) return;
    if (!this.sets.has(kind)) this.sets.set(kind, new Set());
    this.sets.get(kind)!.add(v.trim().toLowerCase());
  }
  take(kind: string, gen: () => string, maxTry = 500): string {
    for (let i = 0; i < maxTry; i++) {
      const v = gen();
      if (!this.has(kind, v)) { this.add(kind, v); return v; }
    }
    throw new Error(`Không sinh được giá trị duy nhất cho ${kind}`);
  }
}

/* ------------------------------ Danh mục bảng đích ------------------------------ */
export const TABLES = {
  shiftTemplates: { key: 'CORE', tab: 'SHIFT_TEMPLATES', schema: S.zShiftTemplate },
  staffingRules: { key: 'CORE', tab: 'STAFFING_RULES', schema: S.zStaffingRule },
  users: { key: 'CORE', tab: 'USERS', schema: S.zUser },
  candidates: { key: 'HR', tab: 'CANDIDATES', schema: S.zCandidate },
  interviews: { key: 'HR', tab: 'INTERVIEWS', schema: S.zInterview },
  employees: { key: 'HR', tab: 'EMPLOYEES', schema: S.zEmployee },
  employeeStageHistory: { key: 'HR', tab: 'EMPLOYEE_STAGE_HISTORY', schema: S.zEmployeeStageHistory },
  testAssignments: { key: 'HR', tab: 'TEST_ASSIGNMENTS', schema: S.zTestAssignment },
  shiftAssignments: { key: 'SCHEDULE', tab: 'SHIFT_ASSIGNMENTS', schema: S.zShiftAssignment },
  leaveRequests: { key: 'SCHEDULE', tab: 'LEAVE_REQUESTS', schema: S.zLeaveRequest },
  shiftSwaps: { key: 'SCHEDULE', tab: 'SHIFT_SWAPS', schema: S.zShiftSwap },
  emergencyLeaves: { key: 'SCHEDULE', tab: 'EMERGENCY_LEAVES', schema: S.zEmergencyLeave },
  attendanceEvents: { key: 'ATTENDANCE', tab: 'ATTENDANCE_EVENTS', schema: S.zAttendanceEvent },
  attendanceAdjustments: { key: 'ATTENDANCE', tab: 'ATTENDANCE_ADJUSTMENTS', schema: S.zAttendanceAdjustment },
  payRates: { key: 'PAYROLL', tab: 'PAY_RATES', schema: S.zPayRate },
  operationJournal: { key: 'SYSTEM', tab: 'OPERATION_JOURNAL', schema: zOperationJournalRow },
} as const;
export type TableKey = keyof typeof TABLES;
/**
 * Thứ tự ghi: hồ sơ / tài khoản trước; Điểm danh, Phiếu bổ sung, Đơn nghỉ / đổi ca / nghỉ khẩn ghi TRƯỚC bảng Ca làm.
 * Lý do: máy chủ đang chạy sẽ làm mới cache và quét "ca đã qua giờ chưa điểm danh -> Vắng mặt" ngay khi thấy ca mới;
 * nếu ca xuất hiện trước dữ liệu điểm danh, hàng loạt ca sẽ bị chuyển nhầm sang Vắng mặt.
 */
export const WRITE_ORDER: TableKey[] = [
  'shiftTemplates', 'staffingRules', 'users', 'employees', 'payRates', 'employeeStageHistory', 'testAssignments',
  'candidates', 'interviews', 'attendanceEvents', 'attendanceAdjustments', 'leaveRequests', 'shiftSwaps', 'emergencyLeaves',
  'shiftAssignments',
];

export type SeedOutput = Record<TableKey, Rec[]>;
export const emptyOutput = (): SeedOutput => Object.fromEntries(Object.keys(TABLES).map((k) => [k, []])) as unknown as SeedOutput;

export function headersOf(t: TableKey): readonly string[] {
  const def = TABLES[t];
  return (S.SPREADSHEETS[def.key].tabs as Record<string, readonly string[]>)[def.tab]!;
}

/** Kiểm tra 100% bản ghi theo schema Zod TRƯỚC khi ghi bất kỳ dòng nào (tất cả hoặc không gì cả). */
export function validateAll(out: SeedOutput): Map<TableKey, string[][]> {
  const cells = new Map<TableKey, string[][]>();
  for (const t of Object.keys(TABLES) as TableKey[]) {
    const def = TABLES[t];
    const headers = headersOf(t);
    const ids = new Set<string>();
    cells.set(t, out[t].map((r) => {
      const parsed = validateRecord(`${def.key}.${def.tab}`, headers, def.schema as never, r) as Rec;
      if (ids.has(String(parsed.id))) throw new Error(`Trùng id ${String(parsed.id)} trong ${def.tab}`);
      ids.add(String(parsed.id));
      return recordToRow(headers, parsed);
    }));
  }
  return cells;
}

export async function appendTable(gw: SheetsGateway, spreadsheetId: string, tab: string, rows: string[][]) {
  for (let i = 0; i < rows.length; i += 400) await gw.appendRows(spreadsheetId, tab, rows.slice(i, i + 400));
}
