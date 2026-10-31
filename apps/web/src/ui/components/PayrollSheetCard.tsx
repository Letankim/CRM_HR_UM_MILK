'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Flex, Input, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { DownloadOutlined, EditOutlined, EyeOutlined, MessageOutlined, SearchOutlined, WarningOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { SelectableTable } from './BulkActionBar';
import { exportPayrollSheet, PayrollConfirmationCell } from './payroll-sheet-helpers';
import { PayrollMissingShiftsModal } from './PayrollMissingShiftsModal';
import { RowActionButtons } from './RowActionButtons';
import { allowancesOf, bonusesOf, deductionsOf, fmtVnd, type MissingShiftDetailItem, type PayPeriodRow, type PayrollSnapshotItem } from './payroll-types';

export { exportPayrollSheet };

const sum = (rows: PayrollSnapshotItem[], f: (r: PayrollSnapshotItem) => number) => rows.reduce((s, r) => s + f(r), 0);

export function PayrollSheetCard({ period, onOpenPayslip }: { period: PayPeriodRow; onOpenPayslip: (r: PayrollSnapshotItem) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const can = useCan();
  const canManage = can('payroll.manage');
  const [searchInput, setSearchInput] = useState('');
  const debouncedQ = useDebouncedValue(searchInput, 400);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [rateFilter, setRateFilter] = useState('ALL');
  const [confirmFilter, setConfirmFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(12);
  const [missingModalOpen, setMissingModalOpen] = useState(false);
  const [inspectEmp, setInspectEmp] = useState<PayrollSnapshotItem | null>(null);

  useEffect(() => { setPage(1); }, [period.id, branchFilter, rateFilter, confirmFilter, debouncedQ]);

  const branchesQ = useQuery({
    queryKey: ['branches', 'select'],
    queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=100'),
  });
  const branchOptions = useMemo(
    () => [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...(branchesQ.data?.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))],
    [branchesQ.data?.data],
  );

  const queryParams = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (branchFilter !== 'ALL') sp.set('branch_id', branchFilter);
    if (rateFilter !== 'ALL') sp.set('rate_type', rateFilter);
    if (confirmFilter !== 'ALL') sp.set('confirm_status', confirmFilter);
    if (debouncedQ.trim()) sp.set('q', debouncedQ.trim());
    return sp.toString();
  }, [page, perPage, branchFilter, rateFilter, confirmFilter, debouncedQ]);

  const snapshotsQ = useQuery({
    queryKey: ['payroll-snapshots', period.id, queryParams],
    queryFn: () => api.list<PayrollSnapshotItem>(`/admin/payroll/periods/${period.id}/snapshots?${queryParams}`),
  });

  const rows = snapshotsQ.data?.data ?? [];
  const totalCount = snapshotsQ.data?.meta.pagination.total ?? rows.length;
  const freshPeriod = snapshotsQ.data?.meta.filters?.period as PayPeriodRow | undefined;
  useEffect(() => {
    if (
      freshPeriod &&
      (freshPeriod.version !== period.version ||
        freshPeriod.unreconciled_records_count !== period.unreconciled_records_count ||
        freshPeriod.confirmed_count !== period.confirmed_count ||
        freshPeriod.disputed_count !== period.disputed_count)
    ) {
      qc.invalidateQueries({ queryKey: ['payroll-periods'] });
    }
  }, [freshPeriod, period.version, period.unreconciled_records_count, period.confirmed_count, period.disputed_count, qc]);
  const summary = (snapshotsQ.data?.meta.filters?.summary ?? {}) as Record<string, number>;
  const totalMissing = Number(summary.totalMissingPunches ?? 0);
  const allMissingShifts = useMemo(
    () => (Array.isArray((summary as Record<string, unknown>).allMissingShifts) ? ((summary as Record<string, unknown>).allMissingShifts as MissingShiftDetailItem[]) : rows.flatMap((r) => r.missingShifts ?? [])),
    [summary, rows],
  );
  const openEmpMissing = (r: PayrollSnapshotItem) => { setInspectEmp(r); setMissingModalOpen(true); };

  return (
    <Card
      size="small" styles={{ body: { padding: 16 } }}
      title={<Typography.Text strong>Bảng lương chi tiết từng nhân sự ({totalCount})</Typography.Text>}
      extra={totalMissing > 0 ? <Button size="small" danger icon={<EyeOutlined />} onClick={() => { setInspectEmp(null); setMissingModalOpen(true); }}>Có {totalMissing} ca thiếu Vào/Ra · Xem chi tiết</Button> : null}
    >
      <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '12px 16px', marginBottom: 14 }}>
        <Flex justify="space-between" align="center" wrap gap={12}>
          <Space size={10} wrap>
            <Input allowClear prefix={<SearchOutlined style={{ color: '#94A3B8' }} />} placeholder="Tìm tên, mã NV, chi nhánh..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ width: 230 }} />
            <Select value={branchFilter} onChange={setBranchFilter} style={{ width: 205 }} options={branchOptions} />
            <Select value={rateFilter} onChange={setRateFilter} style={{ width: 175 }} options={[{ value: 'ALL', label: 'Mọi hình thức lương' }, { value: 'HOURLY', label: 'Theo giờ' }, { value: 'MONTHLY', label: 'Theo tháng' }, { value: 'SHIFT', label: 'Theo ca' }]} />
            <Select
              value={confirmFilter} onChange={setConfirmFilter} style={{ width: 230 }}
              options={[
                { value: 'ALL', label: 'Mọi trạng thái xác nhận NV' },
                { value: 'CONFIRMED', label: 'Đã xác nhận đồng ý' },
                { value: 'UNCONFIRMED', label: 'Chưa xác nhận (Còn điều chỉnh)' },
                { value: 'DISPUTED', label: 'Đang gửi thắc mắc' },
              ]}
            />
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Tổng cộng <strong>{totalCount}</strong> nhân sự phù hợp bộ lọc
          </Typography.Text>
        </Flex>
      </div>
      <SelectableTable<PayrollSnapshotItem>
        size="small" rowKey="id" loading={snapshotsQ.isLoading || snapshotsQ.isFetching} dataSource={rows}
        bulkActions={[{ key: 'export', label: 'Xuất Excel nhân sự đã chọn', icon: <DownloadOutlined />, onClick: (sel) => exportPayrollSheet(period, sel) }]}
        pagination={{
          current: page, pageSize: perPage, total: totalCount,
          showSizeChanger: true, pageSizeOptions: ['10', '12', '15', '20', '50', '100'],
          showTotal: (t) => `Tổng ${t} nhân sự`,
          onChange: (p, ps) => { setPage(ps !== perPage ? 1 : p); setPerPage(ps); },
        }}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: 'Nhân sự', key: 'emp', fixed: 'left',
            render: (_, r) => (
              <div>
                <Space size={6} wrap>
                  <Tag color="geekblue" style={{ margin: 0, borderRadius: 2 }}>{r.employeeCode}</Tag>
                  <Typography.Text strong>{r.fullName}</Typography.Text>
                  {(!r.hasSalaryProfile || r.missingProfileShifts > 0) && <Tooltip title="Chưa thiết lập hồ sơ lương hoặc có ca ngoài thời gian hiệu lực"><WarningOutlined style={{ color: '#D97706' }} /></Tooltip>}
                  {!r.employeeConfirmedAt && r.disputeStatus === 'OPEN' && (
                    <Tooltip title={r.disputeReason ? `Thắc mắc: ${r.disputeReason} (Bấm để mở Trung tâm Phiếu hỗ trợ)` : 'Nhân sự đang gửi thắc mắc phiếu lương'}>
                      <Tag color="volcano" icon={<MessageOutlined />} style={{ margin: 0, cursor: 'pointer', fontSize: 11 }} onClick={() => router.push('/admin/tickets')}>
                        Thắc mắc{r.disputeTicketCode ? ` ${r.disputeTicketCode}` : ''}
                      </Tag>
                    </Tooltip>
                  )}
                </Space>
                <div style={{ fontSize: 12, color: '#64748B' }}>{r.branchName} · {r.stageLabel}</div>
              </div>
            ),
          },
          { title: 'Hình thức / Mức lương', key: 'rate', render: (_, r) => <div><Tag color={r.rateType === 'MONTHLY' ? 'purple' : r.rateType === 'SHIFT' ? 'cyan' : 'blue'} style={{ borderRadius: 2, margin: 0 }}>{r.rateTypeLabel}</Tag><div className="num" style={{ fontSize: 12, marginTop: 2 }}>{fmtVnd(r.rateVnd)}/{r.unitLabel}{r.probationPercent ? ` · TV ${r.probationPercent}%` : ''}</div></div> },
          {
            title: 'Công & Chấm công', key: 'work', align: 'right',
            render: (_, r) => (
              <div className="num">
                <strong>{r.approvedHours} giờ</strong>
                <div style={{ fontSize: 12, color: '#64748B' }}>{r.totalShiftsCount} ca · {r.workedDays} ngày</div>
                {((r.checkedInShiftsCount ?? 0) > 0 || (r.adjustedShiftsCount ?? 0) > 0) && (
                  <div style={{ fontSize: 11, color: '#15803D' }}>Điểm danh: {r.checkedInShiftsCount ?? 0} ca{(r.adjustedShiftsCount ?? 0) > 0 ? ` · Bổ sung: ${r.adjustedShiftsCount}` : ''}</div>
                )}
                {((r.leaveOffCount ?? 0) > 0 || r.shiftSwapCount > 0 || (r.swappedOutCount ?? 0) > 0) && (
                  <div style={{ fontSize: 11, color: '#2563EB' }}>
                    {[(r.leaveOffCount ?? 0) > 0 ? `Nghỉ OFF: ${r.leaveOffCount}` : '', r.shiftSwapCount > 0 ? `Nhận đổi: +${r.shiftSwapCount}ca` : '', (r.swappedOutCount ?? 0) > 0 ? `Chuyển ca: -${r.swappedOutCount}ca` : ''].filter(Boolean).join(' · ')}
                  </div>
                )}
                {(r.lateCount ?? 0) > 0 && <div style={{ fontSize: 11, color: '#D97706' }}>Đi trễ: {r.lateCount} lần ({r.lateMinutesTotal ?? 0}p)</div>}
                {((r.missingCheckoutCount ?? 0) > 0 || (r.pendingAdjCount ?? 0) > 0) && (
                  <div style={{ marginTop: 3 }}>
                    <Tag color="red" icon={<WarningOutlined />} style={{ margin: 0, cursor: 'pointer', fontSize: 11 }} onClick={() => openEmpMissing(r)}>Thiếu Vào/Ra: {r.missingCheckoutCount ?? 0} ca · Xem chi tiết</Tag>
                  </div>
                )}
              </div>
            ),
          },
          { title: 'Lương thử việc', dataIndex: 'probationPayVnd', align: 'right', render: (v: number, r) => <span className="num">{fmtVnd(v)}<div style={{ fontSize: 12, color: '#64748B' }}>{r.probationHours} giờ</div></span> },
          { title: 'Lương chính thức', dataIndex: 'officialPayVnd', align: 'right', render: (v: number, r) => <span className="num">{fmtVnd(v)}<div style={{ fontSize: 12, color: '#64748B' }}>{r.officialHours} giờ</div></span> },
          { title: 'Tăng ca', dataIndex: 'otPayVnd', align: 'right', render: (v: number) => <span className="num">{fmtVnd(v)}</span> },
          { title: 'Phụ cấp', key: 'allw', align: 'right', render: (_, r) => <span className="num">{fmtVnd(allowancesOf(r))}</span> },
          { title: 'Thưởng', key: 'bonus', align: 'right', render: (_, r) => <span className="num" style={{ color: '#15803D', fontWeight: 600 }}>{fmtVnd(bonusesOf(r))}</span> },
          { title: 'Khấu trừ', key: 'ded', align: 'right', render: (_, r) => <span className="num" style={{ color: '#DC2626' }}>{fmtVnd(deductionsOf(r))}</span> },
          { title: 'Thực lĩnh', dataIndex: 'netVnd', align: 'right', render: (v: number) => <span className="num" style={{ color: '#2563EB', fontWeight: 800 }}>{fmtVnd(v)}</span> },
          {
            title: 'Xác nhận của NV', key: 'confirm', width: 175,
            render: (_, r) => <PayrollConfirmationCell row={r} periodStatus={period.status} onOpenTickets={() => router.push('/admin/tickets')} />,
          },
          {
            title: 'Thao tác', key: 'act', width: 92, align: 'right', fixed: 'right',
            render: (_, r) => {
              const canAdj = canManage && period.status !== 'PAID' && r.payslipStatus !== 'PAID' && !r.employeeConfirmedAt && r.canAdjust !== false;
              return (
                <RowActionButtons
                  detailTooltip="Xem chi tiết phiếu lương" onViewDetail={() => onOpenPayslip(r)}
                  menuItems={canAdj ? [{ key: 'adjust', icon: <EditOutlined />, label: 'Điều chỉnh phiếu lương', onClick: () => onOpenPayslip(r) }] : []}
                />
              );
            },
          },
        ]}
        summary={() =>
          rows.length > 0 ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}><strong>TỔNG CỘNG ({totalCount} nhân sự)</strong></Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right"><span className="num">{fmtVnd(summary.probationPayVnd ?? sum(rows, (r) => r.probationPayVnd))}</span></Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right"><span className="num">{fmtVnd(summary.officialPayVnd ?? sum(rows, (r) => r.officialPayVnd))}</span></Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right"><span className="num">{fmtVnd(summary.otPayVnd ?? sum(rows, (r) => r.otPayVnd))}</span></Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right"><span className="num">{fmtVnd(summary.allowancesVnd ?? sum(rows, allowancesOf))}</span></Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right"><span className="num">{fmtVnd(summary.bonusesVnd ?? sum(rows, bonusesOf))}</span></Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right"><span className="num">{fmtVnd(summary.deductionsVnd ?? sum(rows, deductionsOf))}</span></Table.Summary.Cell>
              <Table.Summary.Cell index={7} align="right"><span className="num" style={{ fontWeight: 800, color: '#2563EB' }}>{fmtVnd(summary.netVnd ?? sum(rows, (r) => r.netVnd))}</span></Table.Summary.Cell>
              <Table.Summary.Cell index={8}><span className="num" style={{ fontSize: 12, color: '#15803D', fontWeight: 600 }}>{summary.confirmedCount ?? rows.filter((r) => Boolean(r.employeeConfirmedAt)).length}/{summary.totalEmployees ?? totalCount} đã XN</span></Table.Summary.Cell>
              <Table.Summary.Cell index={9} />
            </Table.Summary.Row>
          ) : null
        }
      />
      <PayrollMissingShiftsModal open={missingModalOpen} period={period} selectedEmployee={inspectEmp} allMissingShifts={allMissingShifts} onClose={() => setMissingModalOpen(false)} onShowAll={() => setInspectEmp(null)} onOpenPayslip={onOpenPayslip} />
    </Card>
  );
}
