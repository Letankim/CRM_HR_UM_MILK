'use client';

import { Alert, Button, Descriptions, Drawer, Space, Tabs, Tag } from 'antd';
import {
  CloseOutlined,
  EditOutlined,
  ExpandAltOutlined,
  HistoryOutlined,
  IdcardOutlined,
  SafetyCertificateOutlined,
  ShrinkOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useState } from 'react';
import type { AccountStatus, Permission, Role } from '@umbm/shared';
import { StatusTag } from '../StatusTag';
import { AccountAuditHistoryTab, AccountPermissionsSummaryCard } from './AccountPermissionsTab';

export interface AccountRowItem {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  roleLabel: string;
  permissions?: Permission[];
  extraPermissions?: Permission[];
  phone: string;
  email?: string;
  employeeId: string | null;
  employeeRecordId?: string | null;
  employeeName?: string | null;
  employeePosition?: string | null;
  employeeStage?: string | null;
  employeeStageLabel?: string | null;
  branchScope: 'ALL' | string[];
  branchNames: string;
  primaryBranchId?: string | null;
  employeeBranchName?: string | null;
  status: AccountStatus;
  statusLabel?: string;
  version: number;
  failedLoginCount?: number;
  lockedUntil?: string | null;
  lastLoginAt: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  revokedAt: string | null;
  revokedBy?: string | null;
  revokeReason?: string | null;
  createdAt: string;
}

const fmtDate = (v: string | null) => (v ? dayjs(v).format('HH:mm:ss DD/MM/YYYY') : 'Chưa ghi nhận');
const fmtPhone = (p: string) => (p ? p.replace(/^\+?84/, '0') : 'Chưa cập nhật');

export function AccountDetailDrawer({
  account,
  canManage,
  onEdit,
  onClose,
}: {
  account: AccountRowItem | null;
  canManage?: boolean;
  onEdit?: (row: AccountRowItem) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Drawer
      title={account ? `Hồ sơ tài khoản: ${account.displayName} (@${account.username})` : 'Chi tiết tài khoản'}
      open={!!account}
      onClose={onClose}
      width={expanded ? '95vw' : '72vw'}
      destroyOnHidden
      extra={
        <Space size={8}>
          {account && canManage && onEdit && (
            <Button
              size="small"
              type="primary"
              icon={<EditOutlined />}
              onClick={() => {
                onClose();
                onEdit(account);
              }}
            >
              Sửa &amp; Phân quyền
            </Button>
          )}
          <Button size="small" icon={expanded ? <ShrinkOutlined /> : <ExpandAltOutlined />} onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Thu gọn' : 'Mở rộng'}
          </Button>
          <Button size="small" icon={<CloseOutlined />} onClick={onClose}>
            Đóng
          </Button>
        </Space>
      }
    >
      {account && (
        <Tabs
          defaultActiveKey="account"
          items={[
            {
              key: 'account',
              label: <span><SafetyCertificateOutlined /> Thông tin Tài khoản &amp; Phân quyền</span>,
              children: (
                <>
                  <Descriptions column={expanded ? 2 : 1} bordered size="small">
                    <Descriptions.Item label="Họ và tên hiển thị">{account.displayName}</Descriptions.Item>
                    <Descriptions.Item label="Tên đăng nhập">
                      <Tag color="blue" style={{ borderRadius: 2, fontWeight: 600 }}>
                        <UserOutlined /> @{account.username}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Vai trò phân quyền">
                      <Space size={6}>
                        <Tag color="blue" style={{ margin: 0, borderRadius: 2 }}>{account.roleLabel}</Tag>
                        {(account.extraPermissions?.length ?? 0) > 0 && (
                          <Tag color="purple" style={{ margin: 0, borderRadius: 2, fontWeight: 600 }}>
                            +{account.extraPermissions!.length} quyền bổ sung
                          </Tag>
                        )}
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="Số điện thoại">{fmtPhone(account.phone)}</Descriptions.Item>
                    <Descriptions.Item label="Địa chỉ Email thông báo">{account.email || 'Chưa cập nhật'}</Descriptions.Item>
                    <Descriptions.Item label="Phạm vi chi nhánh">{account.branchNames}</Descriptions.Item>
                    <Descriptions.Item label="Trạng thái hiện tại"><StatusTag value={account.status} /></Descriptions.Item>
                    <Descriptions.Item label="Số lần đăng nhập sai"><span className="num">{account.failedLoginCount ?? 0} lần</span></Descriptions.Item>
                    <Descriptions.Item label="Ngày khởi tạo">{fmtDate(account.createdAt)}</Descriptions.Item>
                    <Descriptions.Item label="Thời điểm kích hoạt">{fmtDate(account.activatedAt)}</Descriptions.Item>
                    <Descriptions.Item label="Thời điểm thu hồi">{fmtDate(account.revokedAt)}</Descriptions.Item>
                    <Descriptions.Item label="Lý do thu hồi">{account.revokeReason || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Đăng nhập gần nhất" span={expanded ? 2 : 1}>{fmtDate(account.lastLoginAt)}</Descriptions.Item>
                  </Descriptions>
                  <AccountPermissionsSummaryCard account={account} />
                </>
              ),
            },
            {
              key: 'history',
              label: <span><HistoryOutlined /> Lịch sử Thay đổi Quyền &amp; Trạng thái</span>,
              children: <AccountAuditHistoryTab accountId={account.id} />,
            },
            {
              key: 'employee',
              label: <span><IdcardOutlined /> Hồ sơ Nhân sự Liên kết</span>,
              children: account.employeeId ? (
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="Mã hồ sơ nhân sự">
                    <Tag color="geekblue" style={{ borderRadius: 2, fontWeight: 600 }}>{account.employeeId}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Họ và tên nhân sự">{account.employeeName || account.displayName}</Descriptions.Item>
                  <Descriptions.Item label="Vị trí công việc">{account.employeePosition || 'Nhân sự cửa hàng'}</Descriptions.Item>
                  <Descriptions.Item label="Giai đoạn nhân sự">
                    {account.employeeStage ? <StatusTag value={account.employeeStage} /> : account.employeeStageLabel || 'Đang làm việc'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Chi nhánh phân công">{account.employeeBranchName || account.branchNames}</Descriptions.Item>
                  <Descriptions.Item label="Số điện thoại hồ sơ">{fmtPhone(account.phone)}</Descriptions.Item>
                </Descriptions>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  message="Tài khoản này chưa gắn với Hồ sơ Nhân sự cửa hàng (Tài khoản Quản trị nội bộ)"
                  description="Nếu muốn gắn tài khoản này với một Hồ sơ Nhân sự cụ thể, hãy nhấn nút Sửa & Phân quyền ở góc trên bên phải."
                />
              ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}
