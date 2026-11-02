'use client';

import { useEffect, useMemo, useState } from 'react';
import { App, Button, Col, Form, Input, Modal, Radio, Row, Select, Space, Switch, Tag } from 'antd';
import { CloseOutlined, CopyOutlined, SettingOutlined, SendOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SYSTEM_CONFIG } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import type { ZaloHrAccountItem } from './ZaloHrAccountsModal';

export interface ZaloNotifyTarget {
  candidateId?: string;
  interviewId?: string;
  candidateName: string;
  candidateCode?: string;
  candidatePhone: string;
  candidateZaloId?: string;
  zaloAccountId?: string;
  positionLabel?: string;
  branchName?: string;
  interviewTime?: string;
  meetLink?: string;
  rsvpUrl?: string;
  candidateConfirmed?: boolean;
  defaultTemplateType?: 'GREETING' | 'INVITE' | 'REMINDER' | 'PASS';
}

interface Props {
  target: ZaloNotifyTarget | null;
  accounts: ZaloHrAccountItem[];
  currentUserId?: string;
  onClose: () => void;
  onOpenAccountsConfig: () => void;
}

function renderLocalPreview(
  tpl: string,
  target: ZaloNotifyTarget,
  acc?: ZaloHrAccountItem,
): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  return tpl
    .replace(/\{candidate_name\}/g, target.candidateName || 'Bạn')
    .replace(/\{candidate_code\}/g, target.candidateCode || 'UV')
    .replace(/\{position\}/g, target.positionLabel || 'Nhân viên Cửa hàng')
    .replace(/\{branch_name\}/g, target.branchName || SYSTEM_CONFIG.brandName)
    .replace(/\{brand_name\}/g, SYSTEM_CONFIG.brandName)
    .replace(/\{interview_time\}/g, target.interviewTime || 'theo lịch hẹn')
    .replace(/\{meet_link\}/g, target.meetLink || 'https://meet.google.com/umb-milk-hr')
    .replace(/\{rsvp_url\}/g, target.rsvpUrl || `${origin}/rsvp/xac-nhan`)
    .replace(/\{hr_zalo_name\}/g, acc?.zalo_name || `HR ${SYSTEM_CONFIG.brandName}`)
    .replace(/\{hr_zalo_phone\}/g, acc?.zalo_phone || '0901000002')
    .replace(/\{minutes_left\}/g, '10');
}

