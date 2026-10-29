'use client';

import { Alert, Badge, Button, Card, Col, Empty, Flex, Input, Row, Select, Space, Statistic, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, DownloadOutlined, EyeOutlined, FileExcelOutlined,
  SafetyCertificateOutlined, SearchOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { StatusTag } from '../StatusTag';
import { SelectableTable } from './BulkActionBar';
import { PayrollMissingShiftsModal } from './PayrollMissingShiftsModal';
import { RowActionButtons } from './RowActionButtons';
import { type MissingShiftDetailItem, type PayPeriodRow, type PayrollSnapshotItem } from './payroll-types';

interface Props {
  period: PayPeriodRow;
  onOpenPayslip: (row: PayrollSnapshotItem) => void;
}

/**
 * Bảng chấm công tổng hợp & Đối soát công trước chốt lương.
 * Chỉ dùng dữ liệu công đã xác nhận, phát hiện thiếu vào/ra ca, đi trễ và phiếu điều chỉnh chờ duyệt.
 */
export function PayrollAttendanceReconcileCard({ period, onOpenPayslip }: Props) {
  const [searchInput, setSearchInput] = useState('');
  const debouncedQ = useDebouncedValue(searchInput, 400);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [anomalyFilter, setAnomalyFilter] = useState<'ALL' | 'ANOMALY' | 'CLEAN'>('ALL');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(12);
  const [missingModalOpen, setMissingModalOpen] = useState(false);
  const [inspectEmp, setInspectEmp] = useState<PayrollSnapshotItem | null>(null);

  useEffect(() => { setPage(1); }, [period.id, branchFilter, anomalyFilter, debouncedQ]);

  const branchesQ = useQuery({
    queryKey: ['branches-select'],
    queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=100'),
  });
  const branches = useMemo(
    () => [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...(branchesQ.data?.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))],
    [branchesQ.data?.data],
  );

  const queryParams = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (branchFilter !== 'ALL') sp.set('branch_id', branchFilter);
    if (anomalyFilter !== 'ALL') sp.set('anomaly', anomalyFilter);
    if (debouncedQ.trim()) sp.set('q', debouncedQ.trim());
    return sp.toString();
  }, [page, perPage, branchFilter, anomalyFilter, debouncedQ]);

  const snapshotsQ = useQuery({
    queryKey: ['payroll-reconcile', period.id, queryParams],
    queryFn: () => api.list<PayrollSnapshotItem>(`/admin/payroll/periods/${period.id}/snapshots?${queryParams}`),
  });

  const rows = snapshotsQ.data?.data ?? [];
  const totalCount = snapshotsQ.data?.meta.pagination.total ?? rows.length;
  const summary = (snapshotsQ.data?.meta.filters?.summary ?? {}) as Record<string, unknown>;
  const totalPendingAdjs = Number(summary.totalPendingAdjs ?? 0);
  const totalMissingPunches = Number(summary.totalMissingPunches ?? 0);
  const totalApprovedHours = Number(summary.totalApprovedHours ?? period.total_approved_hours ?? 0);
  const allMissingShifts = useMemo(
    () => (Array.isArray(summary.allMissingShifts) ? (summary.allMissingShifts as MissingShiftDetailItem[]) : rows.flatMap((r) => r.missingShifts ?? [])),
    [summary.allMissingShifts, rows],
  );
  const openEmployeeMissing = (r: PayrollSnapshotItem) => { setInspectEmp(r); setMissingModalOpen(true); };
  const openAllMissing = () => { setInspectEmp(null); setMissingModalOpen(true); };

  const handleExport = async () => {
    const sp = new URLSearchParams({ page: '1', per_page: '500' });
    if (branchFilter !== 'ALL') sp.set('branch_id', branchFilter);
    if (anomalyFilter !== 'ALL') sp.set('anomaly', anomalyFilter);
    if (debouncedQ.trim()) sp.set('q', debouncedQ.trim());
    const res = await api.list<PayrollSnapshotItem>(`/admin/payroll/periods/${period.id}/snapshots?${sp.toString()}`);
    exportToExcel({
      fileName: `UB_Bang_Cham_Cong_Doi_Soat_${period.period_code ?? 'KY_LUONG'}.xls`,
      sheetTitle: `BẢNG CHẤM CÔNG & ĐỐI SOÁT CÔNG KỲ LƯƠNG — ${period.name ?? ''}`,
      subtitle: `Từ ${period.from_date ?? ''} đến ${period.to_date ?? ''} · Chỉ tính lương trên dữ liệu công đã xác nhận`,
      columns: [
        { header: 'Mã NV', key: 'employeeCode' },
        { header: 'Họ và tên', key: 'fullName' },
        { header: 'Chi nhánh', key: 'branchName' },
        { header: 'Số ca công', key: 'totalShiftsCount', align: 'right' },
        { header: 'Giờ tiêu chuẩn', key: 'standardHours', align: 'right' },
        { header: 'Giờ thực tế xác nhận', key: 'actualHours', align: 'right' },
        { header: 'Giờ thử việc', key: 'probationHours', align: 'right' },
        { header: 'Giờ chính thức', key: 'officialHours', align: 'right' },
        { header: 'Giờ OT', key: 'otHours', align: 'right' },
        { header: 'Lượt đi trễ', key: 'lateCount', align: 'right' },
        { header: 'Thiếu Vào/Ra hoặc Vắng', key: 'missingCheckoutCount', align: 'right' },
        { header: 'Đơn bù công chờ duyệt', key: 'pendingAdjCount', align: 'right' },
        { header: 'Trạng thái đối soát', key: 'reconcileStatus' },
      ],
      rows: res.data.map((r) => ({
        ...r,
        reconcileStatus: r.hasAnomaly ? 'Cần kiểm tra bổ sung công' : 'Đã khớp công hợp lệ',
      })),
    });
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Nhân sự trong bảng công" value={totalCount} suffix="NV" /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Tổng giờ công tính lương" value={totalApprovedHours} suffix="giờ" prefix={<ClockCircleOutlined />} /></Card></Col>
        <Col xs={12} md={6}>
          <Card size="small" hoverable={totalMissingPunches > 0} onClick={totalMissingPunches > 0 ? openAllMissing : undefined}>
            <Statistic title="Ca thiếu Vào/Ra hoặc Vắng" value={totalMissingPunches} suffix={totalMissingPunches > 0 ? 'ca (Xem chi tiết)' : 'ca'} formatter={(v) => <span style={{ color: totalMissingPunches > 0 ? '#DC2626' : '#16A34A' }}>{v}</span>} prefix={<WarningOutlined style={{ color: totalMissingPunches > 0 ? '#DC2626' : '#16A34A' }} />} />
          </Card>
        </Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Phiếu điều chỉnh chờ duyệt" value={totalPendingAdjs} formatter={(v) => <span style={{ color: totalPendingAdjs > 0 ? '#D97706' : '#16A34A' }}>{v}</span>} prefix={<SafetyCertificateOutlined style={{ color: totalPendingAdjs > 0 ? '#D97706' : '#16A34A' }} />} /></Card></Col>
      </Row>

      {(totalPendingAdjs > 0 || totalMissingPunches > 0) && (
        <Alert
          type="warning" showIcon
          message="Phát hiện dữ liệu chấm công cần đối soát trước khi khóa sổ lương"
          action={
            <Button size="small" type="primary" danger icon={<EyeOutlined />} onClick={openAllMissing}>
              Xem chi tiết ca thiếu ({allMissingShifts.length || totalMissingPunches} ca)
            </Button>
          }
          description={
            <span>
              Hệ thống ghi nhận <strong>{totalMissingPunches} ca thiếu lượt Vào/Ra ca hoặc vắng</strong> và <strong>{totalPendingAdjs} phiếu điều chỉnh công đang chờ duyệt</strong>. Nhấn <strong>Xem chi tiết ca thiếu</strong> để biết cụ thể nhân sự nào đang thiếu ca ngày nào, khung giờ nào để báo Cửa hàng / HR xử lý tại mục{' '}
              <Link href="/admin/schedules?section=workflows"><strong>Đơn từ &amp; Điều chỉnh công</strong></Link>.
            </span>
          }
        />
      )}

      <Card size="small">
        <Flex justify="space-between" align="center" wrap gap={10} style={{ marginBottom: 12 }}>
          <Space wrap size={8}>
            <Input allowClear prefix={<SearchOutlined style={{ color: '#94A3B8' }} />} placeholder="Tìm mã NV, họ tên..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ width: 220 }} />
            <Select value={branchFilter} onChange={setBranchFilter} style={{ width: 210 }} options={branches} />
            <Select
              value={anomalyFilter} onChange={setAnomalyFilter} style={{ width: 220 }}
              options={[
                { value: 'ALL', label: 'Tất cả trạng thái đối soát' },
                { value: 'ANOMALY', label: 'Có bất thường / Đi trễ / Chờ bù công' },
                { value: 'CLEAN', label: 'Đã khớp công 100% (Hợp lệ)' },
              ]}
            />
          </Space>
          <Space wrap size={8}>
            <Link href="/admin/schedules?section=workflows"><Button icon={<SafetyCertificateOutlined />}>Mở phiếu Điều chỉnh công</Button></Link>
            <Button icon={<FileExcelOutlined style={{ color: '#15803D' }} />} onClick={() => void handleExport()}>Xuất Bảng công Excel</Button>
          </Space>
        </Flex>

        <SelectableTable<PayrollSnapshotItem>
          size="small" rowKey="employeeId" loading={snapshotsQ.isLoading || snapshotsQ.isFetching} dataSource={rows}
          bulkActions={[{ key: 'export', label: 'Xuất Excel nhân sự đã chọn', icon: <DownloadOutlined />, onClick: (sel) => exportToExcel({ fileName: `UB_Bang_Cham_Cong_Chon_${period.period_code ?? 'KY_LUONG'}.xls`, sheetTitle: `BẢNG CHẤM CÔNG & ĐỐI SOÁT CÔNG — ${period.name ?? ''}`, rows: sel.map((r) => ({ ...r, reconcileStatus: r.hasAnomaly ? 'Cần kiểm tra bổ sung công' : 'Đã khớp công hợp lệ' })), columns: [{ header: 'Mã NV', key: 'employeeCode' }, { header: 'Họ và tên', key: 'fullName' }, { header: 'Chi nhánh', key: 'branchName' }, { header: 'Số ca công', key: 'totalShiftsCount', align: 'right' }, { header: 'Giờ thực tế', key: 'actualHours', align: 'right' }, { header: 'Trạng thái đối soát', key: 'reconcileStatus' }] }) }]}
          pagination={{
            current: page, pageSize: perPage, total: totalCount,
            showSizeChanger: true, pageSizeOptions: ['10', '12', '15', '20', '50', '100'],
            showTotal: (t) => `Tổng ${t} nhân sự`,
            onChange: (p, ps) => { setPage(ps !== perPage ? 1 : p); setPerPage(ps); },
          }}
          scroll={{ x: 1180 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có dữ liệu chấm công trong kỳ" /> }}
          columns={[
            { title: 'Nhân sự', width: 210, fixed: 'left', render: (_, r) => <div><strong>{r.fullName}</strong><div style={{ fontSize: 12, color: '#64748B' }}>{r.employeeCode} · {r.branchName}</div></div> },
            { title: 'Hình thức', dataIndex: 'rateTypeLabel', width: 110, render: (v: string) => <Tag color="blue">{v}</Tag> },
            { title: 'Số ca', dataIndex: 'totalShiftsCount', width: 75, align: 'right', render: (v: number) => <span className="num">{v} ca</span> },
            { title: 'Giờ chuẩn', dataIndex: 'standardHours', width: 95, align: 'right', render: (v: number) => <span className="num">{v ?? 0}h</span> },
            { title: 'Giờ TV / CT', width: 120, align: 'right', render: (_, r) => <span className="num">{r.probationHours}h / <strong>{r.officialHours}h</strong></span> },
            { title: 'Giờ OT', dataIndex: 'otHours', width: 85, align: 'right', render: (v: number) => v > 0 ? <Tag color="purple" className="num">+{v}h</Tag> : '0h' },
            { title: 'Giờ tính lương', dataIndex: 'approvedPayrollHours', width: 115, align: 'right', render: (v: number, r) => <strong className="num" style={{ color: '#2563EB' }}>{v ?? r.approvedHours} giờ</strong> },
            { title: 'Đi trễ', dataIndex: 'lateCount', width: 85, align: 'center', render: (v: number) => v > 0 ? <Tag color="volcano">{v} lần</Tag> : <Tag color="green">0</Tag> },
            {
              title: 'Đối soát Giờ công & Bù công', width: 270,
              render: (_, r) => r.hasAnomaly ? (
                <Space size={4} wrap>
                  {(r.missingCheckoutCount ?? 0) > 0 && <Tag color="red" icon={<WarningOutlined />} style={{ cursor: 'pointer', margin: 0 }} onClick={() => openEmployeeMissing(r)}>Thiếu Vào/Ra: {r.missingCheckoutCount} ca</Tag>}
                  {(r.pendingAdjCount ?? 0) > 0 && <Badge status="processing" text={<Tag color="gold" style={{ cursor: 'pointer', margin: 0 }} onClick={() => openEmployeeMissing(r)}>{r.pendingAdjCount} đơn bù công chờ duyệt</Tag>} />}
                  <Button size="small" type="link" danger icon={<EyeOutlined />} style={{ padding: '0 4px', height: 22 }} onClick={() => openEmployeeMissing(r)}>Xem chi tiết</Button>
                </Space>
              ) : (
                <Space size={4}>
                  <Tag color="green" icon={<CheckCircleOutlined />}>Đã khớp công hợp lệ</Tag>
                  {(r.approvedAdjCount ?? 0) > 0 && <Typography.Text type="secondary" style={{ fontSize: 11 }}>({r.approvedAdjCount} đơn đã duyệt)</Typography.Text>}
                </Space>
              ),
            },
            { title: 'Trạng thái kỳ', width: 125, render: () => <StatusTag value={period.status || 'DRAFT'} label={period.statusLabel} /> },
            {
              title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
              render: (_, r) => <RowActionButtons detailTooltip="Xem chi tiết công & phiếu lương" onViewDetail={() => onOpenPayslip(r)} />,
            },
          ]}
        />
      </Card>
      <PayrollMissingShiftsModal open={missingModalOpen} period={period} selectedEmployee={inspectEmp} allMissingShifts={allMissingShifts} onClose={() => setMissingModalOpen(false)} onShowAll={() => setInspectEmp(null)} onOpenPayslip={onOpenPayslip} />
    </Space>
  );
}
