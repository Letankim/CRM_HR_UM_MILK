'use client';

import { useMemo, useState } from 'react';
import { Button, Card, Col, Descriptions, Flex, Input, Row, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, SearchOutlined, TableOutlined } from '@ant-design/icons';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '@/lib/use-debounce';
import type { DevStoreStat, DevSystemStatsResponse } from '@/lib/dev-monitor-api';

interface DevDomainStatsTabProps {
  domain: DevSystemStatsResponse['domain'];
}

export function DevDomainStatsTab({ domain }: DevDomainStatsTabProps) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('ALL');
  const debouncedSearch = useDebouncedValue(search, 400);
  const { business } = domain;

  const groupOptions = useMemo(
    () => [{ value: 'ALL', label: 'Tất cả 7 phân hệ nghiệp vụ' }, ...domain.moduleGroups.map((g) => ({ value: g.group, label: g.groupLabel }))],
    [domain.moduleGroups],
  );

  const filteredStores = useMemo(() => {
    const kw = debouncedSearch.trim().toLowerCase();
    return domain.stores.filter((s) => {
      if (groupFilter !== 'ALL' && s.group !== groupFilter) return false;
      if (!kw) return true;
      return s.displayLabel.toLowerCase().includes(kw) || s.tabName.toLowerCase().includes(kw) || s.groupLabel.toLowerCase().includes(kw);
    });
  }, [domain.stores, groupFilter, debouncedSearch]);

  const handleExportExcel = () => {
    exportToExcel<DevStoreStat>({
      fileName: `Bao_cao_Du_lieu_Nghiep_vu_${new Date().toISOString().slice(0, 10)}`,
      sheetTitle: 'THỐNG KÊ SỐ LƯỢNG DỮ LIỆU TOÀN HỆ THỐNG THEO BẢNG & PHÂN HỆ',
      subtitle: `Tổng bản ghi hoạt động: ${domain.totalActiveRows} | Bản ghi đã xóa mềm: ${domain.totalDeletedRows} | Tổng bảng: ${filteredStores.length}`,
      columns: [
        { header: 'STT', align: 'center', render: (_, i) => i + 1 },
        { header: 'Tên bảng dữ liệu', key: 'displayLabel' },
        { header: 'Phân hệ', key: 'groupLabel' },
        { header: 'Tab lưu trữ hiện hành', key: 'tabName' },
        { header: 'Bản ghi đang hoạt động', key: 'activeRows', align: 'right' },
        { header: 'Bản ghi đã xóa mềm', key: 'deletedRows', align: 'right' },
        { header: 'Tổng dòng lưu trữ', key: 'totalRows', align: 'right' },
        { header: 'Dòng lỗi định dạng', key: 'invalidRows', align: 'right' },
        { header: 'Cập nhật bộ nhớ lúc', render: (r) => (r.loadedAt ? new Date(r.loadedAt).toLocaleString('vi-VN') : '-') },
      ],
      rows: filteredStores,
    });
  };

  const columns: ColumnsType<DevStoreStat> = [
    { title: 'NO', width: 64, align: 'center', render: (_, __, i) => <Typography.Text strong>{i + 1}</Typography.Text> },
    {
      title: 'Bảng dữ liệu nghiệp vụ',
      key: 'displayLabel',
      render: (_, r) => (
        <div>
          <Typography.Text strong style={{ color: '#0F172A', display: 'block' }}>{r.displayLabel}</Typography.Text>
          <Space size={6}>
            <Typography.Text code style={{ fontSize: 11 }}>{r.tabName}</Typography.Text>
            {r.isMonthlyPartitioned ? <Tag color="purple" style={{ margin: 0, borderRadius: 2, fontSize: 11 }}>Phân vùng theo tháng</Tag> : null}
          </Space>
        </div>
      ),
    },
    { title: 'Phân hệ', dataIndex: 'groupLabel', width: 220, render: (v: string) => <Tag color="geekblue" style={{ borderRadius: 2 }}>{v}</Tag> },
    {
      title: 'Đang hoạt động',
      dataIndex: 'activeRows',
      width: 140,
      align: 'right',
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.activeRows - b.activeRows,
      render: (v: number) => <Typography.Text strong style={{ color: '#2563EB' }}>{v.toLocaleString('vi-VN')}</Typography.Text>,
    },
    {
      title: 'Đã xóa mềm',
      dataIndex: 'deletedRows',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.deletedRows - b.deletedRows,
      render: (v: number) => <Typography.Text style={{ color: v > 0 ? '#D97706' : '#64748B' }}>{v.toLocaleString('vi-VN')}</Typography.Text>,
    },
    {
      title: 'Tổng dòng',
      dataIndex: 'totalRows',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.totalRows - b.totalRows,
      render: (v: number) => v.toLocaleString('vi-VN'),
    },
    {
      title: 'Toàn vẹn Schema',
      dataIndex: 'invalidRows',
      width: 140,
      align: 'center',
      render: (v: number) => <Tag color={v > 0 ? 'error' : 'success'} style={{ margin: 0, borderRadius: 2 }}>{v > 0 ? `${v} dòng lỗi` : 'Hợp lệ 100%'}</Tag>,
    },
    {
      title: 'Đồng bộ Cache lúc',
      dataIndex: 'loadedAt',
      width: 175,
      render: (v: string | null) => <Typography.Text style={{ fontSize: 12, color: '#64748B' }}>{v ? new Date(v).toLocaleString('vi-VN') : '-'}</Typography.Text>,
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[12, 12]}>
        {domain.moduleGroups.map((g) => (
          <Col xs={24} sm={12} md={8} xl={6} key={g.group}>
            <Card style={{ height: '100%', border: '1px solid #E5E7EB', borderRadius: 4 }} styles={{ body: { padding: 14 } }}>
              <Flex justify="space-between" align="center">
                <Typography.Text strong style={{ color: '#0F172A', fontSize: 13 }}>{g.groupLabel}</Typography.Text>
                <Tag color="blue" style={{ margin: 0, borderRadius: 2 }}>{g.tableCount} bảng</Tag>
              </Flex>
              <Typography.Title level={4} style={{ margin: '8px 0 2px', color: '#2563EB' }}>
                {g.activeRows.toLocaleString('vi-VN')} <span style={{ fontSize: 12, fontWeight: 400, color: '#64748B' }}>bản ghi hoạt động</span>
              </Typography.Title>
              <Typography.Text style={{ fontSize: 12, color: '#64748B' }}>
                Đã xóa mềm: {g.deletedRows.toLocaleString('vi-VN')} · Tổng lưu: {g.totalRows.toLocaleString('vi-VN')}
              </Typography.Text>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <Card title="Tài khoản, Nhân sự & Tuyển dụng" style={{ height: '100%', border: '1px solid #E5E7EB', borderRadius: 4 }}>
            <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="Tổng Tài khoản">{business.accounts.total} tài khoản</Descriptions.Item>
              <Descriptions.Item label="Chi nhánh hoạt động">{business.employees.branchesActive} / {business.employees.branchesTotal} chi nhánh</Descriptions.Item>
              <Descriptions.Item label="Trạng thái Tài khoản" span={2}>
                <Space size={[6, 6]} wrap>
                  {business.accounts.byStatus.map((s) => <Tag key={s.label} style={{ margin: 0, borderRadius: 2 }}>{s.label}: <strong>{s.count}</strong></Tag>)}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Phân bổ Vai trò" span={2}>
                <Space size={[6, 6]} wrap>
                  {business.accounts.byRole.map((r) => <Tag key={r.label} color="blue" style={{ margin: 0, borderRadius: 2 }}>{r.label}: <strong>{r.count}</strong></Tag>)}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Hồ sơ Nhân sự" span={2}>
                <Space size={[6, 6]} wrap>
                  {business.employees.byStage.map((s) => <Tag key={s.label} color="cyan" style={{ margin: 0, borderRadius: 2 }}>{s.label}: <strong>{s.count}</strong></Tag>)}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Ứng viên tuyển dụng">{business.recruitment.candidatesTotal} (Đạt/Nhận: {business.recruitment.candidatesOfferedOrHired})</Descriptions.Item>
              <Descriptions.Item label="Phỏng vấn & Đề thi">{business.recruitment.interviewsEvaluated}/{business.recruitment.interviewsTotal} ca PV · {business.recruitment.testBankQuestions} câu hỏi</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Lịch ca, Chấm công, Tiền lương & Toàn vẹn Saga" style={{ height: '100%', border: '1px solid #E5E7EB', borderRadius: 4 }}>
            <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="Kỳ dữ liệu đang mở">{business.operations.activePartitionLabel}</Descriptions.Item>
              <Descriptions.Item label="Tuần lịch đã tạo">{business.operations.scheduleWeeks} tuần lịch</Descriptions.Item>
              <Descriptions.Item label="Phân công Ca">{business.operations.shiftsTotal} ca (Hoàn thành: {business.operations.shiftsCompleted}, Vắng: {business.operations.shiftsAbsent})</Descriptions.Item>
              <Descriptions.Item label="Đơn Nghỉ & Đổi ca">{business.operations.leavesTotal} đơn OFF ({business.operations.leavesPending} chờ) · {business.operations.swapsTotal} đổi ca</Descriptions.Item>
              <Descriptions.Item label="Điểm danh GPS">{business.operations.attendanceEvents} lượt gốc · {business.operations.attendanceAdjustments} bổ sung</Descriptions.Item>
              <Descriptions.Item label="Hồ sơ Lương cá nhân">{business.payroll.payRates} bậc lương · {business.payroll.payrollItems} khoản thưởng/phụ cấp</Descriptions.Item>
              <Descriptions.Item label="Kỳ lương & Phiếu lương" span={2}>
                <Space size={[6, 6]} wrap>
                  <Tag color="geekblue" style={{ margin: 0, borderRadius: 2 }}>Phiếu lương: <strong>{business.payroll.payslips}</strong></Tag>
                  <Tag color="purple" style={{ margin: 0, borderRadius: 2 }}>Snapshot: <strong>{business.payroll.snapshots}</strong></Tag>
                  {business.payroll.byPeriodStatus.map((p) => <Tag key={p.label} style={{ margin: 0, borderRadius: 2 }}>{p.label}: <strong>{p.count}</strong></Tag>)}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Thông báo & Hỗ trợ">{business.commsAndSystem.notificationsTotal} TB ({business.commsAndSystem.notificationsUnread} chưa đọc) · {business.commsAndSystem.ticketsOpen}/{business.commsAndSystem.ticketsTotal} Ticket mở</Descriptions.Item>
              <Descriptions.Item label="Saga & Đối soát">{business.commsAndSystem.sagasCommitted}/{business.commsAndSystem.sagasTotal} Saga hoàn tất · {business.commsAndSystem.deadLettersUnresolved} Dead-letter · {business.commsAndSystem.auditLogsCurrentMonth} Audit tháng</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Card title={<Space><TableOutlined /><span>Chi tiết Bộ nhớ Đệm Toàn bộ Bảng Nghiệp vụ ({filteredStores.length})</span></Space>} style={{ border: '1px solid #E5E7EB', borderRadius: 4 }}>
        <Flex justify="space-between" align="center" wrap="wrap" gap={12} style={{ marginBottom: 14 }}>
          <Space wrap>
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: '#64748B' }} />}
              placeholder="Tìm tên bảng dữ liệu hoặc tên tab..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 320 }}
            />
            <Select value={groupFilter} onChange={setGroupFilter} options={groupOptions} style={{ width: 260 }} />
          </Space>
          <Button icon={<DownloadOutlined />} onClick={handleExportExcel}>
            Xuất Excel Thống kê Dữ liệu ({filteredStores.length})
          </Button>
        </Flex>

        <Table<DevStoreStat>
          rowKey={(r) => `${r.tableKey}-${r.tabName}`}
          size="middle"
          bordered
          columns={columns}
          dataSource={filteredStores}
          pagination={{ defaultPageSize: 15, showSizeChanger: true, pageSizeOptions: ['15', '30', '50'], showTotal: (t) => `Tổng ${t} bảng nghiệp vụ` }}
          scroll={{ x: 980 }}
        />
      </Card>
    </Space>
  );
}
