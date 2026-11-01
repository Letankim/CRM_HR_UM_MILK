'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Flex, Form, Input, Modal, Space, Table, Tag } from 'antd';
import { CloseCircleOutlined, CloseOutlined, DownOutlined, ExclamationCircleOutlined, UpOutlined, WarningOutlined } from '@ant-design/icons';
import { StatusTag } from '../StatusTag';
import { buildClickableRowProps } from './BulkActionBar';
import { useQuickDetail } from './RecordQuickDetailModal';
import { fmtYmd, issueSeverity, type PlannerIssue, type PlannerOffConflictGroup, type PlannerOffItem } from './schedule-planner-types';
import { renderLeaveOffConflictTag } from './workflow-shift-warning';

export interface PlannerIssuesAlertProps {
  issues: PlannerIssue[];
  maxHeight?: number;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
}

/** Cảnh báo nổi bật cho HR khi trong cùng 1 ngày có 2, 3, 4 (hoặc toàn bộ) nhân sự cùng đăng ký nghỉ OFF. */
export function PlannerOffConflictsAlert({ conflicts }: { conflicts?: PlannerOffConflictGroup[] }) {
  if (!conflicts || conflicts.length === 0) return null;
  const criticalCount = conflicts.filter((c) => c.severity === 'CRITICAL').length;
  return (
    <Alert
      type={criticalCount > 0 ? 'error' : 'warning'}
      showIcon
      icon={<WarningOutlined />}
      message={
        criticalCount > 0
          ? `Cảnh báo trùng lịch nghỉ OFF: Có ${criticalCount} ngày bị thiếu / trống người trực ca do nhiều nhân sự cùng đăng ký nghỉ!`
          : `Lưu ý trùng lịch nghỉ OFF: Có ${conflicts.length} ngày có từ 2 nhân sự trở lên cùng đăng ký nghỉ OFF`
      }
      description={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
          {conflicts.map((c) => (
            <div key={c.key} style={{ fontSize: 13 }}>
              <Tag color={c.severity === 'CRITICAL' ? 'red' : 'orange'} style={{ marginRight: 6 }}>
                {c.severity === 'CRITICAL' ? 'Thiếu người trực' : `Trùng ${c.totalOffCount} đơn OFF`}
              </Tag>
              <span>{c.message}</span>
            </div>
          ))}
        </div>
      }
    />
  );
}

