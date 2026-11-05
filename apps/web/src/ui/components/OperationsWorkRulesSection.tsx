'use client';

import { Col, Form, InputNumber, Row, Typography } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';

const SECTION_STYLE = { fontSize: 13, fontWeight: 600, color: '#0F172A' } as const;

export function OperationsWorkRulesSection() {
  return (
    <div style={{ padding: '8px 4px 4px' }}>
      <Typography.Text style={SECTION_STYLE}>
        <ClockCircleOutlined /> Lịch phân ca, Chấm công &amp; Công chuẩn tháng
      </Typography.Text>
      <Row gutter={16} style={{ marginTop: 12 }}>
        <Col xs={24} md={12}>
          <Form.Item
            name="max_shifts_per_day"
            label="Số ca tối đa / nhân viên / ngày"
            help="Giới hạn an toàn số ca làm việc phân công trong một ngày"
            rules={[{ required: true, message: 'Vui lòng nhập số ca tối đa' }]}
          >
            <InputNumber min={1} max={4} precision={0} style={{ width: '100%' }} suffix="ca" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="checkout_max_late_hours"
            label="Thời hạn tối đa chấm công Ra ca sau giờ kết thúc ca (giờ)"
            help="Quá thời hạn này nhân viên phải gửi phiếu bổ sung công"
            rules={[{ required: true, message: 'Vui lòng nhập thời hạn chấm công Ra ca' }]}
          >
            <InputNumber min={0} max={12} precision={0} style={{ width: '100%' }} suffix="giờ" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="standard_work_days_per_month"
            label="Số ngày công chuẩn của tháng (ngày)"
            help="Mặc định chia đơn giá ngày cho lương tháng (có thể sửa riêng cho từng NV)"
            rules={[{ required: true, message: 'Vui lòng nhập số ngày công chuẩn' }]}
          >
            <InputNumber min={1} max={31} precision={0} style={{ width: '100%' }} suffix="ngày" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="standard_hours_per_day"
            label="Số giờ chuẩn / ngày (ca)"
            help="Mặc định để quy đổi đơn giá giờ tính tăng ca OT (có thể sửa riêng cho từng NV)"
            rules={[{ required: true, message: 'Vui lòng nhập số giờ chuẩn / ngày' }]}
          >
            <InputNumber min={1} max={24} precision={0} style={{ width: '100%' }} suffix="giờ" />
          </Form.Item>
        </Col>
      </Row>
    </div>
  );
}
