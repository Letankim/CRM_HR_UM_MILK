'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Alert, App, Button, Card, Descriptions, Input, Result, Space, Spin, Tag, Typography } from 'antd';
import { CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, EnvironmentOutlined, LockOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { api, ApiClientError } from '@/lib/api';

interface RsvpInterviewInfo {
  interview_id: string; candidate_id: string; candidate_name: string; candidate_code: string;
  position: string; branch_id: string; branch_name: string; branch_address: string;
  start_at: string; end_at: string; duration_minutes: number; meet_link: string;
  status: string; candidate_confirmed: boolean; reschedule_requested: boolean; reschedule_reason: string;
}

export default function PublicInterviewRsvpPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || '');
  const { message } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [info, setInfo] = useState<RsvpInterviewInfo | null>(null);
  const [rescheduleMode, setRescheduleMode] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<'CONFIRM' | 'RESCHEDULE' | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api
      .get<RsvpInterviewInfo>(`/public/rsvp/${encodeURIComponent(token)}`)
      .then((data) => {
        setInfo(data);
        setReason(data.reschedule_reason || '');
        if (data.status === 'CONFIRMED') setDone('CONFIRM');
        else if (data.status === 'RESCHEDULE_NEEDED') setDone('RESCHEDULE');
        setErrorMsg(null);
      })
      .catch((e) => setErrorMsg(e instanceof ApiClientError ? e.message : 'Đường dẫn xác nhận phỏng vấn không hợp lệ hoặc đã hết hạn.'))
      .finally(() => setLoading(false));
  }, [token]);

  const submitRsvp = async (action: 'CONFIRM' | 'RESCHEDULE') => {
    if (action === 'RESCHEDULE' && reason.trim().length < 5) {
      message.warning('Vui lòng nhập lý do và khung giờ bạn mong muốn dời lịch (tối thiểu 5 ký tự)');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/public/rsvp/${encodeURIComponent(token)}`, { action, reason: reason.trim(), reschedule_reason: reason.trim() });
      setDone(action);
      setInfo((prev) =>
        prev
          ? {
              ...prev,
              status: action === 'CONFIRM' ? 'CONFIRMED' : 'RESCHEDULE_NEEDED',
              candidate_confirmed: action === 'CONFIRM',
              reschedule_requested: action === 'RESCHEDULE',
              reschedule_reason: action === 'RESCHEDULE' ? reason.trim() : prev.reschedule_reason,
            }
          : prev,
      );
      message.success(action === 'CONFIRM' ? 'Đã xác nhận tham gia buổi phỏng vấn thành công!' : 'Đã gửi yêu cầu xin dời lịch phỏng vấn tới Phòng Nhân sự!');
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Gửi phản hồi thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC' }}>
        <Spin size="large" tip="Đang tải thông tin lịch phỏng vấn Ụm Bò Milk..." />
      </div>
    );
  }

  if (errorMsg || !info) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', padding: 16 }}>
        <Card style={{ maxWidth: 540, width: '100%' }}>
          <Result status="warning" title="Không thể truy cập trang xác nhận phỏng vấn" subTitle={errorMsg} />
        </Card>
      </div>
    );
  }

  const isLocked = done !== null || info.status !== 'SCHEDULED';
  const isConfirmedState = done === 'CONFIRM' || info.status === 'CONFIRMED';
  const isRescheduleState = done === 'RESCHEDULE' || info.status === 'RESCHEDULE_NEEDED';

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', padding: '32px 16px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
      <Card
        style={{ maxWidth: 640, width: '100%', borderRadius: 4, border: '1px solid #E5E7EB' }}
        title={<Space><CalendarOutlined style={{ color: '#2563EB' }} /><span>XÁC NHẬN LỊCH PHỎNG VẤN — HỆ THỐNG NHÂN SỰ ỤM BÒ MILK</span></Space>}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info" showIcon
            message={`Xin chào ứng viên ${info.candidate_name}${info.candidate_code ? ` (${info.candidate_code})` : ''}`}
            description={
              isLocked
                ? 'Phản hồi lịch phỏng vấn của bạn đã được ghi nhận và khóa thao tác. Nếu cần thay đổi thêm, bộ phận Nhân sự sẽ cập nhật và gửi lại lịch mới cho bạn.'
                : 'Vui lòng kiểm tra kỹ thời gian, địa điểm phỏng vấn bên dưới và xác nhận tham gia (chỉ xác nhận 1 lần).'
            }
          />

          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="Vị trí ứng tuyển"><strong>{info.position}</strong></Descriptions.Item>
            <Descriptions.Item label="Chi nhánh phỏng vấn">
              <Space direction="vertical" size={2}>
                <strong>{info.branch_name}</strong>
                {info.branch_address && <Typography.Text type="secondary" style={{ fontSize: 12 }}><EnvironmentOutlined /> {info.branch_address}</Typography.Text>}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Thời gian phỏng vấn">
              <Tag color="blue" style={{ fontSize: 13, fontWeight: 600 }}>{String(info.start_at).slice(0, 16).replace('T', ' ')} ({info.duration_minutes || 30} phút)</Tag>
            </Descriptions.Item>
            {info.meet_link && (
              <Descriptions.Item label="Phòng họp Google Meet">
                <Button size="small" type="link" icon={<VideoCameraOutlined />} href={info.meet_link} target="_blank" style={{ padding: 0 }}>{info.meet_link}</Button>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Trạng thái phản hồi">
              {isRescheduleState ? (
                <Tag color="warning" icon={<ClockCircleOutlined />}>Đã gửi yêu cầu xin dời lịch phỏng vấn</Tag>
              ) : isConfirmedState ? (
                <Tag color="success" icon={<CheckCircleOutlined />}>Đã xác nhận tham gia phỏng vấn</Tag>
              ) : (
                <Tag color="processing">Chờ ứng viên phản hồi</Tag>
              )}
            </Descriptions.Item>
          </Descriptions>

          {isLocked ? (
            <Alert
              type={isConfirmedState ? 'success' : 'warning'} showIcon icon={<LockOutlined />}
              message={isConfirmedState ? 'Bạn đã xác nhận tham gia buổi phỏng vấn này' : isRescheduleState ? 'Bạn đã gửi yêu cầu xin dời lịch phỏng vấn' : 'Lịch phỏng vấn này đã đóng phản hồi'}
              description={
                <div>
                  {isRescheduleState && info.reschedule_reason && <div style={{ marginBottom: 4 }}><b>Lý do đã gửi:</b> {info.reschedule_reason}</div>}
                  <div>Trạng thái phản hồi đã được khóa. Bạn chỉ có thể thao tác xác nhận lại khi bộ phận Nhân sự (HR) dời lịch hoặc gửi lại lời mời phỏng vấn mới.</div>
                </div>
              }
            />
          ) : (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {rescheduleMode && (
                <div>
                  <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>Lý do bận &amp; Khung giờ bạn mong muốn dời sang:</Typography.Text>
                  <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ví dụ: Em vướng lịch thi học kỳ sáng thứ 3, xin phép dời sang chiều thứ 4 lúc 14:00..." />
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {!rescheduleMode ? (
                  <>
                    <Button icon={<ClockCircleOutlined />} onClick={() => setRescheduleMode(true)}>Xin dời lịch phỏng vấn</Button>
                    <Button type="primary" icon={<CheckCircleOutlined />} loading={submitting} onClick={() => submitRsvp('CONFIRM')}>Xác nhận tham gia phỏng vấn</Button>
                  </>
                ) : (
                  <>
                    <Button onClick={() => setRescheduleMode(false)}>Quay lại</Button>
                    <Button type="primary" danger icon={<ClockCircleOutlined />} loading={submitting} onClick={() => submitRsvp('RESCHEDULE')}>Gửi yêu cầu dời lịch</Button>
                  </>
                )}
              </div>
            </Space>
          )}
        </Space>
      </Card>
    </div>
  );
}
