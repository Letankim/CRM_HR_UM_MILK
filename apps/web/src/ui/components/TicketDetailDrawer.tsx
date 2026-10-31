'use client';

import { Alert, App, Button, Card, Descriptions, Flex, Input, Select, Space, Spin, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined, RetweetOutlined, SendOutlined, UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { TICKET_DEPARTMENT_OPTIONS, type TicketDepartment, type TicketStatus } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { StatusTag } from '../StatusTag';
import { BRAND } from '../theme';
import { BaseDetailDrawer } from './BaseDetailDrawer';
import type { SupportTicketItem, TicketAssigneeOption } from './ticket-types';

export interface TicketDetailDrawerProps {
  ticketId: string | null;
  isBackoffice?: boolean;
  onClose: () => void;
}

export function TicketDetailDrawer({ ticketId, isBackoffice = false, onClose }: TicketDetailDrawerProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { data: me } = useMe();
  const [replyText, setReplyText] = useState('');
  const [nextDept, setNextDept] = useState<TicketDepartment>('HR');
  const [nextAssignee, setNextAssignee] = useState<string>('');

  const detailQ = useQuery({
    queryKey: ['ticket-detail', ticketId],
    queryFn: () => api.get<SupportTicketItem>(`/tickets/${ticketId}`),
    enabled: Boolean(ticketId),
  });

  const assigneesQ = useQuery({
    queryKey: ['ticket-assignees'],
    queryFn: () => api.get<TicketAssigneeOption[]>('/tickets/assignees'),
    enabled: Boolean(ticketId) && isBackoffice,
  });

  const t = detailQ.data;
  useEffect(() => {
    if (t) {
      setNextDept(t.target_department);
      setNextAssignee(t.assignee_user_id || '');
    }
  }, [t]);

  const refreshAll = () => {
    ['tickets', 'ticket-detail', 'notifications', 'payroll-snapshots'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
    void qc.invalidateQueries({ queryKey: ['me', 'payslips'] });
  };

  const replyMut = useMutation({
    mutationFn: (payload: { content: string; status?: TicketStatus }) => api.post<SupportTicketItem>(`/tickets/${ticketId}/reply`, payload),
    onSuccess: (res) => {
      setReplyText('');
      message.success(res.status === 'RESOLVED' ? 'Đã gửi phản hồi và hoàn tất giải quyết phiếu hỗ trợ' : 'Đã gửi phản hồi thành công');
      refreshAll();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Gửi phản hồi thất bại'),
  });

  const updateMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.put<SupportTicketItem>(`/tickets/${ticketId}`, { ...payload, version: t?.version }),
    onSuccess: () => {
      message.success('Đã cập nhật điều phối / trạng thái phiếu hỗ trợ');
      refreshAll();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Cập nhật phiếu hỗ trợ thất bại'),
  });

  const isRequester = Boolean(t && (t.isRequester ?? me?.user.id === t.requester_user_id));
  const isAssignedToMe = Boolean(
    t &&
      (t.isAssignedToMe ??
        (!isRequester &&
          isBackoffice &&
          (t.assignee_user_id ? t.assignee_user_id === me?.user.id : t.target_department === me?.user.role))),
  );
  const canForward = Boolean(t && t.status !== 'CLOSED' && (t.canForward ?? isAssignedToMe));
  const canResolve = Boolean(t && t.status !== 'CLOSED' && isAssignedToMe);
  const canCloseTicket = Boolean(t && t.status !== 'CLOSED' && (isRequester || isAssignedToMe));
  const deptAssignees = (assigneesQ.data ?? []).filter((a) => a.department === nextDept);
  const routingDirty = Boolean(t && (nextDept !== t.target_department || nextAssignee !== (t.assignee_user_id || '')));

  return (
    <BaseDetailDrawer
      open={Boolean(ticketId)}
      onClose={onClose}
      title={t ? `Chi tiết Phiếu hỗ trợ — ${t.ticket_code}` : 'Chi tiết Phiếu hỗ trợ'}
      extra={
        canCloseTicket ? (
          <Button size="small" icon={<CheckCircleOutlined />} loading={updateMut.isPending} onClick={() => updateMut.mutate({ status: 'CLOSED' })}>
            Đóng phiếu
          </Button>
        ) : null
      }
    >
      {detailQ.isLoading || !t ? (
        <div style={{ padding: 32, textAlign: 'center' }}><Spin /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 2, xxl: 2 }} styles={{ label: { width: 195, fontWeight: 500, background: '#F8FAFC' } }}>
            <Descriptions.Item label="Tiêu đề phiếu hỗ trợ" span={2}><strong>{t.subject}</strong></Descriptions.Item>
            <Descriptions.Item label="Người gửi">{t.requesterName}{t.requesterCode ? ` (${t.requesterCode})` : ''} · {t.requesterRoleLabel}</Descriptions.Item>
            <Descriptions.Item label="Chi nhánh">{t.branchName}</Descriptions.Item>
            <Descriptions.Item label="Phân loại vấn đề">{t.categoryLabel}</Descriptions.Item>
            <Descriptions.Item label="Ưu tiên & Trạng thái">
              <Space size={6} wrap><StatusTag value={t.priority} label={t.priorityLabel} /><StatusTag value={t.status} label={t.statusLabel} /></Space>
            </Descriptions.Item>
            <Descriptions.Item label="Bộ phận tiếp nhận" span={2}>
              <strong>{t.departmentLabel}</strong>
            </Descriptions.Item>
            <Descriptions.Item label="Người phụ trách xử lý" span={2}>
              <span style={{ color: t.assignee_user_id ? BRAND.primary : undefined, fontWeight: t.assignee_user_id ? 600 : 400 }}>
                {t.assigneeName}{t.assignee_user_id && t.assigneeRoleLabel ? ` (${t.assigneeRoleLabel})` : ''}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="Hồ sơ / Phiếu liên quan" span={2}>
              {t.related_label ? (
                <Tag color="blue" style={{ margin: 0 }}>{t.related_label}</Tag>
              ) : (
                <Typography.Text type="secondary">Không đính kèm hồ sơ / phiếu cụ thể</Typography.Text>
              )}
            </Descriptions.Item>
          </Descriptions>

          {canForward && (
            <Card size="small" styles={{ body: { padding: '10px 14px', background: '#F8FAFC' } }}>
              <Flex align="center" justify="space-between" wrap gap={10}>
                <Typography.Text strong style={{ fontSize: 12.5 }}><RetweetOutlined /> Điều phối Bộ phận / Người xử lý:</Typography.Text>
                <Space wrap size={8}>
                  <Select size="small" style={{ width: 235 }} value={nextDept} options={TICKET_DEPARTMENT_OPTIONS} onChange={(d) => { setNextDept(d); setNextAssignee(''); }} />
                  <Select
                    size="small" style={{ width: 250 }} value={nextAssignee}
                    options={[{ value: '', label: 'Toàn bộ phận tiếp nhận' }, ...deptAssignees.map((a) => ({ value: a.id, label: `${a.displayName} (${a.roleLabel})` }))]}
                    onChange={setNextAssignee}
                  />
                  <Button size="small" type="primary" ghost icon={<RetweetOutlined />} disabled={!routingDirty} loading={updateMut.isPending} onClick={() => updateMut.mutate({ target_department: nextDept, assignee_user_id: nextAssignee })}>
                    Chuyển xử lý
                  </Button>
                </Space>
              </Flex>
            </Card>
          )}

          {t.resolution_note && (t.status === 'RESOLVED' || t.status === 'CLOSED') && (
            <Alert type="success" showIcon message={`Kết quả giải quyết${t.resolvedByName ? ` (${t.resolvedByName})` : ''}`} description={t.resolution_note} />
          )}

          <Card size="small" title={`Nội dung trao đổi & phản hồi (${t.messages.length})`} styles={{ body: { padding: 12, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 420, overflowY: 'auto' } }}>
            {t.messages.map((m) => {
              const isMine = m.sender_user_id === me?.user.id;
              const isReqMsg = m.sender_user_id === t.requester_user_id;
              return (
                <div key={m.id} style={{ padding: '10px 14px', borderRadius: 4, border: `1px solid ${isReqMsg ? BRAND.border : '#BFDBFE'}`, background: isMine ? '#EFF6FF' : isReqMsg ? '#FFFFFF' : '#F8FAFC' }}>
                  <Flex justify="space-between" align="center" wrap gap={6} style={{ marginBottom: 4 }}>
                    <Space size={6}>
                      <UserOutlined style={{ color: BRAND.primary, fontSize: 12 }} />
                      <Typography.Text strong style={{ fontSize: 12.5 }}>{m.sender_name}</Typography.Text>
                      <Tag color={isReqMsg ? 'default' : 'blue'} style={{ margin: 0, fontSize: 11 }}>{m.sender_role}</Tag>
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>{dayjs(m.created_at).format('HH:mm DD/MM/YYYY')}</Typography.Text>
                  </Flex>
                  <div style={{ fontSize: 13, color: BRAND.text, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{m.content}</div>
                </div>
              );
            })}
          </Card>

          {t.status !== 'CLOSED' && (
            <Card size="small" title="Gửi phản hồi mới" styles={{ body: { padding: 12 } }}>
              <Input.TextArea rows={3} value={replyText} onChange={(e) => setReplyText(e.target.value)} maxLength={2500} placeholder="Nhập nội dung phản hồi, hướng dẫn hoặc kết quả đối soát..." style={{ marginBottom: 10 }} />
              <Flex justify="flex-end" gap={8} wrap>
                <Button icon={<SendOutlined />} type={canResolve ? 'default' : 'primary'} disabled={replyText.trim().length < 2} loading={replyMut.isPending} onClick={() => replyMut.mutate({ content: replyText.trim() })}>
                  Gửi trao đổi
                </Button>
                {canResolve && (
                  <Button type="primary" icon={<CheckCircleOutlined />} disabled={replyText.trim().length < 2} loading={replyMut.isPending} onClick={() => replyMut.mutate({ content: replyText.trim(), status: 'RESOLVED' })}>
                    Phản hồi &amp; Hoàn tất giải quyết
                  </Button>
                )}
              </Flex>
            </Card>
          )}
        </div>
      )}
    </BaseDetailDrawer>
  );
}