export function ZaloCandidateNotifyModal({ target, accounts, currentUserId, onClose, onOpenAccountsConfig }: Props) {
  const qc = useQueryClient(), { message } = App.useApp();
  const [selectedAccId, setSelectedAccId] = useState<string>('');
  const [candZaloId, setCandZaloId] = useState<string>('');
  const [tplType, setTplType] = useState<'GREETING' | 'INVITE' | 'REMINDER' | 'PASS'>('INVITE');
  const [msgText, setMsgText] = useState<string>('');
  const [markConfirmed, setMarkConfirmed] = useState<boolean>(false);

  const selectedAcc = useMemo(
    () => accounts.find((a) => a.id === selectedAccId) ?? accounts[0],
    [accounts, selectedAccId],
  );

  useEffect(() => {
    if (!target) return;
    const preferredAcc =
      (target.zaloAccountId ? accounts.find((a) => a.id === target.zaloAccountId) : undefined)
      ?? (currentUserId ? accounts.find((a) => a.owner_user_id === currentUserId && a.is_default) ?? accounts.find((a) => a.owner_user_id === currentUserId) : undefined)
      ?? accounts.find((a) => a.is_default)
      ?? accounts[0];
    const nextAccId = preferredAcc?.id ?? '';
    const nextTpl = target.defaultTemplateType ?? (target.interviewId ? 'INVITE' : 'GREETING');
    setSelectedAccId(nextAccId);
    setCandZaloId(target.candidateZaloId || target.candidatePhone || '');
    setTplType(nextTpl);
    setMarkConfirmed(Boolean(target.candidateConfirmed));
    const rawTpl =
      nextTpl === 'GREETING' ? preferredAcc?.greeting_template
      : nextTpl === 'REMINDER' ? preferredAcc?.reminder_template
      : nextTpl === 'PASS' ? preferredAcc?.pass_template
      : preferredAcc?.invite_template;
    setMsgText(renderLocalPreview(rawTpl || '', target, preferredAcc));
  }, [target, accounts, currentUserId]);

  const handleAccountOrTplChange = (nextAccId: string, nextTpl: 'GREETING' | 'INVITE' | 'REMINDER' | 'PASS') => {
    const acc = accounts.find((a) => a.id === nextAccId) ?? selectedAcc;
    setSelectedAccId(nextAccId);
    setTplType(nextTpl);
    if (!target) return;
    const rawTpl =
      nextTpl === 'GREETING' ? acc?.greeting_template
      : nextTpl === 'REMINDER' ? acc?.reminder_template
      : nextTpl === 'PASS' ? acc?.pass_template
      : acc?.invite_template;
    setMsgText(renderLocalPreview(rawTpl || '', target, acc));
  };

  const sendMut = useMutation({
    mutationFn: (mode: 'SEND' | 'COPY_AND_SAVE') =>
      api.post<{ zalo_chat_url: string; message: string }>('/admin/recruitment/zalo-send', {
        candidate_id: target?.candidateId,
        interview_id: target?.interviewId,
        zalo_account_id: selectedAcc?.id || selectedAccId,
        candidate_zalo_id: candZaloId.trim() || target?.candidatePhone || '',
        template_type: tplType,
        message: msgText,
        mark_confirmed: target?.interviewId ? markConfirmed : undefined,
        mode,
      }),
    onSuccess: async (res, mode) => {
      try {
        await navigator.clipboard.writeText(msgText);
      } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['interviews'] });
      if (mode === 'COPY_AND_SAVE') {
        message.success('Đã sao chép tin nhắn mẫu vào bộ nhớ tạm và lưu ID Zalo ứng viên');
      } else {
        message.success(`Đã gửi tin nhắn Zalo cho ứng viên ${target?.candidateName ?? ''}`);
        onClose();
      }
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác gửi Zalo thất bại'),
  });

  return (
    <Modal
      width={840} style={{ maxWidth: 'calc(100vw - 24px)' }} open={Boolean(target)} destroyOnHidden onCancel={onClose}
      title={target ? `Nhắn Zalo: ${target.candidateName}${target.candidateCode ? ` (${target.candidateCode})` : ''}` : 'Nhắn Zalo'}
      footer={[
        <Button key="cancel" icon={<CloseOutlined />} onClick={onClose}>
          Đóng
        </Button>,
        <Button key="copy" icon={<CopyOutlined />} loading={sendMut.isPending} onClick={() => sendMut.mutate('COPY_AND_SAVE')}>
          Sao chép tin nhắn
        </Button>,
        <Button key="send" type="primary" icon={<SendOutlined />} loading={sendMut.isPending} onClick={() => sendMut.mutate('SEND')}>
          Gửi Zalo
        </Button>,
      ]}
    >
      {target && (
        <Form layout="vertical">
          <Row gutter={12}>
            <Col xs={24} md={14}>
              <Form.Item
                label={
                  <Space size={8}>
                    <span>Tài khoản Zalo HR gửi đi</span>
                    <Button size="small" type="link" icon={<SettingOutlined />} onClick={onOpenAccountsConfig} style={{ padding: 0, height: 'auto' }}>
                      Quản lý TK Zalo
                    </Button>
                  </Space>
                }
              >
                <Select
                  value={selectedAcc?.id}
                  onChange={(v) => handleAccountOrTplChange(v, tplType)}
                  options={accounts.map((a) => ({
                    value: a.id,
                    label: `${a.zalo_name} (${a.zalo_phone}) — ${a.owner_display_name}`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item label="SĐT / ID Zalo của ứng viên (Lưu để nhắc lịch)">
                <Input
                  value={candZaloId}
                  onChange={(e) => setCandZaloId(e.target.value)}
                  placeholder="Nhập SĐT hoặc ID Zalo ứng viên..."
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Chọn mẫu tin nhắn Zalo">
            <Radio.Group
              value={tplType}
              buttonStyle="solid"
              onChange={(e) => handleAccountOrTplChange(selectedAcc?.id || '', e.target.value)}
              style={{ width: '100%', display: 'flex' }}
            >
              <Radio.Button value="GREETING" style={{ flex: 1, textAlign: 'center' }}>Chào &amp; Kết bạn</Radio.Button>
              <Radio.Button value="INVITE" style={{ flex: 1, textAlign: 'center' }}>Mời phỏng vấn</Radio.Button>
              <Radio.Button value="REMINDER" style={{ flex: 1, textAlign: 'center' }}>Nhắc trước giờ PV</Radio.Button>
              <Radio.Button value="PASS" style={{ flex: 1, textAlign: 'center' }}>Báo Đạt phỏng vấn</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item label="Nội dung tin nhắn gửi ứng viên (có thể chỉnh sửa trước khi gửi hoặc sao chép)">
            <Input.TextArea rows={5} value={msgText} onChange={(e) => setMsgText(e.target.value)} />
          </Form.Item>

          {target.interviewId && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '8px 12px' }}>
              <Space size={8} wrap>
                <Tag color="blue" style={{ margin: 0 }}>Lịch hẹn: {target.interviewTime || 'Đã xếp lịch'}</Tag>
                <span style={{ fontSize: 12, color: '#475569' }}>
                  Khi ứng viên xác nhận tham gia, hệ thống sẽ tự động gửi tin nhắn Zalo nhắc lịch trước giờ phỏng vấn 5–15 phút.
                </span>
              </Space>
              <Space size={6}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Đã xác nhận lịch:</span>
                <Switch size="small" checked={markConfirmed} onChange={setMarkConfirmed} />
              </Space>
            </div>
          )}
        </Form>
      )}
    </Modal>
  );
}
