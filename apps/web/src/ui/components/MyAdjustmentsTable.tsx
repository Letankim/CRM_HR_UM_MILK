'use client';

import { Space, Tag, Typography } from 'antd';
import { ClockCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { StatusTag } from '../StatusTag';
import { useClientPagination } from '../hooks/useClientPagination';
import { formatAdjustmentProposal } from './AdjustmentEvidenceFields';
import { SelectableTable } from './BulkActionBar';
import { FancyboxImage } from './FancyboxPreview';
import { RowActionButtons } from './RowActionButtons';
import { cleanShiftName } from './self-attendance-shared';
import { exportAdjustmentsExcel } from './workflow-bulk-helpers';

type Row = Record<string, unknown>;

export interface MyAdjustmentsTableProps {
  adjustments: Row[]; loading?: boolean; onViewDetail: (record: Row) => void;
}

/** Bảng phiếu lỗi chấm công / bổ sung công của chính nhân viên, có loại phiếu và ảnh minh chứng. */
export function MyAdjustmentsTable({ adjustments, loading = false, onViewDetail }: MyAdjustmentsTableProps) {
  const pag = useClientPagination(10, 'phiếu');
  return (
    <SelectableTable<Row>
      size="small" rowKey="id" loading={loading} pagination={pag} dataSource={adjustments}
      locale={{ emptyText: 'Bạn chưa có phiếu bổ sung công nào.' }}
      bulkActions={[{ key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportAdjustmentsExcel(rows) }]}
      columns={[
        { title: 'Mã phiếu', dataIndex: 'adjustment_code', width: 115, render: (v: string) => <Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag> },
        { title: 'Ngày công', dataIndex: 'work_date', width: 110, render: (v: string) => <strong className="num">{v ? dayjs(v).format('DD/MM/YYYY') : '—'}</strong> },
        { title: 'Khung ca & Giờ ca', width: 215, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.shift_code)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{String(r.shiftTimeRange || '07:00 – 12:00')}</Tag></Space> },
        {
          title: 'Loại phiếu, Lý do & Quyết định',
          render: (_, r) => (
            <div>
              {Boolean(r.punchTypeLabel) && <Tag color="orange" style={{ margin: '0 6px 2px 0' }}>{String(r.punchTypeLabel)}</Tag>}
              <span>{String(r.reason || '')}</span>
              {Boolean(r.decision_reason) && <div style={{ fontSize: 11, color: r.status === 'REJECTED' ? '#DC2626' : '#15803D', marginTop: 2 }}>{r.status === 'REJECTED' ? 'Lý do từ chối: ' : 'Quyết định xử lý: '}{String(r.decision_reason)}</div>}
            </div>
          ),
        },
        {
          title: 'Minh chứng', dataIndex: 'evidencePhotoUrl', width: 96,
          render: (v: string, r) => v ? (
            <div style={{ width: 72, border: '1px solid #E5E7EB', borderRadius: 4, overflow: 'hidden' }}>
              <FancyboxImage src={v} alt="Ảnh minh chứng" caption={`Minh chứng ${String(r.adjustment_code || '')}`} height={48} />
            </div>
          ) : <Typography.Text type="secondary" style={{ fontSize: 12 }}>Không có</Typography.Text>,
        },
        { title: 'Giờ đề nghị', width: 115, render: (_, r) => <strong className="num">{formatAdjustmentProposal(r)}</strong> },
        { title: 'Trạng thái', dataIndex: 'status', width: 150, render: (v: string, r) => <StatusTag value={v} label={String(r.statusLabel || '') || undefined} /> },
        { title: 'Thao tác', width: 88, fixed: 'right', align: 'right', render: (_, r) => <RowActionButtons detailTooltip="Xem chi tiết phiếu" onViewDetail={() => onViewDetail(r)} /> },
      ]}
    />
  );
}
