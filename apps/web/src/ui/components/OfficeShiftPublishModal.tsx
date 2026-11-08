'use client';

import { useEffect, useState } from 'react';
import { Alert, App, Button, Checkbox, Flex, Input, Modal, Select, Space, Spin, Tag } from 'antd';
import {
  BankOutlined, CheckCircleOutlined, CloseOutlined, FormOutlined, ReloadOutlined, ScheduleOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OFFICE_WORKDAY_MODE_OPTIONS, type OfficeWorkdayMode } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { OfficeRosterPreviewTable, type OfficeStaffSummaryItem } from './OfficeRosterPreviewTable';

interface OfficePreviewResponse {
  weekStart: string;
  weekEnd: string;
  mode: OfficeWorkdayMode;
  modeLabel: string;
  staffCount: number;
  toCreate: { employeeName: string; workDate: string; shiftCode: string; hours: number }[];
  skippedExisting: number;
  skippedOff: number;
  staffSummary: OfficeStaffSummaryItem[];
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
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setConfirmed(false);
    setNote('');
  }, [open, weekStart, selectedMode]);

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
      centered={false}
      width="min(1560px, 98vw)"
      style={{ maxWidth: '98vw', top: 16, margin: '0 auto', paddingBottom: 16 }}
      styles={{ body: { maxHeight: 'calc(100vh - 170px)', overflowY: 'auto', paddingTop: 8 } }}
      title={
        <Space size={8} wrap>
          <BankOutlined style={{ color: '#2563EB' }} />
          <span>Ca khối văn phòng</span>
          {p && (
            <Tag color="blue" icon={<ScheduleOutlined />} style={{ margin: 0 }}>
              Tuần {p.weekStart} – {p.weekEnd}
            </Tag>
          )}
        </Space>
      }
      footer={
        <Flex justify="space-between" align="center" wrap gap={12} style={{ width: '100%' }}>
          <Checkbox
            checked={confirmed}
            disabled={publishMut.isPending || !p || p.toCreate.length === 0}
            onChange={(e) => setConfirmed(e.target.checked)}
            style={{ textAlign: 'left' }}
          >
            Tôi đã kiểm tra danh sách ca hành chính dự kiến và xác nhận phát hành ca cho khối văn phòng
          </Checkbox>
          <Space size={8}>
            <Button icon={<CloseOutlined />} disabled={publishMut.isPending} onClick={onClose}>
              Hủy bỏ
            </Button>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              disabled={!confirmed || !p || p.toCreate.length === 0}
              loading={publishMut.isPending}
              onClick={() => publishMut.mutate()}
            >
              Xác nhận
            </Button>
          </Space>
        </Flex>
      }
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '10px 14px' }}>
          <Flex justify="space-between" align="center" wrap gap={10}>
            <Space size={10} wrap>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Chế độ làm việc:</span>
              <Select
                value={selectedMode ?? p?.mode ?? 'MON_TO_FRI'}
                options={OFFICE_WORKDAY_MODE_OPTIONS}
                onChange={(v) => setSelectedMode(v as OfficeWorkdayMode)}
                style={{ width: 330 }}
              />
              {p && (
                <Space size={6} wrap>
                  <Tag color="blue" style={{ margin: 0 }}>Tổng nhân sự: {p.staffCount} người</Tag>
                  <Tag color="green" style={{ margin: 0 }}>Ca dự kiến: {p.toCreate.length} ca</Tag>
                  {p.skippedExisting > 0 && <Tag color="default" style={{ margin: 0 }}>Đã có ca: {p.skippedExisting}</Tag>}
                  {p.skippedOff > 0 && <Tag color="orange" style={{ margin: 0 }}>Đơn OFF: {p.skippedOff}</Tag>}
                </Space>
              )}
            </Space>
            <Button icon={<ReloadOutlined />} loading={q.isFetching && !q.isLoading} onClick={() => q.refetch()}>
              Tải lại dữ liệu
            </Button>
          </Flex>
          <Flex align="center" gap={10} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #E5E7EB' }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: '#0F172A', whiteSpace: 'nowrap' }}>
              <FormOutlined style={{ color: '#2563EB', marginRight: 6 }} />
              Ghi chú đợt phát hành:
            </span>
            <Input
              allowClear
              maxLength={300}
              showCount
              disabled={publishMut.isPending}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Nhập ghi chú cho đợt phát hành ca văn phòng tuần này (không bắt buộc)..."
              style={{ flex: 1 }}
            />
          </Flex>
        </div>

        {p && p.toCreate.length === 0 && (
          <Alert type="warning" showIcon message="Tất cả nhân sự khối văn phòng đã có ca làm việc hoặc đã duyệt nghỉ OFF trong tuần này." />
        )}

        <OfficeRosterPreviewTable dataSource={p?.staffSummary ?? []} loading={q.isLoading} />
      </Space>
    </Modal>
  );
}
