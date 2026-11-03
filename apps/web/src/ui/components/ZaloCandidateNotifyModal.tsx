'use client';

import { useEffect, useMemo, useState } from 'react';
import { App, Button, Col, Form, Input, Modal, Radio, Row, Space, Switch, Tag } from 'antd';
import { CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseOutlined, CopyOutlined, LinkOutlined, SettingOutlined, SendOutlined, WarningOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { ZaloHrAccountItem } from './zalo-accounts-types';
import { computeInterviewTimingNotice, normalizeClientRsvpUrl, renderLocalPreview, type ZaloNotifyTarget } from './zalo-notify-preview';

export type { ZaloNotifyTarget } from './zalo-notify-preview';

interface Props {
  target: ZaloNotifyTarget | null;
  accounts: ZaloHrAccountItem[];
  currentUserId?: string;
  onClose: () => void;
  onOpenAccountsConfig: () => void;
  onRescheduleInterview?: (interviewId?: string, candidateId?: string) => void;
}

export function ZaloCandidateNotifyModal({ target, accounts, onClose, onOpenAccountsConfig, onRescheduleInterview }: Props) {
  const qc = useQueryClient(), { message } = App.useApp();
  const [candZaloId, setCandZaloId] = useState<string>('');
  const [tplType, setTplType] = useState<'GREETING' | 'INVITE' | 'REMINDER' | 'PASS'>('INVITE');
  const [msgText, setMsgText] = useState<string>('');
  const [markConfirmed, setMarkConfirmed] = useState<boolean>(false);
  const [rsvpUrl, setRsvpUrl] = useState<string>('');

  const defaultAcc = useMemo(
    () => accounts.find((a) => a.is_default && a.status === 'ACTIVE') ?? accounts.find((a) => a.is_default) ?? accounts.find((a) => a.status === 'ACTIVE') ?? accounts[0],
    [accounts],
  );
  const isAlreadyConfirmed = Boolean(target?.candidateConfirmed);
  const timing = useMemo(() => computeInterviewTimingNotice(target?.interviewStartAt || target?.interviewTime), [target?.interviewStartAt, target?.interviewTime]);
  const effTarget = target ? { ...target, rsvpUrl: normalizeClientRsvpUrl(rsvpUrl || target.rsvpUrl) } : null;

  const buildPreview = (nextTpl: 'GREETING' | 'INVITE' | 'REMINDER' | 'PASS', acc?: ZaloHrAccountItem, urlOverride?: string) => {
    if (!target) return '';
    const rawTpl = nextTpl === 'GREETING' ? acc?.greeting_template : nextTpl === 'REMINDER' ? acc?.reminder_template : nextTpl === 'PASS' ? acc?.pass_template : acc?.invite_template;
    const t = { ...target, rsvpUrl: normalizeClientRsvpUrl(urlOverride || rsvpUrl || target.rsvpUrl) };
    return renderLocalPreview(rawTpl || '', t, acc, nextTpl === 'GREETING');
  };

  useEffect(() => {
    if (!target) return;
    const rawDefault = target.defaultTemplateType ?? (target.interviewId ? 'INVITE' : 'GREETING');
    const nextTpl = isAlreadyConfirmed && (rawDefault === 'GREETING' || rawDefault === 'INVITE') ? 'REMINDER' : rawDefault;
    const initialUrl = normalizeClientRsvpUrl(target.rsvpUrl);
    setCandZaloId(target.candidateZaloId || target.candidatePhone || '');
    setTplType(nextTpl);
    setMarkConfirmed(Boolean(target.candidateConfirmed));
    setRsvpUrl(initialUrl);
    setMsgText(buildPreview(nextTpl, defaultAcc, initialUrl));
    if ((!target.rsvpUrl || target.rsvpUrl.endsWith('/rsvp/xac-nhan')) && (target.interviewId || target.candidateId)) {
      void api.post<{ rsvp_url: string }>('/admin/recruitment/rsvp-link', { interview_id: target.interviewId, candidate_id: target.candidateId })
        .then((res) => {
          const freshUrl = normalizeClientRsvpUrl(res.rsvp_url);
          setRsvpUrl(freshUrl);
          setMsgText((prev) => prev.includes('/rsvp/') ? prev.replace(/https?:\/\/[^\s]+\/rsvp\/[^\s]+/g, freshUrl) : prev);
        })
        .catch(() => undefined);
    }
  }, [target, defaultAcc, isAlreadyConfirmed]);

  const handleTplChange = (nextTpl: 'GREETING' | 'INVITE' | 'REMINDER' | 'PASS', urlOverride?: string) => {
    setTplType(nextTpl);
    if (!effTarget) return;
    setMsgText(buildPreview(nextTpl, defaultAcc, urlOverride));
  };

  const renewLinkMut = useMutation({
    mutationFn: () => api.post<{ rsvp_url: string }>('/admin/recruitment/rsvp-link', { interview_id: target?.interviewId, candidate_id: target?.candidateId }),
    onSuccess: (res) => {
      const freshUrl = normalizeClientRsvpUrl(res.rsvp_url);
      setRsvpUrl(freshUrl);
      if (/https?:\/\/[^\s]+\/rsvp\/[^\s]+/.test(msgText)) {
        setMsgText(msgText.replace(/https?:\/\/[^\s]+\/rsvp\/[^\s]+/g, freshUrl));
      } else {
        handleTplChange(tplType === 'GREETING' && !isAlreadyConfirmed ? 'INVITE' : tplType, freshUrl);
      }
      qc.invalidateQueries({ queryKey: ['interviews'] });
      message.success('Đã tạo link xác nhận phỏng vấn mới (hiệu lực 7 ngày) và cập nhật vào tin nhắn');
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Tạo link xác nhận mới thất bại'),
  });

  const sendMut = useMutation({
    mutationFn: (mode: 'SEND' | 'COPY_AND_SAVE') =>
      api.post<{ zalo_chat_url: string; message: string }>('/admin/recruitment/zalo-send', {
        candidate_id: target?.candidateId, interview_id: target?.interviewId,
        zalo_account_id: defaultAcc?.id || '',
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
              <Form.Item label={<Space size={8}><span>Tài khoản Zalo mặc định gửi thông báo</span><Button size="small" type="link" icon={<SettingOutlined />} onClick={onOpenAccountsConfig} style={{ padding: 0, height: 'auto' }}>Cấu hình TK mặc định</Button></Space>}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, height: 32, padding: '0 11px', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4 }}>
                  {defaultAcc ? (
                    <Space size={6} style={{ overflow: 'hidden' }}>
                      <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{defaultAcc.zalo_name} ({defaultAcc.zalo_phone})</span>
                      <Tag color="gold" style={{ margin: 0 }}>Mặc định</Tag>
                    </Space>
                  ) : <span style={{ color: '#64748B' }}>Chưa liên kết tài khoản Zalo</span>}
                </div>
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item label="SĐT / ID Zalo của ứng viên (Lưu để nhắc lịch)">
                <Input value={candZaloId} onChange={(e) => setCandZaloId(e.target.value)} placeholder="Nhập SĐT hoặc ID Zalo ứng viên..." />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            label={
              <Space size={8} wrap>
                <span>Chọn mẫu tin nhắn Zalo</span>
                {isAlreadyConfirmed && <Tag color="success" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>Ứng viên đã xác nhận — Khóa Chào mừng &amp; Mời phỏng vấn</Tag>}
              </Space>
            }
          >
            <Radio.Group value={tplType} buttonStyle="solid" onChange={(e) => handleTplChange(e.target.value)} style={{ width: '100%', display: 'flex' }}>
              <Radio.Button value="GREETING" disabled={isAlreadyConfirmed} style={{ flex: 1, textAlign: 'center' }}>Chào &amp; Kết bạn</Radio.Button>
              <Radio.Button value="INVITE" disabled={isAlreadyConfirmed} style={{ flex: 1, textAlign: 'center' }}>Mời phỏng vấn</Radio.Button>
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

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '8px 12px' }}>
            <Space size={6} wrap>
              {target.interviewId ? (
                <>
                  <Tag color="blue" style={{ margin: 0 }}>Lịch hẹn: {target.interviewTime || 'Đã xếp lịch'}</Tag>
                  {(timing.status === 'PAST' || timing.status === 'SOON') && (
                    <Tag
                      color={timing.color}
                      icon={timing.status === 'PAST' ? <WarningOutlined /> : <ClockCircleOutlined />}
                      style={{ margin: 0, fontWeight: 600, cursor: onRescheduleInterview ? 'pointer' : 'default' }}
                      onClick={() => onRescheduleInterview?.(target.interviewId, target.candidateId)}
                    >
                      {timing.label}
                    </Tag>
                  )}
                  {onRescheduleInterview && (
                    <Button size="small" type={timing.status === 'PAST' || timing.status === 'SOON' ? 'primary' : 'default'} danger={timing.status === 'PAST'} ghost={timing.status === 'PAST' || timing.status === 'SOON'} icon={<CalendarOutlined />} onClick={() => onRescheduleInterview(target.interviewId, target.candidateId)}>
                      Điều chỉnh ngày giờ
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Tag color="warning" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>Chưa xếp ngày giờ phỏng vấn</Tag>
                  {onRescheduleInterview && (
                    <Button size="small" type="primary" ghost icon={<CalendarOutlined />} onClick={() => onRescheduleInterview(undefined, target.candidateId)}>
                      Đặt ngày giờ phỏng vấn
                    </Button>
                  )}
                </>
              )}
            </Space>
            <Space size={8} wrap>
              <Button size="small" icon={<LinkOutlined />} loading={renewLinkMut.isPending} onClick={() => renewLinkMut.mutate()}>Tạo link xác nhận mới</Button>
              {target.interviewId && (
                <>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>Đã xác nhận lịch:</span>
                  <Switch size="small" checked={markConfirmed} onChange={setMarkConfirmed} />
                </>
              )}
            </Space>
          </div>
        </Form>
      )}
    </Modal>
  );
}
