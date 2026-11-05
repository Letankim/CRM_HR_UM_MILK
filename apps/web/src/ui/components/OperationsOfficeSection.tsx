'use client';

import { Col, Form, InputNumber, Row, Select, Typography } from 'antd';
import { BankOutlined } from '@ant-design/icons';
import { OFFICE_WORKDAY_MODE_OPTIONS } from '@umbm/shared';
import { TimeStringPicker } from './DateTimePickers';

const SECTION_STYLE = { fontSize: 13, fontWeight: 600, color: '#0F172A' } as const;

export function OperationsOfficeSection({ canEdit }: { canEdit: boolean }) {
  const form = Form.useFormInstance();
  const mode = Form.useWatch('office_workday_mode', form);

  return (
    <div style={{ padding: '8px 4px 4px' }}>
      <Typography.Text style={SECTION_STYLE}>
        <BankOutlined /> Chế độ làm việc Khối Văn phòng (Backoffice / Quản trị)
      </Typography.Text>
      <Row gutter={16} style={{ marginTop: 8 }}>
        <Col xs={24} md={12}>
          <Form.Item
            name="office_workday_mode"
            label="Chế độ ngày làm việc chuẩn khối Văn phòng"
            help="Quyết định lịch tự động phát hành và quét chấm công cho khối văn phòng"
            rules={[{ required: true, message: 'Vui lòng chọn chế độ làm việc khối Văn phòng' }]}
          >
            <Select options={OFFICE_WORKDAY_MODE_OPTIONS} />
          </Form.Item>
        </Col>

        {mode === 'MON_TO_SAT_MORNING' && (
          <>
            <Col xs={12} md={4}>
              <Form.Item
                name="office_saturday_start_time"
                label="Giờ vào ca sáng T7"
                rules={[{ required: true, message: 'Chọn giờ vào' }]}
              >
                <TimeStringPicker disabled={!canEdit} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item
                name="office_saturday_end_time"
                label="Giờ ra ca sáng T7"
                rules={[{ required: true, message: 'Chọn giờ ra' }]}
              >
                <TimeStringPicker disabled={!canEdit} />
              </Form.Item>
            </Col>
            <Col xs={24} md={4}>
              <Form.Item
                name="office_saturday_hours"
                label="Công sáng T7 (giờ)"
                rules={[{ required: true, message: 'Nhập số giờ' }]}
              >
                <InputNumber min={1} max={12} precision={1} style={{ width: '100%' }} suffix="giờ" />
              </Form.Item>
            </Col>
          </>
        )}
      </Row>
    </div>
  );
}
