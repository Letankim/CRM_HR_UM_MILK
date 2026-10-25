'use client';

import { Button, type ButtonProps } from 'antd';
import type { ReactNode } from 'react';
import type { Permission, Role } from '@umbm/shared';
import { useMe } from '@/lib/auth';

export interface PermissionCheckProps {
  /** Danh sách quyền (permissions) cần kiểm tra. Mặc định chỉ cần thỏa mãn ít nhất 1 quyền trong danh sách. */
  perms?: Permission[];
  /** Danh sách vai trò (roles) được phép hiển thị (ví dụ: ['ADMIN', 'HR']). */
  roles?: Role[];
  /** Nếu true, bắt buộc người dùng phải có TẤT CẢ các quyền trong `perms`. */
  requireAll?: boolean;
  /** Cho phép truyền thêm điều kiện boolean tùy chỉnh (ví dụ: quyền sở hữu bản ghi `canEditRow`). */
  allowed?: boolean;
}

/**
 * Hook kiểm tra quyền hiển thị nút/hành động chặt chẽ theo Vai trò (`roles`) và Quyền (`perms`).
 */
export function usePermissionGuard({ perms, roles, requireAll = false, allowed = true }: PermissionCheckProps): boolean {
  const { data } = useMe();
  if (!data?.user || !allowed) return false;
  const user = data.user;

  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    return false;
  }

  if (perms && perms.length > 0) {
    const userPerms = user.permissions ?? [];
    const hasPerm = requireAll ? perms.every((p) => userPerms.includes(p)) : perms.some((p) => userPerms.includes(p));
    if (!hasPerm) return false;
  }

  return true;
}

/**
 * Component bọc khối giao diện theo quyền (`PermissionGuard`).
 * Nếu tài khoản hiện tại không đủ quyền hoặc vai trò, tự động ẩn hoàn toàn (`null`).
 */
export function PermissionGuard({
  children,
  ...checkProps
}: PermissionCheckProps & { children: ReactNode }) {
  const ok = usePermissionGuard(checkProps);
  if (!ok) return null;
  return <>{children}</>;
}

export type GuardButtonProps = ButtonProps & PermissionCheckProps;

/**
 * Nút hành động có bảo vệ phân quyền (`GuardButton`).
 * Nếu tài khoản không có quyền thực hiện thao tác, nút sẽ tự động ẩn hoàn toàn khỏi giao diện.
 */
export function GuardButton({
  perms,
  roles,
  requireAll,
  allowed,
  children,
  ...buttonProps
}: GuardButtonProps) {
  const ok = usePermissionGuard({ perms, roles, requireAll, allowed });
  if (!ok) return null;
  return <Button {...buttonProps}>{children}</Button>;
}
