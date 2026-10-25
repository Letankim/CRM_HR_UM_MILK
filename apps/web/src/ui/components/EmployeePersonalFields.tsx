'use client';

import { Col, Form, Input, Row, Select } from 'antd';
import { DateStringPicker } from './DateTimePickers';

/**
 * Tab nhập/chỉnh sửa Thông tin Cá nhân, CCCD, Email, Địa chỉ, Liên hệ Khẩn cấp & Mã số thuế
 * tương ứng 100% với các cột trong bảng UMBM_HR.EMPLOYEES.
 */
export function EmployeePersonalFields({ isEditing }: { isEditing?: boolean }) {
  return (
    <>
      <Row gutter={12}>
        <Col span={10}>
          <Form.Item name="email" label="Email">
            <Input placeholder="Ví dụ: minhanh.nv@umbomilk.vn" />
          </Form.Item>
        </Col>
        <Col span={7}>
          <Form.Item name="date_of_birth" label="Ngày sinh">
            <DateStringPicker placeholder="Chọn ngày sinh (DD/MM/YYYY)" />
          </Form.Item>
        </Col>
        <Col span={7}>
          <Form.Item name="gender" label="Giới tính">
            <Select
              allowClear
              placeholder="Chọn giới tính"
              options={[
                { value: 'Nữ', label: 'Nữ' },
                { value: 'Nam', label: 'Nam' },
                { value: 'Khác', label: 'Khác' },
              ]}
            />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col span={8}>
          <Form.Item name="citizen_id" label="Số CCCD">
            <Input placeholder="Nhập 12 số CCCD" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item name="citizen_issue_date" label="Ngày cấp CCCD">
            <DateStringPicker placeholder="Chọn ngày cấp CCCD" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item name="tax_code" label="Mã số thuế">
            <Input placeholder="Nhập MST cá nhân (nếu có)" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="permanent_address" label="Địa chỉ thường trú">
            <Input placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="current_address" label="Chỗ ở hiện tại">
            <Input placeholder="Địa chỉ đang sinh sống tại TP. Hồ Chí Minh" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col span={8}>
          <Form.Item name="emergency_contact_name" label="Liên hệ khẩn cấp">
            <Input placeholder="Họ tên người thân & quan hệ" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item name="emergency_contact_phone" label="SĐT khẩn cấp">
            <Input placeholder="Ví dụ: 0909123456" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item name="note" label="Ghi chú">
            <Input placeholder="Ghi chú bổ sung" />
          </Form.Item>
        </Col>
      </Row>
      {isEditing && (
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item name="resigned_at" label="Ngày nghỉ việc">
              <DateStringPicker placeholder="Chọn ngày nghỉ việc" />
            </Form.Item>
          </Col>
          <Col span={16}>
            <Form.Item name="resign_reason" label="Lý do nghỉ việc">
              <Input placeholder="Nhập lý do nghỉ việc nếu nhân sự chuyển trạng thái Đã nghỉ việc" />
            </Form.Item>
          </Col>
        </Row>
      )}
    </>
  );
}
