'use client';

import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, Flex, Input, Progress, Row, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, HddOutlined, SearchOutlined } from '@ant-design/icons';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '@/lib/use-debounce';
import { formatBytes, type DevPgTableStat, type DevSystemStatsResponse } from '@/lib/dev-monitor-api';

interface DevPostgresStorageTabProps {
  postgres: DevSystemStatsResponse['postgres'];
}

export function DevPostgresStorageTab({ postgres }: DevPostgresStorageTabProps) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('ALL');
  const debouncedSearch = useDebouncedValue(search, 400);

  const groupOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of postgres.tables) map.set(t.group, t.groupLabel);
    return [{ value: 'ALL', label: 'Tất cả phân hệ PostgreSQL' }, ...Array.from(map.entries()).map(([value, label]) => ({ value, label }))];
  }, [postgres.tables]);

  const filteredTables = useMemo(() => {
    const kw = debouncedSearch.trim().toLowerCase();
    return postgres.tables.filter((t) => {
      if (groupFilter !== 'ALL' && t.group !== groupFilter) return false;
      if (!kw) return true;
      return t.displayLabel.toLowerCase().includes(kw) || t.pgTableName.toLowerCase().includes(kw) || t.groupLabel.toLowerCase().includes(kw);
    });
  }, [postgres.tables, groupFilter, debouncedSearch]);

  const handleExportExcel = () => {
    exportToExcel<DevPgTableStat>({
      fileName: `Bao_cao_Dung_luong_PostgreSQL_${new Date().toISOString().slice(0, 10)}`,
      sheetTitle: 'THỐNG KÊ DUNG LƯỢNG LƯU TRỮ & BẢNG VẬT LÝ POSTGRESQL',
      subtitle: `Đã dùng: ${postgres.storage.usedMb} MB / ${postgres.storage.quotaMb} MB | Còn trống: ${postgres.storage.freeMb} MB (${postgres.storage.freePercent}%) | Tổng bảng: ${filteredTables.length}`,
      columns: [
        { header: 'STT', align: 'center', render: (_, idx) => idx + 1 },
        { header: 'Tên bảng nghiệp vụ', key: 'displayLabel' },
        { header: 'Bảng SQL vật lý', key: 'pgTableName' },
        { header: 'Phân hệ', key: 'groupLabel' },
        { header: 'Số cột', key: 'columnCount', align: 'right' },
        { header: 'Số Index', key: 'indexCount', align: 'right' },
        { header: 'Số dòng thực tế', key: 'rowCount', align: 'right' },
        { header: 'Chờ đồng bộ', key: 'unsyncedRows', align: 'right' },
        { header: 'Dung lượng Dữ liệu', align: 'right', render: (r) => formatBytes(r.dataBytes) },
        { header: 'Dung lượng Index', align: 'right', render: (r) => formatBytes(r.indexBytes) },
        { header: 'Tổng dung lượng', align: 'right', render: (r) => formatBytes(r.totalBytes) },
        { header: 'Tỷ trọng (%)', align: 'right', render: (r) => `${r.sharePercent}%` },
      ],
      rows: filteredTables,
    });
  };

  const columns: ColumnsType<DevPgTableStat> = [
    { title: 'NO', width: 64, align: 'center', render: (_, __, idx) => <Typography.Text strong>{idx + 1}</Typography.Text> },
    {
      title: 'Tên bảng nghiệp vụ & Bảng SQL',
      key: 'name',
      render: (_, r) => (
        <div>
          <Typography.Text strong style={{ color: '#0F172A', display: 'block' }}>{r.displayLabel}</Typography.Text>
          <Typography.Text code style={{ fontSize: 11 }}>{r.pgTableName}</Typography.Text>
        </div>
      ),
    },
    {
      title: 'Phân hệ',
      dataIndex: 'groupLabel',
      width: 210,
      render: (val: string) => <Tag color="blue" style={{ borderRadius: 2 }}>{val}</Tag>,
    },
    {
      title: 'Cấu trúc',
      width: 145,
      align: 'center',
      render: (_, r) => <Typography.Text style={{ fontSize: 12, color: '#475569' }}>{r.columnCount} cột · {r.indexCount} index</Typography.Text>,
    },
    {
      title: 'Số dòng PG',
      dataIndex: 'rowCount',
      width: 125,
      align: 'right',
      sorter: (a, b) => a.rowCount - b.rowCount,
      render: (v: number) => <Typography.Text strong>{v.toLocaleString('vi-VN')}</Typography.Text>,
    },
    {
      title: 'Chờ đồng bộ',
      dataIndex: 'unsyncedRows',
      width: 125,
      align: 'center',
      sorter: (a, b) => a.unsyncedRows - b.unsyncedRows,
      render: (v: number) => (
        <Tag color={v > 0 ? 'warning' : 'success'} style={{ borderRadius: 2, margin: 0 }}>
          {v > 0 ? `${v} chờ đẩy` : 'Đã khớp 100%'}
        </Tag>
      ),
    },
    {
      title: 'Dữ liệu bảng',
      dataIndex: 'dataBytes',
      width: 125,
      align: 'right',
      sorter: (a, b) => a.dataBytes - b.dataBytes,
      render: (v: number) => formatBytes(v),
    },
    {
      title: 'Bộ chỉ mục (Index)',
      dataIndex: 'indexBytes',
      width: 135,
      align: 'right',
      sorter: (a, b) => a.indexBytes - b.indexBytes,
      render: (v: number) => formatBytes(v),
    },
    {
      title: 'Tổng dung lượng',
      dataIndex: 'totalBytes',
      width: 155,
      align: 'right',
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.totalBytes - b.totalBytes,
      render: (v: number, r) => (
        <div>
          <Typography.Text strong style={{ color: '#0F172A', display: 'block' }}>{formatBytes(v)}</Typography.Text>
          <Typography.Text style={{ fontSize: 11, color: '#64748B' }}>{r.sharePercent}% DB</Typography.Text>
        </div>
      ),
    },
  ];

  if (!postgres.enabled) {
    return <Alert type="warning" showIcon message="Môi trường này chưa cấu hình biến DATABASE_URL" description="Hãy điền chuỗi kết nối PostgreSQL vào biến môi trường DATABASE_URL trên máy chủ Backend để kích hoạt lưu trữ PostgreSQL chính và theo dõi dung lượng chi tiết." />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={<Space><HddOutlined /><span>Phân tích Dung lượng Lưu trữ PostgreSQL</span></Space>} style={{ height: '100%', border: '1px solid #E5E7EB', borderRadius: 4 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Flex justify="space-between" align="baseline" wrap="wrap">
                <Typography.Text strong style={{ fontSize: 14 }}>
                  Đã sử dụng: <span style={{ color: '#2563EB' }}>{postgres.storage.usedMb} MB</span> ({formatBytes(postgres.storage.usedBytes)})
                </Typography.Text>
                <Typography.Text strong style={{ fontSize: 14, color: '#16A34A' }}>
                  Còn trống khả dụng: {postgres.storage.freeMb} MB ({postgres.storage.freePercent}%)
                </Typography.Text>
              </Flex>
              <Progress percent={postgres.storage.usagePercent} strokeColor={postgres.storage.usagePercent >= 85 ? '#DC2626' : '#2563EB'} />
              <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
                <Descriptions.Item label="Tổng hạn mức gói">{postgres.storage.quotaMb} MB ({formatBytes(postgres.storage.quotaBytes)})</Descriptions.Item>
                <Descriptions.Item label="Dung lượng còn trống">{postgres.storage.freeMb} MB ({formatBytes(postgres.storage.freeBytes)})</Descriptions.Item>
                <Descriptions.Item label="Dữ liệu thuần (44 bảng)">{formatBytes(postgres.storage.tablesDataBytes)}</Descriptions.Item>
                <Descriptions.Item label="Chỉ mục B-Tree (Indexes)">{formatBytes(postgres.storage.tablesIndexBytes)}</Descriptions.Item>
                <Descriptions.Item label="Tổng các bảng User">{formatBytes(postgres.storage.tablesTotalBytes)}</Descriptions.Item>
                <Descriptions.Item label="Hệ thống / Catalog / WAL">{formatBytes(postgres.storage.systemOverheadBytes)}</Descriptions.Item>
              </Descriptions>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Thông số Máy chủ PostgreSQL & Kết nối Đồng thời" style={{ height: '100%', border: '1px solid #E5E7EB', borderRadius: 4 }}>
            <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="Chế độ vận hành" span={2}>{postgres.modeLabel}</Descriptions.Item>
              <Descriptions.Item label="Máy chủ (Host)">{postgres.host}</Descriptions.Item>
              <Descriptions.Item label="Tên Database">{postgres.database}</Descriptions.Item>
              <Descriptions.Item label="Phiên bản Engine" span={2}>{postgres.serverVersion}</Descriptions.Item>
              <Descriptions.Item label="Kết nối Server tối đa">{postgres.connections.serverMax} kết nối</Descriptions.Item>
              <Descriptions.Item label="Slot kết nối còn trống">
                <Tag color="success" style={{ margin: 0, borderRadius: 2 }}>{postgres.connections.serverFree} slot trống</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Đang dùng trên Server">{postgres.connections.serverUsed} ({postgres.connections.serverActive} active / {postgres.connections.serverIdle} idle)</Descriptions.Item>
              <Descriptions.Item label="Pool kết nối Node API">{postgres.connections.poolTotal} mở / {postgres.connections.poolIdle} rảnh / {postgres.connections.poolWaiting} chờ (Max {postgres.connections.poolMax})</Descriptions.Item>
              <Descriptions.Item label="Khởi động PG từ">{postgres.serverStartedAt ? new Date(postgres.serverStartedAt).toLocaleString('vi-VN') : '-'}</Descriptions.Item>
              <Descriptions.Item label="Đồng bộ Outbox gần nhất">{postgres.sync.outbox.lastSyncedAt ? new Date(postgres.sync.outbox.lastSyncedAt).toLocaleString('vi-VN') : 'Chưa phát sinh ghi mới'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Card style={{ border: '1px solid #E5E7EB', borderRadius: 4 }} styles={{ body: { padding: 16 } }}>
        <Flex justify="space-between" align="center" wrap="wrap" gap={12} style={{ marginBottom: 14 }}>
          <Space wrap>
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: '#64748B' }} />}
              placeholder="Tìm tên bảng tiếng Việt hoặc tên bảng SQL..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 320 }}
            />
            <Select value={groupFilter} onChange={setGroupFilter} options={groupOptions} style={{ width: 260 }} />
          </Space>
          <Button icon={<DownloadOutlined />} onClick={handleExportExcel}>
            Xuất Excel Dung lượng PG ({filteredTables.length})
          </Button>
        </Flex>

        <Table<DevPgTableStat>
          rowKey="pgTableName"
          size="middle"
          bordered
          columns={columns}
          dataSource={filteredTables}
          pagination={{ defaultPageSize: 15, showSizeChanger: true, pageSizeOptions: ['15', '30', '50'], showTotal: (t) => `Tổng ${t} bảng vật lý PostgreSQL` }}
          scroll={{ x: 1050 }}
        />
      </Card>
    </Space>
  );
}
