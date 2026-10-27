'use client';

import { Space, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EditOutlined, RiseOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { exportToExcel } from '@/lib/export-excel';
import { StatusTag } from '../StatusTag';
import type { SalaryProfile } from './payroll-types';
import { RowActionButtons } from './RowActionButtons';

export interface EmployeeRowItem {
  id: string; employeeCode: string; fullName: string; phone: string;
  email?: string; dateOfBirth?: string; gender?: string; citizenId?: string; citizenIssueDate?: string;
  permanentAddress?: string; currentAddress?: string; emergencyContactName?: string; emergencyContactPhone?: string;
  taxCode?: string; resignedAt?: string; resignReason?: string;
  branchId: string; branchName: string; staffGroup: string; staffGroupLabel: string;
  stage: string; stageLabel: string; status: string; statusLabel: string;
  positionTitle: string; employmentType: string; employmentTypeLabel: string;
  defaultShiftCode: string; defaultShiftLabel: string;
  probationStart: string | null; probationEnd: string | null; officialFrom: string | null;
  probationCycleDays: number; probationWorkDays: number; probationOffDays: number;
  salaryStatus: 'ACTIVE' | 'EXPIRED' | 'SCHEDULED' | 'MISSING'; salaryStatusLabel: string;
  salaryRateType: 'HOURLY' | 'MONTHLY' | 'SHIFT' | null; salaryRateTypeLabel: string | null; salaryUnitLabel: string | null;
  salaryOfficialAmountVnd: number; salaryProbationPercent: number | null; salaryEffectiveAmountVnd: number;
  salaryProfile?: SalaryProfile | null;
  bankName: string; bankAccountNumber: string; bankAccountHolder: string;
  userId: string | null; username: string | null; userDisplayName?: string | null; userRole?: string | null; userRoleLabel?: string | null;
  accountStatus: string | null; accountStatusLabel: string;
  probationHoursCompleted?: number; totalShiftsCount?: number;
  recentShifts?: { id: string; work_date: string; shift_code: string; shiftLabel: string; branchName?: string; start_at: string; end_at: string; scheduled_hours: number; status: string; note?: string; assignedByName?: string; assignedByRoleLabel?: string }[];
  testBestScorePercent?: number; testPassed?: boolean; testAssignedCount?: number; testAttemptsCount?: number;
  leaveRequestsCount?: number; swapRequestsCount?: number;
  stageHistory?: { id: string; fromStage: string; fromStageLabel: string; toStage: string; toStageLabel: string; effectiveFrom: string; decidedBy: string; decidedBySub?: string; decidedByRoleLabel?: string; probationHoursCompleted: number; testScorePercent: number; evaluationSummary: string; note: string; fromBranchName?: string; toBranchName?: string; fromShiftLabel?: string; toShiftLabel?: string; createdAt?: string }[];
  note?: string; version: number; created_at: string; updated_at: string;
}

const fmtPhone = (p: string) => (p ? p.replace(/^\+?84/, '0') : 'Chưa cập nhật');
export const fmtEmployeeSalary = (r: EmployeeRowItem, amount = r.salaryEffectiveAmountVnd) =>
  r.salaryRateType ? `${Math.round(amount).toLocaleString('vi-VN')} đ/${r.salaryUnitLabel}` : r.salaryStatusLabel;

export function exportEmployeesExcel(rows: EmployeeRowItem[], canSeeSalary = true) {
  exportToExcel({
    fileName: `Ho_So_Nhan_Su_UmBoMilk_${dayjs().format('YYYYMMDD_HHmm')}.xls`,
    sheetTitle: 'Danh sách Hồ sơ Nhân sự',
    columns: [
      { header: 'Mã NV', key: 'employeeCode' },
      { header: 'Họ và tên', key: 'fullName' },
      { header: 'Số điện thoại', render: (r) => fmtPhone(r.phone) },
      { header: 'Chi nhánh', key: 'branchName' },
      { header: 'Khối vị trí', key: 'staffGroupLabel' },
      { header: 'Giai đoạn', key: 'stageLabel' },
      { header: 'Ca mặc định', key: 'defaultShiftLabel' },
      ...(canSeeSalary
        ? [
            { header: 'Hình thức lương', render: (r: EmployeeRowItem) => r.salaryRateTypeLabel ?? r.salaryStatusLabel },
            { header: 'Lương chính thức', render: (r: EmployeeRowItem) => r.salaryOfficialAmountVnd, isCurrency: true },
            { header: '% thử việc', render: (r: EmployeeRowItem) => (r.salaryProbationPercent ? `${r.salaryProbationPercent}%` : '') },
            { header: 'Lương đang áp dụng', render: (r: EmployeeRowItem) => r.salaryEffectiveAmountVnd, isCurrency: true },
            { header: 'Phụ cấp ăn ca/ca', render: (r: EmployeeRowItem) => r.salaryProfile?.mealAllowancePerShiftVnd ?? 0, isCurrency: true },
            { header: 'Thưởng chuyên cần', render: (r: EmployeeRowItem) => r.salaryProfile?.attendanceBonusVnd ?? 0, isCurrency: true },
            { header: 'Phụ cấp cố định khác', render: (r: EmployeeRowItem) => (r.salaryProfile?.transportAllowanceVnd ?? 0) + (r.salaryProfile?.responsibilityAllowanceVnd ?? 0) + (r.salaryProfile?.otherAllowanceVnd ?? 0), isCurrency: true },
            { header: 'Ngân hàng', key: 'bankName' as const },
            { header: 'Số tài khoản', key: 'bankAccountNumber' as const },
          ]
        : []),
      { header: 'Trạng thái TK', key: 'accountStatusLabel' },
    ],
    rows,
  });
}

export interface BuildEmployeeColumnsOptions {
  canManage: boolean;
  canPromote: boolean;
  canSeeSalary?: boolean;
  processingId: string | null;
  onViewDetail: (row: EmployeeRowItem) => void;
  onEdit: (row: EmployeeRowItem) => void;
  onPromoteOfficial: (row: EmployeeRowItem) => void;
  onDelete: (row: EmployeeRowItem) => void;
}

export function buildEmployeeColumns({
  canManage,
  canPromote,
  canSeeSalary = true,
  processingId,
  onViewDetail,
  onEdit,
  onPromoteOfficial,
  onDelete,
}: BuildEmployeeColumnsOptions): ColumnsType<EmployeeRowItem> {
  const cols: ColumnsType<EmployeeRowItem> = [
    {
      title: 'Nhân sự & Vị trí',
      key: 'employee',
      render: (_, r) => (
        <div>
          <Typography.Text strong style={{ fontSize: 13 }}>{r.fullName}</Typography.Text>
          <div style={{ marginTop: 3 }}>
            <Space size={6} wrap>
              <Tag color="geekblue" style={{ margin: 0, borderRadius: 2, fontSize: 11, fontWeight: 600 }}>
                {r.employeeCode}
              </Tag>
              <span style={{ fontSize: 12, color: '#64748B' }}>{r.staffGroupLabel}</span>
            </Space>
          </div>
        </div>
      ),
    },
    {
      title: 'Chi nhánh & Ca mặc định',
      key: 'branch',
      render: (_, r) => (
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#0F172A' }}>{r.branchName}</div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{r.defaultShiftLabel}</div>
        </div>
      ),
    },
    {
      title: 'Số điện thoại',
      dataIndex: 'phone',
      width: 115,
      render: (v: string) => <span className="num" style={{ fontWeight: 600, color: '#2563EB' }}>{fmtPhone(v)}</span>,
    },
    {
      title: 'Giai đoạn nhân sự',
      dataIndex: 'stage',
      width: 150,
      render: (_, r) => (
        <div>
          <StatusTag value={r.stage} />
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>
            {r.stage === 'OFFICIAL' && r.officialFrom
              ? `Chính thức: ${r.officialFrom}`
              : r.probationStart
                ? `Thử việc: ${r.probationStart}`
                : `Chu kỳ ${r.probationCycleDays} ngày`}
          </div>
        </div>
      ),
    },
    {
      title: 'Lương cá nhân',
      key: 'salary',
      width: 160,
      align: 'right',
      render: (_, r) =>
        r.salaryRateType && r.salaryOfficialAmountVnd === 0 ? (
          <Tag style={{ borderRadius: 2, margin: 0 }}>{r.salaryRateTypeLabel}</Tag>
        ) : r.salaryRateType ? (
          <div>
            <div className="num" style={{ fontWeight: 600 }}>{fmtEmployeeSalary(r)}</div>
            <div style={{ fontSize: 11, color: '#64748B' }}>
              {r.stage === 'OFFICIAL' ? r.salaryRateTypeLabel : `Thử việc ${r.salaryProbationPercent}% · Chính thức ${fmtEmployeeSalary(r, r.salaryOfficialAmountVnd)}`}
            </div>
          </div>
        ) : (
          <StatusTag value="MISSING" label={r.salaryStatusLabel} />
        ),
    },
    {
      title: 'Tài khoản Liên kết',
      key: 'accountStatus',
      width: 155,
      render: (_, r) =>
        r.username ? (
          <div>
            <Space size={4} wrap>
              <Tag color="blue" style={{ margin: 0, borderRadius: 2, fontSize: 11, fontWeight: 600 }}>
                <UserOutlined /> @{r.username}
              </Tag>
              {r.accountStatus && <StatusTag value={r.accountStatus} />}
            </Space>
            {r.userRoleLabel && <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{r.userRoleLabel}</div>}
          </div>
        ) : (
          <Tag color="warning" style={{ borderRadius: 2, margin: 0 }}>{r.accountStatusLabel}</Tag>
        ),
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
          menuItems.push({ key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa hồ sơ & Lương', onClick: () => onEdit(r) });
        }
        if (canPromote && r.stage === 'PROBATION') {
          menuItems.push({ key: 'promote', icon: <RiseOutlined />, label: 'Chuyển lên Chính thức', onClick: () => onPromoteOfficial(r) });
        }
        if (canManage) {
          menuItems.push({ key: 'delete', icon: <DeleteOutlined />, label: 'Xóa hồ sơ nhân sự', danger: true, onClick: () => onDelete(r) });
        }
        return <RowActionButtons onViewDetail={() => onViewDetail(r)} menuItems={menuItems} loading={processingId === r.id} />;
      },
    },
  ];
  return canSeeSalary ? cols : cols.filter((c) => c.key !== 'salary');
}
