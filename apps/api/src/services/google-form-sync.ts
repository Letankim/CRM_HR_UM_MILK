import { normalizePhone, STAFF_GROUP_LABELS, type Candidate } from '@umbm/shared';
import type { Database } from '../data/database.js';
import { nowIso } from '../lib/time.js';

function resolveStaffGroup(raw: string): string {
  const s = (raw || '').trim().toUpperCase();
  if (s === 'BARISTA' || s === 'CASHIER' || s === 'KITCHEN' || s === 'SHIFT_LEAD') return s;
  const lower = (raw || '').toLowerCase();
  if (lower.includes('thu ngân') || lower.includes('cashier')) return 'CASHIER';
  if (lower.includes('bếp') || lower.includes('kitchen')) return 'KITCHEN';
  if (lower.includes('ca trưởng') || lower.includes('lead')) return 'SHIFT_LEAD';
  return 'BARISTA';
}

function resolveBranchPref(db: Database, raw: string): string {
  const s = (raw || '').trim();
  const branches = db.branches.all();
  if (!s) return branches[0]?.id ?? '';
  const exact = db.branches.get(s);
  if (exact) return exact.id;
  const matched = branches.find(
    (b) =>
      b.code.toLowerCase() === s.toLowerCase() ||
      b.name.toLowerCase() === s.toLowerCase() ||
      b.name.toLowerCase().includes(s.toLowerCase()),
  );
  return matched?.id ?? branches[0]?.id ?? s;
}

/**
 * Tự động đọc dữ liệu từ tab `FROM_NHAN_VIEN` (Google Form Responses) trên Spreadsheet `UMBM_HR`
 * và đồng bộ sang bảng `CANDIDATES` với `source_channel = 'GOOGLE_FORM'`, `status = 'NEW'`.
 * Không tự động loại ứng viên theo các tiêu chí không liên quan công việc.
 */
export async function syncCandidatesFromGoogleForm(
  db: Database,
  actorId = 'google-form-sync',
  forceRefresh = false,
): Promise<{ syncedCount: number; skippedCount: number; totalFormRows: number; createdCandidates: Candidate[] }> {
  if (forceRefresh) {
    await Promise.all([db.formNhanVien.refreshIfIdle(), db.candidates.refreshIfIdle()]);
  }
  const formRows = db.formNhanVien.all();
  let syncedCount = 0;
  let skippedCount = 0;
  const createdCandidates: Candidate[] = [];

  for (const row of formRows) {
    const phone = normalizePhone(row.phone);
    const fullName = (row.full_name || '').trim();
    if (!fullName || !phone) {
      skippedCount++;
      continue;
    }
    const sourceRowTag = `F-${row.id}`;
    const existingCandidate =
      (row.synced_candidate_id ? db.candidates.get(row.synced_candidate_id) : undefined) ??
      db.candidates.find((c) => c.source_row === sourceRowTag || c.phone === phone);
    const existingEmployee = db.employees.find((e) => e.phone === phone);

    if (existingCandidate || existingEmployee) {
      if (existingCandidate && !row.synced_candidate_id) {
        await db.formNhanVien.update(row.id, row.version, { synced_candidate_id: existingCandidate.id, synced_at: nowIso() }, actorId);
      }
      skippedCount++;
      continue;
    }

    const staffGroup = resolveStaffGroup(row.position);
    const branchPref = resolveBranchPref(db, row.branch_pref);
    const created = await db.candidates.insert(
      {
        candidate_code: `UV${String(db.candidates.all(true).length + 1).padStart(4, '0')}`,
        source_row: sourceRowTag,
        full_name: fullName,
        phone,
        email: (row.email || '').trim(),
        position: STAFF_GROUP_LABELS[staffGroup as keyof typeof STAFF_GROUP_LABELS] ?? (row.position || 'Pha chế'),
        staff_group: staffGroup,
        branch_pref: branchPref,
        shift_pref: row.shift_pref || 'CA_SANG',
        status: 'NEW',
        source_channel: 'GOOGLE_FORM',
        birth_year: row.birth_year || '2004',
        gender: row.gender || '',
        experience_note: row.experience_note || '',
        hr_note: 'Tiếp nhận tự động từ biểu mẫu ứng tuyển Google Form (FROM_NHAN_VIEN)',
        cv_file_id: '',
        assigned_hr_id: 'hr',
        contacted_at: '',
      },
      actorId,
    );

    await db.formNhanVien.update(row.id, row.version, { synced_candidate_id: created.id, synced_at: nowIso() }, actorId);
    await db.notifications.insert(
      {
        recipient_user_id: 'ALL',
        recipient_role: 'HR',
        branch_id: branchPref || 'ALL',
        category: 'RECRUITMENT',
        title: `Ứng viên mới từ Google Form: ${created.full_name} (${created.candidate_code})`,
        body: `SĐT: ${created.phone} · Vị trí: ${created.position} · Nguồn: FROM_NHAN_VIEN`,
        link: '/admin/employees?tab=recruitment',
        severity: 'INFO',
        read_at: '',
        entity_type: 'CANDIDATES',
        entity_id: created.id,
      },
      actorId,
    );

    createdCandidates.push(created);
    syncedCount++;
  }

  return { syncedCount, skippedCount, totalFormRows: formRows.length, createdCandidates };
}
