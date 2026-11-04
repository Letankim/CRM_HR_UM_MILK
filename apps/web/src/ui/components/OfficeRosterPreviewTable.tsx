'use client';

import { Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';

export interface OfficeStaffSummaryItem {
  id: string;
  code: string;
  name: string;
  roleTitle: string;
  branchName: string;
  plannedCount: number;
  days: {
    date: string;
    weekday: number;
    type: 'PLANNED' | 'EXISTING' | 'OFF' | 'WEEKEND_OFF';
    label: string;
    hours: number;
  }[];
}

interface Props {
  dataSource: OfficeStaffSummaryItem[];
  loading: boolean;
}

const WEEKDAY_NAMES = ['', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

export function OfficeRosterPreviewTable({ dataSource, loading }: Props) {
  const dayColumns: ColumnsType<OfficeStaffSummaryItem> = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    title: WEEKDAY_NAMES[weekday],
    key: `day_${weekday}`,
    align: 'center',
    width: 105,
    render: (_, record) => {
      const d = record.days.find((x) => x.weekday === weekday);
      if (!d) return <span style={{ color: '#94A3B8' }}>—</span>;
      if (d.type === 'WEEKEND_OFF') return <span style={{ color: '#94A3B8' }}>Nghỉ</span>;
      if (d.type === 'OFF') return <Tag color="orange" style={{ margin: 0 }}>Nghỉ OFF</Tag>;
      if (d.type === 'EXISTING') return <Tag color="default" style={{ margin: 0 }}>Đã có ca</Tag>;
      return (
        <Tag color={weekday === 6 ? 'cyan' : 'blue'} style={{ margin: 0 }}>
          {d.label} {d.hours ? `(${d.hours}h)` : ''}
        </Tag>
      );
    },
  }));

  const columns: ColumnsType<OfficeStaffSummaryItem> = [
    {
      title: 'Nhân sự văn phòng',
      key: 'staff',
      width: 200,
      fixed: 'left',
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 600, color: '#0F172A' }}>{r.name}</div>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {r.code} · {r.roleTitle}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: 'Chi nhánh',
      dataIndex: 'branchName',
      key: 'branchName',
      width: 140,
      render: (v) => <span style={{ fontSize: 12 }}>{v || 'Văn phòng'}</span>,
    },
    ...dayColumns,
    {
      title: 'Dự kiến tạo',
      key: 'plannedCount',
      align: 'center',
      width: 95,
      fixed: 'right',
      render: (_, r) => (
        <Tag color={r.plannedCount > 0 ? 'green' : 'default'} style={{ margin: 0, fontWeight: 600 }}>
          {r.plannedCount} ca
        </Tag>
      ),
    },
  ];

  return (
    <Table<OfficeStaffSummaryItem>
      rowKey="id"
      size="small"
      loading={loading}
      columns={columns}
      dataSource={dataSource}
      pagination={false}
      scroll={{ x: 1100 }}
      bordered
    />
  );
}
