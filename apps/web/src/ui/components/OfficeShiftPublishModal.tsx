'use client';

import { Alert, App, Button, Form, Input, Modal, Select, Space, Spin, Tag, Typography } from 'antd';
import { BankOutlined, CheckCircleOutlined, ScheduleOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { OFFICE_WORKDAY_MODE_OPTIONS, type OfficeWorkdayMode } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';

interface OfficePreviewResponse {
  weekStart: string;
  weekEnd: string;
  mode: OfficeWorkdayMode;
  modeLabel: string;
  staffCount: number;
  toCreate: { employeeName: string; workDate: string; shiftCode: string; hours: number }[];
  skippedExisting: number;
  skippedOff: number;
  staffSummary: { id: string; name: string; plannedCount: number }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  weekStart: string;
  branchId?: string;
}

export function OfficeShiftPublishModal({ open, onClose, weekStart, branchId = 'ALL' }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [selectedMode, setSelectedMode] = useState<OfficeWorkdayMode | undefined>(undefined);
  const [note, setNote] = useState('');

  const queryParams = new URLSearchParams({ week_start: weekStart, branch_id: branchId });
  if (selectedMode) queryParams.set('mode', selectedMode);

  const q = useQuery({
    queryKey: ['office-shifts-preview', weekStart, branchId, selectedMode],
    queryFn: () => api.get<OfficePreviewResponse>(`/admin/schedule-planner/office-shifts?${queryParams.toString()}`),
    enabled: open && Boolean(weekStart),
  });

  const publishMut = useMutation({
    mutationFn: () =>
      api.post<{ message?: string }>('/admin/schedule-planner/office-shifts/publish', {
        week_start: weekStart,
        branch_id: branchId,
        mode: selectedMode,
        note: note.trim(),
      }),
    onSuccess: (res: { message?: string }) => {
      message.success(res?.message || 'Đã phát hành ca hành chính cho khối văn phòng');
      qc.invalidateQueries({ queryKey: ['schedule-week'] });
      qc.invalidateQueries({ queryKey: ['schedules'] });
      onClose();
    },
    onError: (e: unknown) => {
      message.error(e instanceof ApiClientError ? e.message : 'Không thể phát hành ca văn phòng');
    },
  });

  const p = q.data;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      destroyOnHidden
      title={
        <Space>
          <BankOutlined style={{ color: '#2563EB' }} />
          <span>Phát hành ca Hành chính Khối Văn phòng</span>
        </Space>
      }
      footer={[
        <Button key="cancel" onClick={onClose} disabled={publishMut.isPending}>
          Đóng
        </Button>,
        <Button
          key="submit"
          type="primary"
          icon={<CheckCircleOutlined />}
          loading={publishMut.isPending}
          disabled={!p || p.toCreate.length === 0}
          onClick={() => publishMut.mutate()}
        >
          Phát hành {p?.toCreate.length ? `${p.toCreate.length} ca` : 'ca'}
        </Button>,
      ]}
    >
      <Form layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item label="Chế độ làm việc áp dụng cho tuần này">
          <Select
            value={selectedMode ?? p?.mode ?? 'MON_TO_FRI'}
            options={OFFICE_WORKDAY_MODE_OPTIONS}
            onChange={(val) => setSelectedMode(val as OfficeWorkdayMode)}
          />
        </Form.Item>

        {q.isLoading ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}><Spin tip="Đang tải dữ liệu dự kiến..." /></div>
        ) : p ? (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              icon={<ScheduleOutlined />}
              message={`Tuần áp dụng: ${p.weekStart} đến ${p.weekEnd}`}
              description={
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <Tag color="blue">Tổng nhân sự: {p.staffCount} người</Tag>
                  <Tag color="green">Dự kiến tạo: {p.toCreate.length} ca</Tag>
                  {p.skippedExisting > 0 && <Tag color="default">Đã có ca: {p.skippedExisting} lượt</Tag>}
                  {p.skippedOff > 0 && <Tag color="orange">Đơn OFF duyệt: {p.skippedOff} ngày</Tag>}
                </div>
              }
            />
            {p.toCreate.length === 0 && (
              <Alert type="warning" showIcon message="Tất cả nhân sự khối văn phòng đã có ca hoặc đã duyệt nghỉ OFF trong tuần này." />
            )}
            <Form.Item label="Ghi chú phát hành (tùy chọn)" style={{ marginBottom: 0 }}>
              <Input.TextArea
                rows={2}
                maxLength={300}
                placeholder="Nhập ghi chú cho đợt phát hành ca văn phòng..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Form.Item>
          </Space>
        ) : null}
      </Form>
    </Modal>
  );
}
