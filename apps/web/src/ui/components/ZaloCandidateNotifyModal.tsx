'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Checkbox, Col, Flex, Form, Input, Modal, Row, Segmented, Select, Space, Tag } from 'antd';
import { BellOutlined, CloseOutlined, CopyOutlined, ExportOutlined, LockOutlined, MessageOutlined, SendOutlined, SettingOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { ZaloHrAccountItem } from './ZaloHrAccountsModal';

export interface ZaloNotifyTarget {
  candidateId?: string; interviewId?: string; candidateName: string; candidateCode?: string;
  candidatePhone?: string; candidateZaloId?: string; zaloAccountId?: string; positionLabel?: string;
  branchName?: string; interviewTime?: string; meetLink?: string; rsvpUrl?: string;
  candidateConfirmed?: boolean; defaultTemplateType?: 'GREETING' | 'INVITE' | 'REMINDER' | 'PASS';
}

interface Props {
  target: ZaloNotifyTarget | null; accounts: ZaloHrAccountItem[]; currentUserId?: string;
  onClose: () => void; onOpenAccountsConfig: () => void;
}

function interpolateTemplate(tpl: string, t: ZaloNotifyTarget, acc?: ZaloHrAccountItem): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  return (tpl || '')
    .replace(/\{candidate_name\}/g, t.candidateName || 'Bạn').replace(/\{candidate_code\}/g, t.candidateCode || 'UV')
    .replace(/\{position\}/g, t.positionLabel || 'Nhân viên Cửa hàng').replace(/\{branch_name\}/g, t.branchName || 'Ụm Bò Milk')
    .replace(/\{brand_name\}/g, 'Ụm Bò Milk').replace(/\{interview_time\}/g, t.interviewTime || 'theo lịch hẹn')
    .replace(/\{meet_link\}/g, t.meetLink || 'https://meet.google.com/umb-milk-hr').replace(/\{rsvp_url\}/g, t.rsvpUrl || `${origin}/nv/login`)
    .replace(/\{hr_zalo_name\}/g, acc?.zalo_name || 'HR Ụm Bò Milk').replace(/\{hr_zalo_phone\}/g, acc?.zalo_phone || '0901000002')
    .replace(/\{minutes_left\}/g, '10');
}

