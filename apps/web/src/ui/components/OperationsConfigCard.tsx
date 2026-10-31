'use client';

import { Alert, App, Button, Card, Col, Divider, Form, InputNumber, Row, Select, Skeleton, Tag, Typography } from 'antd';
import { ClockCircleOutlined, LockOutlined, ReloadOutlined, SaveOutlined, SafetyOutlined, ScheduleOutlined, SettingOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { WEEKDAY_OPTIONS, type OperationSettings } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { TimeStringPicker } from './DateTimePickers';

export interface OffWindowState {
  isOpen: boolean;
  opensAt: string;
  closesAt: string;
  targetWeekStart: string;
  targetWeekEnd: string;
  message: string;
}

export interface OperationsConfigResponse {
  settings: OperationSettings;
  fields: { field: string; key: string; value: string; label: string; category: string }[];
  offWindow: OffWindowState;
  partitionLabel: string;
}

interface OperationsFormValues {
  pin_rotation_days: number;
  off_window_open_weekday: number;
  off_window_open_time: string;
  off_window_close_weekday: number;
  off_window_close_time: string;
  official_weekly_off_limit: number;
  max_shifts_per_day: number;
  checkout_max_late_hours: number;
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
});

const SECTION_STYLE = { fontSize: 13, fontWeight: 600, color: '#0F172A' } as const;
const fmtDateTime = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}:\d{2}))?/.exec(v || '');
  return m ? `${m[4] ? `${m[4]} ` : ''}${m[3]}/${m[2]}/${m[1]}` : v || '—';
};

export function OperationsConfigCard() {
  const qc = useQueryClient();
  const can = useCan();
  const canEdit = can('system.config');
  const { message } = App.useApp();
  const [form] = Form.useForm<OperationsFormValues>();

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
      title={<span><SettingOutlined /> Cấu hình vận hành hệ thống</span>}
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
        <Form<OperationsFormValues> form={form} layout="vertical" disabled={!canEdit} onFinish={(v) => saveMut.mutate(v)} requiredMark={false}>
          {!canEdit && (
            <Alert type="warning" showIcon icon={<LockOutlined />} style={{ marginBottom: 12 }} message="Bạn chỉ có quyền xem. Chỉ Quản trị viên có quyền Cấu hình hệ thống mới được chỉnh sửa." />
          )}
          <Typography.Text style={SECTION_STYLE}><SafetyOutlined /> Bảo mật</Typography.Text>
          <Row gutter={16} style={{ marginTop: 8 }}>
            <Col xs={24} md={12}>
              <Form.Item name="pin_rotation_days" label="Chu kỳ bắt buộc đổi mã PIN (ngày)" help="0 = không bắt buộc đổi định kỳ" rules={[{ required: true, message: 'Vui lòng nhập chu kỳ đổi mã PIN' }]}>
                <InputNumber min={0} max={3650} precision={0} style={{ width: '100%' }} suffix="ngày" />
              </Form.Item>
            </Col>
          </Row>

          <Divider style={{ margin: '12px 0' }} />
          <Typography.Text style={SECTION_STYLE}><ScheduleOutlined /> Cổng đăng ký nghỉ OFF</Typography.Text>
          {offWindow && (
            <Alert
              style={{ margin: '8px 0 12px' }}
              type={offWindow.isOpen ? 'success' : 'info'}
              showIcon
              message={<span>{offWindow.message} <Tag color={offWindow.isOpen ? 'green' : 'default'} style={{ marginLeft: 6 }}>{offWindow.isOpen ? 'Đang mở' : 'Đang đóng'}</Tag></span>}
              description={`Tuần đích: ${fmtDateTime(offWindow.targetWeekStart)} – ${fmtDateTime(offWindow.targetWeekEnd)} · Mở: ${fmtDateTime(offWindow.opensAt)} · Đóng: ${fmtDateTime(offWindow.closesAt)}`}
            />
          )}
          <Row gutter={16}>
            <Col xs={12} md={6}>
              <Form.Item name="off_window_open_weekday" label="Ngày mở cổng" rules={[{ required: true, message: 'Vui lòng chọn ngày mở cổng' }]}>
                <Select options={WEEKDAY_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="off_window_open_time" label="Giờ mở cổng" rules={[{ required: true, message: 'Vui lòng chọn giờ mở cổng' }]}>
                <TimeStringPicker disabled={!canEdit} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="off_window_close_weekday" label="Ngày đóng cổng" rules={[{ required: true, message: 'Vui lòng chọn ngày đóng cổng' }]}>
                <Select options={WEEKDAY_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="off_window_close_time" label="Giờ đóng cổng" rules={[{ required: true, message: 'Vui lòng chọn giờ đóng cổng' }]}>
                <TimeStringPicker disabled={!canEdit} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="official_weekly_off_limit" label="Số ngày OFF tối đa / tuần (NV chính thức)" rules={[{ required: true, message: 'Vui lòng nhập số ngày OFF tối đa' }]}>
                <InputNumber min={0} max={7} precision={0} style={{ width: '100%' }} suffix="ngày" />
              </Form.Item>
            </Col>
          </Row>

          <Divider style={{ margin: '12px 0' }} />
          <Typography.Text style={SECTION_STYLE}><ClockCircleOutlined /> Lịch &amp; chấm công</Typography.Text>
          <Row gutter={16} style={{ marginTop: 8 }}>
            <Col xs={24} md={12}>
              <Form.Item name="max_shifts_per_day" label="Số ca tối đa / nhân viên / ngày" rules={[{ required: true, message: 'Vui lòng nhập số ca tối đa' }]}>
                <InputNumber min={1} max={4} precision={0} style={{ width: '100%' }} suffix="ca" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="checkout_max_late_hours"
                label="Thời hạn tối đa chấm công Ra ca sau giờ kết thúc ca (giờ)"
                help="Không được ra ca sớm trước giờ kết thúc ca; quá thời hạn này nhân viên phải gửi phiếu bổ sung công."
                rules={[{ required: true, message: 'Vui lòng nhập thời hạn chấm công Ra ca' }]}
              >
                <InputNumber min={0} max={12} precision={0} style={{ width: '100%' }} suffix="giờ" />
              </Form.Item>
            </Col>
          </Row>

          {canEdit && (
            <Form.Item style={{ marginTop: 16, marginBottom: 0, textAlign: 'right' }}>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saveMut.isPending}>
                Lưu cấu hình vận hành
              </Button>
            </Form.Item>
          )}
        </Form>
      )}
    </Card>
  );
}
