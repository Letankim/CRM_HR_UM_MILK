'use client';

import { App, Button, Card, Descriptions, Empty, Flex, Input, Select, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import { MailOutlined, SafetyCertificateOutlined, SendOutlined, SyncOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EMAIL_TEMPLATE_CODES, EMAIL_TEMPLATE_LABELS, TABLE_DISPLAY_LABELS, type EmailTemplateCode } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { StatusTag } from '../StatusTag';

interface ReconciliationIssue {
  id: string; code: string; label: string; severity: 'warning' | 'error'; table: string; recordId: string; message: string; autoRepaired: boolean;
}

interface ReconciliationReport {
  checkedAt: string;
  status: 'ok' | 'degraded' | 'down';
  summary: { tablesScanned: number; rowsScanned: number; issuesFound: number; autoRepaired: number; unresolvedIssues: number };
  issues: ReconciliationIssue[];
}

interface EmailLogItem {
  id: string; to: string; subject: string; template: EmailTemplateCode; status: 'SENT' | 'QUEUED_MEMORY' | 'DRY_RUN' | 'FAILED'; sentAt: string;
}

interface EmailTemplateResponse {
  templates: { code: EmailTemplateCode; label: string }[];
  preview: { template: EmailTemplateCode; label: string; subject: string; html: string };
  recentEmails?: EmailLogItem[];
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
    mutationFn: () =>
      api.post('/admin/integrations/send-test-email', {
        to: recipientEmail,
        recipient_name: recipientName,
        template: selectedTemplate,
      }),
    onSuccess: () => {
      message.success(`Đã gửi email mẫu "${EMAIL_TEMPLATE_LABELS[selectedTemplate]}" tới ${recipientEmail}`);
      qc.invalidateQueries({ queryKey: ['integrations', 'email-templates'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Gửi email thất bại'),
  });

  const report = reconcileQuery.data;
  const preview = emailPreviewQuery.data?.preview;
  const recentEmails = emailPreviewQuery.data?.recentEmails ?? [];

  const reconcilePane = (
    <Card
      size="small"
      title="Bộ máy Đối soát & Đồng bộ Toàn vẹn Dữ liệu"
      extra={
        <Button size="small" type="primary" icon={<SyncOutlined />} loading={runRepair.isPending || reconcileQuery.isFetching} onClick={() => runRepair.mutate()}>
          Quét &amp; Tự động sửa lỗi
        </Button>
      }
    >
      <Spin spinning={reconcileQuery.isLoading || runRepair.isPending} tip="Đang quét đối soát dữ liệu...">
        <div style={{ minHeight: 160 }}>
          {report && (
            <div>
              <Descriptions size="small" bordered column={4} style={{ marginBottom: 12 }}>
                <Descriptions.Item label="Trạng thái toàn vẹn"><StatusTag value={report.status} /></Descriptions.Item>
                <Descriptions.Item label="Số bảng / dòng đã quét"><span className="num">{report.summary.tablesScanned} bảng ({report.summary.rowsScanned} bản ghi)</span></Descriptions.Item>
                <Descriptions.Item label="Điểm lệch phát hiện"><span className="num">{report.summary.issuesFound}</span></Descriptions.Item>
                <Descriptions.Item label="Đã tự động sửa"><span className="num" style={{ color: '#16A34A', fontWeight: 600 }}>{report.summary.autoRepaired}</span></Descriptions.Item>
              </Descriptions>

              {report.issues.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="100% bản ghi đạt chuẩn liên kết dữ liệu, không trùng lặp và đồng bộ trạng thái" />
              ) : (
                <Table<ReconciliationIssue>
                  size="small"
                  rowKey="id"
                  pagination={{ pageSize: 8 }}
                  dataSource={report.issues}
                  columns={[
                    { title: 'Bảng dữ liệu', dataIndex: 'table', width: 240, render: (v: string) => <Typography.Text strong>{TABLE_DISPLAY_LABELS[v] ?? v}</Typography.Text> },
                    {
                      title: 'Chi tiết kiểm tra',
                      dataIndex: 'message',
                      render: (v: string, r) => (
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</div>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v}</Typography.Text>
                        </div>
                      ),
                    },
                    {
                      title: 'Xử lý',
                      dataIndex: 'autoRepaired',
                      width: 130,
                      align: 'right',
                      render: (repaired: boolean) => repaired ? <Tag color="green" style={{ borderRadius: 2 }}>Đã tự sửa</Tag> : <Tag color="gold" style={{ borderRadius: 2 }}>Cần kiểm tra</Tag>,
                    },
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
      title="Mẫu Email Doanh Nghiệp (Chuẩn Hành Chính Phẳng)"
      extra={
        <Select
          size="small"
          value={selectedTemplate}
          style={{ width: 280 }}
          options={EMAIL_TEMPLATE_CODES.map((code) => ({ value: code, label: EMAIL_TEMPLATE_LABELS[code] }))}
          onChange={(val) => setSelectedTemplate(val)}
        />
      }
    >
      <Spin spinning={emailPreviewQuery.isLoading || emailPreviewQuery.isFetching} tip="Đang tải mẫu email...">
        <div style={{ minHeight: 200 }}>
          {preview && (
            <div>
              <Flex gap={8} wrap="wrap" style={{ marginBottom: 10 }}>
                <Input size="small" style={{ flex: 1, minWidth: 180 }} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Tên người nhận" />
                <Input size="small" style={{ flex: 1, minWidth: 220 }} value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="Email người nhận" />
                <Button size="small" type="primary" icon={<SendOutlined />} loading={sendEmailMut.isPending} onClick={() => sendEmailMut.mutate()}>
                  Gửi Email này
                </Button>
              </Flex>
              <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
                <Typography.Text strong style={{ fontSize: 13 }}>Tiêu đề: {preview.subject}</Typography.Text>
                <Tag color="blue" style={{ borderRadius: 2, margin: 0 }}>{preview.label}</Tag>
              </Flex>
              <iframe
                title={`Xem trước email ${preview.template}`}
                srcDoc={preview.html}
                style={{ width: '100%', height: 320, border: '1px solid #E5E7EB', borderRadius: 2, background: '#F1F5F9' }}
              />
              {recentEmails.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 12, color: '#475569' }}>
                  <strong>Đã gửi gần nhất:</strong> {recentEmails[0]!.to} — {EMAIL_TEMPLATE_LABELS[recentEmails[0]!.template]} ({recentEmails[0]!.status === 'SENT' ? 'Đã gửi Gmail' : 'Đã ghi nhận'})
                </div>
              )}
            </div>
          )}
        </div>
      </Spin>
    </Card>
  );

  if (mode === 'reconcile') return reconcilePane;
  if (mode === 'email') return emailPane;

  return (
    <Card size="small" style={{ marginTop: 16 }}>
      <Tabs
        activeKey={subTab}
        onChange={(k) => setSubTab(k as 'reconcile' | 'email')}
        items={[
          { key: 'reconcile', label: <Space size={6}><SafetyCertificateOutlined /><span>Bộ máy Đối soát &amp; Đồng bộ Toàn vẹn Dữ liệu</span></Space>, children: reconcilePane },
          { key: 'email', label: <Space size={6}><MailOutlined /><span>Mẫu Email Doanh Nghiệp &amp; Gửi thử Gmail</span></Space>, children: emailPane },
        ]}
      />
    </Card>
  );
}
