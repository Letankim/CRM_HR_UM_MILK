'use client';

import { Button, Card, Empty, Flex, Select, Space, Table, Tag } from 'antd';
import { BarChartOutlined, FileExcelOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { exportToExcel } from '@/lib/export-excel';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import { useJobPositions } from './JobPositionsManagerModal';

interface Props {
  branchFilter: string;
  periodFilter: 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'ALL';
}

/**
 * Báo cáo tổng hợp Nhân sự HR (HR-14 / AI-TAB-26) & Báo cáo Vận hành Chi nhánh (STR-09 / AI-TAB-36):
 * Headcount, Thử việc/Chính thức, Tuyển dụng, Ngày công, Giờ làm, Đi trễ, Vắng mặt, Ca thiếu người và Tỷ lệ phủ ca.
 */
export function HrStoreOperationsReportCard({ branchFilter, periodFilter }: Props) {
  const can = useCan();
  const canViewReport = can('report.hr', 'report.store');
  const canRecruit = can('candidate.manage');
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [shiftFilter, setShiftFilter] = useState('ALL');
  const { options: jobPositionOptions } = useJobPositions();
  const { options: shiftOptions } = useShiftTemplates(branchFilter);

  const branchesQ = useQuery({
    queryKey: ['report-branches'],
    queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=50'),
    enabled: canViewReport,
  });
  const employeesQ = useQuery({
    queryKey: ['report-employees'],
    queryFn: () => api.list<Record<string, unknown>>('/admin/employees?per_page=100'),
    enabled: canViewReport && can('employee.read'),
  });
  const candidatesQ = useQuery({
    queryKey: ['report-candidates'],
    queryFn: () => api.list<Record<string, unknown>>('/admin/candidates?per_page=100'),
    enabled: canViewReport && canRecruit,
  });
  const shiftsQ = useQuery({
    queryKey: ['report-shifts'],
    queryFn: () => api.list<Record<string, unknown>>('/admin/schedules?per_page=300'),
    enabled: canViewReport,
  });
  const eventsQ = useQuery({
    queryKey: ['report-events'],
    queryFn: () => api.list<Record<string, unknown>>('/admin/attendance/events?per_page=100'),
    enabled: canViewReport,
  });

  const todayStr = dayjs().format('YYYY-MM-DD');
  const inPeriod = (dateStr: string) => {
    if (!dateStr || periodFilter === 'ALL') return true;
    if (periodFilter === 'TODAY') return dateStr === todayStr;
    if (periodFilter === 'THIS_WEEK') return dayjs(dateStr).isSame(dayjs(), 'week');
    return dayjs(dateStr).isSame(dayjs(), 'month');
  };

  const reportRows = useMemo(() => {
    const branches = (branchesQ.data?.data ?? []).filter((b) => branchFilter === 'ALL' || b.id === branchFilter);
    const emps = employeesQ.data?.data ?? [];
    const cands = candidatesQ.data?.data ?? [];
    const shifts = (shiftsQ.data?.data ?? []).filter((s) => inPeriod(String(s.workDate || '')));
    const evs = eventsQ.data?.data ?? [];

    return branches.map((b) => {
      const bEmps = emps.filter((e) => {
        if ((e.branchId ?? e.branch_id) !== b.id) return false;
        if (positionFilter !== 'ALL') return e.staffGroup === positionFilter || e.staff_group === positionFilter;
        return true;
      });
      const bShifts = shifts.filter((s) => {
        if ((s.branchId ?? s.branch_id) !== b.id) return false;
        if (shiftFilter !== 'ALL') return s.shiftCode === shiftFilter || s.shift_code === shiftFilter;
        return true;
      });
      const bCands = cands.filter((c) => (!c.applied_branch_id && !c.branch_pref) || c.applied_branch_id === b.id || c.branch_pref === b.id);
      const probationCount = bEmps.filter((e) => e.stage === 'PROBATION' || e.stage === 'THU_VIEC').length;
      const officialCount = bEmps.filter((e) => e.stage === 'OFFICIAL' || e.stage === 'CHINH_THUC').length;
      const workDaysCount = new Set(bShifts.map((s) => String(s.workDate || s.work_date || '')).filter(Boolean)).size;
      const totalHours = bShifts.reduce((sum, s) => sum + (Number(s.scheduledHours) || 5), 0);
      const lateCount = evs.filter((e) => e.branch_id === b.id && (e.punctualityStatus === 'LATE' || Number(e.late_minutes) > 0)).length;
      const absentCount = bShifts.filter((s) => s.status === 'ABSENT').length;
      const understaffedCount = bShifts.filter((s) => s.status === 'ABSENT' || s.status === 'ON_LEAVE').length;
      const coverageRate = bShifts.length > 0 ? Math.max(0, Math.round(((bShifts.length - understaffedCount) / bShifts.length) * 100)) : 100;

      return {
        id: b.id, branchCode: b.code, branchName: b.name, headcount: bEmps.length,
        probationCount, officialCount, candidateCount: bCands.length, workDaysCount,
        shiftCount: bShifts.length, totalHours, lateCount, absentCount, understaffedCount, coverageRate,
      };
    });
  }, [branchesQ.data, employeesQ.data, candidatesQ.data, shiftsQ.data, eventsQ.data, branchFilter, periodFilter, positionFilter, shiftFilter]);

  if (!canViewReport) return null;

  const handleExport = () => {
    exportToExcel({
      fileName: `UB_Bao_Cao_HR_Van_Hanh_Chi_Nhanh_${dayjs().format('YYYYMMDD')}.xls`,
      sheetTitle: 'BÁO CÁO TỔNG HỢP NHÂN SỰ & VẬN HÀNH CHI NHÁNH',
      subtitle: `Ngày xuất: ${dayjs().format('DD/MM/YYYY HH:mm')}`,
      columns: [
        { header: 'Mã CN', key: 'branchCode' },
        { header: 'Chi nhánh', key: 'branchName' },
        { header: 'Tổng nhân sự', key: 'headcount', align: 'right' },
        { header: 'NV Thử việc', key: 'probationCount', align: 'right' },
        { header: 'NV Chính thức', key: 'officialCount', align: 'right' },
        { header: 'Hồ sơ Ứng viên', key: 'candidateCount', align: 'right' },
        { header: 'Số ngày công', key: 'workDaysCount', align: 'right' },
        { header: 'Tổng số ca công', key: 'shiftCount', align: 'right' },
        { header: 'Tổng giờ làm', key: 'totalHours', align: 'right' },
        { header: 'Lượt đi trễ', key: 'lateCount', align: 'right' },
        { header: 'Ca vắng mặt', key: 'absentCount', align: 'right' },
        { header: 'Ca thiếu người', key: 'understaffedCount', align: 'right' },
        { header: 'Tỷ lệ phủ ca (%)', key: 'coverageRate', align: 'right' },
      ],
      rows: reportRows,
    });
  };

  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      title={<span><BarChartOutlined /> Báo cáo Nhân sự &amp; Vận hành Chi nhánh</span>}
      extra={
        <Flex gap={8} wrap align="center">
          <Select
            size="small" value={positionFilter} onChange={setPositionFilter} style={{ width: 185 }}
            options={[{ value: 'ALL', label: 'Tất cả vị trí công việc' }, ...jobPositionOptions]}
          />
          <Select
            size="small" value={shiftFilter} onChange={setShiftFilter} style={{ width: 195 }}
            options={[{ value: 'ALL', label: 'Tất cả khung ca' }, ...shiftOptions]}
          />
          <Button size="small" icon={<FileExcelOutlined style={{ color: '#15803D' }} />} onClick={handleExport}>Xuất Báo cáo Excel</Button>
        </Flex>
      }
    >
      <Table
        size="small" rowKey="id" pagination={false} loading={branchesQ.isLoading || shiftsQ.isLoading} dataSource={reportRows} scroll={{ x: 980 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu báo cáo theo bộ lọc" /> }}
        columns={[
          { title: 'Chi nhánh', width: 200, render: (_, r) => <div><strong>{r.branchName}</strong><div style={{ fontSize: 12, color: '#64748B' }}>{r.branchCode}</div></div> },
          { title: 'Tổng nhân sự', dataIndex: 'headcount', width: 110, align: 'right', render: (v: number) => <strong className="num">{v} NV</strong> },
          { title: 'Thử việc / Chính thức', width: 145, align: 'center', render: (_, r) => <Space size={4}><Tag color="gold">{r.probationCount} TV</Tag><Tag color="blue">{r.officialCount} CT</Tag></Space> },
          ...(canRecruit ? [{ title: 'Tuyển dụng', dataIndex: 'candidateCount', width: 105, align: 'right' as const, render: (v: number) => <span className="num">{v} hồ sơ</span> }] : []),
          { title: 'Ngày công · Ca · Giờ làm', width: 175, align: 'right', render: (_, r) => <span className="num"><strong>{r.workDaysCount} ngày</strong> · {r.shiftCount} ca ({r.totalHours}h)</span> },
          { title: 'Đi trễ', dataIndex: 'lateCount', width: 90, align: 'center', render: (v: number) => v > 0 ? <Tag color="volcano">{v} lượt</Tag> : <Tag color="green">0</Tag> },
          { title: 'Vắng / Thiếu ca', width: 130, align: 'center', render: (_, r) => <Space size={4}><Tag color={r.absentCount > 0 ? 'red' : 'default'}>{r.absentCount} vắng</Tag><Tag color={r.understaffedCount > 0 ? 'orange' : 'default'}>{r.understaffedCount} thiếu</Tag></Space> },
          { title: 'Tỷ lệ phủ ca', dataIndex: 'coverageRate', width: 115, align: 'right', render: (v: number) => <Tag color={v >= 90 ? 'green' : 'orange'} className="num">{v}%</Tag> },
        ]}
      />
    </Card>
  );
}
