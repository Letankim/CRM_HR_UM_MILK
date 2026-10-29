'use client';

import { Alert, App, Button, Card, Descriptions, Drawer, Empty, Form, Grid, Input, List, Modal, Space, Spin, Tag } from 'antd';
import {
  CheckCircleOutlined, CloseOutlined, ExclamationCircleOutlined, ExpandAltOutlined,
  FileTextOutlined, ReloadOutlined, SendOutlined, ShrinkOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { fmtVnd, type PayrollSnapshotItem } from '@/ui/components/payroll-types';
import { payslipLines } from '@/ui/components/PayslipDrawer';
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
  breakdown: PayrollSnapshotItem;
}

export function MyPayslipsView({ embedded = false }: { embedded?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [disputeModal, setDisputeModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isDesktop = Boolean(screens.md);

  const query = useQuery({
    queryKey: ['me', 'payslips'],
    queryFn: () => api.get<MyPayslip[]>('/me/payslips'),
  });

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
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xác nhận phiếu lương thất bại'),
  });

  const disputeMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<MyPayslip>(`/me/payslips/${id}/dispute`, { reason }),
    onSuccess: () => {
      message.success('Đã gửi phản hồi thắc mắc phiếu lương tới Kế toán / HR');
      setDisputeModal(false);
      void qc.invalidateQueries({ queryKey: ['me', 'payslips'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Gửi phản hồi thất bại'),
  });

  const items = query.data ?? [];
  const open = openId ? items.find((x) => x.id === openId) ?? null : null;
  const baseLines = open?.breakdown?.segments ? payslipLines(open.breakdown) : [];
  const revisionDelta = open?.breakdown ? open.netVnd - open.breakdown.netVnd : 0;
  const lines = revisionDelta !== 0 && open
    ? [...baseLines, { label: 'Điều chỉnh sau phát hành', detail: `Phiếu điều chỉnh lần ${open.revision}`, amount: revisionDelta }]
    : baseLines;

  const content = query.isLoading ? (
    <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
  ) : query.isError ? (
    <div style={{ padding: 16 }}>
      <Alert
        type="error"
        showIcon
        message="Không thể tải danh sách phiếu lương cá nhân"
        description={query.error instanceof ApiClientError ? query.error.message : 'Vui lòng bấm Làm mới để đồng bộ lại dữ liệu.'}
        action={<Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={() => void handleManualRefresh()}>Thử lại</Button>}
      />
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
                  <Tag color="volcano" style={{ margin: 0, borderRadius: 2 }}>Đang gửi thắc mắc</Tag>
                ) : p.employeeConfirmedAt ? (
                  <Tag color="green" style={{ margin: 0, borderRadius: 2 }}>Đã xác nhận</Tag>
                ) : null}
              </Space>
            }
            description={`${p.payslipCode} · ${dayjs(p.fromDate).format('DD/MM')} - ${dayjs(p.toDate).format('DD/MM/YYYY')} · ${p.totalShiftsCount} ca · ${p.approvedHours} giờ`}
          />
          <div className="num" style={{ fontWeight: 700, color: '#15803D', fontSize: 15 }}>{fmtVnd(p.netVnd)}</div>
        </List.Item>
      )}
    />
  );

  return (
    <div style={{ padding: embedded || isDesktop ? 0 : '8px 6px', width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <Card
        size="small"
        title={<span><FileTextOutlined /> Phiếu lương cá nhân đã phát hành ({items.length})</span>}
        extra={<Button size="small" icon={<ReloadOutlined />} loading={refreshing || query.isFetching} onClick={() => void handleManualRefresh()}>Làm mới</Button>}
        styles={{ body: { padding: 0 } }}
      >
        {content}
      </Card>

      <Drawer
        placement={isDesktop ? 'right' : 'bottom'}
        width={isDesktop ? (expanded ? '95vw' : '70vw') : undefined}
        height={isDesktop ? undefined : '85%'}
        open={!!open}
        onClose={() => setOpenId(null)}
        title={open ? `Phiếu lương — ${open.periodName}` : ''}
        destroyOnHidden
        extra={
          open && (
            <Space size={6} wrap>
              <Button size="small" type="primary" icon={<CheckCircleOutlined />} disabled={Boolean(open.employeeConfirmedAt && open.disputeStatus !== 'OPEN')} loading={confirmMut.isPending} onClick={() => confirmMut.mutate(open.id)}>
                {open.employeeConfirmedAt && open.disputeStatus !== 'OPEN' ? 'Đã xác nhận' : 'Xác nhận phiếu lương'}
              </Button>
              <Button size="small" danger icon={<ExclamationCircleOutlined />} onClick={() => { form.resetFields(); setDisputeModal(true); }}>
                Gửi thắc mắc
              </Button>
              {isDesktop && (
                <Button size="small" icon={expanded ? <ShrinkOutlined /> : <ExpandAltOutlined />} onClick={() => setExpanded((v) => !v)}>
                  {expanded ? 'Thu gọn' : 'Mở rộng'}
                </Button>
              )}
            </Space>
          )
        }
      >
        {open && (
          <>
            {open.disputeStatus === 'OPEN' && open.disputeReason && (
              <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Đã gửi thắc mắc đối chiếu tới Kế toán / HR" description={open.disputeReason} />
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
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: `1px solid ${BRAND.border}` }}>
              <strong>THỰC LĨNH</strong>
              <strong className="num" style={{ color: '#15803D', fontSize: 16 }}>{fmtVnd(open.netVnd)}</strong>
            </div>
          </>
        )}
      </Drawer>

      <Modal width={640} title="Gửi Phản Hồi / Thắc Mắc Phiếu Lương" open={disputeModal} onCancel={() => setDisputeModal(false)} onOk={() => form.submit()} okText="Gửi phản hồi" cancelText="Hủy bỏ" okButtonProps={{ icon: <SendOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} confirmLoading={disputeMut.isPending} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => open && disputeMut.mutate({ id: open.id, reason: String(v.reason || '') })}>
          <Form.Item name="reason" label="Nội dung thắc mắc / đối chiếu công lương" rules={[{ required: true, min: 5, message: 'Vui lòng nhập tối thiểu 5 ký tự' }]}>
            <Input.TextArea rows={3} placeholder="VD: Em xin kiểm tra lại công ca tối ngày 18/10 và phụ cấp nhận ca thay..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
