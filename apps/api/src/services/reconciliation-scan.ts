import { RECONCILIATION_ISSUE_LABELS, type ReconciliationIssueCode } from '@umbm/shared';
import { parseBranchScope } from '../auth/auth.service.js';
import type { Database } from '../data/database.js';

export interface ReconciliationIssue {
  id: string; code: ReconciliationIssueCode; label: string; severity: 'warning' | 'error';
  table: string; recordId: string; message: string; autoRepaired: boolean;
}

export interface ReconciliationReport {
  checkedAt: string;
  status: 'ok' | 'degraded' | 'down';
  summary: { tablesScanned: number; rowsScanned: number; issuesFound: number; autoRepaired: number; unresolvedIssues: number };
  issues: ReconciliationIssue[];
}

/** 1. Kiểm tra trùng khóa duy nhất trên USERS (username, phone) và BRANCHES (code). */
export async function scanUniqueKeys(
  db: Database,
  opts: { autoFix: boolean; actorId: string } = { autoFix: false, actorId: 'system-reconciler' },
): Promise<ReconciliationIssue[]> {
  const { autoFix, actorId } = opts;
  const issues: ReconciliationIssue[] = [];
  const users = db.users.all();
  const branches = db.branches.all();
  const seenUsernames = new Map<string, string>();
  const seenPhones = new Map<string, string>();
  for (const u of users) {
    const uname = u.username.trim().toLowerCase();
    if (seenUsernames.has(uname)) {
      let repaired = false;
      if (autoFix) {
        await db.users.softDelete(u.id, u.version, actorId);
        repaired = true;
      }
      issues.push({
        id: `dup-username-${u.id}`,
        code: 'DUPLICATE_UNIQUE_KEY',
        label: RECONCILIATION_ISSUE_LABELS.DUPLICATE_UNIQUE_KEY,
        severity: 'error',
        table: 'CORE.USERS',
        recordId: u.id,
        message: `Trùng tên đăng nhập "${u.username}" giữa bản ghi ${seenUsernames.get(uname)} và ${u.id}`,
        autoRepaired: repaired,
      });
      if (repaired) continue;
    } else {
      seenUsernames.set(uname, u.id);
    }

    if (u.phone) {
      if (seenPhones.has(u.phone)) {
        let repaired = false;
        if (autoFix) {
          await db.users.update(u.id, u.version, { phone: '' }, actorId);
          repaired = true;
        }
        issues.push({
          id: `dup-phone-${u.id}`,
          code: 'DUPLICATE_UNIQUE_KEY',
          label: RECONCILIATION_ISSUE_LABELS.DUPLICATE_UNIQUE_KEY,
          severity: 'error',
          table: 'CORE.USERS',
          recordId: u.id,
          message: `Trùng số điện thoại "${u.phone}" giữa bản ghi ${seenPhones.get(u.phone)} và ${u.id}`,
          autoRepaired: repaired,
        });
      } else {
        seenPhones.set(u.phone, u.id);
      }
    }
  }

  const seenBranchCodes = new Map<string, string>();
  for (const b of branches) {
    const code = b.code.trim().toUpperCase();
    if (seenBranchCodes.has(code)) {
      let repaired = false;
      if (autoFix) {
        await db.branches.softDelete(b.id, b.version, actorId);
        repaired = true;
      }
      issues.push({
        id: `dup-branch-${b.id}`,
        code: 'DUPLICATE_UNIQUE_KEY',
        label: RECONCILIATION_ISSUE_LABELS.DUPLICATE_UNIQUE_KEY,
        severity: 'error',
        table: 'CORE.BRANCHES',
        recordId: b.id,
        message: `Trùng mã chi nhánh "${b.code}" giữa bản ghi ${seenBranchCodes.get(code)} và ${b.id}`,
        autoRepaired: repaired,
      });
    } else {
      seenBranchCodes.set(code, b.id);
    }
  }
  return issues;
}

