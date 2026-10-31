/**
 * Bộ hàm tự sinh mã định danh (Mã nhân sự, Tên đăng nhập, Mã PIN / Mật khẩu, Mã chi nhánh, Mã ca)
 * phục vụ các nút "Tự sinh" trên các biểu mẫu Quản trị.
 */

import { isEmployeeRole, type Role } from '@umbm/shared';

function stripVietnamese(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim();
}

/** Tự sinh mã nhân viên NVxxxx duy nhất (mỗi lần bấm tạo một mã mới chưa trùng) */
export function generateEmployeeCode(existingCodes: string[] = [], currentCode?: string): string {
  const used = new Set(existingCodes.map((c) => c.trim().toUpperCase()));
  let maxNum = 0;
  for (const c of used) {
    const m = /^NV(\d+)$/i.exec(c);
    if (m) maxNum = Math.max(maxNum, Number(m[1]));
  }
  const curMatch = currentCode ? /^NV(\d+)$/i.exec(currentCode.trim()) : null;
  let candidateNum = curMatch ? Number(curMatch[1]) + 1 : Math.max(maxNum + 1, existingCodes.length + 1);
  while (used.has(`NV${String(candidateNum).padStart(4, '0')}`)) {
    candidateNum += 1;
  }
  return `NV${String(candidateNum).padStart(4, '0')}`;
}

/** Tự sinh tên đăng nhập từ Họ tên hoặc Mã nhân sự */
export function generateUsername(fullName?: string, empCode?: string, currentUsername?: string): string {
  const cleanName = stripVietnamese(fullName || '').toLowerCase();
  const parts = cleanName.split(/\s+/).filter(Boolean);
  const rand2 = String(Math.floor(10 + Math.random() * 89));

  if (parts.length >= 2) {
    const givenName = parts[parts.length - 1]!;
    const initials = parts
      .slice(0, -1)
      .map((p) => p[0])
      .join('');
    const base = `nv.${givenName}${initials}`;
    return currentUsername === base ? `${base}${rand2}` : base;
  }
  if (empCode && empCode.trim()) {
    const base = `nv.${empCode.trim().toLowerCase()}`;
    return currentUsername === base ? `${base}.${rand2}` : base;
  }
  return `nv.nhansu${ Math.floor(100 + Math.random() * 899)}`;
}

/** Tự sinh mã PIN 6 chữ số ngẫu nhiên cho Cổng Nhân viên */
export function generatePin6(): string {
  const first = Math.floor(1 + Math.random() * 9);
  const rest = Math.floor(10000 + Math.random() * 90000);
  return `${first}${rest}`;
}

/** Tự sinh mật khẩu mạnh hoặc mã PIN 6 chữ số tùy theo vai trò */
export function generateAccountSecret(role?: Role | string): string {
  const cleanRole = typeof role === 'string' ? role.trim() : '';
  if (!cleanRole || isEmployeeRole(cleanRole as Role)) {
    return generatePin6();
  }
  const num = Math.floor(1000 + Math.random() * 9000);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const suffix = chars[Math.floor(Math.random() * chars.length)]!;
  return `Umbm@${num}${suffix}`;
}

/** Tự sinh mã chi nhánh CNxx */
export function generateBranchCode(existingCodes: string[] = [], currentCode?: string): string {
  const used = new Set(existingCodes.map((c) => c.trim().toUpperCase()));
  const curMatch = currentCode ? /^CN(\d+)$/i.exec(currentCode.trim()) : null;
  let num = curMatch ? Number(curMatch[1]) + 1 : Math.max(existingCodes.length + 1, 5);
  while (used.has(`CN${String(num).padStart(2, '0')}`)) {
    num += 1;
  }
  return `CN${String(num).padStart(2, '0')}`;
}

/** Tự sinh mã ca làm việc từ tên ca */
export function generateShiftCode(name?: string, currentCode?: string): string {
  const clean = stripVietnamese(name || '')
    .toUpperCase()
    .replace(/\s+/g, '_');
  const base = clean ? (clean.startsWith('CA_') ? clean : `CA_${clean}`) : 'CA_LINH_HOAT';
  if (currentCode === base) {
    return `${base}_${Math.floor(10 + Math.random() * 89)}`;
  }
  return base;
}
