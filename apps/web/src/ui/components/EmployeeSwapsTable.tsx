'use client';

import { App, Space, Tag } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, CloseOutlined, DownloadOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { StatusTag } from '../StatusTag';
import { useClientPagination } from '../hooks/useClientPagination';
import { SelectableTable } from './BulkActionBar';
import { RowActionButtons } from './RowActionButtons';
import { fmtShiftTime } from './EmployeeShiftsTable';
import { cleanShiftName } from './self-attendance-shared';
import { renderSwapAllowanceTag } from './ShiftSwapApproveModal';
import { exportSwapsExcel } from './workflow-bulk-helpers';
import { confirmWorkflowShiftOverride, renderWorkflowShiftStateTag } from './workflow-shift-warning';

type Row = Record<string, unknown>;

export interface EmployeeSwapsTableProps {
  swaps: Row[]; empId: string; empCode: string; refreshing?: boolean; onViewDetail: (record: Row) => void; onRefresh: () => void;
}

/** Bảng yêu cầu Nhường ca / Đổi ca 2 chiều của chính nhân viên (người gửi hoặc người nhận). */
export function EmployeeSwapsTable({ swaps, empId, empCode, refreshing = false, onViewDetail, onRefresh }: EmployeeSwapsTableProps) {
  const { message, modal } = App.useApp();
  const pag = useClientPagination(10, 'yêu cầu');
  const isPeer = (r: Row) => r.peer_id === empId || r.peerCode === empCode;
  const isRequester = (r: Row) => r.requester_id === empId || r.requesterCode === empCode;
  const canRespond = (r: Row) => r.status === 'PENDING_PEER' && isPeer(r);
  const canCancel = (r: Row) => (r.status === 'PENDING_PEER' || r.status === 'PEER_ACCEPTED') && isRequester(r);

  const peerRespondMut = useMutation({
    mutationFn: async (items: { id: string; version: number; accept: boolean }[]) => {
      for (const it of items) await api.post(`/admin/shift-swaps/${it.id}/peer-respond`, { version: it.version, accept: it.accept, peer_note: it.accept ? 'Đồng ý nhận ca' : 'Bận lịch cá nhân, không thể nhận ca' });
      return items[0]?.accept;
    },
    onSuccess: (accept) => { message.success(accept ? 'Đã xác nhận đồng ý. Lịch được cập nhật ngay hoặc chuyển HR duyệt nếu người nhận vượt 2 ca/ngày.' : 'Đã từ chối yêu cầu'); onRefresh(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại'),
  });
  const cancelMut = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await api.post(`/admin/shift-swaps/${id}/cancel`, {}); },
    onSuccess: () => { message.success('Đã hủy yêu cầu nhường / đổi ca'); onRefresh(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể hủy yêu cầu'),
  });
  const respond = (rows: Row[], accept: boolean) => peerRespondMut.mutate(rows.map((r) => ({ id: String(r.id), version: Number(r.version), accept })));
  const accept = (rows: Row[]) => confirmWorkflowShiftOverride(modal, 'swap', rows, () => respond(rows, true));
  const confirmCancel = (rows: Row[]) => modal.confirm({
    title: 'Hủy yêu cầu', content: `Bạn chắc chắn muốn hủy ${rows.length} yêu cầu nhường / đổi ca đang chờ?`,
    okText: 'Hủy yêu cầu', okButtonProps: { danger: true, icon: <StopOutlined /> }, cancelText: 'Đóng', cancelButtonProps: { icon: <CloseOutlined /> },
    onOk: () => cancelMut.mutateAsync(rows.map((r) => String(r.id))),
  });
  const busy = peerRespondMut.isPending || cancelMut.isPending;

  return (
    <SelectableTable<Row>
      size="small" rowKey="id" loading={refreshing} pagination={pag} dataSource={swaps} onRowClick={onViewDetail}
      bulkActions={[
        { key: 'accept', label: 'Đồng ý đã chọn', type: 'primary', icon: <CheckCircleOutlined />, loading: peerRespondMut.isPending, eligibleFilter: canRespond, onClick: accept },
        { key: 'reject', label: 'Từ chối đã chọn', danger: true, icon: <CloseCircleOutlined />, loading: peerRespondMut.isPending, eligibleFilter: canRespond, onClick: (rows) => respond(rows, false) },
        { key: 'cancel', label: 'Hủy yêu cầu đã chọn', danger: true, icon: <StopOutlined />, loading: cancelMut.isPending, eligibleFilter: canCancel, onClick: confirmCancel },
        { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportSwapsExcel(rows) },
      ]}
      locale={{ emptyText: 'Bạn chưa có yêu cầu nhường / đổi ca nào. Bấm "Nhường / Đổi ca" phía trên để gửi yêu cầu cho đồng nghiệp.' }}
      columns={[
        { title: 'Mã đơn', dataIndex: 'swap_code', width: 115, render: (v: string) => <Tag color="purple" style={{ margin: 0 }}>{v}</Tag> },
        { title: 'Loại', dataIndex: 'kind', width: 125, render: (v: string, r) => <Tag color={v === 'SWAP' ? 'geekblue' : 'cyan'} style={{ margin: 0 }}>{String(r.kindLabel || '')}</Tag> },
        {
          title: 'Ca nhường / đổi', width: 300,
          render: (_, r) => {
            const to = r.toShiftDetails as Row | null | undefined;
            return (
              <Space direction="vertical" size={2}>
                <Space size={6} wrap><strong className="num">{r.from_work_date ? dayjs(String(r.from_work_date)).format('DD/MM/YYYY') : '—'}</strong><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.from_shift_code)}</span><Tag color="geekblue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag>{renderWorkflowShiftStateTag(r)}</Space>
                {r.kind === 'SWAP' && to && (
                  <Space size={6} wrap style={{ fontSize: 12, color: '#64748B' }}><span>Nhận về:</span><strong className="num">{r.to_work_date ? dayjs(String(r.to_work_date)).format('DD/MM/YYYY') : '—'}</strong><span>{cleanShiftName(to.shiftLabel || r.to_shift_code)}</span><Tag style={{ margin: 0 }}>{String(to.shiftTimeRange || `${String(to.startAt || '')} – ${String(to.endAt || '')}`)}</Tag></Space>
                )}
              </Space>
            );
          },
        },
        { title: 'Người gửi', width: 180, ellipsis: true, render: (_, r) => <Space size={4}><span>{String(r.requesterName || '')}</span>{isRequester(r) && <Tag color="blue" style={{ margin: 0 }}>Bạn</Tag>}</Space> },
        { title: 'Người nhận', width: 180, ellipsis: true, render: (_, r) => <Space size={4}><span>{String(r.peerName || '')}</span>{isPeer(r) && <Tag color="cyan" style={{ margin: 0 }}>Bạn</Tag>}</Space> },
        { title: 'Trạng thái', dataIndex: 'status', width: 230, render: (v: string, r) => <Space size={4} wrap><StatusTag value={v} label={String(r.statusLabel || '') || undefined} />{renderSwapAllowanceTag(r, true)}</Space> },
        {
          title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
          render: (_, r) => (
            <RowActionButtons
              detailTooltip="Xem chi tiết yêu cầu" onViewDetail={() => onViewDetail(r)} loading={busy}
              menuItems={[
                ...(canRespond(r) ? [
                  { key: 'accept', icon: <CheckCircleOutlined style={{ color: '#16A34A' }} />, label: r.kind === 'SWAP' ? 'Đồng ý đổi ca' : 'Đồng ý nhận ca', onClick: () => accept([r]) },
                  { key: 'reject', icon: <CloseCircleOutlined />, danger: true, label: 'Từ chối', onClick: () => respond([r], false) },
                ] : []),
                ...(canCancel(r) ? [{ key: 'cancel', icon: <StopOutlined />, danger: true, label: 'Hủy yêu cầu', onClick: () => confirmCancel([r]) }] : []),
              ]}
            />
          ),
        },
      ]}
    />
  );
}
