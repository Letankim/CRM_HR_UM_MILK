'use client';

import { Alert, Col, Form, InputNumber, Row, Typography } from 'antd';
import { SafetyOutlined } from '@ant-design/icons';

const SECTION_STYLE = { fontSize: 13, fontWeight: 600, color: '#0F172A' } as const;

export function OperationsSecuritySection() {
  return (
    <div style={{ padding: '8px 4px 4px' }}>
      <Typography.Text style={SECTION_STYLE}>
        <SafetyOutlined /> Chính sách bảo mật &amp; Mã PIN tài khoản
      </Typography.Text>
      <Alert
        style={{ margin: '8px 0 16px' }}
        type="info"
        showIcon
        message="Bảo mật đăng nhập quầy & Cổng thông tin nhân sự"
        description="Khi kích hoạt chu kỳ bắt buộc đổi mã PIN, tài khoản quá hạn sẽ được yêu cầu đổi mã PIN mới trước khi thực hiện thao tác."
      />
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item
            name="pin_rotation_days"
            label="Chu kỳ bắt buộc đổi mã PIN (ngày)"
            help="0 = không bắt buộc đổi định kỳ"
            rules={[{ required: true, message: 'Vui lòng nhập chu kỳ đổi mã PIN' }]}
          >
            <InputNumber min={0} max={3650} precision={0} style={{ width: '100%' }} suffix="ngày" />
          </Form.Item>
        </Col>
      </Row>
    </div>
  );
}
