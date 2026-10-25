'use client';

import { App, Button, Card, Descriptions, Drawer, Empty, Form, Grid, Input, List, Modal, Space, Spin, Tag } from 'antd';
import { CheckCircleOutlined, ExclamationCircleOutlined, FileTextOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { fmtVnd, type PayrollSnapshotItem } from '@/ui/components/payroll-types';
import { payslipLines } from '@/ui/components/PayslipDrawer';
import { BRAND } from '@/ui/theme';

interface MyPayslip {
  id: string;
  payslipCode: string;
  periodName: string;
  fromDate: string;
  toDate: string;
  revision: number;
  statusLabel: string;
  approvedHours: number;
  totalShiftsCount: number;
  grossVnd: number;
  netVnd: number;
  totalDeductionsVnd: number;
  employeeConfirmedAt?: string;
  disputeStatus?: string;
  disputeReason?: string;
  breakdown: PayrollSnapshotItem;
}

/** Phiếu lương cá nhân (PRB-09 / OFF-09 — hiển thị kỳ đã PUBLISHED / PAID + xác nhận / phản hồi). */
export default function MyPayslipsPage() {
  const [open, setOpen] = useState<MyPayslip | null>(null);
  const [disputeModal, setDisputeModal] = useState(false);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isDesktop = Boolean(screens.md);
  const query = useQuery({ queryKey: ['me', 'payslips'], queryFn: () => api.get<MyPayslip[]>('/me/payslips') });

  const confirmMut = useMutation({
    mutationFn: (id: string) => api.post(`/me/payslips/${id}/confirm`, {}),
    onSuccess: () => { message.success('Đã xác nhận đồng ý phiếu lương thành công'); qc.invalidateQueries({ queryKey: ['me', 'payslips'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xác nhận phiếu lương thất bại'),
  });

  const disputeMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/me/payslips/${id}/dispute`, { reason }),
    onSuccess: () => { message.success('Đã gửi phản hồi thắc mắc phiếu lương tới Kế toán / HR'); setDisputeModal(false); qc.invalidateQueries({ queryKey: ['me', 'payslips'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Gửi phản hồi thất bại'),
  });

  const baseLines = open?.breakdown?.segments ? payslipLines(open.breakdown) : [];
  const revisionDelta = open?.breakdown ? open.netVnd - open.breakdown.netVnd : 0;
  const lines = revisionDelta !== 0 ? [...baseLines, { label: 'Điều chỉnh sau phát hành', detail: `Phiếu điều chỉnh lần ${open!.revision}`, amount: revisionDelta }] : baseLines;

  return (
    <div style={{ padding: isDesktop ? 0 : 16 }}>
      <Card size="small" title={<span><FileTextOutlined /> Phiếu lương cá nhân đã phát hành</span>} styles={{ body: { padding: 0 } }}>
        {query.isLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
        ) : (query.data ?? []).length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có phiếu lương nào được phát hành" style={{ padding: 24 }} />
        ) : (
          <List
            dataSource={query.data}
            renderItem={(p) => (
              <List.Item style={{ padding: '12px 14px', cursor: 'pointer', minHeight: 56 }} onClick={() => setOpen(p)}>
                <List.Item.Meta
                  avatar={<FileTextOutlined style={{ fontSize: 20, color: BRAND.primary }} />}
                  title={<span>{p.periodName}{p.revision > 1 && <Tag style={{ marginLeft: 6, borderRadius: 2 }}>Điều chỉnh lần {p.revision}</Tag>}</span>}
                  description={`${dayjs(p.fromDate).format('DD/MM')} - ${dayjs(p.toDate).format('DD/MM/YYYY')} · ${p.totalShiftsCount} ca · ${p.approvedHours} giờ`}
                />
                <div className="num" style={{ fontWeight: 700, color: '#15803D' }}>{fmtVnd(p.netVnd)}</div>
              </List.Item>
            )}
          />
        )}
      </Card>

      <Drawer
        placement={isDesktop ? 'right' : 'bottom'}
        width={isDesktop ? 560 : undefined}
        height={isDesktop ? undefined : '85%'}
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? `Phiếu lương — ${open.periodName}` : ''}
        destroyOnHidden
        extra={
          open && (
            <Space size={6}>
              <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={confirmMut.isPending} onClick={() => confirmMut.mutate(open.id)}>
                Xác nhận phiếu lương
              </Button>
              <Button size="small" danger icon={<ExclamationCircleOutlined />} onClick={() => { form.resetFields(); setDisputeModal(true); }}>
                Gửi thắc mắc
              </Button>
            </Space>
          )
        }
      >
        {open && (
          <>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Mã phiếu">{open.payslipCode}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái">{open.statusLabel}</Descriptions.Item>
              <Descriptions.Item label="Hình thức lương">{open.breakdown?.rateTypeLabel ?? '—'}</Descriptions.Item>
            </Descriptions>
            {lines.map((l, i) => (
              <div key={`${l.label}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: `1px solid ${BRAND.border}` }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{l.label}</div>
                  <div style={{ fontSize: 12, color: BRAND.textSecondary }}>{l.detail}</div>
                </div>
                <div className="num" style={{ fontWeight: 600, color: l.amount < 0 ? '#DC2626' : undefined, whiteSpace: 'nowrap' }}>{fmtVnd(l.amount)}</div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0' }}>
              <span>Tổng thu nhập</span>
              <strong className="num">{fmtVnd(open.grossVnd)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: `1px solid ${BRAND.border}` }}>
              <strong>THỰC LĨNH</strong>
              <strong className="num" style={{ color: '#15803D', fontSize: 16 }}>{fmtVnd(open.netVnd)}</strong>
            </div>
          </>
        )}
      </Drawer>

      <Modal width={640} title="Gửi Phản Hồi / Thắc Mắc Phiếu Lương" open={disputeModal} onCancel={() => setDisputeModal(false)} onOk={() => form.submit()} okText="Gửi phản hồi" cancelText="Hủy bỏ" confirmLoading={disputeMut.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => open && disputeMut.mutate({ id: open.id, reason: String(v.reason || '') })}>
          <Form.Item name="reason" label="Nội dung thắc mắc / đối chiếu công lương" rules={[{ required: true, min: 5, message: 'Vui lòng nhập tối thiểu 5 ký tự' }]}>
            <Input.TextArea rows={3} placeholder="VD: Em xin kiểm tra lại công ca tối ngày 18/10 và phụ cấp nhận ca thay..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
