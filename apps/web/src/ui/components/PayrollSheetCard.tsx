'use client';

import { useMemo, useState } from 'react';
import { Button, Card, Flex, Input, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { EyeOutlined, SearchOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { allowancesOf, bonusesOf, deductionsOf, fmtVnd, type PayPeriodRow, type PayrollSnapshotItem } from './payroll-types';

const sum = (rows: PayrollSnapshotItem[], f: (r: PayrollSnapshotItem) => number) => rows.reduce((s, r) => s + f(r), 0);

/** Xuất Bảng lương tổng hợp chuẩn kế toán (tách lương thử việc / chính thức, OT, phụ cấp, thưởng, khấu trừ) */
export function exportPayrollSheet(period: PayPeriodRow, rows: PayrollSnapshotItem[]) {
  exportToExcel({
    fileName: `Bang_Luong_${period.period_code}_${dayjs().format('YYYYMMDD')}.xls`,
    sheetTitle: `BẢNG TỔNG HỢP LƯƠNG & THƯỞNG — ${period.name} (${period.from_date} đến ${period.to_date})`,
    subtitle: `Trạng thái: ${period.statusLabel} | Tổng nhân sự: ${rows.length} | Tổng thực lĩnh: ${fmtVnd(period.total_net_vnd)}`,
    columns: [
      { header: 'Mã NV', key: 'employeeCode' },
      { header: 'Họ và tên', key: 'fullName' },
      { header: 'Chi nhánh', key: 'branchName' },
      { header: 'Hình thức lương', key: 'rateTypeLabel' },
      { header: 'Lương chính thức', key: 'rateVnd', isCurrency: true },
      { header: 'Giờ thử việc', key: 'probationHours', align: 'right' },
      { header: 'Lương thử việc', key: 'probationPayVnd', isCurrency: true },
      { header: 'Giờ chính thức', key: 'officialHours', align: 'right' },
      { header: 'Lương chính thức (kỳ)', key: 'officialPayVnd', isCurrency: true },
      { header: 'Tăng ca', key: 'otPayVnd', isCurrency: true },
      { header: 'Phụ cấp', render: allowancesOf, isCurrency: true },
      { header: 'Thưởng', render: bonusesOf, isCurrency: true },
      { header: 'Khấu trừ', render: deductionsOf, isCurrency: true },
      { header: 'Tổng thu nhập', key: 'grossVnd', isCurrency: true },
      { header: 'THỰC LĨNH', key: 'netVnd', isCurrency: true },
      { header: 'Ngân hàng', key: 'bankName' },
      { header: 'Số tài khoản', key: 'bankAccountNumber' },
    ],
    rows,
    summaryRow: [
      'TỔNG CỘNG', `${rows.length} nhân sự`, '', '', '',
      sum(rows, (r) => r.probationHours), sum(rows, (r) => r.probationPayVnd), sum(rows, (r) => r.officialHours), sum(rows, (r) => r.officialPayVnd),
      sum(rows, (r) => r.otPayVnd), sum(rows, allowancesOf), sum(rows, bonusesOf), sum(rows, deductionsOf), sum(rows, (r) => r.grossVnd), sum(rows, (r) => r.netVnd), '', '',
    ],
  });
}

export function PayrollSheetCard({ rows, loading, onOpenPayslip }: { rows: PayrollSnapshotItem[]; loading?: boolean; onOpenPayslip: (r: PayrollSnapshotItem) => void }) {
  const [searchInput, setSearchInput] = useState('');
  const debouncedQ = useDebouncedValue(searchInput, 400);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [rateFilter, setRateFilter] = useState('ALL');

  const branchOptions = useMemo(() => {
    const names = Array.from(new Set(rows.map((r) => r.branchName).filter(Boolean)));
    return [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...names.map((n) => ({ value: n, label: n }))];
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = debouncedQ.trim().toLowerCase();
    return rows.filter((r) => {
      if (branchFilter !== 'ALL' && r.branchName !== branchFilter) return false;
      if (rateFilter !== 'ALL' && r.rateType !== rateFilter) return false;
      if (q && !`${r.employeeCode} ${r.fullName} ${r.branchName} ${r.stageLabel}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, branchFilter, rateFilter, debouncedQ]);

  return (
    <Card
      size="small"
      styles={{ body: { padding: 16 } }}
      title={<Typography.Text strong>Bảng lương chi tiết từng nhân sự ({filteredRows.length})</Typography.Text>}
    >
      <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '12px 16px', marginBottom: 14 }}>
        <Flex justify="space-between" align="center" wrap gap={12}>
          <Space size={10} wrap>
            <Input allowClear prefix={<SearchOutlined style={{ color: '#94A3B8' }} />} placeholder="Tìm tên, mã NV, chi nhánh..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ width: 250 }} />
            <Select value={branchFilter} onChange={setBranchFilter} style={{ width: 205 }} options={branchOptions} />
            <Select value={rateFilter} onChange={setRateFilter} style={{ width: 185 }} options={[{ value: 'ALL', label: 'Mọi hình thức lương' }, { value: 'HOURLY', label: 'Theo giờ' }, { value: 'MONTHLY', label: 'Theo tháng' }, { value: 'SHIFT', label: 'Theo ca' }]} />
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Hiển thị <strong>{filteredRows.length}</strong> / {rows.length} nhân sự
          </Typography.Text>
        </Flex>
      </div>
      <Table<PayrollSnapshotItem>
        size="small" rowKey="id" loading={loading} dataSource={filteredRows}
        pagination={{ pageSize: 12, showSizeChanger: true, pageSizeOptions: ['12', '24', '50', '100'], showTotal: (t) => `Tổng ${t} nhân sự` }}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: 'Nhân sự', key: 'emp', fixed: 'left',
            render: (_, r) => (
              <div>
                <Space size={6}>
                  <Tag color="geekblue" style={{ margin: 0, borderRadius: 2 }}>{r.employeeCode}</Tag>
                  <Typography.Text strong>{r.fullName}</Typography.Text>
                  {(!r.hasSalaryProfile || r.missingProfileShifts > 0) && <Tooltip title="Chưa thiết lập hồ sơ lương hoặc có ca ngoài thời gian hiệu lực"><WarningOutlined style={{ color: '#D97706' }} /></Tooltip>}
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
                  <div style={{ fontSize: 11, color: '#15803D' }}>
                    Điểm danh: {r.checkedInShiftsCount ?? 0} ca{(r.adjustedShiftsCount ?? 0) > 0 ? ` · Bổ sung: ${r.adjustedShiftsCount}` : ''}
                  </div>
                )}
                {((r.leaveOffCount ?? 0) > 0 || r.shiftSwapCount > 0 || (r.swappedOutCount ?? 0) > 0) && (
                  <div style={{ fontSize: 11, color: '#2563EB' }}>
                    {[
                      (r.leaveOffCount ?? 0) > 0 ? `Nghỉ OFF: ${r.leaveOffCount}` : '',
                      r.shiftSwapCount > 0 ? `Nhận đổi: +${r.shiftSwapCount}ca` : '',
                      (r.swappedOutCount ?? 0) > 0 ? `Chuyển ca: -${r.swappedOutCount}ca` : '',
                    ].filter(Boolean).join(' · ')}
                  </div>
                )}
                {(r.lateCount ?? 0) > 0 && (
                  <div style={{ fontSize: 11, color: '#D97706' }}>Đi trễ: {r.lateCount} lần ({r.lateMinutesTotal ?? 0}p)</div>
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
            title: 'Thao tác', key: 'act', width: 70, align: 'center', fixed: 'right',
            render: (_, r) => <Tooltip title="Xem chi tiết phiếu lương"><Button size="small" icon={<EyeOutlined />} onClick={() => onOpenPayslip(r)} /></Tooltip>,
          },
        ]}
        summary={() =>
          filteredRows.length > 0 ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={3}><strong>TỔNG CỘNG ({filteredRows.length} nhân sự)</strong></Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right"><span className="num">{fmtVnd(sum(filteredRows, (r) => r.probationPayVnd))}</span></Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right"><span className="num">{fmtVnd(sum(filteredRows, (r) => r.officialPayVnd))}</span></Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right"><span className="num">{fmtVnd(sum(filteredRows, (r) => r.otPayVnd))}</span></Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right"><span className="num">{fmtVnd(sum(filteredRows, allowancesOf))}</span></Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right"><span className="num">{fmtVnd(sum(filteredRows, bonusesOf))}</span></Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right"><span className="num">{fmtVnd(sum(filteredRows, deductionsOf))}</span></Table.Summary.Cell>
              <Table.Summary.Cell index={7} align="right"><span className="num" style={{ fontWeight: 800, color: '#2563EB' }}>{fmtVnd(sum(filteredRows, (r) => r.netVnd))}</span></Table.Summary.Cell>
              <Table.Summary.Cell index={8} />
            </Table.Summary.Row>
          ) : null
        }
      />
    </Card>
  );
}
