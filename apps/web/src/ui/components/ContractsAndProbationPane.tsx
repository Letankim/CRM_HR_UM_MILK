'use client';

import { useMemo, useState } from 'react';
import { App, Button, Space, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined, CloudUploadOutlined, DownloadOutlined, FileProtectOutlined,
  FileTextOutlined, PlusCircleOutlined, RiseOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { CONTRACT_TYPE_LABELS, EMPLOYEE_STAGE_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { StatusTag } from '../StatusTag';
import { BaseDetailDrawer } from './BaseDetailDrawer';
import { DataTableCard } from './DataTableCard';
import { ContractUploadModal, EmployeeContractStorePanel } from './EmployeeContractStorePanel';
import { PromoteOfficialModal } from './EmployeeDossierHistoryTab';
import type { EmployeeRowItem } from './employee-table-columns';
import { FilterToolbar } from './FilterToolbar';
import { useJobPositions } from './JobPositionsManagerModal';
import { RowActionButtons } from './RowActionButtons';
import { useWorkflowDecisionModal } from './WorkflowDecisionModal';

const CONTRACT_FILTER_OPTIONS = [
  { value: 'ALL', label: 'Tất cả trạng thái hợp đồng' },
  { value: 'HAS_CONTRACT', label: 'Đã lưu hợp đồng lao động' },
  { value: 'MISSING_CONTRACT', label: 'Chưa có hợp đồng lao động' },
];

export function ContractsAndProbationPane({ branches }: { branches: { value: string; label: string }[] }) {
  const qc = useQueryClient(), can = useCan(), { message } = App.useApp();
  const canManage = can('employee.manage'), canPromote = can('employee.promote');
  const { options: jobPositionOptions } = useJobPositions(), { promptDecision, decisionModalElement } = useWorkflowDecisionModal();

  const [q, setQ] = useState(''), debouncedQ = useDebouncedValue(q, 400);
  const [branchFilter, setBranchFilter] = useState('ALL'), [stageFilter, setStageFilter] = useState('ALL');
  const [staffGroupFilter, setStaffGroupFilter] = useState('ALL'), [contractFilter, setContractFilter] = useState('ALL');
  const [page, setPage] = useState(1), [perPage, setPerPage] = useState(12);
  const [detailEmp, setDetailEmp] = useState<EmployeeRowItem | null>(null);
  const [uploadPresetEmp, setUploadPresetEmp] = useState<EmployeeRowItem | null>(null), [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [promotingRow, setPromotingRow] = useState<EmployeeRowItem | null>(null);

  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (debouncedQ) params.set('q', debouncedQ);
  if (branchFilter !== 'ALL') params.set('branch_id', branchFilter);
  if (stageFilter !== 'ALL') params.set('stage', stageFilter);
  if (staffGroupFilter !== 'ALL') params.set('staff_group', staffGroupFilter);

  const empQ = useQuery({
    queryKey: ['employees', 'contracts-pane', page, perPage, debouncedQ, branchFilter, stageFilter, staffGroupFilter],
    queryFn: () => api.list<EmployeeRowItem>(`/admin/employees?${params.toString()}`),
  });

  const allRows = empQ.data?.data ?? [];
  const rows = useMemo(() => {
    if (contractFilter === 'HAS_CONTRACT') return allRows.filter((r) => (r.contractsCount ?? r.contracts?.length ?? 0) > 0);
    if (contractFilter === 'MISSING_CONTRACT') return allRows.filter((r) => (r.contractsCount ?? r.contracts?.length ?? 0) === 0);
    return allRows;
  }, [allRows, contractFilter]);

  const liveDetailEmp = detailEmp ? (allRows.find((x) => x.id === detailEmp.id) ?? detailEmp) : null;
  const employeeOptions = useMemo(() => allRows.map((r) => ({ value: r.id, label: `${r.employeeCode} — ${r.fullName} (${r.branchName})`, stage: r.stage })), [allRows]);
  const refreshAll = () => ['employees', 'employee-contracts', 'accounts'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));

  const promoteSingle = useMutation({
    mutationFn: (input: { row: EmployeeRowItem; official_from: string; evaluation_summary: string }) =>
      api.post<EmployeeRowItem>(`/admin/employees/${input.row.id}/promote-official`, { version: input.row.version, official_from: input.official_from, evaluation_summary: input.evaluation_summary }),
    onSuccess: (updated) => { message.success(`Đã chuyển chính thức cho ${updated.fullName} (${updated.employeeCode})`); setPromotingRow(null); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Chuyển chính thức thất bại'),
  });

  const exportRows = (list: EmployeeRowItem[]) =>
    exportToExcel({
      fileName: `Quan_ly_Hop_dong_Lao_dong_${dayjs().format('YYYYMMDD_HHmm')}.xls`,
      sheetTitle: 'Danh sách Hợp đồng Lao động & Đánh giá Thử việc',
      rows: list as unknown as Record<string, unknown>[],
      columns: [
        { header: 'Mã NV', key: 'employeeCode' }, { header: 'Họ và tên', key: 'fullName' }, { header: 'Chi nhánh', key: 'branchName' },
        { header: 'Vị trí', key: 'staffGroupLabel' }, { header: 'Giai đoạn', key: 'stageLabel' }, { header: 'Số văn bản hợp đồng', key: 'contractsCount' },
        { header: 'Giờ công thử việc', key: 'probationHoursCompleted' }, { header: 'Điểm TEST (%)', key: 'testBestScorePercent' }, { header: 'Điểm tín nhiệm (100đ)', key: 'attendanceCreditPoints' },
      ],
    });

  const promptMeetEval = (targets: EmployeeRowItem[], clear?: () => void) =>
    promptDecision({
      title: targets.length > 1 ? `Ghi nhận hoàn tất Vấn đáp Google Meet (${targets.length} nhân sự)` : `Ghi nhận kết quả Vấn đáp Google Meet: ${targets[0]?.fullName ?? ''}`,
      subtitle: 'Xác nhận nhân sự đã hoàn thành buổi vấn đáp đánh giá thử việc.',
      required: true, noteLabel: 'Nhận xét đánh giá buổi vấn đáp', okText: 'Xác nhận hoàn tất',
      suggestions: ['Hoàn thành tốt buổi vấn đáp Google Meet, nắm vững quy trình SOP và nội quy cửa hàng'],
      onConfirm: async (note) => {
        for (const r of targets) await api.post(`/admin/employees/${r.id}/meet-evaluation`, { probation_meet_done: true, note });
        message.success(`Đã ghi nhận hoàn tất Vấn đáp Google Meet cho ${targets.length} nhân sự`); clear?.(); refreshAll();
      },
    });

  const promptGrantLeave = (targets: EmployeeRowItem[], clear?: () => void) =>
    promptDecision({
      title: targets.length > 1 ? `Cấp quyền nghỉ đột xuất hàng loạt (${targets.length} nhân sự)` : `Cấp 1 lượt nghỉ đột xuất: ${targets[0]?.fullName ?? ''}`,
      subtitle: 'Cấp 1 lượt quyền xin nghỉ đột xuất trong chu kỳ thử việc.',
      required: false, noteLabel: 'Lý do cấp quyền nghỉ đột xuất', okText: 'Xác nhận cấp quyền',
      suggestions: ['Nhân sự có việc cá nhân/lịch học đột xuất đã báo trước với Quản lý'],
      onConfirm: async (note) => {
        for (const r of targets) await api.post(`/admin/employees/${r.id}/grant-emergency-leave`, { grant_count: 1, note: note || 'HR cấp 1 lượt nghỉ đột xuất' });
        message.success(`Đã cấp quyền nghỉ đột xuất cho ${targets.length} nhân sự`); clear?.(); refreshAll();
      },
    });

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <FilterToolbar
        searchPlaceholder="Tìm mã NV, họ tên, SĐT, chi nhánh..." searchValue={q} onSearchChange={(v) => { setQ(v); setPage(1); }}
        selects={[
          { key: 'branch', value: branchFilter, width: 195, options: [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branches], onChange: (v) => { setBranchFilter(v); setPage(1); } },
          { key: 'stage', value: stageFilter, width: 175, options: [{ value: 'ALL', label: 'Tất cả giai đoạn' }, ...EMPLOYEE_STAGE_OPTIONS], onChange: (v) => { setStageFilter(v); setPage(1); } },
          { key: 'pos', value: staffGroupFilter, width: 175, options: [{ value: 'ALL', label: 'Tất cả vị trí' }, ...jobPositionOptions], onChange: (v) => { setStaffGroupFilter(v); setPage(1); } },
          { key: 'contract', value: contractFilter, width: 205, options: CONTRACT_FILTER_OPTIONS, onChange: (v) => setContractFilter(v) },
        ]}
        onRefresh={refreshAll} refreshing={empQ.isFetching} onExportExcel={() => exportRows(rows)}
        primaryActionLabel={canManage ? 'Tải lên hợp đồng' : undefined}
        onPrimaryAction={canManage ? () => { setUploadPresetEmp(null); setUploadModalOpen(true); } : undefined}
      />

      <DataTableCard<EmployeeRowItem>
        dataSource={rows} meta={empQ.data?.meta} loading={empQ.isLoading || empQ.isFetching}
        codeExtractor={(r) => r.employeeCode} onPageChange={(p, ps) => { setPage(p); setPerPage(ps); }}
        onRowClick={setDetailEmp}
        bulkActions={[
          ...(canManage ? [
            { key: 'meet', label: 'Xác nhận Vấn đáp Meet đã chọn', type: 'primary' as const, icon: <VideoCameraOutlined />, eligibleFilter: (r: EmployeeRowItem) => r.stage === 'PROBATION' && !r.probationMeetDone, onClick: (sel: EmployeeRowItem[], clr: () => void) => promptMeetEval(sel, clr) },
            { key: 'leave', label: 'Cấp quyền nghỉ đột xuất đã chọn', icon: <PlusCircleOutlined />, eligibleFilter: (r: EmployeeRowItem) => r.stage === 'PROBATION', onClick: (sel: EmployeeRowItem[], clr: () => void) => promptGrantLeave(sel, clr) },
          ] : []),
          { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (sel) => exportRows(sel) },
        ]}
        columns={[
          { title: 'Nhân sự & Vị trí', key: 'emp', width: 215, render: (_, r) => <div><Typography.Text strong>{r.fullName}</Typography.Text><div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{r.staffGroupLabel} · {r.branchName}</div></div> },
          { title: 'Giai đoạn & Thời hạn', key: 'stage', width: 170, render: (_, r) => <div><StatusTag value={r.stage} /><div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>{r.stage === 'OFFICIAL' && r.officialFrom ? `Chính thức: ${r.officialFrom}` : r.probationStart ? `Thử việc: ${r.probationStart}` : `Chu kỳ ${r.probationCycleDays} ngày`}</div></div> },
          {
            title: 'Hợp đồng Lao động đã lưu', key: 'contracts',
            render: (_, r) => {
              const list = r.contracts ?? [];
              return list.length === 0 ? <Tag color="default">Chưa tải lên hợp đồng</Tag> : (
                <Space size={4} wrap>
                  <Tag color="geekblue" icon={<FileProtectOutlined />} style={{ margin: 0, fontWeight: 600 }}>{list.length} văn bản</Tag>
                  {list.slice(0, 2).map((c) => <Tag key={c.id} color={c.contractType === 'OFFICIAL_CONTRACT' ? 'green' : 'gold'} icon={<FileTextOutlined />} style={{ margin: 0 }}>{CONTRACT_TYPE_LABELS[c.contractType] || c.contractType}</Tag>)}
                </Space>
              );
            },
          },
          {
            title: 'Tiến độ Đánh giá Thử việc', key: 'probationEval', width: 235,
            render: (_, r) => <Space size={4} wrap><Tag color={(r.probationHoursCompleted ?? 0) >= 15 ? 'success' : 'processing'} style={{ margin: 0 }}>Công: {r.probationHoursCompleted ?? 0}h</Tag><Tag color={r.testPassed ? 'success' : 'warning'} style={{ margin: 0 }}>TEST: {r.testBestScorePercent ?? 0}%</Tag><Tag color={r.probationMeetDone ? 'success' : 'default'} icon={<VideoCameraOutlined />} style={{ margin: 0 }}>{r.probationMeetDone ? 'Đã vấn đáp' : 'Chưa vấn đáp'}</Tag></Space>,
          },
          { title: 'Điểm Tín nhiệm', key: 'credit', width: 135, render: (_, r) => { const pts = r.attendanceCreditPoints ?? 100; return <Tag color={pts >= 95 ? 'success' : pts >= 80 ? 'warning' : 'error'} icon={<CheckCircleOutlined />} style={{ margin: 0, fontWeight: 600 }}>{pts}/100 điểm</Tag>; } },
          {
            title: 'Thao tác', key: 'action', width: 88, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem chi tiết hợp đồng & đánh giá thử việc" onViewDetail={() => setDetailEmp(r)}
                menuItems={[
                  ...(canManage ? [{ key: 'upload', icon: <CloudUploadOutlined style={{ color: '#2563EB' }} />, label: 'Tải lên hợp đồng mới', onClick: () => { setUploadPresetEmp(r); setUploadModalOpen(true); } }] : []),
                  ...(canManage && r.stage === 'PROBATION' ? [
                    { key: 'meet', icon: <VideoCameraOutlined style={{ color: '#2563EB' }} />, label: 'Ghi nhận kết quả Vấn đáp Meet', onClick: () => promptMeetEval([r]) },
                    { key: 'leave', icon: <PlusCircleOutlined />, label: 'Cấp 1 lượt nghỉ đột xuất', onClick: () => promptGrantLeave([r]) },
                  ] : []),
                  ...(canPromote && r.stage === 'PROBATION' ? [{ key: 'promote', icon: <RiseOutlined style={{ color: '#16A34A' }} />, label: 'Chuyển lên Chính thức', onClick: () => setPromotingRow(r) }] : []),
                ]}
              />
            ),
          },
        ]}
      />

      <BaseDetailDrawer
        open={Boolean(liveDetailEmp)} title={liveDetailEmp ? `Hợp đồng & Đánh giá Thử việc: ${liveDetailEmp.fullName} (${liveDetailEmp.employeeCode})` : 'Chi tiết hợp đồng'}
        onClose={() => setDetailEmp(null)}
        extra={liveDetailEmp && (
          <Space size={6} wrap>
            {canManage && <Button size="small" type="primary" ghost icon={<CloudUploadOutlined />} onClick={() => { setUploadPresetEmp(liveDetailEmp); setUploadModalOpen(true); }}>Tải lên hợp đồng</Button>}
            {canPromote && liveDetailEmp.stage === 'PROBATION' && <Button size="small" type="primary" icon={<RiseOutlined />} onClick={() => setPromotingRow(liveDetailEmp)}>Chuyển Chính thức</Button>}
          </Space>
        )}
      >
        {liveDetailEmp && <EmployeeContractStorePanel employee={liveDetailEmp} canManage={canManage} />}
      </BaseDetailDrawer>

      <ContractUploadModal open={uploadModalOpen} presetEmployee={uploadPresetEmp} employeeOptions={employeeOptions} onClose={() => { setUploadModalOpen(false); setUploadPresetEmp(null); }} />
      <PromoteOfficialModal employee={promotingRow} loading={promoteSingle.isPending} onClose={() => setPromotingRow(null)} onConfirm={(v) => promotingRow && promoteSingle.mutate({ row: promotingRow, ...v })} />
      {decisionModalElement}
    </Space>
  );
}
