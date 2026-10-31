'use client';

import { Space, Tag, Typography } from 'antd';
import { EditOutlined, FileExcelOutlined, HistoryOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { EMPLOYEE_STAGE_OPTIONS, PAY_RATE_TYPE_OPTIONS } from '@umbm/shared';
import { api } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { StatusTag } from '@/ui/StatusTag';
import { DataTableCard } from './DataTableCard';
import { FilterToolbar } from './FilterToolbar';
import { fmtVnd, type SalaryProfile, type SalaryProfileRow } from './payroll-types';
import { RowActionButtons } from './RowActionButtons';
import { SalaryHistoryDrawer, SalaryProfileDetailModal } from './SalaryHistoryDrawer';
import { SalaryProfileModal, type SalaryModalMode } from './SalaryProfileModal';

const ALL = { label: 'Tất cả', value: 'ALL' };

function exportSalaryExcel(rows: SalaryProfileRow[]) {
  exportToExcel({
    fileName: `Ho_So_Luong_Nhan_Su_${dayjs().format('YYYYMMDD')}.xls`,
    sheetTitle: 'HỒ SƠ LƯƠNG CÁ NHÂN THEO TỪNG NHÂN SỰ',
    columns: [
      { header: 'Mã NV', key: 'employeeCode' },
      { header: 'Họ và tên', key: 'fullName' },
      { header: 'Chi nhánh', key: 'branchName' },
      { header: 'Giai đoạn', key: 'stageLabel' },
      { header: 'Hình thức lương', render: (r) => r.profile?.rateTypeLabel ?? 'Chưa thiết lập' },
      { header: 'Lương chính thức', render: (r) => r.profile?.amountVnd ?? 0, isCurrency: true },
      { header: '% thử việc', render: (r) => (r.profile ? `${r.profile.probationPercent}%` : '') },
      { header: 'Lương thử việc', render: (r) => r.profile?.probationAmountVnd ?? 0, isCurrency: true },
      { header: 'Phụ cấp ăn ca/ca', render: (r) => r.profile?.mealAllowancePerShiftVnd ?? 0, isCurrency: true },
      { header: 'Thưởng chuyên cần', render: (r) => r.profile?.attendanceBonusVnd ?? 0, isCurrency: true },
      { header: 'Hiệu lực từ', render: (r) => r.profile?.effectiveFrom ?? '' },
      { header: 'Trạng thái', key: 'profileStatusLabel' },
    ],
    rows,
  });
}

export function SalaryProfilesTab({ canManage, employeeOptions }: { canManage: boolean; employeeOptions: { value: string; label: string }[] }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [branchId, setBranchId] = useState('ALL');
  const [stage, setStage] = useState('ALL');
  const [rateType, setRateType] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState({ page: 1, perPage: 12 });
  const [modal, setModal] = useState<{ mode: SalaryModalMode; employee: { id: string; label: string } | null; base: SalaryProfile | null } | null>(null);
  const [historyOf, setHistoryOf] = useState<{ id: string; label: string } | null>(null);
  const [detailProfile, setDetailProfile] = useState<SalaryProfile | null>(null);

  const branchesQuery = useQuery({
    queryKey: ['branches', 'select'],
    queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=100'),
  });
  const branchOptions = useMemo(
    () => [{ label: 'Tất cả chi nhánh', value: 'ALL' }, ...(branchesQuery.data?.data ?? []).map((b) => ({ label: `${b.name} (${b.code})`, value: b.id }))],
    [branchesQuery.data?.data],
  );

  const params = new URLSearchParams({
    page: String(page.page),
    per_page: String(page.perPage),
    q,
    ...(branchId !== 'ALL' ? { branch_id: branchId } : {}),
    stage,
    rate_type: rateType,
    profile_status: status,
    sort_by: 'employeeCode',
    sort_order: 'asc',
  });
  const listQuery = useQuery({
    queryKey: ['salary-profiles', params.toString()],
    queryFn: () => api.list<SalaryProfileRow>(`/admin/payroll/salary-profiles?${params.toString()}`),
  });
  const rows = listQuery.data?.data ?? [];
  const reset = () => setPage((p) => ({ ...p, page: 1 }));
  const label = (r: SalaryProfileRow) => `${r.fullName} (${r.employeeCode})`;

  const columns = useMemo(
    () => [
      { title: 'Nhân sự', key: 'emp', render: (_: unknown, r: SalaryProfileRow) => <div><Typography.Text strong>{r.fullName}</Typography.Text><div style={{ fontSize: 12, color: '#64748B' }}>{r.branchName} · {r.stageLabel}{r.officialFrom ? ` từ ${dayjs(r.officialFrom).format('DD/MM/YYYY')}` : ''}</div></div> },
      { title: 'Hình thức', key: 'type', render: (_: unknown, r: SalaryProfileRow) => (r.profile ? <Tag color={r.profile.rateType === 'MONTHLY' ? 'purple' : r.profile.rateType === 'SHIFT' ? 'cyan' : 'blue'} style={{ borderRadius: 2 }}>{r.profile.rateTypeLabel}</Tag> : <Typography.Text type="secondary">—</Typography.Text>) },
      { title: 'Lương chính thức', key: 'off', align: 'right' as const, render: (_: unknown, r: SalaryProfileRow) => (r.profile ? <span className="num" style={{ fontWeight: 700 }}>{fmtVnd(r.profile.amountVnd)}/{r.profile.unitLabel}</span> : '—') },
      { title: 'Lương thử việc', key: 'prob', align: 'right' as const, render: (_: unknown, r: SalaryProfileRow) => (r.profile ? <span className="num">{fmtVnd(r.profile.probationAmountVnd)}/{r.profile.unitLabel}<div style={{ fontSize: 12, color: '#64748B' }}>{r.profile.probationPercent}% lương chính thức</div></span> : '—') },
      { title: 'Phụ cấp / Thưởng cố định', key: 'allw', render: (_: unknown, r: SalaryProfileRow) => (r.profile ? <span style={{ fontSize: 12 }}>Ăn ca {fmtVnd(r.profile.mealAllowancePerShiftVnd)}/ca · Chuyên cần {fmtVnd(r.profile.attendanceBonusVnd)}</span> : '—') },
      { title: 'Hiệu lực', key: 'eff', render: (_: unknown, r: SalaryProfileRow) => (r.profile ? <span>{dayjs(r.profile.effectiveFrom).format('DD/MM/YYYY')}<div style={{ fontSize: 12, color: '#64748B' }}>{r.historyCount} mức lương</div></span> : '—') },
      { title: 'Trạng thái', key: 'st', render: (_: unknown, r: SalaryProfileRow) => <StatusTag value={r.profileStatus} label={r.profileStatusLabel} /> },
      {
        title: 'Thao tác',
        key: 'act',
        width: 90,
        align: 'right' as const,
        render: (_: unknown, r: SalaryProfileRow) => (
          <RowActionButtons
            detailTooltip={r.profile ? 'Xem chi tiết mức lương hiện tại' : 'Xem lịch sử lương'}
            onViewDetail={() => (r.profile ? setDetailProfile(r.profile) : setHistoryOf({ id: r.employeeId, label: label(r) }))}
            menuItems={[
              ...(canManage && !r.profile
                ? [{ key: 'create', icon: <PlusOutlined />, label: 'Thiết lập lương ban đầu', onClick: () => setModal({ mode: 'CREATE', employee: { id: r.employeeId, label: label(r) }, base: null }) }]
                : []),
              ...(canManage && r.profile
                ? [
                    { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa mức lương hiện tại', onClick: () => setModal({ mode: 'EDIT', employee: { id: r.employeeId, label: label(r) }, base: r.profile }) },
                    { key: 'adjust', icon: <PlusOutlined />, label: 'Điều chỉnh lương mới (Lưu lịch sử)', onClick: () => setModal({ mode: 'ADJUST', employee: { id: r.employeeId, label: label(r) }, base: r.profile }) },
                  ]
                : []),
              { key: 'history', icon: <HistoryOutlined />, label: `Xem lịch sử lương (${r.historyCount} mức)`, onClick: () => setHistoryOf({ id: r.employeeId, label: label(r) }) },
            ]}
          />
        ),
      },
    ],
    [canManage],
  );

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <FilterToolbar
        searchPlaceholder="Tìm theo mã, họ tên nhân sự, chi nhánh..."
        searchValue={q}
        onSearchChange={(v) => { setQ(v); reset(); }}
        selects={[
          { key: 'branch', value: branchId, width: 210, options: branchOptions, onChange: (v) => { setBranchId(v); reset(); } },
          { key: 'stage', value: stage, width: 170, options: [ALL, ...EMPLOYEE_STAGE_OPTIONS], onChange: (v) => { setStage(v); reset(); } },
          { key: 'rate', value: rateType, width: 190, options: [{ label: 'Mọi hình thức lương', value: 'ALL' }, ...PAY_RATE_TYPE_OPTIONS], onChange: (v) => { setRateType(v); reset(); } },
          { key: 'status', value: status, width: 190, options: [{ label: 'Mọi trạng thái', value: 'ALL' }, { label: 'Đang áp dụng', value: 'ACTIVE' }, { label: 'Chờ hiệu lực', value: 'SCHEDULED' }, { label: 'Chưa thiết lập lương', value: 'MISSING' }], onChange: (v) => { setStatus(v); reset(); } },
        ]}
        onRefresh={async () => {
          const fresh = await api.list<SalaryProfileRow>(`/admin/payroll/salary-profiles?${params.toString()}&refresh=1`).catch(() => null);
          if (fresh) qc.setQueryData(['salary-profiles', params.toString()], fresh);
          void qc.invalidateQueries({ queryKey: ['salary-profiles'], refetchType: fresh ? 'none' : 'active' });
          ['payroll-periods', 'payroll-periods-report', 'payroll-snapshots', 'payroll-reconcile'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        }}
        refreshing={listQuery.isFetching}
        onExportExcel={() => exportSalaryExcel(rows)}
        primaryActionLabel={canManage ? 'Thiết lập lương' : undefined}
        onPrimaryAction={canManage ? () => setModal({ mode: 'CREATE', employee: null, base: null }) : undefined}
      />
      <DataTableCard<SalaryProfileRow>
        columns={columns}
        dataSource={rows}
        meta={listQuery.data?.meta}
        loading={listQuery.isLoading || (listQuery.isFetching && !listQuery.data)}
        codeExtractor={(r) => r.employeeCode}
        onPageChange={(p, perPage) => setPage({ page: p, perPage })}
        onRowClick={(r) => (r.profile ? setDetailProfile(r.profile) : setHistoryOf({ id: r.employeeId, label: `${r.fullName} (${r.employeeCode})` }))}
        emptyText="Chưa có nhân sự phù hợp bộ lọc"
        bulkActions={[{ key: 'export', label: 'Xuất Excel đã chọn', icon: <FileExcelOutlined style={{ color: '#15803D' }} />, onClick: (sel) => exportSalaryExcel(sel) }]}
      />
      <SalaryProfileModal open={!!modal} mode={modal?.mode ?? 'CREATE'} employee={modal?.employee} base={modal?.base} employees={employeeOptions} onClose={() => setModal(null)} />
      <SalaryHistoryDrawer
        employee={historyOf}
        canManage={canManage}
        onClose={() => setHistoryOf(null)}
        onEdit={(p) => setModal({ mode: 'EDIT', employee: { id: p.employeeId, label: `${p.employeeName} (${p.employeeCode})` }, base: p })}
      />
      <SalaryProfileDetailModal
        profile={detailProfile}
        canManage={canManage}
        onClose={() => setDetailProfile(null)}
        onEdit={(p) => setModal({ mode: 'EDIT', employee: { id: p.employeeId, label: `${p.employeeName} (${p.employeeCode})` }, base: p })}
        onAdjust={(p) => setModal({ mode: 'ADJUST', employee: { id: p.employeeId, label: `${p.employeeName} (${p.employeeCode})` }, base: p })}
      />
    </Space>
  );
}
