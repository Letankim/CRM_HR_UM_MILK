'use client';

import { Alert, Col, Form, InputNumber, Row, Select, Tag, Typography } from 'antd';
import { ScheduleOutlined } from '@ant-design/icons';
import { WEEKDAY_OPTIONS, type OffWindowState } from '@umbm/shared';
import { TimeStringPicker } from './DateTimePickers';

const SECTION_STYLE = { fontSize: 13, fontWeight: 600, color: '#0F172A' } as const;

const fmtDateTime = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}:\d{2}))?/.exec(v || '');
  return m ? `${m[4] ? `${m[4]} ` : ''}${m[3]}/${m[2]}/${m[1]}` : v || '—';
};

export function OperationsOffWindowSection({
  offWindow,
  canEdit,
}: {
  offWindow?: OffWindowState;
  canEdit: boolean;
}) {
  return (
    <div style={{ padding: '8px 4px 4px' }}>
      <Typography.Text style={SECTION_STYLE}>
        <ScheduleOutlined /> Cổng đăng ký nghỉ OFF hàng tuần
      </Typography.Text>
      {offWindow && (
        <Alert
          style={{ margin: '8px 0 16px' }}
          type={offWindow.isOpen ? 'success' : 'info'}
          showIcon
          message={
            <span>
              {offWindow.message}{' '}
              <Tag color={offWindow.isOpen ? 'green' : 'default'} style={{ marginLeft: 6 }}>
                {offWindow.isOpen ? 'Đang mở' : 'Đang đóng'}
              </Tag>
            </span>
          }
          description={`Tuần đích: ${fmtDateTime(offWindow.targetWeekStart)} – ${fmtDateTime(offWindow.targetWeekEnd)} · Mở: ${fmtDateTime(offWindow.opensAt)} · Đóng: ${fmtDateTime(offWindow.closesAt)}`}
        />
      )}
      <Row gutter={16}>
        <Col xs={12} md={6}>
          <Form.Item
            name="off_window_open_weekday"
            label="Ngày mở cổng"
            rules={[{ required: true, message: 'Vui lòng chọn ngày mở cổng' }]}
          >
            <Select options={WEEKDAY_OPTIONS} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item
            name="off_window_open_time"
            label="Giờ mở cổng"
            rules={[{ required: true, message: 'Vui lòng chọn giờ mở cổng' }]}
          >
            <TimeStringPicker disabled={!canEdit} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item
            name="off_window_close_weekday"
            label="Ngày đóng cổng"
            rules={[{ required: true, message: 'Vui lòng chọn ngày đóng cổng' }]}
          >
            <Select options={WEEKDAY_OPTIONS} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item
            name="off_window_close_time"
            label="Giờ đóng cổng"
            rules={[{ required: true, message: 'Vui lòng chọn giờ đóng cổng' }]}
          >
            <TimeStringPicker disabled={!canEdit} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="official_weekly_off_limit"
            label="Số ngày OFF tối đa / tuần (NV chính thức)"
            rules={[{ required: true, message: 'Vui lòng nhập số ngày OFF tối đa' }]}
          >
            <InputNumber min={0} max={7} precision={0} style={{ width: '100%' }} suffix="ngày" />
          </Form.Item>
        </Col>
      </Row>
    </div>
  );
}
