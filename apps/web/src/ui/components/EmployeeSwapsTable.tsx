'use client';

import { useCallback } from 'react';
import { Alert, App, Space, Tag } from 'antd';
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
import { useWorkflowDecisionModal } from './WorkflowDecisionModal';
import { exportSwapsExcel } from './workflow-bulk-helpers';
import { renderWorkflowDecisionAlert, renderWorkflowShiftStateTag } from './workflow-shift-warning';

type Row = Record<string, unknown>;

/** Hook dùng chung mở popup phản hồi Đồng ý / Từ chối nhận hoặc đổi ca của người nhận (peer). */
export function usePeerSwapDecision({ empId, empCode, onSuccess }: { empId: string; empCode: string; onSuccess: () => void }) {
  const { message } = App.useApp();
  const { promptDecision, decisionModalElement } = useWorkflowDecisionModal();
  const isPeer = useCallback((r: Row) => r.peer_id === empId || r.peerCode === empCode, [empId, empCode]);
  const canClaim = useCallback((r: Row) => r.kind === 'HR_DISPATCH' && r.status === 'PENDING_PEER' && r.requester_id !== empId && r.requesterCode !== empCode, [empId, empCode]);
  const canRespond = useCallback((r: Row) => (r.status === 'PENDING_PEER' && isPeer(r)) || canClaim(r), [isPeer, canClaim]);

  const peerRespondMut = useMutation({
    mutationFn: async (vars: { rows: Row[]; accept: boolean; note: string; clear?: () => void }) => {
      for (const r of vars.rows) {
        await api.post(`/admin/shift-swaps/${String(r.id)}/peer-respond`, {
          version: Number(r.version), accept: vars.accept, peer_note: vars.note,
        });
      }
      return vars;
    },
    onSuccess: (vars) => {
      message.success(
        vars.rows.some((r) => r.kind === 'HR_DISPATCH')
          ? 'Đã nhận ca điều phối khẩn cấp (+30.000đ). Lịch làm việc và bảng lương của bạn đã được cập nhật ngay lập tức.'
          : vars.accept
          ? 'Đã xác nhận đồng ý. Lịch được cập nhật ngay hoặc chuyển HR duyệt nếu người nhận vượt 2 ca/ngày.'
          : 'Đã từ chối yêu cầu nhường / đổi ca',
      );
      vars.clear?.();
      onSuccess();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại'),
  });

  const promptRespond = useCallback((rows: Row[], accept: boolean, clear?: () => void) => {
    const eligible = rows.filter(canRespond);
    if (eligible.length === 0) return;
    const single = eligible.length === 1 ? eligible[0] : null;
    const code = single ? String(single.swap_code || '') : '';
    const requester = single ? String(single.requesterName || 'đồng nghiệp') : '';
    const isSwap = single ? single.kind === 'SWAP' : false;
    const isDispatch = single ? single.kind === 'HR_DISPATCH' : false;
    if (accept) {
      promptDecision({
        title: single ? (isDispatch ? `Nhận ca điều phối khẩn cấp (+30.000đ) — ${code}` : `${isSwap ? 'Đồng ý đổi ca 2 chiều' : 'Đồng ý nhận ca'} — ${code}`) : `Xác nhận nhận ${eligible.length} ca đã chọn`,
        subtitle: single ? (isDispatch ? `Cần nhân sự làm thay · Ngày ${single.from_work_date ? dayjs(String(single.from_work_date)).format('DD/MM/YYYY') : '—'} · ${cleanShiftName(single.shiftLabel || single.from_shift_code)} · Phụ cấp: +30.000đ/ca` : `Yêu cầu từ ${requester} · Ngày ${single.from_work_date ? dayjs(String(single.from_work_date)).format('DD/MM/YYYY') : '—'} · ${cleanShiftName(single.shiftLabel || single.from_shift_code)}`) : undefined,
        alertNode: isDispatch ? (
          <Alert type="success" showIcon message="Phụ cấp thưởng điều phối khẩn cấp: +30.000đ" description="Bạn đang nhận làm thay ca điều phối khẩn cấp từ Cửa hàng. Khi bấm xác nhận, ca này sẽ lập tức được nạp vào lịch làm việc chính thức của bạn và hệ thống tự động cộng +30.000đ vào kỳ lương." style={{ marginBottom: 12 }} />
        ) : renderWorkflowDecisionAlert('swap', eligible),
        noteLabel: isDispatch ? 'Ghi chú xác nhận nhận ca' : 'Ghi chú phản hồi cho đồng nghiệp',
        placeholder: isDispatch ? 'VD: Tôi sẵn sàng nhận làm thay ca này...' : 'Nhập ghi chú xác nhận (không bắt buộc)...',
        required: false,
        maxLength: 200,
        suggestions: isDispatch ? ['Tôi sẵn sàng nhận làm thay ca này', 'Đã sắp xếp thời gian để hỗ trợ chi nhánh'] : ['Đồng ý nhận ca hỗ trợ đồng nghiệp', 'Đã sắp xếp lịch cá nhân, đồng ý đổi ca'],
        okText: single ? (isDispatch ? 'Nhận ca làm thay (+30k)' : isSwap ? 'Đồng ý đổi ca' : 'Đồng ý nhận ca') : `Đồng ý (${eligible.length})`,
        onConfirm: async (note) => { await peerRespondMut.mutateAsync({ rows: eligible, accept: true, note, clear }); },
      });
      return;
    }
    promptDecision({
      title: single ? `Từ chối yêu cầu nhường / đổi ca — ${code}` : `Từ chối ${eligible.length} yêu cầu nhường / đổi ca đã chọn`,
      subtitle: single ? `Yêu cầu từ ${requester}` : undefined,
      noteLabel: 'Lý do từ chối nhận / đổi ca',
      placeholder: 'Nhập rõ lý do từ chối để đồng nghiệp nắm thông tin sắp xếp lại...',
      required: true,
      requiredMessage: 'Vui lòng nhập lý do từ chối yêu cầu nhường / đổi ca',
      maxLength: 200,
      danger: true,
      suggestions: ['Bận lịch cá nhân, không thể nhận ca này', 'Đã có kế hoạch khác trùng khung giờ ca'],
      okText: single ? 'Xác nhận từ chối' : `Từ chối (${eligible.length})`,
      onConfirm: async (note) => { await peerRespondMut.mutateAsync({ rows: eligible, accept: false, note, clear }); },
    });
  }, [canRespond, peerRespondMut, promptDecision]);

  return { isPeer, canClaim, canRespond, promptRespond, responding: peerRespondMut.isPending, decisionModalElement };
}

export interface EmployeeSwapsTableProps {
  swaps: Row[]; empId: string; empCode: string; refreshing?: boolean;
  onViewDetail: (record: Row) => void; onRefresh: () => void;
  onPeerRespond?: (rows: Row[], accept: boolean, clear?: () => void) => void;
  peerResponding?: boolean;
}

/** Bảng yêu cầu Nhường ca / Đổi ca 2 chiều của chính nhân viên (người gửi hoặc người nhận). */
export function EmployeeSwapsTable({
  swaps, empId, empCode, refreshing = false, onViewDetail, onRefresh, onPeerRespond, peerResponding,
}: EmployeeSwapsTableProps) {
  const { message, modal } = App.useApp();
  const pag = useClientPagination(10, 'yêu cầu');
  const fallbackPeer = usePeerSwapDecision({ empId, empCode, onSuccess: onRefresh });
  const isPeer = fallbackPeer.isPeer;
  const isRequester = (r: Row) => r.requester_id === empId || r.requesterCode === empCode;
  const canRespond = fallbackPeer.canRespond;
  const canCancel = (r: Row) => (r.status === 'PENDING_PEER' || r.status === 'PEER_ACCEPTED') && isRequester(r);
  const handleRespond = onPeerRespond ?? fallbackPeer.promptRespond;
  const isResponding = peerResponding ?? fallbackPeer.responding;

  const cancelMut = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await api.post(`/admin/shift-swaps/${id}/cancel`, {}); },
    onSuccess: () => { message.success('Đã hủy yêu cầu nhường / đổi ca'); onRefresh(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể hủy yêu cầu'),
  });
  const confirmCancel = (rows: Row[], clear?: () => void) => modal.confirm({
    title: 'Hủy yêu cầu', content: `Bạn chắc chắn muốn hủy ${rows.length} yêu cầu nhường / đổi ca đang chờ?`,
    okText: 'Hủy yêu cầu', okButtonProps: { danger: true, icon: <StopOutlined /> }, cancelText: 'Đóng', cancelButtonProps: { icon: <CloseOutlined /> },
    onOk: async () => { await cancelMut.mutateAsync(rows.map((r) => String(r.id))); clear?.(); },
  });
  const busy = isResponding || cancelMut.isPending;
  const openDispatches = swaps.filter(fallbackPeer.canClaim);

  return (
    <>
      {openDispatches.length > 0 && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message={<strong>Cửa hàng đang có {openDispatches.length} ca điều phối khẩn cấp cần người làm thay (+30.000đ/ca)</strong>}
          description="Nhân viên nhận ca làm thay theo diện HR Dispatch sẽ được hệ thống tự động cộng thêm phụ cấp thưởng +30.000đ/ca vào bảng lương kỳ đó. Bấm 'Nhận ca (+30k)' tại bảng bên dưới để nhận ca ngay."
        />
      )}
      <SelectableTable<Row>
        size="small" rowKey="id" loading={refreshing} pagination={pag} dataSource={swaps} onRowClick={onViewDetail}
        bulkActions={[
          { key: 'accept', label: 'Đồng ý / Nhận ca đã chọn', type: 'primary', icon: <CheckCircleOutlined />, loading: isResponding, eligibleFilter: canRespond, onClick: (rows, clear) => handleRespond(rows, true, clear) },
          { key: 'reject', label: 'Từ chối đã chọn', danger: true, icon: <CloseCircleOutlined />, loading: isResponding, eligibleFilter: canRespond, onClick: (rows, clear) => handleRespond(rows, false, clear) },
          { key: 'cancel', label: 'Hủy yêu cầu đã chọn', danger: true, icon: <StopOutlined />, loading: cancelMut.isPending, eligibleFilter: canCancel, onClick: (rows, clear) => confirmCancel(rows, clear) },
          { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportSwapsExcel(rows) },
        ]}
        locale={{ emptyText: 'Bạn chưa có yêu cầu nhường / đổi ca nào. Bấm "Nhường / Đổi ca" phía trên để gửi yêu cầu cho đồng nghiệp.' }}
        columns={[
          { title: 'Mã đơn', dataIndex: 'swap_code', width: 115, render: (v: string) => <Tag color="purple" style={{ margin: 0 }}>{v}</Tag> },
          { title: 'Loại', dataIndex: 'kind', width: 125, render: (v: string, r) => <Tag color={v === 'SWAP' ? 'geekblue' : v === 'HR_DISPATCH' ? 'gold' : 'cyan'} style={{ margin: 0 }}>{String(r.kindLabel || '')}</Tag> },
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
          {
            title: 'Người nhận', width: 180, ellipsis: true,
            render: (_, r) => {
              if (r.kind === 'HR_DISPATCH' && (!r.peer_id || r.status === 'PENDING_PEER')) {
                return <Tag color="gold" style={{ margin: 0 }}>Đang mở toàn chi nhánh (+30k)</Tag>;
              }
              return <Space size={4}><span>{String(r.peerName || '')}</span>{isPeer(r) && <Tag color="cyan" style={{ margin: 0 }}>Bạn</Tag>}</Space>;
            },
          },
          { title: 'Trạng thái', dataIndex: 'status', width: 230, render: (v: string, r) => <Space size={4} wrap><StatusTag value={v} label={String(r.statusLabel || '') || undefined} />{renderSwapAllowanceTag(r, true)}</Space> },
          {
            title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem chi tiết yêu cầu" onViewDetail={() => onViewDetail(r)} loading={busy}
                menuItems={[
                  ...(fallbackPeer.canClaim(r) ? [
                    { key: 'claim', icon: <CheckCircleOutlined style={{ color: '#16A34A' }} />, label: 'Nhận ca (+30.000đ)', onClick: () => handleRespond([r], true) },
                  ] : canRespond(r) ? [
                    { key: 'accept', icon: <CheckCircleOutlined style={{ color: '#16A34A' }} />, label: r.kind === 'SWAP' ? 'Đồng ý đổi ca' : 'Đồng ý nhận ca', onClick: () => handleRespond([r], true) },
                    { key: 'reject', icon: <CloseCircleOutlined />, danger: true, label: 'Từ chối', onClick: () => handleRespond([r], false) },
                  ] : []),
                  ...(canCancel(r) ? [{ key: 'cancel', icon: <StopOutlined />, danger: true, label: 'Hủy yêu cầu', onClick: () => confirmCancel([r]) }] : []),
                ]}
              />
            ),
          },
        ]}
      />
      {!onPeerRespond && fallbackPeer.decisionModalElement}
    </>
  );
}
