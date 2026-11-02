'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Alert, Button, Card, Descriptions, Divider, Input, Space, Spin, Tag, Typography } from 'antd';
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  UserOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { api, ApiClientError } from '@/lib/api';

interface RsvpInterviewInfo {
  interview_id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_code: string;
  position: string;
  branch_id: string;
  branch_name: string;
  branch_address: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  meet_link: string;
  status: string;
  candidate_confirmed: boolean;
  reschedule_requested: boolean;
  reschedule_reason: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  SCHEDULED: { label: 'Đang chờ xác nhận tham gia', color: 'processing' },
  CONFIRMED: { label: 'Đã xác nhận tham gia phỏng vấn', color: 'success' },
  RESCHEDULE_NEEDED: { label: 'Đã gửi yêu cầu xin dời lịch phỏng vấn', color: 'warning' },
  COMPLETED: { label: 'Buổi phỏng vấn đã hoàn tất', color: 'default' },
  CANCELLED: { label: 'Lịch phỏng vấn đã hủy', color: 'error' },
  NO_SHOW: { label: 'Vắng mặt quá giờ hẹn', color: 'error' },
};

export default function CandidateRsvpPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token ?? '');

  const [info, setInfo] = useState<RsvpInterviewInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<'CONFIRM' | 'RESCHEDULE' | null>(null);
  const [reason, setReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    api
      .get<RsvpInterviewInfo>(`/public/rsvp/${encodeURIComponent(token)}`)
      .then((data) => {
        if (!active) return;
        setInfo(data);
        setReason(data.reschedule_reason || '');
        setErrorMsg(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setErrorMsg(err instanceof ApiClientError ? err.message : 'Đường dẫn xác nhận phỏng vấn không hợp lệ hoặc đã hết hạn 7 ngày');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const handleAction = async (action: 'CONFIRM' | 'RESCHEDULE') => {
    if (!token) return;
    setSubmitting(action);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await api.post(`/public/rsvp/${encodeURIComponent(token)}`, {
        action,
        reschedule_reason: reason.trim() || undefined,
      });
      const refreshed = await api.get<RsvpInterviewInfo>(`/public/rsvp/${encodeURIComponent(token)}`);
      setInfo(refreshed);
      setSuccessMsg(
        action === 'CONFIRM'
          ? 'Bạn đã xác nhận tham gia buổi phỏng vấn thành công. Hẹn gặp bạn đúng giờ!'
          : 'Hệ thống đã ghi nhận yêu cầu xin dời lịch phỏng vấn. Bộ phận Nhân sự sẽ liên hệ sắp xếp lịch mới cho bạn.',
      );
    } catch (err: unknown) {
      setErrorMsg(err instanceof ApiClientError ? err.message : 'Không thể gửi phản hồi lịch phỏng vấn, vui lòng thử lại');
    } finally {
      setSubmitting(null);
    }
  };

  const statusMeta = info ? (STATUS_LABELS[info.status] ?? { label: info.status, color: 'default' }) : null;

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', padding: '40px 16px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
      <Card
        style={{ width: '100%', maxWidth: 680, borderRadius: 4, border: '1px solid #E5E7EB' }}
        styles={{ body: { padding: 24 } }}
      >
        <div style={{ borderBottom: '1px solid #E5E7EB', paddingBottom: 16, marginBottom: 20 }}>
          <Typography.Text style={{ fontSize: 12, fontWeight: 700, color: '#2563EB', letterSpacing: 0.6 }}>
            HỆ THỐNG TUYỂN DỤNG NHÂN SỰ — ỤM BÒ MILK
          </Typography.Text>
          <Typography.Title level={4} style={{ margin: '4px 0 0', color: '#0F172A' }}>
            <CalendarOutlined style={{ marginRight: 8, color: '#2563EB' }} />
            Xác nhận Lịch Phỏng vấn Tuyển dụng
          </Typography.Title>
        </div>

        {loading ? (
          <div style={{ padding: '48px 0', textAlign: 'center' }}>
            <Spin size="large" />
            <div style={{ marginTop: 12, color: '#64748B' }}>Đang tải thông tin lịch phỏng vấn...</div>
          </div>
        ) : errorMsg && !info ? (
          <Alert type="error" showIcon message="Không thể truy cập lịch phỏng vấn" description={errorMsg} />
        ) : info ? (
          <>
            {successMsg && <Alert style={{ marginBottom: 16 }} type="success" showIcon message={successMsg} />}
            {errorMsg && <Alert style={{ marginBottom: 16 }} type="error" showIcon message={errorMsg} />}

            <Descriptions bordered column={1} size="middle">
              <Descriptions.Item label={<><UserOutlined /> Ứng viên</>}>
                <strong>{info.candidate_name}</strong> {info.candidate_code ? `(${info.candidate_code})` : ''}
              </Descriptions.Item>
              <Descriptions.Item label="Vị trí ứng tuyển">{info.position}</Descriptions.Item>
              <Descriptions.Item label={<><EnvironmentOutlined /> Chi nhánh đăng ký</>}>
                <div><strong>{info.branch_name}</strong></div>
                {info.branch_address && <div style={{ fontSize: 12, color: '#64748B' }}>{info.branch_address}</div>}
              </Descriptions.Item>
              <Descriptions.Item label={<><ClockCircleOutlined /> Thời gian phỏng vấn</>}>
                <strong>{info.start_at}</strong> ({info.duration_minutes} phút)
              </Descriptions.Item>
              <Descriptions.Item label={<><VideoCameraOutlined /> Phòng họp trực tuyến</>}>
                {info.meet_link ? (
                  <a href={info.meet_link} target="_blank" rel="noreferrer" style={{ color: '#2563EB', fontWeight: 600 }}>
                    {info.meet_link}
                  </a>
                ) : (
                  'Phỏng vấn trực tiếp tại cửa hàng'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Trạng thái xác nhận">
                {statusMeta && <Tag color={statusMeta.color}>{statusMeta.label}</Tag>}
              </Descriptions.Item>
            </Descriptions>

            <Divider style={{ margin: '20px 0 16px' }} />

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: '#0F172A', fontSize: 13 }}>
                Lý do xin dời lịch (nếu bạn bận đột xuất chưa thể tham gia khung giờ trên):
              </div>
              <Input.TextArea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Nhập khung giờ bạn có thể tham gia hoặc lý do xin dời lịch..."
              />
            </div>

            <Space wrap size="middle">
              <Button
                type="primary"
                size="large"
                icon={<CheckCircleOutlined />}
                loading={submitting === 'CONFIRM'}
                disabled={submitting !== null}
                onClick={() => handleAction('CONFIRM')}
              >
                Xác nhận tham gia
              </Button>
              <Button
                size="large"
                icon={<ClockCircleOutlined />}
                loading={submitting === 'RESCHEDULE'}
                disabled={submitting !== null}
                onClick={() => handleAction('RESCHEDULE')}
              >
                Xin dời lịch phỏng vấn
              </Button>
            </Space>
          </>
        ) : null}
      </Card>
    </div>
  );
}
