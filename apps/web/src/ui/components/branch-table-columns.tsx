'use client';

import { Button, Space, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EditOutlined, EnvironmentOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { exportToExcel } from '@/lib/export-excel';
import type { BranchRowItem } from '@/ui/components/BranchFormModal';
import { RowActionButtons } from '@/ui/components/RowActionButtons';
import { StatusTag } from '@/ui/StatusTag';

/** Xuất danh mục chi nhánh, tọa độ GPS & bán kính điểm danh ra Excel. */
export function exportBranchesExcel(rows: BranchRowItem[]) {
  exportToExcel({
    fileName: `Chi_Nhanh_GPS_UmBoMilk_${dayjs().format('YYYYMMDD_HHmm')}.xls`,
    sheetTitle: 'Danh mục Chi nhánh, Tọa độ GPS & Bán kính Điểm danh',
    columns: [
      { header: 'Mã CN', key: 'code' },
      { header: 'Tên chi nhánh', key: 'name' },
      { header: 'Địa chỉ', key: 'address' },
      { header: 'Vĩ độ (Lat)', key: 'lat' },
      { header: 'Kinh độ (Lng)', key: 'lng' },
      { header: 'Bán kính (m)', key: 'radiusM' },
      { header: 'Nhân sự', key: 'employeeCount' },
      { header: 'Trạng thái', key: 'statusLabel' },
    ],
    rows,
  });
}

interface BuildBranchColumnsOptions {
  canConfig: boolean;
  onViewDetail: (row: BranchRowItem) => void;
  onEdit: (row: BranchRowItem) => void;
  onDelete: (row: BranchRowItem) => void;
}

/** Cột bảng danh mục chi nhánh (Địa chỉ, GPS, Nhân sự, Trạng thái, Thao tác). */
export function buildBranchColumns({ canConfig, onViewDetail, onEdit, onDelete }: BuildBranchColumnsOptions): ColumnsType<BranchRowItem> {
  return [
    {
      title: 'Chi nhánh & Địa chỉ',
      key: 'branch',
      render: (_, r) => (
        <div>
          <Space size={6}>
            <Tag color="blue" style={{ margin: 0, borderRadius: 2, fontWeight: 600 }}>{r.code}</Tag>
            <Typography.Text strong>{r.name}</Typography.Text>
          </Space>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>
            {r.address || 'TP. Hồ Chí Minh'} · Mở cửa: {r.openTime} – {r.closeTime}
          </div>
        </div>
      ),
    },
    {
      title: 'Tọa độ GPS & Bán kính Điểm danh',
      key: 'gps',
      render: (_, r) => (
        <div>
          <Space size={8} wrap>
            <span className="num" style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>
              <EnvironmentOutlined style={{ color: '#2563EB', marginRight: 4 }} />
              {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
            </span>
            <Button size="small" type="link" icon={<EnvironmentOutlined />} style={{ padding: 0, height: 20, fontSize: 12 }} href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noopener noreferrer">
              Xem trên Google Maps
            </Button>
          </Space>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
            Bán kính hợp lệ: <strong>{r.radiusM}m</strong> (Sai số tối đa {r.maxAccuracyM}m)
          </div>
        </div>
      ),
    },
    { title: 'Nhân sự', dataIndex: 'employeeCount', width: 105, align: 'center', render: (v: number) => <Tag color="geekblue" style={{ borderRadius: 2, margin: 0 }}>{v} nhân sự</Tag> },
    { title: 'Hiệu lực từ', dataIndex: 'effectiveFrom', width: 115, render: (v: string) => <span className="num" style={{ fontSize: 12 }}>{v}</span> },
    { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (v: string) => <StatusTag value={v} /> },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 88,
      fixed: 'right',
      align: 'right',
      render: (_, r) => (
        <RowActionButtons
          onViewDetail={() => onViewDetail(r)}
          detailTooltip="Xem chi tiết chi nhánh & tọa độ GPS"
          menuItems={
            canConfig
              ? [
                  { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa chi nhánh & GPS', onClick: () => onEdit(r) },
                  { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa chi nhánh', onClick: () => onDelete(r) },
                ]
              : []
          }
        />
      ),
    },
  ];
}
