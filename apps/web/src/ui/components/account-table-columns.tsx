'use client';

import { Space, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckOutlined, DeleteOutlined, EditOutlined, LockOutlined, StopOutlined, UnlockOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { PERMISSION_LABELS } from '@umbm/shared';
import { exportToExcel } from '@/lib/export-excel';
import { StatusTag } from '../StatusTag';
import type { AccountRowItem } from './AccountDetailDrawer';
import { RowActionButtons } from './RowActionButtons';

const fmt = (v: string | null) => (v ? dayjs(v).format('HH:mm DD/MM/YYYY') : 'Chưa đăng nhập');
const fmtPhone = (p: string) => (p ? p.replace(/^\+?84/, '0') : 'Chưa cập nhật');

export function exportAccountsExcel(rows: AccountRowItem[]) {
  exportToExcel({
    fileName: `Danh_Sach_Tai_Khoan_UmBoMilk_${dayjs().format('YYYYMMDD_HHmm')}.xls`,
    sheetTitle: 'Danh sách Tài khoản & Phân quyền Hệ thống',
    columns: [
      { header: 'Mã nhân sự', render: (r) => r.employeeId || 'Nội bộ' },
      { header: 'Tên đăng nhập', render: (r) => `@${r.username}` },
      { header: 'Họ và tên', key: 'displayName' },
      { header: 'Vai trò', key: 'roleLabel' },
      {
        header: 'Quyền bổ sung',
        render: (r) =>
          (r.extraPermissions?.length ?? 0) > 0
            ? r.extraPermissions!.map((p) => PERMISSION_LABELS[p] ?? p).join(', ')
            : 'Mặc định theo vai trò',
      },
      { header: 'Số điện thoại', render: (r) => fmtPhone(r.phone) },
      { header: 'Phạm vi chi nhánh', key: 'branchNames' },
      { header: 'Trạng thái', key: 'statusLabel' },
      { header: 'Đăng nhập gần nhất', render: (r) => fmt(r.lastLoginAt) },
    ],
    rows,
  });
}

export interface BuildAccountColumnsOptions {
  canActivate: boolean;
  canManage: boolean;
  currentUserId?: string;
  processingId: string | null;
  onViewDetail: (row: AccountRowItem) => void;
  onEdit: (row: AccountRowItem) => void;
  onActivate: (row: AccountRowItem) => void;
  onLock: (row: AccountRowItem) => void;
  onUnlock: (row: AccountRowItem) => void;
  onRevoke: (row: AccountRowItem) => void;
  onDelete: (row: AccountRowItem) => void;
}

export function buildAccountColumns({
  canActivate,
  canManage,
  currentUserId,
  processingId,
  onViewDetail,
  onEdit,
  onActivate,
  onLock,
  onUnlock,
  onRevoke,
  onDelete,
}: BuildAccountColumnsOptions): ColumnsType<AccountRowItem> {
  return [
    {
      title: 'Tài khoản nhân sự',
      key: 'account',
      render: (_, r) => (
        <div>
          <Typography.Text strong style={{ fontSize: 13 }}>{r.displayName}</Typography.Text>
          <div style={{ marginTop: 3 }}>
            <Space size={6} wrap>
              <Tag color="default" style={{ margin: 0, borderRadius: 2, fontSize: 11 }}>
                <UserOutlined /> @{r.username}
              </Tag>
              <span style={{ fontSize: 12, color: '#64748B' }}>{r.roleLabel}</span>
            </Space>
          </div>
        </div>
      ),
    },
    {
      title: 'Phân quyền & Chi nhánh',
      key: 'scope',
      render: (_, r) => (
        <div>
          <Space size={4} wrap>
            <Tag color="blue" style={{ margin: 0, borderRadius: 2, fontSize: 11 }}>{r.roleLabel}</Tag>
            {(r.extraPermissions?.length ?? 0) > 0 && (
              <Tag color="purple" style={{ margin: 0, borderRadius: 2, fontSize: 11, fontWeight: 600 }}>
                +{r.extraPermissions!.length} quyền bổ sung
              </Tag>
            )}
            <Tag color="green" style={{ margin: 0, borderRadius: 2, fontSize: 11 }}>
              {r.branchScope === 'ALL' ? 'Toàn chuỗi' : 'Theo chi nhánh'}
            </Tag>
          </Space>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>{r.branchNames}</div>
        </div>
      ),
    },
    {
      title: 'Hồ sơ Nhân sự Liên kết',
      dataIndex: 'employeeId',
      width: 170,
      render: (v: string | null, r) =>
        v ? (
          <div>
            <Space size={6} wrap>
              <Tag color="geekblue" style={{ margin: 0, borderRadius: 2, fontWeight: 600 }}>{v}</Tag>
              {r.employeeName && <span style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>{r.employeeName}</span>}
            </Space>
            {r.employeePosition && <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{r.employeePosition}</div>}
          </div>
        ) : (
          <Tag style={{ margin: 0, borderRadius: 2 }}>Tài khoản Quản trị / Chưa gắn HS</Tag>
        ),
    },
    {
      title: 'Số điện thoại',
      dataIndex: 'phone',
      width: 118,
      render: (v: string) => <span className="num" style={{ fontWeight: 600, color: v ? '#2563EB' : '#94A3B8' }}>{fmtPhone(v)}</span>,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 125,
      render: (v: string) => <StatusTag value={v} />,
    },
    {
      title: 'Đăng nhập gần nhất',
      dataIndex: 'lastLoginAt',
      width: 135,
      render: (v: string | null) => <span className="num" style={{ fontSize: 12, color: '#475569' }}>{fmt(v)}</span>,
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 88,
      fixed: 'right',
      align: 'right',
      render: (_, r) => {
        const menuItems = [];
        if (canManage) {
          menuItems.push({ key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa & Phân quyền', onClick: () => onEdit(r) });
        }
        if (canActivate && r.status !== 'ACTIVE') {
          menuItems.push({ key: 'activate', icon: <CheckOutlined />, label: 'Kích hoạt tài khoản', onClick: () => onActivate(r) });
        }
        if (canActivate && r.status === 'ACTIVE' && r.id !== currentUserId && r.username !== 'admin') {
          menuItems.push({ key: 'lock', icon: <LockOutlined />, label: 'Khóa tạm thời tài khoản', onClick: () => onLock(r) });
        }
        if (canActivate && (r.status === 'LOCKED' || (r.failedLoginCount ?? 0) > 0)) {
          menuItems.push({ key: 'unlock', icon: <UnlockOutlined />, label: 'Mở khóa đăng nhập', onClick: () => onUnlock(r) });
        }
        if (canActivate && r.id !== currentUserId && r.status !== 'REVOKED') {
          menuItems.push({ key: 'revoke', icon: <StopOutlined />, danger: true, label: 'Thu hồi quyền truy cập', onClick: () => onRevoke(r) });
        }
        if (canActivate && r.id !== currentUserId && r.username !== 'admin') {
          menuItems.push({ key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa tài khoản', onClick: () => onDelete(r) });
        }
        return <RowActionButtons onViewDetail={() => onViewDetail(r)} menuItems={menuItems} loading={processingId === r.id} />;
      },
    },
  ];
}
