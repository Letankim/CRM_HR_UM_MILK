'use client';

import { Button, Space } from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, CloseOutlined,
  DollarOutlined, EyeOutlined, FileAddOutlined,
} from '@ant-design/icons';
import type { ScheduleDetailKind } from './ScheduleRequestDetailModal';

type RowRec = Record<string, unknown>;

export interface ScheduleRequestDetailActions {
  onApproveLeave?: (record: RowRec) => void;
  onRejectLeave?: (record: RowRec) => void;
  onStoreConfirmAdjustment?: (record: RowRec) => void;
  onApproveAdjustment?: (record: RowRec) => void;
  onRejectAdjustment?: (record: RowRec) => void;
  onApproveSwap?: (record: RowRec) => void;
  onRejectSwap?: (record: RowRec) => void;
  onEditSwapAllowance?: (record: RowRec) => void;
  onPeerAcceptSwap?: (record: RowRec) => void;
  onPeerDeclineSwap?: (record: RowRec) => void;
  onApproveDraftShift?: (record: RowRec) => void;
  onRejectDraftShift?: (record: RowRec) => void;
}

interface ScheduleRequestDetailFooterProps extends ScheduleRequestDetailActions {
  kind: ScheduleDetailKind;
  record: RowRec;
  canViewAtt: boolean;
  isAbsentShift: boolean;
  onOpenAttendance: () => void;
  onOpenQuickAdj: () => void;
  onClose: () => void;
}

export function ScheduleRequestDetailFooter({
  kind, record: r, canViewAtt, isAbsentShift, onOpenAttendance, onOpenQuickAdj, onClose,
  onApproveLeave, onRejectLeave,
  onStoreConfirmAdjustment, onApproveAdjustment, onRejectAdjustment,
  onApproveSwap, onRejectSwap, onEditSwapAllowance,
  onPeerAcceptSwap, onPeerDeclineSwap,
  onApproveDraftShift, onRejectDraftShift,
}: ScheduleRequestDetailFooterProps) {
  const fire = (fn?: (rec: RowRec) => void) => {
    onClose();
    fn?.(r);
  };

  return (
    <Space wrap size={8}>
      {canViewAtt && (
        <Button type="primary" ghost icon={<EyeOutlined />} onClick={onOpenAttendance}>
          Xem chi tiết điểm danh
        </Button>
      )}

      {kind === 'leave' && (r.status === 'PENDING' || r.status === 'DRAFT') && (
        <>
          {onApproveLeave && (
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => fire(onApproveLeave)}>
              Phê duyệt đơn nghỉ
            </Button>
          )}
          {onRejectLeave && (
            <Button danger icon={<CloseCircleOutlined />} onClick={() => fire(onRejectLeave)}>
              Từ chối đơn nghỉ
            </Button>
          )}
        </>
      )}

      {kind === 'adjustment' && (
        <>
          {r.status === 'PENDING' && onStoreConfirmAdjustment && (
            <Button type="primary" ghost icon={<CheckCircleOutlined />} onClick={() => fire(onStoreConfirmAdjustment)}>
              Cửa hàng xác nhận thực tế
            </Button>
          )}
          {(r.status === 'PENDING' || r.status === 'STORE_CONFIRMED') && onApproveAdjustment && (
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => fire(onApproveAdjustment)}>
              Phê duyệt phiếu bổ sung công
            </Button>
          )}
          {(r.status === 'PENDING' || r.status === 'STORE_CONFIRMED') && onRejectAdjustment && (
            <Button danger icon={<CloseCircleOutlined />} onClick={() => fire(onRejectAdjustment)}>
              Từ chối phiếu bổ sung công
            </Button>
          )}
        </>
      )}

      {kind === 'swap' && (
        <>
          {r.status === 'PENDING_PEER' && onPeerAcceptSwap && (
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => fire(onPeerAcceptSwap)}>
              Đồng ý nhận / đổi ca
            </Button>
          )}
          {r.status === 'PENDING_PEER' && onPeerDeclineSwap && (
            <Button danger icon={<CloseCircleOutlined />} onClick={() => fire(onPeerDeclineSwap)}>
              Từ chối
            </Button>
          )}
          {r.status === 'PEER_ACCEPTED' && onApproveSwap && (
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => fire(onApproveSwap)}>
              HR phê duyệt yêu cầu
            </Button>
          )}
          {r.status === 'PEER_ACCEPTED' && onRejectSwap && (
            <Button danger icon={<CloseCircleOutlined />} onClick={() => fire(onRejectSwap)}>
              HR từ chối yêu cầu
            </Button>
          )}
          {r.status === 'APPROVED' && onEditSwapAllowance && (
            <Button icon={<DollarOutlined />} onClick={() => fire(onEditSwapAllowance)}>
              Điều chỉnh phụ cấp đổi ca
            </Button>
          )}
        </>
      )}

      {kind === 'shift' && r.status === 'DRAFT' && (
        <>
          {onApproveDraftShift && (
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => fire(onApproveDraftShift)}>
              Duyệt ca đăng ký
            </Button>
          )}
          {onRejectDraftShift && (
            <Button danger icon={<CloseCircleOutlined />} onClick={() => fire(onRejectDraftShift)}>
              Từ chối ca đăng ký
            </Button>
          )}
        </>
      )}

      {isAbsentShift && (
        <Button type="primary" danger icon={<FileAddOutlined />} onClick={onOpenQuickAdj}>
          Tạo phiếu bổ sung công từ ca này
        </Button>
      )}
      <Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
    </Space>
  );
}
