'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Flex, Space, Tag } from 'antd';
import { BellOutlined, ClockCircleOutlined, EditOutlined, EyeOutlined, MessageOutlined, VideoCameraOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

interface UpcomingInterviewsBannerProps {
  interviews: Record<string, unknown>[];
  canManage: boolean;
  onViewDetail: (iv: Record<string, unknown>) => void;
  onEvaluate: (iv: Record<string, unknown>) => void;
  onOpenZaloNotify?: (iv: Record<string, unknown>) => void;
}

interface EnrichedUpcomingItem {
  raw: Record<string, unknown>;
  id: string;
  candidateName: string;
  candidateCode: string;
  branchName: string;
  interviewerLabel: string;
  meetLink: string;
  startLabel: string;
  endHm: string;
  durationMinutes: number;
  minsUntilStart: number;
  isImminent: boolean;
  isOngoing: boolean;
}

/**
 * Khối hiển thị nổi bật các "Cuộc hẹn phỏng vấn sắp đến" ngay đầu tab Lịch Phỏng vấn:
 * - Tự động đếm ngược theo phút trên trình duyệt (không gọi lại API gây loading Spin).
 * - Nổi bật đặc biệt các cuộc hẹn còn 5–10 phút (<= 10 phút) hoặc đang trong khung giờ phỏng vấn.
 */
export function UpcomingInterviewsBanner({
  interviews,
  canManage,
  onViewDetail,
  onEvaluate,
  onOpenZaloNotify,
}: UpcomingInterviewsBannerProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const upcomingList = useMemo<EnrichedUpcomingItem[]>(() => {
    const items: EnrichedUpcomingItem[] = [];
    for (const iv of interviews) {
      const status = String(iv.status || '');
      const decision = String(iv.decision || 'PENDING');
      if (status === 'CANCELLED' || status === 'COMPLETED' || decision !== 'PENDING') continue;
      const start = dayjs(String(iv.scheduled_at || iv.start_at || ''));
      if (!start.isValid()) continue;
      const dur = Math.max(5, Number(iv.duration_minutes) || 30);
      const end = start.add(dur, 'minute');
      const diffStartMs = start.valueOf() - nowMs;
      const diffEndMs = end.valueOf() - nowMs;
      // Hiển thị các cuộc hẹn đang diễn ra hoặc sắp diễn ra trong 48 giờ tới
      if (diffEndMs < 0 || diffStartMs > 48 * 3600_000) continue;

      const minsUntilStart = Math.ceil(diffStartMs / 60_000);
      const isOngoing = diffStartMs <= 0 && diffEndMs >= 0;
      const isImminent = diffStartMs > 0 && minsUntilStart <= 10;
      const isToday = start.format('YYYY-MM-DD') === dayjs(nowMs).format('YYYY-MM-DD');

      items.push({
        raw: iv,
        id: String(iv.id),
        candidateName: String(iv.candidateName || iv.candidate_id || 'Ứng viên'),
        candidateCode: String(iv.candidateCode || ''),
        branchName: String(iv.branchName || 'Chi nhánh'),
        interviewerLabel: String(iv.interviewerLabel || iv.interviewer_id || 'Hội đồng phỏng vấn'),
        meetLink: String(iv.meet_link || ''),
        startLabel: `${isToday ? 'Hôm nay' : start.format('DD/MM/YYYY')} · ${start.format('HH:mm')}`,
        endHm: end.format('HH:mm'),
        durationMinutes: dur,
        minsUntilStart,
        isImminent,
        isOngoing,
      });
    }
    return items.sort((a, b) => a.minsUntilStart - b.minsUntilStart).slice(0, 6);
  }, [interviews, nowMs]);

  if (upcomingList.length === 0) return null;

  const imminentItems = upcomingList.filter((x) => x.isImminent || x.isOngoing);

  return (
    <Card
      size="small"
      style={{
        borderColor: imminentItems.length > 0 ? '#F59E0B' : '#BFDBFE',
        background: imminentItems.length > 0 ? '#FFFBEB' : '#F8FAFC',
      }}
      styles={{ body: { padding: '10px 14px' } }}
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Flex justify="space-between" align="center" wrap gap={8}>
          <Space size={8} wrap>
            <BellOutlined style={{ color: imminentItems.length > 0 ? '#D97706' : '#2563EB', fontSize: 15 }} />
            <strong style={{ color: '#0F172A', fontSize: 13 }}>
              Cuộc hẹn phỏng vấn sắp đến ({upcomingList.length})
            </strong>
            {imminentItems.length > 0 && (
              <Tag color="volcano" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>
                {imminentItems.length} cuộc hẹn sắp bắt đầu / đang diễn ra (hệ thống tự động nhắc trước 5–10 phút)
              </Tag>
            )}
          </Space>
          <span style={{ fontSize: 12, color: '#64748B' }}>
            Tự động gửi chuông &amp; email nhắc Hội đồng phỏng vấn, HR và Ứng viên trước 5–10 phút
          </span>
        </Flex>

        {imminentItems.map((im) => (
          <Alert
            key={`alert-${im.id}`}
            type={im.isOngoing ? 'info' : 'warning'}
            showIcon
            message={
              im.isOngoing
                ? `Đang trong khung giờ phỏng vấn: ${im.candidateName}${im.candidateCode ? ` (${im.candidateCode})` : ''} (${im.startLabel} – ${im.endHm})`
                : `Nhắc lịch phỏng vấn còn ${im.minsUntilStart} phút nữa: ${im.candidateName}${im.candidateCode ? ` (${im.candidateCode})` : ''} lúc ${im.startLabel} – ${im.endHm}`
            }
          />
        ))}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 8 }}>
          {upcomingList.map((item) => (
            <div
              key={item.id}
              style={{
                background: '#FFFFFF',
                border: `1px solid ${item.isImminent ? '#F59E0B' : item.isOngoing ? '#2563EB' : '#E5E7EB'}`,
                borderRadius: 4,
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <Flex justify="space-between" align="center" gap={6}>
                <strong style={{ fontSize: 13, color: '#0F172A' }}>
                  {item.candidateName} {item.candidateCode ? <span style={{ color: '#2563EB' }}>({item.candidateCode})</span> : null}
                </strong>
                <Tag color={item.isOngoing ? 'processing' : item.isImminent ? 'red' : item.minsUntilStart <= 60 ? 'orange' : 'blue'} style={{ margin: 0 }}>
                  {item.isOngoing
                    ? 'Đang diễn ra'
                    : item.minsUntilStart <= 60
                      ? `Sau ${item.minsUntilStart} phút`
                      : `Sau ${Math.floor(item.minsUntilStart / 60)}h${item.minsUntilStart % 60 > 0 ? `${item.minsUntilStart % 60}p` : ''}`}
                </Tag>
              </Flex>
              <div style={{ fontSize: 12, color: '#475569' }}>
                <div><strong>Khung giờ:</strong> <span className="num">{item.startLabel} – {item.endHm} ({item.durationMinutes}p)</span> · {item.branchName}</div>
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <strong>Người PV:</strong> {item.interviewerLabel}
                </div>
              </div>
              <Flex justify="flex-end" gap={6} wrap>
                {canManage && onOpenZaloNotify && (
                  <Button size="small" icon={<MessageOutlined style={{ color: '#2563EB' }} />} onClick={() => onOpenZaloNotify(item.raw)}>
                    Nhắn Zalo
                  </Button>
                )}
                {item.meetLink && (
                  <Button size="small" type="primary" ghost icon={<VideoCameraOutlined />} href={item.meetLink} target="_blank">
                    Vào phòng họp
                  </Button>
                )}
                {canManage && (
                  <Button size="small" type={item.raw.decision && item.raw.decision !== 'PENDING' ? 'default' : 'primary'} icon={<EditOutlined />} onClick={() => onEvaluate(item.raw)}>
                    {item.raw.decision && item.raw.decision !== 'PENDING' ? 'Chỉnh sửa điểm' : 'Chấm điểm'}
                  </Button>
                )}
                <Button size="small" icon={<EyeOutlined />} onClick={() => onViewDetail(item.raw)}>
                  Chi tiết
                </Button>
              </Flex>
            </div>
          ))}
        </div>
      </Space>
    </Card>
  );
}
