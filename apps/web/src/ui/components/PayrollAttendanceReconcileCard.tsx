'use client';

import { Alert, Badge, Button, Card, Col, Empty, Flex, Input, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, EyeOutlined, FileExcelOutlined,
  SafetyCertificateOutlined, SearchOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { StatusTag } from '../StatusTag';
import { type PayPeriodRow, type PayrollSnapshotItem } from './payroll-types';

interface Props {
  period?: PayPeriodRow;
  snapshots: PayrollSnapshotItem[];
  loading?: boolean;
  onOpenPayslip: (row: PayrollSnapshotItem) => void;
}

/**
 * Bảng chấm công tổng hợp (FIN-02) & Đối soát công trước chốt lương (FIN-03).
 * Chỉ dùng dữ liệu công đã xác nhận, phát hiện thiếu check-in/out, đi trễ và phiếu điều chỉnh chờ duyệt.
 */
export function PayrollAttendanceReconcileCard({ period, snapshots, loading, onOpenPayslip }: Props) {
  const [searchInput, setSearchInput] = useState('');
  const debouncedQ = useDebouncedValue(searchInput, 400);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [anomalyFilter, setAnomalyFilter] = useState<'ALL' | 'ANOMALY' | 'CLEAN'>('ALL');

  const eventsQ = useQuery({
    queryKey: ['payroll-reconcile-events', period?.id],
    queryFn: () => api.list<Record<string, unknown>>('/admin/attendance-events?per_page=100'),
    enabled: Boolean(period?.id),
  });
  const adjQ = useQuery({
    queryKey: ['payroll-reconcile-adjustments', period?.id],
    queryFn: () => api.list<Record<string, unknown>>('/admin/attendance-adjustments?per_page=100'),
    enabled: Boolean(period?.id),
  });
  const shiftsQ = useQuery({
    queryKey: ['payroll-reconcile-shifts', period?.id],
    queryFn: () => api.list<Record<string, unknown>>('/admin/schedules?per_page=100'),
    enabled: Boolean(period?.id),
  });

  const branches = useMemo(() => {
    const names = Array.from(new Set(snapshots.map((s) => s.branchName).filter(Boolean)));
    return [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...names.map((n) => ({ value: n, label: n }))];
  }, [snapshots]);

  const rows = useMemo(() => {
    const evs = eventsQ.data?.data ?? [];
    const adjs = adjQ.data?.data ?? [];
    const shifts = shiftsQ.data?.data ?? [];
    const fromDate = period?.from_date || '2000-01-01';
    const toDate = period?.to_date || '2099-12-31';

    return snapshots.map((snap) => {
      const empShifts = shifts.filter((s) => (s.employeeId === snap.employeeId || s.employeeCode === snap.employeeCode) && String(s.workDate) >= fromDate && String(s.workDate) <= toDate);
      const empEvs = evs.filter((e) => (e.employee_id === snap.employeeId || e.employeeCode === snap.employeeCode));
      const empAdjs = adjs.filter((a) => (a.employee_id === snap.employeeId || a.employeeCode === snap.employeeCode));

      const standardHours = empShifts.reduce((sum, s) => sum + (Number(s.scheduledHours) || 5), 0) || snap.approvedHours;
      const lateCount = snap.lateCount ?? empEvs.filter((e) => e.punctualityStatus === 'LATE' || Number(e.late_minutes) > 0).length;
      const missingCheckoutCount = (snap.absentCount ?? 0) + empShifts.filter((s) => {
        const sEvs = empEvs.filter((e) => String(e.assignment_id) === String(s.id));
        const hasIn = sEvs.some((e) => e.type === 'CHECK_IN');
        const hasOut = sEvs.some((e) => e.type === 'CHECK_OUT');
        return hasIn && !hasOut;
      }).length;
      const pendingAdjCount = empAdjs.filter((a) => a.status === 'PENDING').length;
      const approvedAdjCount = empAdjs.filter((a) => a.status === 'APPROVED').length;
      const hasAnomaly = missingCheckoutCount > 0 || pendingAdjCount > 0;

      return {
        ...snap,
        standardHours,
        actualHours: snap.approvedHours,
        approvedPayrollHours: snap.approvedHours,
        lateCount,
        missingCheckoutCount,
        pendingAdjCount,
        approvedAdjCount,
        hasAnomaly,
      };
    });
  }, [snapshots, eventsQ.data, adjQ.data, shiftsQ.data, period?.from_date, period?.to_date]);

  const filtered = useMemo(() => {
    const q = debouncedQ.trim().toLowerCase();
    return rows.filter((r) => {
      if (branchFilter !== 'ALL' && r.branchName !== branchFilter) return false;
      if (anomalyFilter === 'ANOMALY' && !r.hasAnomaly && r.lateCount === 0) return false;
      if (anomalyFilter === 'CLEAN' && (r.hasAnomaly || r.lateCount > 0)) return false;
      if (q && !`${r.employeeCode} ${r.fullName} ${r.branchName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, branchFilter, anomalyFilter, debouncedQ]);

  const totalPendingAdjs = rows.reduce((s, r) => s + r.pendingAdjCount, 0);
  const totalMissingPunches = rows.reduce((s, r) => s + r.missingCheckoutCount, 0);
  const totalApprovedHours = rows.reduce((s, r) => s + r.approvedPayrollHours, 0);

  const handleExport = () => {
    exportToExcel({
      fileName: `UB_Bang_Cham_Cong_Doi_Soat_${period?.period_code ?? 'KY_LUONG'}.xls`,
      sheetTitle: `BẢNG CHẤM CÔNG & ĐỐI SOÁT CÔNG KỲ LƯƠNG — ${period?.name ?? ''}`,
      subtitle: `Từ ${period?.from_date ?? ''} đến ${period?.to_date ?? ''} · Chỉ tính lương trên dữ liệu công đã xác nhận`,
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
        { header: 'Thiếu In/Out hoặc Vắng', key: 'missingCheckoutCount', align: 'right' },
        { header: 'Đơn bù công chờ duyệt', key: 'pendingAdjCount', align: 'right' },
        { header: 'Trạng thái đối soát', key: 'reconcileStatus' },
      ],
      rows: filtered.map((r) => ({
        ...r,
        reconcileStatus: r.hasAnomaly ? 'Cần kiểm tra bổ sung công' : 'Đã khớp công hợp lệ',
      })),
    });
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Nhân sự trong bảng công" value={rows.length} suffix="NV" /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Tổng giờ công tính lương" value={totalApprovedHours} suffix="giờ" prefix={<ClockCircleOutlined />} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Ca thiếu In/Out hoặc Vắng" value={totalMissingPunches} valueStyle={{ color: totalMissingPunches > 0 ? '#DC2626' : '#16A34A' }} prefix={<WarningOutlined />} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Phiếu điều chỉnh chờ duyệt" value={totalPendingAdjs} valueStyle={{ color: totalPendingAdjs > 0 ? '#D97706' : '#16A34A' }} prefix={<SafetyCertificateOutlined />} /></Card></Col>
      </Row>

      {(totalPendingAdjs > 0 || totalMissingPunches > 0) && (
        <Alert
          type="warning" showIcon
          message="Phát hiện dữ liệu chấm công cần đối soát trước khi khóa sổ lương (FIN-03)"
          description={
            <span>
              Hệ thống ghi nhận <strong>{totalMissingPunches} ca thiếu lượt Check-in/out hoặc vắng</strong> và <strong>{totalPendingAdjs} phiếu điều chỉnh công đang chờ duyệt</strong>. Kế toán không tự sửa sự kiện gốc; vui lòng phối hợp Cửa hàng / HR xử lý tại mục{' '}
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
            <Button icon={<FileExcelOutlined style={{ color: '#15803D' }} />} onClick={handleExport}>Xuất Bảng công Excel</Button>
          </Space>
        </Flex>

        <Table
          size="small" rowKey="employeeId" loading={loading || eventsQ.isLoading} dataSource={filtered} pagination={{ pageSize: 12 }} scroll={{ x: 1180 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có dữ liệu chấm công trong kỳ" /> }}
          columns={[
            { title: 'Nhân sự', width: 210, fixed: 'left', render: (_, r) => <div><strong>{r.fullName}</strong><div style={{ fontSize: 12, color: '#64748B' }}>{r.employeeCode} · {r.branchName}</div></div> },
            { title: 'Hình thức', dataIndex: 'rateTypeLabel', width: 110, render: (v: string) => <Tag color="blue">{v}</Tag> },
            { title: 'Số ca', dataIndex: 'totalShiftsCount', width: 75, align: 'right', render: (v: number) => <span className="num">{v} ca</span> },
            { title: 'Giờ chuẩn', dataIndex: 'standardHours', width: 95, align: 'right', render: (v: number) => <span className="num">{v}h</span> },
            { title: 'Giờ TV / CT', width: 120, align: 'right', render: (_, r) => <span className="num">{r.probationHours}h / <strong>{r.officialHours}h</strong></span> },
            { title: 'Giờ OT', dataIndex: 'otHours', width: 85, align: 'right', render: (v: number) => v > 0 ? <Tag color="purple" className="num">+{v}h</Tag> : '0h' },
            { title: 'Giờ tính lương', dataIndex: 'approvedPayrollHours', width: 115, align: 'right', render: (v: number) => <strong className="num" style={{ color: '#2563EB' }}>{v} giờ</strong> },
            { title: 'Đi trễ', dataIndex: 'lateCount', width: 85, align: 'center', render: (v: number) => v > 0 ? <Tag color="volcano">{v} lần</Tag> : <Tag color="green">0</Tag> },
            {
              title: 'Đối soát In/Out & Bù công (FIN-03)', width: 240,
              render: (_, r) => r.hasAnomaly ? (
                <Space size={4} wrap>
                  {r.missingCheckoutCount > 0 && <Tag color="red" icon={<WarningOutlined />}>Thiếu In/Out: {r.missingCheckoutCount} ca</Tag>}
                  {r.pendingAdjCount > 0 && <Badge status="processing" text={<Tag color="gold">{r.pendingAdjCount} đơn bù công chờ duyệt</Tag>} />}
                </Space>
              ) : (
                <Space size={4}>
                  <Tag color="green" icon={<CheckCircleOutlined />}>Đã khớp công hợp lệ</Tag>
                  {r.approvedAdjCount > 0 && <Typography.Text type="secondary" style={{ fontSize: 11 }}>({r.approvedAdjCount} đơn đã duyệt)</Typography.Text>}
                </Space>
              ),
            },
            { title: 'Trạng thái kỳ', width: 125, render: () => <StatusTag value={period?.status || 'DRAFT'} label={period?.statusLabel} /> },
            {
              title: 'Chi tiết', width: 90, fixed: 'right', align: 'right',
              render: (_, r) => <Button size="small" icon={<EyeOutlined />} onClick={() => onOpenPayslip(r)}>Chi tiết</Button>,
            },
          ]}
        />
      </Card>
    </Space>
  );
}