export function ZaloCandidateNotifyModal({ target, accounts, currentUserId, onClose, onOpenAccountsConfig }: Props) {
  const qc = useQueryClient(), { message } = App.useApp(), [form] = Form.useForm();
  const [templateType, setTemplateType] = useState<'GREETING' | 'INVITE' | 'REMINDER' | 'PASS'>('INVITE');
  const selectedAccId = Form.useWatch('zalo_account_id', form) as string | undefined;
  const selectedAcc = useMemo(() => accounts.find((a) => a.id === selectedAccId) ?? accounts[0], [accounts, selectedAccId]);

  useEffect(() => {
    if (!target) return;
    const initialTpl = target.defaultTemplateType ?? (target.interviewId ? 'INVITE' : 'GREETING');
    setTemplateType(initialTpl);
    const preferredAcc =
      (target.zaloAccountId ? accounts.find((a) => a.id === target.zaloAccountId) : undefined)
      ?? (currentUserId ? accounts.find((a) => a.owner_user_id === currentUserId && a.is_default) ?? accounts.find((a) => a.owner_user_id === currentUserId) : undefined)
      ?? accounts.find((a) => a.is_default)
      ?? accounts[0];
    const rawTpl =
      initialTpl === 'GREETING' ? preferredAcc?.greeting_template
      : initialTpl === 'REMINDER' ? preferredAcc?.reminder_template
      : initialTpl === 'PASS' ? preferredAcc?.pass_template
      : preferredAcc?.invite_template;
    form.setFieldsValue({
      zalo_account_id: preferredAcc?.id,
      candidate_zalo_id: target.candidateZaloId || target.candidatePhone || '',
      mark_confirmed: target.candidateConfirmed ?? true,
      message: interpolateTemplate(rawTpl || '', target, preferredAcc),
    });
  }, [target, accounts, currentUserId, form]);

  const applyTemplateType = (nextType: 'GREETING' | 'INVITE' | 'REMINDER' | 'PASS', acc?: ZaloHrAccountItem) => {
    setTemplateType(nextType);
    if (!target) return;
    const a = acc ?? selectedAcc;
    const rawTpl =
      nextType === 'GREETING' ? a?.greeting_template
      : nextType === 'REMINDER' ? a?.reminder_template
      : nextType === 'PASS' ? a?.pass_template
      : a?.invite_template;
    form.setFieldValue('message', interpolateTemplate(rawTpl || '', target, a));
  };

  const sendMut = useMutation({
    mutationFn: (payload: { mode: 'SEND' | 'COPY_AND_SAVE'; values: Record<string, unknown> }) =>
      api.post<{ zalo_chat_url: string; message: string }>('/admin/recruitment/zalo-send', {
        candidate_id: target?.candidateId,
        interview_id: target?.interviewId,
        zalo_account_id: payload.values.zalo_account_id,
        candidate_zalo_id: payload.values.candidate_zalo_id,
        template_type: templateType,
        message: payload.values.message,
        mark_confirmed: payload.values.mark_confirmed,
        mode: payload.mode,
      }),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['interviews'] });
      if (vars.mode === 'COPY_AND_SAVE') {
        void navigator.clipboard?.writeText(String(vars.values.message || res?.message || ''));
        message.success('Đã sao chép tin nhắn mẫu, lưu ID Zalo ứng viên và mở cửa sổ chat Zalo');
        if (res?.zalo_chat_url) window.open(res.zalo_chat_url, '_blank');
      } else {
        message.success('Đã gửi thông báo Zalo tới ứng viên và lưu ID Zalo để tự động nhắc lịch phỏng vấn');
      }
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Gửi thông báo Zalo thất bại'),
  });

  const handleCopyOnly = async () => {
    const msg = String(form.getFieldValue('message') || '');
    await navigator.clipboard?.writeText(msg);
    message.success('Đã sao chép nội dung tin nhắn mẫu vào bộ nhớ tạm');
  };

  return (
    <Modal
      width={720}
      open={Boolean(target)}
      destroyOnHidden
      title={target ? `Gửi Thông báo Zalo & Tin nhắn mẫu: ${target.candidateName}${target.candidateCode ? ` (${target.candidateCode})` : ''}` : 'Gửi thông báo Zalo'}
      footer={null}
      onCancel={onClose}
    >
      {target && (
        <Form form={form} layout="vertical" onFinish={(v) => sendMut.mutate({ mode: 'SEND', values: v })}>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              icon={<BellOutlined />}
              message="Lưu liên kết Tài khoản Zalo HR & ID Zalo Ứng viên để tự động nhắc lịch phỏng vấn"
              description="Khi chọn tài khoản Zalo và lưu/gửi cho ứng viên, hệ thống sẽ gắn ID Zalo của ứng viên và tài khoản Zalo phụ trách vào lịch phỏng vấn. Khi còn 5–15 phút tới giờ phỏng vấn (nếu ứng viên đã xác nhận), hệ thống tự động gửi tin nhắn nhắc nhở qua Zalo."
            />

            <Row gutter={12}>
              <Col span={15}>
                <Form.Item
                  name="zalo_account_id"
                  label={
                    <Space size={6}>
                      <span>Tài khoản Zalo gửi thông báo (theo nhân sự)</span>
                      <Tag color="success" icon={<LockOutlined />} style={{ margin: 0 }}>AES-256</Tag>
                    </Space>
                  }
                  rules={[{ required: true, message: 'Vui lòng chọn tài khoản Zalo' }]}
                >
                  <Select
                    options={accounts.map((a) => ({
                      value: a.id,
                      label: `${a.zalo_name} (${a.zalo_phone}) — Sở hữu: ${a.owner_display_name}`,
                    }))}
                    onChange={(val) => {
                      const nextAcc = accounts.find((a) => a.id === val);
                      applyTemplateType(templateType, nextAcc);
                    }}
                  />
                </Form.Item>
              </Col>
              <Col span={9}>
                <Form.Item
                  name="candidate_zalo_id"
                  label="ID Zalo / SĐT Zalo của Ứng viên"
                  rules={[{ required: true, message: 'Nhập ID hoặc SĐT Zalo ứng viên' }]}
                >
                  <Input prefix={<MessageOutlined style={{ color: '#2563EB' }} />} placeholder="0909888777 hoặc UID Zalo" />
                </Form.Item>
              </Col>
            </Row>

            <Flex justify="space-between" align="center" wrap gap={8}>
              <Segmented
                value={templateType}
                options={[
                  { value: 'GREETING', label: '1. Kết bạn & Sàng lọc' },
                  { value: 'INVITE', label: '2. Mời phỏng vấn & RSVP' },
                  { value: 'REMINDER', label: '3. Nhắc lịch phỏng vấn' },
                  { value: 'PASS', label: '4. Báo Đạt phỏng vấn' },
                ]}
                onChange={(v) => applyTemplateType(v as 'GREETING' | 'INVITE' | 'REMINDER' | 'PASS')}
              />
              <Button size="small" icon={<SettingOutlined />} onClick={onOpenAccountsConfig}>
                Cấu hình TK Zalo
              </Button>
            </Flex>

            <Form.Item
              name="message"
              label="Nội dung tin nhắn Zalo (có thể chỉnh sửa trực tiếp hoặc sao chép nhanh)"
              rules={[{ required: true, message: 'Nhập nội dung tin nhắn Zalo' }]}
              style={{ marginBottom: 4 }}
            >
              <Input.TextArea rows={4} />
            </Form.Item>

            {target.interviewId && (
              <Form.Item name="mark_confirmed" valuePropName="checked" style={{ marginBottom: 4 }}>
                <Checkbox>
                  Đánh dấu <b>Ứng viên đã xác nhận lịch phỏng vấn</b> (Tự động gửi tin nhắn Zalo nhắc lịch trước 5–15 phút)
                </Checkbox>
              </Form.Item>
            )}

            <Flex justify="space-between" align="center" wrap gap={8} style={{ paddingTop: 6, borderTop: '1px solid #E5E7EB' }}>
              <Button icon={<CopyOutlined />} onClick={handleCopyOnly}>
                Sao chép tin nhắn mẫu
              </Button>
              <Space wrap>
                <Button icon={<CloseOutlined />} onClick={onClose}>Hủy bỏ</Button>
                <Button
                  icon={<ExportOutlined />}
                  loading={sendMut.isPending}
                  onClick={async () => {
                    const values = await form.validateFields();
                    sendMut.mutate({ mode: 'COPY_AND_SAVE', values });
                  }}
                >
                  Sao chép, Lưu ID &amp; Mở Zalo
                </Button>
                <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={sendMut.isPending}>
                  Gửi qua Zalo đã chọn &amp; Lưu ID nhắc lịch
                </Button>
              </Space>
            </Flex>
          </Space>
        </Form>
      )}
    </Modal>
  );
}
