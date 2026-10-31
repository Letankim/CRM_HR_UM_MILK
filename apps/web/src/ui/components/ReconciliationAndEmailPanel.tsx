'use client';

import { App, Button, Card, Descriptions, Empty, Flex, Input, Select, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import { CopyOutlined, DownOutlined, FileTextOutlined, MailOutlined, SafetyCertificateOutlined, SendOutlined, SyncOutlined, UpOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EMAIL_TEMPLATE_CODES, EMAIL_TEMPLATE_LABELS, TABLE_DISPLAY_LABELS, type EmailTemplateCode } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useClientPagination } from '../hooks/useClientPagination';
import { StatusTag } from '../StatusTag';
import { EmailQueueDetailModal, expandEmailHtmlForPreview, formatEmailDateTime, renderEmailQueueStatusTag, type EmailLogItem } from './EmailQueueDetailModal';
import { RowActionButtons } from './RowActionButtons';

interface ReconciliationIssue {
  id: string; code: string; label: string; severity: 'warning' | 'error'; table: string; recordId: string; message: string; autoRepaired: boolean;
}

interface ReconciliationReport {
  checkedAt: string;
  status: 'ok' | 'degraded' | 'down';
  summary: { tablesScanned: number; rowsScanned: number; issuesFound: number; autoRepaired: number; unresolvedIssues: number };
  issues: ReconciliationIssue[];
}

interface EmailQueueStats {
  queuedCount: number; sentCount: number; failedCount: number; totalCount: number; batchSize: number; intervalSeconds: number; processing: boolean;
}

interface EmailTemplateResponse {
  templates: { code: EmailTemplateCode; label: string }[];
  preview: { template: EmailTemplateCode; label: string; subject: string; html: string };
  recentEmails?: EmailLogItem[];
  queueStats?: EmailQueueStats;
}

