'use client';

import {
  ApiOutlined,
  AuditOutlined,
  BellOutlined,
  BookOutlined,
  CalendarOutlined,
  CustomerServiceOutlined,
  DashboardOutlined,
  DollarOutlined,
  EnvironmentOutlined,
  FileDoneOutlined,
  IdcardOutlined,
  NotificationOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  SolutionOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import type { Permission, Role } from '@umbm/shared';

export interface NavItem {
  key: string;
  label: string;
  breadcrumbTitle: string;
  icon: ReactNode;
  perms: Permission[];
  roles?: Role[];
}

export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

export const BACKOFFICE_NAV: NavGroup[] = [
  {
    key: 'grp-workspace',
    label: 'Bàn làm việc',
    items: [
      {
        key: '/dashboard',
        label: 'Tổng quan & Thống kê',
        breadcrumbTitle: 'Tổng quan & Thống kê',
        icon: <DashboardOutlined />,
        perms: [],
        roles: ['ADMIN', 'HR', 'STORE', 'FINANCE', 'MKT'],
      },
      {
        key: '/admin/my-attendance',
        label: 'Điểm danh & Ca của bạn',
        breadcrumbTitle: 'Điểm danh GPS, Ca làm việc & Đơn cá nhân của bạn',
        icon: <EnvironmentOutlined />,
        perms: ['self.attendance'],
      },
      {
        key: '/admin/notifications',
        label: 'Trung tâm Thông báo',
        breadcrumbTitle: 'Trung tâm Thông báo & Hộp thư Hệ thống',
        icon: <BellOutlined />,
        perms: [],
        roles: ['ADMIN', 'HR', 'STORE', 'FINANCE', 'MKT'],
      },
      {
        key: '/admin/tickets',
        label: 'Phiếu hỗ trợ & Thắc mắc',
        breadcrumbTitle: 'Trung tâm Phiếu hỗ trợ & Giải đáp Thắc mắc',
        icon: <CustomerServiceOutlined />,
        perms: [],
        roles: ['ADMIN', 'HR', 'STORE', 'FINANCE', 'MKT'],
      },
    ],
  },
  {
    key: 'grp-hr-rbac',
    label: 'Nhân sự & Phân quyền',
    items: [
      {
        key: '/admin/employees',
        label: 'Hồ sơ nhân sự',
        breadcrumbTitle: 'Hồ sơ Nhân sự & Chuyển Chính thức',
        icon: <IdcardOutlined />,
        perms: ['employee.read'],
      },
      {
        key: '/admin/employees?section=recruitment',
        label: 'Tuyển dụng & Phỏng vấn',
        breadcrumbTitle: 'Tuyển dụng & Lịch Phỏng vấn',
        icon: <SolutionOutlined />,
        perms: ['candidate.manage', 'interview.manage'],
      },
      {
        key: '/admin/employees?section=tests',
        label: 'Ngân hàng Đề & Thi TEST',
        breadcrumbTitle: 'Ngân hàng Đề & Thi TEST Nghiệp Vụ',
        icon: <BookOutlined />,
        perms: ['test.manage'],
      },
      {
        key: '/admin/accounts',
        label: 'Tài khoản người dùng',
        breadcrumbTitle: 'Quản lý Tài khoản & Phân quyền',
        icon: <TeamOutlined />,
        perms: ['account.manage', 'account.activate'],
      },
      {
        key: '/admin/schedules',
        label: 'Lịch làm việc & Phân ca',
        breadcrumbTitle: 'Lịch làm việc, Phân ca & Theo dõi',
        icon: <CalendarOutlined />,
        perms: ['schedule.read'],
      },
      {
        key: '/admin/schedules?section=workflows',
        label: 'Điểm danh, Nghỉ phép & Đổi ca',
        breadcrumbTitle: 'Lịch sử Điểm danh, Nghỉ phép & Đổi ca',
        icon: <FileDoneOutlined />,
        perms: ['schedule.read', 'attendance.read'],
      },
      {
        key: '/admin/payroll',
        label: 'Kỳ lương & Thưởng',
        breadcrumbTitle: 'Kỳ lương, Thưởng, Phụ cấp & Phiếu lương',
        icon: <DollarOutlined />,
        perms: ['payroll.read', 'payroll.manage'],
      },
    ],
  },
  {
    key: 'grp-system',
    label: 'Hệ thống & Cá nhân',
    items: [
      {
        key: '/admin/branches',
        label: 'Chi nhánh & Ca làm',
        breadcrumbTitle: 'Quản lý Chi nhánh, GPS & Khung ca',
        icon: <ShopOutlined />,
        perms: ['system.config'],
      },
      {
        key: '/admin/audit-logs',
        label: 'Nhật ký kiểm toán',
        breadcrumbTitle: 'Nhật ký Kiểm toán',
        icon: <AuditOutlined />,
        perms: ['system.audit.read'],
      },
      {
        key: '/admin/integrations',
        label: 'Tích hợp, Đối soát & Email',
        breadcrumbTitle: 'Tích hợp, Đối soát & Mẫu Email',
        icon: <ApiOutlined />,
        perms: ['integration.read'],
      },
      {
        key: '/admin/integrations?section=governance',
        label: 'Chính sách & Sao lưu Bảo trì',
        breadcrumbTitle: 'Chính sách Vận hành & Sao lưu Bảo trì',
        icon: <SafetyCertificateOutlined />,
        perms: ['system.config', 'system.maintenance', 'system.backup'],
      },
      {
        key: '/admin/integrations?section=comms',
        label: 'Bản tin Truyền thông Nội bộ',
        breadcrumbTitle: 'Bản tin Truyền thông Nội bộ',
        icon: <NotificationOutlined />,
        perms: ['comms.manage'],
      },
    ],
  },
];
