'use client';

import { Alert, Button, Empty, Flex, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { CloseOutlined, EyeOutlined, FileExcelOutlined, SafetyCertificateOutlined, SearchOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { exportToExcel } from '@/lib/export-excel';
import { useClientPagination } from '../hooks/useClientPagination';
import type { MissingShiftDetailItem, PayPeriodRow, PayrollSnapshotItem } from './payroll-types';

interface Props {
  open: boolean;
  period: PayPeriodRow;
  selectedEmployee?: PayrollSnapshotItem | null;
  allMissingShifts: MissingShiftDetailItem[];
  onClose: () => void;
  onShowAll?: () => void;
  onOpenPayslip?: (row: PayrollSnapshotItem) => void;
}

const ISSUE_COLORS: Record<MissingShiftDetailItem['issueType'], string> = {
  ABSENT: 'red',
  MISSING_CHECKOUT: 'volcano',
  MISSING_CHECKIN: 'orange',
  PENDING_ADJUSTMENT: 'gold',
};

/**
 * Modal đối soát chi tiết từng ca thiếu chấm công Vào/Ra, vắng mặt hoặc đang chờ duyệt phiếu bù công
 * dành cho Kế toán kiểm tra để thông báo chính xác cho HR / Quản lý cửa hàng xử lý.
 */
export function PayrollMissingShiftsModal({
  open, period, selectedEmployee, allMissingShifts, onClose, onShowAll, onOpenPayslip,
}: Props) {
  const [q, setQ] = useState('');
  const [issueFilter, setIssueFilter] = useState<string>('ALL');
  const pagination = useClientPagination(10, 'ca thiếu');

  const baseList = useMemo(() => {
    if (!selectedEmployee) return allMissingShifts;
    if (selectedEmployee.missingShifts && selectedEmployee.missingShifts.length > 0) return selectedEmployee.missingShifts;
    return allMissingShifts.filter((m) => m.employeeId === selectedEmployee.employeeId || m.employeeCode === selectedEmployee.employeeCode);
  }, [selectedEmployee, allMissingShifts]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return baseList.filter((item) => {
      if (issueFilter === 'ABSENT' && item.issueType !== 'ABSENT') return false;
      if (issueFilter === 'MISSING_PUNCH' && item.issueType !== 'MISSING_CHECKOUT' && item.issueType !== 'MISSING_CHECKIN') return false;
      if (issueFilter === 'HAS_PENDING_ADJ' && !item.pendingAdjustmentCode) return false;
      if (issueFilter === 'NO_ADJ' && item.pendingAdjustmentCode) return false;
      if (kw) {
        const dateVn = dayjs(item.date).format('DD/MM/YYYY');
        const haystack = `${item.employeeCode} ${item.fullName} ${item.branchName} ${item.date} ${dateVn} ${item.shiftLabel} ${item.issueLabel} ${item.pendingAdjustmentCode ?? ''}`.toLowerCase();
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
  }, [baseList, q, issueFilter]);

  const handleExport = () => {
    exportToExcel({
      fileName: `UB_Chi_Tiet_Ca_Thieu_Cong_${selectedEmployee ? selectedEmployee.employeeCode : period.period_code}.xls`,
      sheetTitle: `DANH SÁCH CHI TIẾT CA THIẾU CHẤM CÔNG VÀO/RA — ${period.name}`,
      subtitle: `Kỳ lương: ${period.from_date} đến ${period.to_date} · Dùng để gửi HR / Quản lý cửa hàng đối soát xử lý`,
      columns: [
        { header: 'Mã NV', key: 'employeeCode' }, { header: 'Họ và tên', key: 'fullName' }, { header: 'Chi nhánh', key: 'branchName' },
        { header: 'Ngày ca', key: 'dateFormatted' }, { header: 'Khung ca', key: 'shiftLabel' }, { header: 'Giờ quy định', key: 'shiftTime' },
        { header: 'Giờ Vào – Ra thực tế', key: 'actualPunch' }, { header: 'Tình trạng thiếu công', key: 'issueLabel' },
        { header: 'Phiếu bù công', key: 'adjDisplay' }, { header: 'Hướng xử lý (Báo HR / Cửa hàng)', key: 'actionGuide' },
      ],
      rows: filtered.map((r) => ({
        ...r,
        dateFormatted: dayjs(r.date).format('DD/MM/YYYY'),
        actualPunch: !r.checkInHm && !r.checkOutHm ? 'Chưa chấm công Vào & Ra' : `Vào: ${r.checkInHm || 'Thiếu'} – Ra: ${r.checkOutHm || 'Chưa chấm Ra'}`,
        adjDisplay: r.pendingAdjustmentCode ? `${r.pendingAdjustmentCode} (${r.pendingAdjustmentStatus === 'STORE_CONFIRMED' ? 'CH đã xác nhận · Chờ HR duyệt' : 'Chờ CH / HR duyệt'})` : 'Chưa gửi phiếu bù công',
      })),
    });
  };

  return (
    <Modal
      open={open} onCancel={onClose} width="min(1180px, 96vw)" destroyOnHidden
      title={
        <Space size={8} wrap>
          <WarningOutlined style={{ color: '#DC2626' }} />
          <span>{selectedEmployee ? `Chi tiết ca thiếu chấm công Vào/Ra — ${selectedEmployee.fullName} (${selectedEmployee.employeeCode} · ${selectedEmployee.branchName})` : `Danh sách chi tiết toàn bộ ca thiếu chấm công Vào/Ra trong kỳ — ${period.name}`}</span>
          <Tag color="red">{filtered.length} ca cần xử lý</Tag>
        </Space>
      }
      footer={
        <Flex justify="space-between" align="center" wrap gap={8}>
          <Space wrap size={8}>
            {selectedEmployee && onShowAll && allMissingShifts.length > baseList.length && (
              <Button onClick={onShowAll}>Xem tất cả nhân sự thiếu ca trong kỳ ({allMissingShifts.length} ca)</Button>
            )}
            {selectedEmployee && onOpenPayslip && (
              <Button icon={<EyeOutlined />} onClick={() => { onClose(); onOpenPayslip(selectedEmployee); }}>Mở Phiếu lương &amp; Nhật ký công đầy đủ</Button>
            )}
          </Space>
          <Space wrap size={8}>
            <Link href="/admin/schedules?section=workflows"><Button icon={<SafetyCertificateOutlined />}>Mở trang Đơn từ &amp; Điều chỉnh công</Button></Link>
            <Button icon={<FileExcelOutlined style={{ color: '#15803D' }} />} onClick={handleExport} disabled={filtered.length === 0}>Xuất danh sách ca thiếu (Excel)</Button>
            <Button type="primary" icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
          </Space>
        </Flex>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="warning" showIcon
          message="Hướng dẫn đối soát dành cho Kế toán"
          description="Dưới đây là danh sách cụ thể từng ngày, từng ca làm việc đang bị thiếu giờ Vào/Ra hoặc vắng mặt chưa hoàn tất. Kế toán có thể xuất file Excel hoặc báo trực tiếp mã ca / ngày ca bên dưới cho Quản lý cửa hàng và HR để duyệt phiếu bổ sung công (hoặc xóa ca trên lịch nếu phân ca nhầm)."
        />
        <Flex justify="space-between" align="center" wrap gap={8}>
          <Space wrap size={8}>
            <Input allowClear prefix={<SearchOutlined style={{ color: '#94A3B8' }} />} placeholder="Tìm mã NV, tên, chi nhánh, ngày (VD: 27/10)..." value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 290 }} />
            <Select
              value={issueFilter} onChange={setIssueFilter} style={{ width: 250 }}
              options={[
                { value: 'ALL', label: `Tất cả tình trạng thiếu (${baseList.length})` },
                { value: 'ABSENT', label: 'Vắng mặt (Chưa chấm Vào & Ra)' },
                { value: 'MISSING_PUNCH', label: 'Quên chấm công Ra ca / Vào ca' },
                { value: 'HAS_PENDING_ADJ', label: 'Đã có phiếu bù công chờ duyệt' },
                { value: 'NO_ADJ', label: 'Chưa gửi phiếu bù công nào' },
              ]}
            />
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Hiển thị <strong>{filtered.length}</strong> ca cần HR / Cửa hàng xử lý</Typography.Text>
        </Flex>
        <Table<MissingShiftDetailItem>
          size="small" rowKey={(r, i) => `${r.assignmentId}-${r.date}-${r.shiftCode}-${i}`} pagination={pagination} dataSource={filtered} scroll={{ x: 1020 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có ca thiếu chấm công Vào/Ra nào — Dữ liệu công đã khớp hợp lệ" /> }}
          columns={[
            { title: 'Nhân sự & Chi nhánh', width: 195, fixed: 'left', render: (_, r) => <div><strong>{r.fullName}</strong><div style={{ fontSize: 12, color: '#64748B' }}>{r.employeeCode} · {r.branchName}</div></div> },
            { title: 'Ngày & Khung ca thiếu', width: 175, render: (_, r) => <div><Tag color="geekblue" className="num" style={{ margin: 0 }}>{dayjs(r.date).format('DD/MM/YYYY')}</Tag><div style={{ marginTop: 3 }}><strong>{r.shiftLabel}</strong> <span style={{ fontSize: 12, color: '#64748B' }}>({r.shiftTime})</span></div></div> },
            {
              title: 'Giờ Vào – Ra thực tế', width: 165,
              render: (_, r) => !r.checkInHm && !r.checkOutHm ? <Tag color="red" style={{ margin: 0 }}>Chưa chấm Vào &amp; Ra</Tag> : (
                <div className="num" style={{ fontSize: 12 }}>
                  <div>Vào: <strong style={{ color: r.checkInHm ? '#15803D' : '#DC2626' }}>{r.checkInHm || 'Thiếu giờ Vào'}</strong></div>
                  <div>Ra: <strong style={{ color: r.checkOutHm ? '#15803D' : '#DC2626' }}>{r.checkOutHm || 'Chưa chấm Ra'}</strong></div>
                </div>
              ),
            },
            { title: 'Tình trạng thiếu cụ thể', width: 225, render: (_, r) => <Tag color={ISSUE_COLORS[r.issueType] || 'red'} style={{ whiteSpace: 'normal', lineHeight: 1.35, padding: '2px 6px' }}>{r.issueLabel}</Tag> },
            {
              title: 'Phiếu bổ sung công', width: 175,
              render: (_, r) => r.pendingAdjustmentCode ? (
                <div><Tag color="gold" style={{ margin: 0 }}>{r.pendingAdjustmentCode}</Tag><div style={{ fontSize: 11, color: '#D97706', marginTop: 2 }}>{r.pendingAdjustmentStatus === 'STORE_CONFIRMED' ? 'CH đã xác nhận · Chờ HR duyệt' : 'Đang chờ CH / HR duyệt'}</div></div>
              ) : <Tag color="default" style={{ margin: 0 }}>Chưa gửi phiếu bù công</Tag>,
            },
            { title: 'Hướng xử lý (Báo HR / Cửa hàng)', dataIndex: 'actionGuide', render: (v: string) => <span style={{ fontSize: 12, color: '#334155' }}>{v}</span> },
          ]}
        />
      </Space>
    </Modal>
  );
}