export function ReconciliationAndEmailPanel({ mode }: { mode?: 'reconcile' | 'email' }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const can = useCan();
  const canRead = can('integration.read');
  const [subTab, setSubTab] = useState<'reconcile' | 'email'>('reconcile');
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplateCode>('ACCOUNT_ACTIVATED');
  const [recipientEmail, setRecipientEmail] = useState('nhanvien@umbomilk.vn');
  const [recipientName, setRecipientName] = useState('Nguyễn Văn An');
  const [templatePreviewOpen, setTemplatePreviewOpen] = useState(true);
  const [viewingEmail, setViewingEmail] = useState<EmailLogItem | null>(null);
  const issuesPag = useClientPagination(10, 'cảnh báo');
  const emailsPag = useClientPagination(8, 'thư');

  const reconcileQuery = useQuery({
    queryKey: ['integrations', 'reconcile'],
    queryFn: () => api.get<ReconciliationReport>('/admin/integrations/reconcile'),
    enabled: canRead,
  });

  const runRepair = useMutation({
    mutationFn: () => api.post<ReconciliationReport>('/admin/integrations/reconcile', {}),
    onSuccess: (report) => {
      message.success(`Đã quét ${report.summary.rowsScanned} bản ghi, tự động sửa ${report.summary.autoRepaired} mục sai lệch`);
      qc.setQueryData(['integrations', 'reconcile'], report);
      qc.invalidateQueries({ queryKey: ['integrations', 'health'] });
    },
  });

  const emailPreviewQuery = useQuery({
    queryKey: ['integrations', 'email-templates', selectedTemplate],
    queryFn: () => api.get<EmailTemplateResponse>(`/admin/integrations/email-templates?template=${selectedTemplate}`),
    enabled: canRead,
  });

  const sendEmailMut = useMutation({
    mutationFn: () => api.post('/admin/integrations/send-test-email', { to: recipientEmail, recipient_name: recipientName, template: selectedTemplate }),
    onSuccess: () => {
      message.success(`Đã gửi email mẫu "${EMAIL_TEMPLATE_LABELS[selectedTemplate]}" tới ${recipientEmail}`);
      qc.invalidateQueries({ queryKey: ['integrations', 'email-templates'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Gửi email thất bại'),
  });

  const flushQueueMut = useMutation({
    mutationFn: () => api.post<{ processed: number; queueStats: EmailQueueStats }>('/admin/integrations/email-queue/flush', {}),
    onSuccess: (res) => {
      message.success(`Đã quét hàng đợi Email: xử lý ${res.processed} thư, còn ${res.queueStats.queuedCount} thư đang chờ`);
      qc.invalidateQueries({ queryKey: ['integrations', 'email-templates'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Quét hàng đợi thất bại'),
  });

  const copyToClipboard = (text: string, label: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => message.success(`Đã sao chép ${label}`));
    }
  };

  const report = reconcileQuery.data;
  const preview = emailPreviewQuery.data?.preview;
  const recentEmails = emailPreviewQuery.data?.recentEmails ?? [];
  const qStats = emailPreviewQuery.data?.queueStats;

  const reconcilePane = (
    <Card
      size="small"
      title="Bộ máy Đối soát & Đồng bộ Toàn vẹn Dữ liệu"
      extra={<Button size="small" type="primary" icon={<SyncOutlined />} loading={runRepair.isPending || reconcileQuery.isFetching} onClick={() => runRepair.mutate()}>Quét &amp; Tự động sửa lỗi</Button>}
    >
      <Spin spinning={reconcileQuery.isLoading || runRepair.isPending} tip="Đang quét đối soát dữ liệu...">
        <div style={{ minHeight: 160 }}>
          {report && (
            <div>
              <Descriptions size="small" bordered column={2} style={{ marginBottom: 12 }}>
                <Descriptions.Item label="Trạng thái toàn vẹn"><StatusTag value={report.status} /></Descriptions.Item>
                <Descriptions.Item label="Số bảng / dòng đã quét"><span className="num">{report.summary.tablesScanned} bảng ({report.summary.rowsScanned} bản ghi)</span></Descriptions.Item>
                <Descriptions.Item label="Điểm lệch phát hiện"><span className="num">{report.summary.issuesFound}</span></Descriptions.Item>
                <Descriptions.Item label="Đã tự động sửa"><span className="num" style={{ color: '#16A34A', fontWeight: 600 }}>{report.summary.autoRepaired}</span></Descriptions.Item>
              </Descriptions>
              {report.issues.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="100% bản ghi đạt chuẩn liên kết dữ liệu, không trùng lặp và đồng bộ trạng thái" />
              ) : (
                <Table<ReconciliationIssue>
                  size="small" rowKey="id" pagination={issuesPag} dataSource={report.issues}
                  columns={[
                    { title: 'Bảng dữ liệu', dataIndex: 'table', width: 240, render: (v: string) => <Typography.Text strong>{TABLE_DISPLAY_LABELS[v] ?? v}</Typography.Text> },
                    { title: 'Chi tiết kiểm tra', dataIndex: 'message', render: (v: string, r) => <div><div style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{v}</Typography.Text></div> },
                    { title: 'Xử lý', dataIndex: 'autoRepaired', width: 130, align: 'right', render: (repaired: boolean) => repaired ? <Tag color="green" style={{ borderRadius: 2 }}>Đã tự sửa</Tag> : <Tag color="gold" style={{ borderRadius: 2 }}>Cần kiểm tra</Tag> },
                  ]}
                />
              )}
            </div>
          )}
        </div>
      </Spin>
    </Card>
  );

  const emailPane = (
    <Card
      size="small"
      title="Mẫu Email Doanh Nghiệp & Hàng Đợi Chống Nghẽn (Rate-Limited Batch Queue)"
      extra={
        <Space size={8} wrap>
          <Button size="small" icon={<SyncOutlined />} loading={flushQueueMut.isPending} onClick={() => flushQueueMut.mutate()}>Quét &amp; Gửi lô hàng đợi ngay</Button>
          <Select size="small" value={selectedTemplate} style={{ width: 270 }} options={EMAIL_TEMPLATE_CODES.map((code) => ({ value: code, label: EMAIL_TEMPLATE_LABELS[code] }))} onChange={(val) => { setSelectedTemplate(val); setTemplatePreviewOpen(true); }} />
          <Button size="small" icon={templatePreviewOpen ? <UpOutlined /> : <DownOutlined />} onClick={() => setTemplatePreviewOpen((v) => !v)}>{templatePreviewOpen ? 'Đóng mẫu Email' : 'Mở mẫu Email'}</Button>
        </Space>
      }
    >
      <Spin spinning={emailPreviewQuery.isLoading || emailPreviewQuery.isFetching} tip="Đang tải mẫu email...">
        <div style={{ minHeight: 200 }}>
          {qStats && (
            <Descriptions size="small" bordered column={2} style={{ marginBottom: 10 }}>
              <Descriptions.Item label="Cơ chế chống Spam / Limit"><Tag color="blue" style={{ borderRadius: 2 }}>Tối đa {qStats.batchSize} thư / {qStats.intervalSeconds}s (Khử trùng 60s)</Tag></Descriptions.Item>
              <Descriptions.Item label="Đang chờ hàng đợi"><span className="num" style={{ color: '#D97706', fontWeight: 600 }}>{qStats.queuedCount} thư</span></Descriptions.Item>
              <Descriptions.Item label="Đã xử lý gửi"><span className="num" style={{ color: '#16A34A', fontWeight: 600 }}>{qStats.sentCount} thư</span></Descriptions.Item>
              <Descriptions.Item label="Lỗi chờ thử lại"><span className="num" style={{ color: qStats.failedCount > 0 ? '#DC2626' : '#64748B', fontWeight: 600 }}>{qStats.failedCount} thư</span></Descriptions.Item>
            </Descriptions>
          )}
          {preview && (
            <div>
              <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, background: '#F8FAFC', padding: '8px 12px', marginBottom: 12 }}>
                <Flex justify="space-between" align="center" gap={8} wrap="wrap">
                  <Space size={8} wrap>
                    <MailOutlined style={{ color: '#2563EB' }} />
                    <Typography.Text strong style={{ fontSize: 13 }}>Tiêu đề mẫu: {preview.subject}</Typography.Text>
                    <Tag color="blue" style={{ borderRadius: 2, margin: 0 }}>{preview.label}</Tag>
                  </Space>
                  <Button size="small" type="text" icon={templatePreviewOpen ? <UpOutlined /> : <DownOutlined />} onClick={() => setTemplatePreviewOpen((v) => !v)}>
                    {templatePreviewOpen ? 'Thu gọn khung xem trước' : 'Mở khung xem trước & gửi thử'}
                  </Button>
                </Flex>
                {templatePreviewOpen && (
                  <div style={{ marginTop: 10 }}>
                    <Flex gap={8} wrap="wrap" style={{ marginBottom: 10 }}>
                      <Input size="small" style={{ flex: 1, minWidth: 180 }} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Tên người nhận" />
                      <Input size="small" style={{ flex: 1, minWidth: 220 }} value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="Email người nhận" />
                      <Button size="small" type="primary" icon={<SendOutlined />} loading={sendEmailMut.isPending} onClick={() => sendEmailMut.mutate()}>Gửi Email mẫu này</Button>
                    </Flex>
                    <iframe title={`Xem trước email ${preview.template}`} srcDoc={expandEmailHtmlForPreview(preview.html, true)} style={{ width: '100%', height: 480, border: '1px solid #E5E7EB', borderRadius: 2, background: '#FFFFFF', display: 'block' }} />
                  </div>
                )}
              </div>
              <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
                <Typography.Text strong style={{ fontSize: 13 }}>Lịch sử &amp; Hàng đợi Gửi Email ({recentEmails.length} thư gần nhất)</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Bấm Xem chi tiết hoặc menu (...) để xem toàn bộ nội dung thư</Typography.Text>
              </Flex>
              <Table<EmailLogItem>
                size="small" rowKey="id" pagination={emailsPag} dataSource={recentEmails}
                locale={{ emptyText: 'Chưa có thư nào trong lịch sử hàng đợi Email' }}
                onRow={(r) => ({ style: { cursor: 'pointer' }, onClick: (e) => { if (!(e.target as HTMLElement).closest('button, a, .ant-dropdown-trigger')) setViewingEmail(r); } })}
                columns={[
                  { title: 'Người nhận', dataIndex: 'to', width: 205, render: (v: string, r) => <div><div style={{ fontWeight: 600, fontSize: 12 }}>{r.recipientName || 'Nhân sự Ụm Bò Milk'}</div><Typography.Text type="secondary" style={{ fontSize: 11 }}>{v}</Typography.Text></div> },
                  { title: 'Loại & Tiêu đề thông báo Email', dataIndex: 'template', render: (v: EmailTemplateCode, r) => <div><div style={{ fontSize: 12, fontWeight: 600 }}>{r.templateLabel || EMAIL_TEMPLATE_LABELS[v] || 'Thông báo hệ thống'}</div><div style={{ fontSize: 11.5, color: '#334155' }}>{r.subject}</div><Typography.Text type="secondary" style={{ fontSize: 11 }}>Mã: {r.referenceCode || '—'}</Typography.Text></div> },
                  { title: 'Lần thử', dataIndex: 'attempts', width: 76, align: 'center', render: (v?: number) => <span className="num">{v ?? 1}/3</span> },
                  { title: 'Trạng thái Hàng đợi', dataIndex: 'status', width: 145, render: (s: EmailLogItem['status']) => renderEmailQueueStatusTag(s) },
                  { title: 'Thời gian', dataIndex: 'sentAt', width: 145, render: (v: string, r) => <span className="num" style={{ fontSize: 11 }}>{formatEmailDateTime(v || r.queuedAt)}</span> },
                  { title: 'Thao tác', key: 'actions', width: 96, align: 'center', render: (_: unknown, r) => <RowActionButtons onViewDetail={() => setViewingEmail(r)} detailTooltip="Xem chi tiết nội dung Email" menuItems={[{ key: 'copy-to', icon: <CopyOutlined />, label: 'Sao chép Email người nhận', onClick: () => copyToClipboard(r.to, 'địa chỉ Email người nhận') }, { key: 'copy-subj', icon: <FileTextOutlined />, label: 'Sao chép tiêu đề Email', onClick: () => copyToClipboard(r.subject, 'tiêu đề Email') }]} /> },
                ]}
              />
            </div>
          )}
        </div>
      </Spin>
      <EmailQueueDetailModal email={viewingEmail} fallbackHtml={preview?.html} onClose={() => setViewingEmail(null)} />
    </Card>
  );

  if (mode === 'reconcile') return reconcilePane;
  if (mode === 'email') return emailPane;
  return (
    <Card size="small" style={{ marginTop: 16 }}>
      <Tabs activeKey={subTab} onChange={(k) => setSubTab(k as 'reconcile' | 'email')} items={[{ key: 'reconcile', label: <Space size={6}><SafetyCertificateOutlined /><span>Bộ máy Đối soát &amp; Đồng bộ Toàn vẹn Dữ liệu</span></Space>, children: reconcilePane }, { key: 'email', label: <Space size={6}><MailOutlined /><span>Mẫu Email Doanh Nghiệp &amp; Gửi thử Gmail</span></Space>, children: emailPane }]} />
    </Card>
  );
}
