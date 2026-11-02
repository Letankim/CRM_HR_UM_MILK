'use client';

import { useState } from 'react';
import { Alert, Button, Card, Modal, Space, Table, Tag } from 'antd';
import { CheckCircleOutlined, CloudUploadOutlined, FileProtectOutlined, SafetyCertificateOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CONTRACT_TYPE_LABELS, EMPLOYEE_STAGE_OPTIONS } from '@umbm/shared';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { StatusTag } from '../StatusTag';
import { EmployeeContractStorePanel } from './EmployeeContractStorePanel';
import type { EmployeeRowItem } from './employee-table-columns';
import { FilterToolbar } from './FilterToolbar';

interface Props {
  branches: { value: string; label: string }[];
}

export function ContractsAndProbationPane({ branches }: Props) {
  const qc = useQueryClient();
  const can = useCan();
  const canManage = can('employee.manage');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [stageFilter, setStageFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(12);
  const [selectedEmp, setSelectedEmp] = useState<EmployeeRowItem | null>(null);

  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (debouncedQ) params.set('q', debouncedQ);
  if (branchFilter !== 'ALL') params.set('branch_id', branchFilter);
  if (stageFilter !== 'ALL') params.set('stage', stageFilter);

  const empQ = useQuery({
    queryKey: ['employees', 'contracts-pane', page, perPage, debouncedQ, branchFilter, stageFilter],
    queryFn: () => api.list<EmployeeRowItem>(`/admin/employees?${params.toString()}`),
  });

  const rows = empQ.data?.data ?? [];
  const liveSelectedEmp = selectedEmp ? (rows.find((x) => x.id === selectedEmp.id) ?? selectedEmp) : null;

  const handleExport = () => {
    exportToExcel({
      fileName: 'Quan_ly_Hop_dong_va_Tin_nhiem.xls',
      sheetTitle: 'Danh sách Hợp đồng Lao động & Điểm Tín nhiệm Chuyên cần',
      rows: rows as unknown as Record<string, unknown>[],
      columns: [
        { header: 'Mã NV', key: 'employeeCode' },
        { header: 'Họ và tên', key: 'fullName' },
        { header: 'Chi nhánh', key: 'branchName' },
        { header: 'Giai đoạn', key: 'stageLabel' },
        { header: 'Số tệp Hợp đồng PDF', key: 'contractsCount' },
        { header: 'Điểm Tín nhiệm (100đ)', key: 'attendanceCreditPoints' },
        { header: 'Giờ công Thử việc', key: 'probationHoursCompleted' },
        { header: 'Điểm TEST (%)', key: 'testBestScorePercent' },
      ],
    });
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        icon={<SafetyCertificateOutlined />}
        message="Quản lý Hợp đồng Lao động Điện tử (4 vị trí PDF/Ảnh/Word <= 6MB) & Đánh giá Thử việc 7 Ngày"
        description="Hệ thống kiểm tra chữ ký số Magic Bytes ở đầu tệp, lưu trữ kép song song trên Google Drive và đĩa cục bộ (Local Backup), kết hợp theo dõi Vấn đáp Google Meet 15 phút, Bài thi 25 câu/8 phút và Quỹ điểm tín nhiệm chuyên cần 100 điểm/tháng."
      />

      <FilterToolbar
        searchPlaceholder="Tìm mã NV, họ tên, SĐT, chi nhánh..."
        searchValue={q}
        onSearchChange={(v) => { setQ(v); setPage(1); }}
        selects={[
          { key: 'branch', value: branchFilter, width: 210, options: [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branches], onChange: (v) => { setBranchFilter(v); setPage(1); } },
          { key: 'stage', value: stageFilter, width: 190, options: [{ value: 'ALL', label: 'Tất cả giai đoạn' }, ...EMPLOYEE_STAGE_OPTIONS], onChange: (v) => { setStageFilter(v); setPage(1); } },
        ]}
        onRefresh={() => void qc.invalidateQueries({ queryKey: ['employees'] })}
        refreshing={empQ.isFetching}
        onExportExcel={handleExport}
      />

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<EmployeeRowItem>
          size="small"
          rowKey="id"
          loading={empQ.isLoading}
          dataSource={rows}
          onRow={(record) => ({ onClick: () => setSelectedEmp(record), style: { cursor: 'pointer' } })}
          pagination={{
            current: page,
            pageSize: perPage,
            total: empQ.data?.meta.pagination.total ?? rows.length,
            showSizeChanger: true,
            pageSizeOptions: ['10', '12', '20', '50'],
            showTotal: (t) => `Tổng ${t} nhân sự`,
            onChange: (p, ps) => { setPage(ps !== perPage ? 1 : p); setPerPage(ps); },
          }}
          columns={[
            {
              title: 'Mã NV & Họ tên',
              key: 'emp',
              width: 210,
              render: (_, r) => (
                <div>
                  <div style={{ fontWeight: 600, color: '#0F172A' }}>{r.fullName}</div>
                  <Space size={4} style={{ marginTop: 2 }}>
                    <Tag color="geekblue" style={{ margin: 0 }}>{r.employeeCode}</Tag>
                    <span style={{ fontSize: 12, color: '#64748B' }}>{r.staffGroupLabel}</span>
                  </Space>
                </div>
              ),
            },
            {
              title: 'Chi nhánh & Giai đoạn',
              key: 'branchStage',
              width: 190,
              render: (_, r) => (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{r.branchName}</div>
                  <div style={{ marginTop: 3 }}><StatusTag value={r.stage} /></div>
                </div>
              ),
            },
            {
              title: 'Kho Hợp đồng Lao động (4 tệp PDF)',
              key: 'contracts',
              render: (_, r) => {
                const list = r.contracts ?? [];
                return (
                  <Space size={4} wrap>
                    <Tag color={list.length > 0 ? 'blue' : 'default'} icon={<FileProtectOutlined />} style={{ margin: 0, fontWeight: 600 }}>
                      {list.length}/4 tệp đã lưu
                    </Tag>
                    {list.slice(0, 2).map((c) => (
                      <Tag key={c.id} color={c.contractType === 'OFFICIAL_CONTRACT' ? 'green' : 'gold'} style={{ margin: 0 }}>
                        {CONTRACT_TYPE_LABELS[c.contractType] || c.contractType}: {c.fileName}
                      </Tag>
                    ))}
                  </Space>
                );
              },
            },
            {
              title: 'Đánh giá Thử việc & Vấn đáp Meet',
              key: 'probationEval',
              width: 225,
              render: (_, r) => (
                <Space size={4} wrap>
                  <Tag color={(r.probationHoursCompleted ?? 0) >= 15 ? 'success' : 'processing'} style={{ margin: 0 }}>
                    Công: {r.probationHoursCompleted ?? 0}h
                  </Tag>
                  <Tag color={r.testPassed ? 'success' : 'warning'} style={{ margin: 0 }}>
                    TEST: {r.testBestScorePercent ?? 0}%
                  </Tag>
                  <Tag color={r.probationMeetDone ? 'success' : 'default'} icon={<VideoCameraOutlined />} style={{ margin: 0 }}>
                    {r.probationMeetDone ? 'Đã vấn đáp Meet' : 'Chờ vấn đáp 15p'}
                  </Tag>
                </Space>
              ),
            },
            {
              title: 'Điểm Tín nhiệm (100đ)',
              key: 'credit',
              width: 155,
              render: (_, r) => {
                const pts = r.attendanceCreditPoints ?? 100;
                return (
                  <Tag color={pts >= 95 ? 'success' : pts >= 80 ? 'warning' : 'error'} icon={<CheckCircleOutlined />} style={{ margin: 0, fontWeight: 600 }}>
                    {pts}/100 điểm
                  </Tag>
                );
              },
            },
            {
              title: 'Thao tác Hợp đồng',
              key: 'action',
              width: 175,
              fixed: 'right',
              align: 'right',
              render: (_, r) => (
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<CloudUploadOutlined />}
                  onClick={(e) => { e.stopPropagation(); setSelectedEmp(r); }}
                >
                  Quản lý Hợp đồng ({r.contractsCount ?? 0}/4)
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={Boolean(liveSelectedEmp)}
        onCancel={() => setSelectedEmp(null)}
        destroyOnHidden
        width={820}
        title={liveSelectedEmp ? `Quản lý Hợp đồng Lao động & Đánh giá Thử việc: ${liveSelectedEmp.fullName} (${liveSelectedEmp.employeeCode})` : 'Quản lý Hợp đồng'}
        footer={<Button onClick={() => setSelectedEmp(null)}>Đóng</Button>}
      >
        {liveSelectedEmp && <EmployeeContractStorePanel employee={liveSelectedEmp} canManage={canManage} />}
      </Modal>
    </Space>
  );
}