/** Danh sách vướng mắc khi tự động sắp ca (hỗ trợ đóng/mở thu gọn để không chiếm diện tích trang). */
export function PlannerIssuesAlert({
  issues, maxHeight = 220, collapsible = true, defaultExpanded = false, expanded, onExpandedChange,
}: PlannerIssuesAlertProps) {
  const [internalOpen, setInternalOpen] = useState(defaultExpanded);
  if (issues.length === 0) return null;
  const isOpen = !collapsible ? true : (expanded ?? internalOpen);
  const toggle = () => {
    const next = !isOpen;
    if (expanded === undefined) setInternalOpen(next);
    onExpandedChange?.(next);
  };
  const errorCount = issues.filter((i) => issueSeverity(i) === 'error').length;
  return (
    <Alert
      type={errorCount > 0 ? 'error' : 'warning'}
      showIcon
      icon={<ExclamationCircleOutlined />}
      style={{ padding: isOpen ? '10px 12px' : '7px 12px' }}
      message={
        <Flex
          justify="space-between" align="center" gap={8} wrap={false}
          onClick={collapsible ? toggle : undefined}
          style={{ width: '100%', cursor: collapsible ? 'pointer' : 'default', userSelect: 'none' }}
        >
          <span style={{ fontWeight: 600, minWidth: 0 }}>Không thể xếp được / Cảnh báo định biên ({issues.length} trường hợp)</span>
          {collapsible && (
            <Button
              size="small" type="text" icon={isOpen ? <UpOutlined /> : <DownOutlined />}
              onClick={(e) => { e.stopPropagation(); toggle(); }}
              style={{ flexShrink: 0, fontWeight: 600, color: errorCount > 0 ? '#DC2626' : '#D97706', paddingInline: 8, height: 24 }}
            >
              {isOpen ? 'Thu gọn' : `Xem chi tiết (${issues.length})`}
            </Button>
          )}
        </Flex>
      }
      description={
        isOpen ? (
          <div style={{ maxHeight, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(220, 38, 38, 0.16)' }}>
            {issues.map((i, idx) => (
              <Space key={`${i.kind}-${i.employeeId}-${i.workDate}-${i.shiftCode}-${idx}`} size={6} align="start">
                <Tag color={issueSeverity(i) === 'error' ? 'red' : 'gold'} style={{ margin: 0 }}>{issueSeverity(i) === 'error' ? 'Không xếp được' : 'Cảnh báo'}</Tag>
                <span style={{ fontSize: 13 }}>{i.message}</span>
              </Space>
            ))}
          </div>
        ) : undefined
      }
    />
  );
}

/** Bảng đơn OFF trong kỳ chốt lịch (dùng chung cho tuần chính thức và chu kỳ thử việc). */
export function PlannerOffTable({ rows, renderActions, loading }: { rows: PlannerOffItem[]; renderActions?: (r: PlannerOffItem) => React.ReactNode; loading?: boolean }) {
  const showDetail = useQuickDetail();
  return (
    <Table<PlannerOffItem>
      size="small" rowKey="id" loading={loading} dataSource={rows} pagination={rows.length > 10 ? { pageSize: 10, showTotal: (t) => `Tổng ${t} đơn` } : false}
      onRow={(r) => buildClickableRowProps(r, (item) => showDetail('plannerOff', item))}
      locale={{ emptyText: 'Không có đơn nghỉ OFF nào trong kỳ này' }}
      columns={[
        { title: 'Mã đơn', dataIndex: 'requestCode', width: 110, render: (v: string) => <Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag> },
        { title: 'Nhân sự', width: 220, ellipsis: true, render: (_, r) => <span><strong>{r.employeeName}</strong> <span style={{ color: '#64748B' }}>({r.employeeCode})</span></span> },
        { title: 'Ngày nghỉ & Ca', dataIndex: 'leaveDate', width: 235, render: (v: string, r) => <Space size={4} wrap><strong className="num">{fmtYmd(v)}</strong>{r.shiftLabel && <Tag color="blue" style={{ margin: 0 }}>{r.shiftLabel}</Tag>}{renderLeaveOffConflictTag(r as unknown as Record<string, unknown>)}</Space> },
        { title: 'Trạng thái', dataIndex: 'status', width: 155, render: (v: string, r) => <StatusTag value={v} label={r.statusLabel || undefined} /> },
        { title: 'Lý do', dataIndex: 'reason', ellipsis: true },
        ...(renderActions ? [{ title: 'Thao tác', width: 180, align: 'right' as const, render: (_: unknown, r: PlannerOffItem) => renderActions(r) }] : []),
      ]}
    />
  );
}

/** Hộp thoại nhập lý do từ chối đơn nghỉ OFF (bắt buộc nhập lý do). */
export function OffRejectModal({ target, loading, onClose, onConfirm }: { target: PlannerOffItem | null; loading?: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [form] = Form.useForm<{ reason: string }>();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(Boolean(target)); if (target) form.setFieldsValue({ reason: '' }); }, [target, form]);
  return (
    <Modal
      open={open} width="min(520px, 94vw)" title="Từ chối đơn nghỉ OFF" okText="Xác nhận từ chối" cancelText="Hủy bỏ" confirmLoading={loading}
      okButtonProps={{ danger: true, icon: <CloseCircleOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose} onOk={() => form.submit()} destroyOnHidden
    >
      {target && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`${target.employeeName} (${target.employeeCode}) xin nghỉ OFF ngày ${fmtYmd(target.leaveDate)}`} />}
      <Form form={form} layout="vertical" onFinish={(v) => onConfirm(v.reason.trim())}>
        <Form.Item name="reason" label="Lý do từ chối" rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập lý do từ chối đơn nghỉ OFF' }]}>
          <Input.TextArea rows={3} maxLength={300} placeholder="Ví dụ: Ngày này các đồng nghiệp cùng ca đã xin nghỉ hết, cửa hàng thiếu định biên" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
