'use client';

import { Alert, App, Button, Card, Col, Descriptions, Drawer, Empty, Form, Grid, Input, List, Modal, Row, Select, Space, Spin, Tag } from 'antd';
import {
  CheckCircleOutlined, CloseOutlined, CustomerServiceOutlined, ExclamationCircleOutlined,
  ExpandAltOutlined, FileTextOutlined, ReloadOutlined, SendOutlined, ShrinkOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { TICKET_DEPARTMENT_OPTIONS, type TicketDepartment } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { fmtVnd, type PayrollSnapshotItem } from '@/ui/components/payroll-types';
import { payslipLines } from '@/ui/components/PayslipDrawer';
import { TicketDetailDrawer } from '@/ui/components/TicketDetailDrawer';
import type { LinkedPayslipTicketSummary, TicketAssigneeOption } from '@/ui/components/ticket-types';
import { StatusTag } from '@/ui/StatusTag';
import { BRAND } from '@/ui/theme';

export interface MyPayslip {
  id: string;
  payslipCode: string;
  periodName: string;
  fromDate: string;
  toDate: string;
  revision: number;
  status: string;
  statusLabel: string;
  approvedHours: number;
  totalShiftsCount: number;
  grossVnd: number;
  netVnd: number;
  totalDeductionsVnd: number;
  employeeConfirmedAt?: string | null;
  disputeStatus?: string;
  disputeReason?: string;
  linkedTicket?: LinkedPayslipTicketSummary | null;
  breakdown: PayrollSnapshotItem;
}

export function MyPayslipsView({ embedded = false }: { embedded?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [disputeModal, setDisputeModal] = useState(false);
  const [ticketDrawerId, setTicketDrawerId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [form] = Form.useForm();
  const selectedDept = Form.useWatch('target_department', form) as TicketDepartment | undefined;
  const qc = useQueryClient();
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isDesktop = Boolean(screens.md);

  const query = useQuery({ queryKey: ['me', 'payslips'], queryFn: () => api.get<MyPayslip[]>('/me/payslips') });
  const assigneesQ = useQuery({ queryKey: ['ticket-assignees'], queryFn: () => api.get<TicketAssigneeOption[]>('/tickets/assignees'), enabled: disputeModal });

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await api.get<MyPayslip[]>('/me/payslips?refresh=1');
      qc.setQueryData(['me', 'payslips'], fresh);
      message.success('Đã đồng bộ danh sách phiếu lương cá nhân mới nhất');
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Đồng bộ phiếu lương thất bại');
    } finally {
      setRefreshing(false);
    }
  };

  const confirmMut = useMutation({
    mutationFn: (id: string) => api.post<MyPayslip>(`/me/payslips/${id}/confirm`, {}),
    onSuccess: () => {
      message.success('Đã xác nhận đồng ý phiếu lương thành công');
      void qc.invalidateQueries({ queryKey: ['me', 'payslips'] });
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xác nhận phiếu lương thất bại'),
  });

  const disputeMut = useMutation({
    mutationFn: (payload: { id: string; reason: string; target_department: TicketDepartment; assignee_user_id: string }) =>
      api.post<MyPayslip>(`/me/payslips/${payload.id}/dispute`, {
        reason: payload.reason, target_department: payload.target_department, assignee_user_id: payload.assignee_user_id,
      }),
    onSuccess: (updated) => {
      message.success(`Đã tạo phiếu hỗ trợ ${updated.linkedTicket?.ticketCode || ''} và gửi tới ${updated.linkedTicket?.departmentLabel || 'bộ phận phụ trách'}`);
      setDisputeModal(false);
      void qc.invalidateQueries({ queryKey: ['me', 'payslips'] });
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Gửi thắc mắc thất bại'),
  });

  const items = query.data ?? [];
  const open = openId ? items.find((x) => x.id === openId) ?? null : null;
  const baseLines = open?.breakdown?.segments ? payslipLines(open.breakdown) : [];
  const revisionDelta = open?.breakdown ? open.netVnd - open.breakdown.netVnd : 0;
  const lines = revisionDelta !== 0 && open ? [...baseLines, { label: 'Điều chỉnh sau phát hành', detail: `Phiếu điều chỉnh lần ${open.revision}`, amount: revisionDelta }] : baseLines;
  const deptAssignees = (assigneesQ.data ?? []).filter((a) => !selectedDept || a.department === selectedDept);

  const content = query.isLoading ? (
    <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
  ) : query.isError ? (
    <div style={{ padding: 16 }}>
      <Alert type="error" showIcon message="Không thể tải danh sách phiếu lương cá nhân" description={query.error instanceof ApiClientError ? query.error.message : 'Vui lòng bấm Làm mới để đồng bộ lại dữ liệu.'} action={<Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={() => void handleManualRefresh()}>Thử lại</Button>} />
    </div>
  ) : items.length === 0 ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có phiếu lương nào được phát hành cho tài khoản của bạn" style={{ padding: 24 }} />
  ) : (
    <List
      dataSource={items}
      renderItem={(p) => (
        <List.Item style={{ padding: '12px 14px', cursor: 'pointer', minHeight: 56 }} onClick={() => setOpenId(p.id)}>
          <List.Item.Meta
            avatar={<FileTextOutlined style={{ fontSize: 20, color: BRAND.primary }} />}
            title={
              <Space size={6} wrap>
                <span style={{ fontWeight: 600 }}>{p.periodName}</span>
                <StatusTag value={p.status || 'PUBLISHED'} label={p.statusLabel} />
                {p.revision > 1 && <Tag color="blue" style={{ margin: 0, borderRadius: 2 }}>Điều chỉnh lần {p.revision}</Tag>}
                {p.disputeStatus === 'OPEN' ? (
                  <Tag color="volcano" style={{ margin: 0, borderRadius: 2 }}>Đang thắc mắc{p.linkedTicket ? ` (${p.linkedTicket.ticketCode})` : ''}</Tag>
                ) : p.disputeStatus === 'RESOLVED' ? (
                  <Tag color="cyan" style={{ margin: 0, borderRadius: 2 }}>Đã phản hồi thắc mắc</Tag>
                ) : p.employeeConfirmedAt ? (
                  <Tag color="green" style={{ margin: 0, borderRadius: 2 }}>Đã xác nhận</Tag>
                ) : null}
              </Space>
            }
            description={`${p.payslipCode} · ${dayjs(p.fromDate).format('DD/MM')} - ${dayjs(p.toDate).format('DD/MM/YYYY')} · ${p.totalShiftsCount} ca · ${p.approvedHours} giờ${p.linkedTicket ? ` · Gửi tới: ${p.linkedTicket.departmentLabel} (${p.linkedTicket.assigneeName})` : ''}`}
          />
          <div className="num" style={{ fontWeight: 700, color: '#15803D', fontSize: 15 }}>{fmtVnd(p.netVnd)}</div>
        </List.Item>
      )}
    />
  );

  return (
    <div style={{ padding: embedded || isDesktop ? 0 : '8px 6px', width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <Card size="small" title={<span><FileTextOutlined /> Phiếu lương cá nhân đã phát hành ({items.length})</span>} extra={<Button size="small" icon={<ReloadOutlined />} loading={refreshing || query.isFetching} onClick={() => void handleManualRefresh()}>Làm mới</Button>} styles={{ body: { padding: 0 } }}>
        {content}
      </Card>

      <Drawer
        placement={isDesktop ? 'right' : 'bottom'} width={isDesktop ? (expanded ? '95vw' : '70vw') : undefined} height={isDesktop ? undefined : '85%'}
        open={!!open} onClose={() => setOpenId(null)} title={open ? `Phiếu lương — ${open.periodName}` : ''} destroyOnHidden
        extra={
          open && (
            <Space size={6} wrap>
              {open.linkedTicket && (
                <Button size="small" icon={<CustomerServiceOutlined />} onClick={() => setTicketDrawerId(open.linkedTicket!.id)}>
                  Xem phiếu hỗ trợ ({open.linkedTicket.ticketCode})
                </Button>
              )}
              <Button size="small" type="primary" icon={<CheckCircleOutlined />} disabled={Boolean(open.employeeConfirmedAt && open.disputeStatus !== 'OPEN')} loading={confirmMut.isPending} onClick={() => confirmMut.mutate(open.id)}>
                {open.employeeConfirmedAt && open.disputeStatus !== 'OPEN' ? 'Đã xác nhận' : 'Xác nhận phiếu lương'}
              </Button>
              <Button size="small" danger icon={<ExclamationCircleOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ target_department: open.linkedTicket?.department || 'FINANCE', assignee_user_id: '' }); setDisputeModal(true); }}>
                Gửi thắc mắc
              </Button>
              {isDesktop && <Button size="small" icon={expanded ? <ShrinkOutlined /> : <ExpandAltOutlined />} onClick={() => setExpanded((v) => !v)}>{expanded ? 'Thu gọn' : 'Mở rộng'}</Button>}
            </Space>
          )
        }
      >
        {open && (
          <>
            {(open.disputeStatus === 'OPEN' || open.disputeStatus === 'RESOLVED') && (
              <Alert
                type={open.disputeStatus === 'RESOLVED' ? 'success' : 'warning'} showIcon style={{ marginBottom: 12 }}
                message={open.linkedTicket ? `Phiếu hỗ trợ ${open.linkedTicket.ticketCode} — ${open.linkedTicket.departmentLabel} (${open.linkedTicket.assigneeName}) · ${open.linkedTicket.statusLabel}` : 'Đã gửi thắc mắc đối chiếu'}
                description={open.disputeReason}
                action={open.linkedTicket ? <Button size="small" type="primary" ghost onClick={() => setTicketDrawerId(open.linkedTicket!.id)}>Xem phản hồi ({open.linkedTicket.messageCount})</Button> : undefined}
              />
            )}
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Mã phiếu">{open.payslipCode}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái">{open.statusLabel}{open.employeeConfirmedAt ? ` · Đã xác nhận lúc ${dayjs(open.employeeConfirmedAt).format('HH:mm DD/MM/YYYY')}` : ''}</Descriptions.Item>
              <Descriptions.Item label="Hình thức lương">{open.breakdown?.rateTypeLabel ?? 'Theo hồ sơ lương cá nhân'}</Descriptions.Item>
            </Descriptions>
            {lines.map((l, i) => (
              <div key={`${l.label}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: `1px solid ${BRAND.border}` }}>
                <div><div style={{ fontWeight: 600 }}>{l.label}</div><div style={{ fontSize: 12, color: BRAND.textSecondary }}>{l.detail}</div></div>
                <div className="num" style={{ fontWeight: 600, color: l.amount < 0 ? '#DC2626' : undefined, whiteSpace: 'nowrap' }}>{fmtVnd(l.amount)}</div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0' }}><span>Tổng thu nhập</span><strong className="num">{fmtVnd(open.grossVnd)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: `1px solid ${BRAND.border}` }}><strong>THỰC LĨNH</strong><strong className="num" style={{ color: '#15803D', fontSize: 16 }}>{fmtVnd(open.netVnd)}</strong></div>
          </>
        )}
      </Drawer>

      <Modal width={640} title="Gửi Phiếu Hỗ Trợ / Thắc Mắc Phiếu Lương" open={disputeModal} onCancel={() => setDisputeModal(false)} onOk={() => form.submit()} okText="Tạo phiếu & Gửi thắc mắc" cancelText="Hủy bỏ" okButtonProps={{ icon: <SendOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} confirmLoading={disputeMut.isPending} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => open && disputeMut.mutate({ id: open.id, reason: String(v.reason || ''), target_department: (v.target_department || 'FINANCE') as TicketDepartment, assignee_user_id: String(v.assignee_user_id || '') })}>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="target_department" label="Chọn Bộ phận tiếp nhận" rules={[{ required: true, message: 'Vui lòng chọn bộ phận' }]}>
                <Select options={TICKET_DEPARTMENT_OPTIONS} onChange={() => form.setFieldValue('assignee_user_id', '')} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="assignee_user_id" label="Chọn cụ thể người xử lý (tùy chọn)">
                <Select showSearch optionFilterProp="label" loading={assigneesQ.isLoading} options={[{ value: '', label: 'Toàn bộ phận tiếp nhận' }, ...deptAssignees.map((a) => ({ value: a.id, label: `${a.displayName} — ${a.roleLabel}` }))]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="reason" label="Nội dung thắc mắc / đối chiếu công lương" rules={[{ required: true, min: 5, message: 'Vui lòng nhập tối thiểu 5 ký tự' }]}>
            <Input.TextArea rows={3} placeholder="VD: Em xin kiểm tra lại công ca tối ngày 18/10 và phụ cấp nhận ca thay..." />
          </Form.Item>
        </Form>
      </Modal>

      <TicketDetailDrawer ticketId={ticketDrawerId} isBackoffice={false} onClose={() => setTicketDrawerId(null)} />
    </div>
  );
}