/** 2-6. Kiểm tra khóa ngoại, bất biến trạng thái và đồng bộ liên kết 2 chiều USERS <-> EMPLOYEES. */
export async function scanUserInvariants(
  db: Database,
  opts: { autoFix: boolean; actorId: string; now: string },
): Promise<ReconciliationIssue[]> {
  const { autoFix, actorId, now } = opts;
  const issues: ReconciliationIssue[] = [];
  const users = db.users.all();
  const branchIds = new Set(db.branches.all().map((b) => b.id));
  for (const u of users) {
    const scope = parseBranchScope(u.branch_scope);
    if (scope !== 'ALL') {
      const missingBranches = scope.filter((bid) => !branchIds.has(bid));
      if (missingBranches.length > 0) {
        issues.push({
          id: `orphan-branch-${u.id}`,
          code: 'ORPHAN_FOREIGN_KEY',
          label: RECONCILIATION_ISSUE_LABELS.ORPHAN_FOREIGN_KEY,
          severity: 'warning',
          table: 'CORE.USERS',
          recordId: u.id,
          message: `Tài khoản "${u.username}" tham chiếu chi nhánh không tồn tại: ${missingBranches.join(', ')}`,
          autoRepaired: false,
        });
      }
    }

    if (u.status === 'ACTIVE' && !u.activated_at) {
      let repaired = false;
      if (autoFix) {
        await db.users.update(u.id, u.version, { activated_at: u.updated_at || now, activated_by: u.activated_by || actorId }, actorId);
        repaired = true;
      }
      issues.push({
        id: `inv-active-${u.id}`,
        code: 'STATE_INVARIANT_VIOLATION',
        label: RECONCILIATION_ISSUE_LABELS.STATE_INVARIANT_VIOLATION,
        severity: 'warning',
        table: 'CORE.USERS',
        recordId: u.id,
        message: `Tài khoản "${u.username}" ở trạng thái ACTIVE nhưng thiếu dấu thời gian activated_at`,
        autoRepaired: repaired,
      });
    }

    if (u.status === 'REVOKED' && !u.revoked_at) {
      let repaired = false;
      if (autoFix) {
        await db.users.update(u.id, u.version, { revoked_at: u.updated_at || now }, actorId);
        repaired = true;
      }
      issues.push({
        id: `inv-revoked-${u.id}`,
        code: 'STATE_INVARIANT_VIOLATION',
        label: RECONCILIATION_ISSUE_LABELS.STATE_INVARIANT_VIOLATION,
        severity: 'warning',
        table: 'CORE.USERS',
        recordId: u.id,
        message: `Tài khoản "${u.username}" ở trạng thái REVOKED nhưng thiếu dấu thời gian revoked_at`,
        autoRepaired: repaired,
      });
    }

    if (u.locked_until && new Date(u.locked_until).getTime() <= Date.now()) {
      let repaired = false;
      if (autoFix) {
        await db.users.update(u.id, u.version, { locked_until: '', failed_login_count: 0, status: u.status === 'LOCKED' ? 'ACTIVE' : u.status }, actorId);
        repaired = true;
      }
      issues.push({
        id: `exp-lock-${u.id}`,
        code: 'EXPIRED_ACCOUNT_LOCK',
        label: RECONCILIATION_ISSUE_LABELS.EXPIRED_ACCOUNT_LOCK,
        severity: 'warning',
        table: 'CORE.USERS',
        recordId: u.id,
        message: `Tài khoản "${u.username}" đã hết thời hạn khóa tạm thời (${u.locked_until})`,
        autoRepaired: repaired,
      });
    }
  }

  for (const emp of db.employees.all()) {
    const codeUpper = emp.employee_code.trim().toUpperCase();
    const matchedUser =
      (emp.user_id ? db.users.get(emp.user_id) : undefined) ??
      db.users.find((u) => u.employee_id.trim().toUpperCase() === codeUpper || u.employee_id === emp.id) ??
      (emp.phone ? db.users.find((u) => Boolean(u.phone && u.phone === emp.phone)) : undefined);

    if (matchedUser && (emp.user_id !== matchedUser.id || matchedUser.employee_id !== emp.employee_code)) {
      let repaired = false;
      if (autoFix) {
        if (emp.user_id !== matchedUser.id) await db.employees.update(emp.id, emp.version, { user_id: matchedUser.id }, actorId);
        if (matchedUser.employee_id !== emp.employee_code) await db.users.update(matchedUser.id, matchedUser.version, { employee_id: emp.employee_code }, actorId);
        repaired = true;
      }
      issues.push({
        id: `sync-emp-user-${emp.id}`,
        code: 'STATE_INVARIANT_VIOLATION',
        label: RECONCILIATION_ISSUE_LABELS.STATE_INVARIANT_VIOLATION,
        severity: 'warning',
        table: 'HR.EMPLOYEES',
        recordId: emp.id,
        message: `Hồ sơ nhân sự "${emp.full_name} (${emp.employee_code})" và tài khoản "@${matchedUser.username}" chưa đồng bộ khóa liên kết 2 chiều`,
        autoRepaired: repaired,
      });
    }
  }

  return issues;
}
