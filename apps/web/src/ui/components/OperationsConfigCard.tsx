'use client';

import { Alert, App, Button, Card, Form, Skeleton, Space, Tabs } from 'antd';
import {
  BankOutlined,
  ClockCircleOutlined,
  LockOutlined,
  ReloadOutlined,
  SafetyOutlined,
  SaveOutlined,
  ScheduleOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { OffWindowState, OperationSettings, OfficeWorkdayMode } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { OperationsOfficeSection } from './OperationsOfficeSection';
import { OperationsOffWindowSection } from './OperationsOffWindowSection';
import { OperationsSecuritySection } from './OperationsSecuritySection';
import { OperationsWorkRulesSection } from './OperationsWorkRulesSection';

export interface OperationsConfigResponse {
  settings: OperationSettings;
  fields: { field: string; key: string; value: string; label: string; category: string }[];
  offWindow: OffWindowState;
  partitionLabel: string;
}

export interface OperationsFormValues {
  pin_rotation_days: number;
  off_window_open_weekday: number;
  off_window_open_time: string;
  off_window_close_weekday: number;
  off_window_close_time: string;
  official_weekly_off_limit: number;
  max_shifts_per_day: number;
  checkout_max_late_hours: number;
  standard_work_days_per_month: number;
  standard_hours_per_day: number;
  office_workday_mode: OfficeWorkdayMode;
  office_saturday_start_time: string;
  office_saturday_end_time: string;
  office_saturday_hours: number;
}

const toFormValues = (s: OperationSettings): OperationsFormValues => ({
  pin_rotation_days: s.pinRotationDays,
  off_window_open_weekday: s.offWindowOpenWeekday,
  off_window_open_time: s.offWindowOpenTime,
  off_window_close_weekday: s.offWindowCloseWeekday,
  off_window_close_time: s.offWindowCloseTime,
  official_weekly_off_limit: s.officialWeeklyOffLimit,
  max_shifts_per_day: s.maxShiftsPerDay,
  checkout_max_late_hours: s.checkoutMaxLateHours,
  standard_work_days_per_month: s.standardWorkDaysPerMonth,
  standard_hours_per_day: s.standardHoursPerDay,
  office_workday_mode: s.officeWorkdayMode || 'MON_TO_FRI',
  office_saturday_start_time: s.officeSaturdayStartTime || '08:00',
  office_saturday_end_time: s.officeSaturdayEndTime || '12:00',
  office_saturday_hours: s.officeSaturdayHours || 4,
});

export function OperationsConfigCard() {
  const qc = useQueryClient();
  const can = useCan();
  const canEdit = can('system.config');
  const { message } = App.useApp();
  const [form] = Form.useForm<OperationsFormValues>();
  const [subTab, setSubTab] = useState<'off_window' | 'office' | 'work_rules' | 'security'>('off_window');

  const q = useQuery({
    queryKey: ['operations-config'],
    queryFn: () => api.get<OperationsConfigResponse>('/admin/operations-config'),
    retry: false,
  });

  useEffect(() => {
    if (q.data?.settings) form.setFieldsValue(toFormValues(q.data.settings));
  }, [q.data, form]);

  const saveMut = useMutation({
    mutationFn: (body: OperationsFormValues) => api.put<OperationsConfigResponse>('/admin/operations-config', body),
    onSuccess: (data) => {
      qc.setQueryData(['operations-config'], data);
      qc.invalidateQueries({ queryKey: ['off-window'] });
      message.success('Đã lưu cấu hình vận hành hệ thống thành công');
    },
    onError: (e: unknown) => {
      if (e instanceof ApiClientError) {
        const fieldErrors = e.details.filter((d) => d.field).map((d) => ({ name: d.field as keyof OperationsFormValues, errors: [d.message] }));
        if (fieldErrors.length) form.setFields(fieldErrors);
        message.error(e.message);
      } else message.error('Không thể lưu cấu hình vận hành, vui lòng thử lại');
    },
  });

  const offWindow = q.data?.offWindow;

  return (
    <Card
      size="small"
      title={
        <Space size={6}>
          <SettingOutlined />
          <span>Cấu hình vận hành hệ thống</span>
        </Space>
      }
      extra={
        <Button size="small" icon={<ReloadOutlined />} loading={q.isFetching && !q.isLoading} onClick={() => q.refetch()}>
          Làm mới
        </Button>
      }
    >
      {q.isLoading ? (
        <Skeleton active />
      ) : q.isError ? (
        <Alert type="error" showIcon message="Không thể tải cấu hình vận hành" description={q.error instanceof ApiClientError ? q.error.message : undefined} />
      ) : (
        <Form<OperationsFormValues>
          form={form}
          layout="vertical"
          disabled={!canEdit}
          onFinish={(v) => saveMut.mutate(v)}
          requiredMark={false}
        >
          {!canEdit && (
            <Alert
              type="warning"
              showIcon
              icon={<LockOutlined />}
              style={{ marginBottom: 12 }}
              message="Bạn chỉ có quyền xem. Chỉ Quản trị viên có quyền Cấu hình hệ thống mới được chỉnh sửa."
            />
          )}

          <Tabs
            activeKey={subTab}
            onChange={(k) => setSubTab(k as typeof subTab)}
            destroyOnHidden={false}
            items={[
              {
                key: 'off_window',
                label: (
                  <Space size={6}>
                    <ScheduleOutlined />
                    <span>Cổng đăng ký nghỉ OFF</span>
                  </Space>
                ),
                children: <OperationsOffWindowSection offWindow={offWindow} canEdit={canEdit} />,
              },
              {
                key: 'office',
                label: (
                  <Space size={6}>
                    <BankOutlined />
                    <span>Khối Văn phòng</span>
                  </Space>
                ),
                children: <OperationsOfficeSection canEdit={canEdit} />,
              },
              {
                key: 'work_rules',
                label: (
                  <Space size={6}>
                    <ClockCircleOutlined />
                    <span>Chấm công &amp; Công chuẩn</span>
                  </Space>
                ),
                children: <OperationsWorkRulesSection />,
              },
              {
                key: 'security',
                label: (
                  <Space size={6}>
                    <SafetyOutlined />
                    <span>Bảo mật &amp; Mã PIN</span>
                  </Space>
                ),
                children: <OperationsSecuritySection />,
              },
            ]}
          />

          {canEdit && (
            <div style={{ marginTop: 16, borderTop: '1px solid #F1F5F9', paddingTop: 12, textAlign: 'right' }}>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saveMut.isPending}>
                Lưu cấu hình vận hành
              </Button>
            </div>
          )}
        </Form>
      )}
    </Card>
  );
}
