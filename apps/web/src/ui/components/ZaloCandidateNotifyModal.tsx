'use client';

import { useEffect, useMemo, useState } from 'react';
import { App, Button, Col, Form, Input, Modal, Radio, Row, Select, Space, Switch, Tag } from 'antd';
import { CloseOutlined, CopyOutlined, LinkOutlined, SettingOutlined, SendOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { ZaloHrAccountItem } from './zalo-accounts-types';
import { renderLocalPreview, type ZaloNotifyTarget } from './zalo-notify-preview';

export type { ZaloNotifyTarget } from './zalo-notify-preview';

interface Props {
  target: ZaloNotifyTarget | null;
  accounts: ZaloHrAccountItem[];
  currentUserId?: string;
  onClose: () => void;
  onOpenAccountsConfig: () => void;
}

export function ZaloCandidateNotifyModal({ target, accounts, currentUserId, onClose, onOpenAccountsConfig }: Props) {
  const qc = useQueryClient(), { message } = App.useApp();
  const [selectedAccId, setSelectedAccId] = useState<string>('');
  const [candZaloId, setCandZaloId] = useState<string>('');
  const [tplType, setTplType] = useState<'GREETING' | 'INVITE' | 'REMINDER' | 'PASS'>('INVITE');
  const [msgText, setMsgText] = useState<string>('');
  const [markConfirmed, setMarkConfirmed] = useState<boolean>(false);
  const [rsvpUrl, setRsvpUrl] = useState<string>('');
  const effTarget = target ? { ...target, rsvpUrl: rsvpUrl || target.rsvpUrl } : null;

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
    setRsvpUrl(target.rsvpUrl || '');
    const rawTpl =
      nextTpl === 'GREETING' ? preferredAcc?.greeting_template
      : nextTpl === 'REMINDER' ? preferredAcc?.reminder_template
      : nextTpl === 'PASS' ? preferredAcc?.pass_template
      : preferredAcc?.invite_template;
    setMsgText(renderLocalPreview(rawTpl || '', target, preferredAcc, nextTpl === 'GREETING'));
  }, [target, accounts, currentUserId]);

  const handleAccountOrTplChange = (nextAccId: string, nextTpl: 'GREETING' | 'INVITE' | 'REMINDER' | 'PASS', urlOverride?: string) => {
    const acc = accounts.find((a) => a.id === nextAccId) ?? selectedAcc;
    setSelectedAccId(nextAccId);
    setTplType(nextTpl);
    if (!effTarget) return;
    const rawTpl =
      nextTpl === 'GREETING' ? acc?.greeting_template
      : nextTpl === 'REMINDER' ? acc?.reminder_template
      : nextTpl === 'PASS' ? acc?.pass_template
      : acc?.invite_template;
    setMsgText(renderLocalPreview(rawTpl || '', urlOverride ? { ...effTarget, rsvpUrl: urlOverride } : effTarget, acc, nextTpl === 'GREETING'));
  };

  const renewLinkMut = useMutation({
    mutationFn: () => api.post<{ rsvp_url: string }>(`/admin/interviews/${target?.interviewId}/rsvp-link`, {}),
    onSuccess: (res) => {
      const oldUrl = rsvpUrl || target?.rsvpUrl || '';
      setRsvpUrl(res.rsvp_url);
      if (oldUrl && msgText.includes(oldUrl)) setMsgText(msgText.split(oldUrl).join(res.rsvp_url));
      else if (target) handleAccountOrTplChange(selectedAcc?.id || '', tplType === 'GREETING' ? 'INVITE' : tplType, res.rsvp_url);
      qc.invalidateQueries({ queryKey: ['interviews'] });
      message.success('Đã tạo link xác nhận mới (hiệu lực 7 ngày) và cập nhật vào nội dung tin nhắn');
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Tạo link xác nhận mới thất bại'),
  });

  const sendMut = useMutation({
    mutationFn: (mode: 'SEND' | 'COPY_AND_SAVE') =>
      api.post<{ zalo_chat_url: string; message: string }>('/admin/recruitment/zalo-send', {
        candidate_id: target?.candidateId, interview_id: target?.interviewId,
        zalo_account_id: selectedAcc?.id || selectedAccId,
        candidate_zalo_id: candZaloId.trim() || target?.candidatePhone || '',
        template_type: tplType, message: msgText,
        mark_confirmed: target?.interviewId ? markConfirmed : undefined, mode,
      }),
    onSuccess: async (_res, mode) => {
      try { await navigator.clipboard.writeText(msgText); } catch { /* ignore */ }
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
        <Button key="cancel" icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>,
        <Button key="copy" icon={<CopyOutlined />} loading={sendMut.isPending} onClick={() => sendMut.mutate('COPY_AND_SAVE')}>Sao chép tin nhắn</Button>,
        <Button key="send" type="primary" icon={<SendOutlined />} loading={sendMut.isPending} onClick={() => sendMut.mutate('SEND')}>Gửi Zalo</Button>,
      ]}
    >
      {target && (
        <Form layout="vertical">
          <Row gutter={12}>
            <Col xs={24} md={14}>
              <Form.Item label={<Space size={8}><span>Tài khoản Zalo HR gửi đi</span><Button size="small" type="link" icon={<SettingOutlined />} onClick={onOpenAccountsConfig} style={{ padding: 0, height: 'auto' }}>Quản lý TK Zalo</Button></Space>}>
                <Select value={selectedAcc?.id} onChange={(v) => handleAccountOrTplChange(v, tplType)} options={accounts.map((a) => ({ value: a.id, label: `${a.zalo_name} (${a.zalo_phone}) — ${a.owner_display_name}` }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item label="SĐT / ID Zalo của ứng viên (Lưu để nhắc lịch)">
                <Input value={candZaloId} onChange={(e) => setCandZaloId(e.target.value)} placeholder="Nhập SĐT hoặc ID Zalo ứng viên..." />
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

          <Form.Item
            label={
              <Space size={8} wrap>
                <span>{tplType === 'GREETING' ? 'Lời mời kết bạn Zalo (Giới hạn tối đa 150 ký tự)' : 'Nội dung tin nhắn gửi ứng viên (có thể chỉnh sửa trước khi gửi hoặc sao chép)'}</span>
                {tplType === 'GREETING' && <Tag color={msgText.length > 150 ? 'red' : 'blue'} style={{ margin: 0 }}>{msgText.length}/150 ký tự</Tag>}
              </Space>
            }
          >
            <Input.TextArea rows={5} maxLength={tplType === 'GREETING' ? 150 : 2000} showCount value={msgText} onChange={(e) => setMsgText(tplType === 'GREETING' ? e.target.value.slice(0, 150) : e.target.value)} />
          </Form.Item>

          {target.interviewId && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '8px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <Tag color="blue" style={{ margin: 0, flexShrink: 0 }}>Lịch hẹn: {target.interviewTime || 'Đã xếp lịch'}</Tag>
                <span style={{ fontSize: 12, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Khi xác nhận lịch, hệ thống sẽ tự động nhắn Zalo nhắc trước giờ phỏng vấn 5–15 phút.
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, whiteSpace: 'nowrap' }}>
                <Button size="small" icon={<LinkOutlined />} loading={renewLinkMut.isPending} onClick={() => renewLinkMut.mutate()}>Tạo link xác nhận mới</Button>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap' }}>Đã xác nhận lịch:</span>
                <Switch size="small" checked={markConfirmed} onChange={setMarkConfirmed} />
              </div>
            </div>
          )}
        </Form>
      )}
    </Modal>
  );
}
