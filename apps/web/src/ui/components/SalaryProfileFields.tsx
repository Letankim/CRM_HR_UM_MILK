'use client';

import { Alert, Col, Form, InputNumber, Radio, Row, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { PAY_RATE_TYPE_LABELS, PAY_RATE_UNIT_LABELS, SYSTEM_CONFIG } from '@umbm/shared';
import { DateStringPicker } from './DateTimePickers';
import { fmtVnd, MONEY_INPUT_PROPS, type PayRateType } from './payroll-types';

const D = SYSTEM_CONFIG.defaults;

export const SALARY_FIELD_DEFAULTS = {
  rate_type: 'HOURLY' as PayRateType,
  amount_vnd: 28000,
  probation_percent: D.probationSalaryPercent,
  standard_work_days: D.standardWorkDaysPerMonth,
  standard_hours_per_day: D.standardHoursPerDay,
  ot_multiplier: D.overtimeMultiplier,
  attendance_bonus_vnd: 0,
  meal_allowance_per_shift_vnd: 0,
  transport_allowance_vnd: 0,
  responsibility_allowance_vnd: 0,
  other_allowance_vnd: 0,
};

const DEFAULT_AMOUNT: Record<PayRateType, number> = { HOURLY: 28000, MONTHLY: 7500000, SHIFT: 150000 };
const STEP: Record<PayRateType, number> = { HOURLY: 1000, MONTHLY: 100000, SHIFT: 5000 };
const money = MONEY_INPUT_PROPS;

/**
 * Bộ trường cấu hình lương CÁ NHÂN dùng chung (Tiếp nhận nhân sự & Hồ sơ lương).
 * `prefix` cho phép lồng vào form cha (ví dụ: ['salary', 'amount_vnd']).
 */
export function SalaryProfileFields({ form, prefix, showEffectiveFrom = true }: { form: FormInstance; prefix?: string; showEffectiveFrom?: boolean }) {
  const n = (k: string) => (prefix ? [prefix, k] : k);
  const rateType = (Form.useWatch(n('rate_type'), form) as PayRateType | undefined) ?? 'HOURLY';
  const amount = (Form.useWatch(n('amount_vnd'), form) as number | undefined) ?? 0;
  const percent = (Form.useWatch(n('probation_percent'), form) as number | undefined) ?? D.probationSalaryPercent;
  const unit = PAY_RATE_UNIT_LABELS[rateType];

  return (
    <>
      <Form.Item name={n('rate_type')} label="Hình thức lương" rules={[{ required: true }]}>
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          onChange={(e) => form.setFieldValue(n('amount_vnd'), DEFAULT_AMOUNT[e.target.value as PayRateType])}
          options={(['HOURLY', 'MONTHLY', 'SHIFT'] as PayRateType[]).map((v) => ({ value: v, label: PAY_RATE_TYPE_LABELS[v] }))}
        />
      </Form.Item>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name={n('amount_vnd')} label="Lương chính thức" rules={[{ required: true, message: 'Vui lòng nhập mức lương' }]}>
            <InputNumber min={0} step={STEP[rateType]} style={{ width: '100%' }} suffix={`đ/${unit}`} {...money} />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item name={n('probation_percent')} label="% thử việc" rules={[{ required: true, message: 'Nhập tỷ lệ' }]}>
            <InputNumber min={1} max={100} style={{ width: '100%' }} suffix="%" />
          </Form.Item>
        </Col>
        {showEffectiveFrom && (
          <Col span={6}>
            <Form.Item name={n('effective_from')} label="Ngày hiệu lực" rules={[{ required: true, message: 'Chọn ngày' }]}>
              <DateStringPicker placeholder="Chọn ngày hiệu lực" />
            </Form.Item>
          </Col>
        )}
      </Row>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={
          <span>
            Thử việc: <Typography.Text strong>{fmtVnd((amount * percent) / 100)}/{unit}</Typography.Text> ({percent}%) — Chính thức:{' '}
            <Typography.Text strong>{fmtVnd(amount)}/{unit}</Typography.Text>
            {rateType === 'MONTHLY' && ' — Lương tháng chia theo ngày công thực tế / công chuẩn.'}
          </span>
        }
      />
      <Row gutter={12}>
        {rateType === 'MONTHLY' && (
          <Col span={8}>
            <Form.Item name={n('standard_work_days')} label="Công chuẩn / tháng" tooltip="Số ngày công tiêu chuẩn trong tháng để chia đơn giá 1 ngày công">
              <InputNumber min={1} max={31} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        )}
        {rateType !== 'HOURLY' && (
          <Col span={8}>
            <Form.Item name={n('standard_hours_per_day')} label="Giờ chuẩn / ngày (ca)" tooltip="Số giờ tiêu chuẩn mỗi ngày/ca để quy đổi ra đơn giá 1 giờ khi tính Tăng ca (OT)">
              <InputNumber min={1} max={24} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        )}
        <Col span={rateType === 'HOURLY' ? 12 : 8}>
          <Form.Item name={n('ot_multiplier')} label="Hệ số tăng ca (OT)" tooltip="Hệ số nhân đơn giá giờ khi làm thêm giờ (VD: 1.5 = 150%)">
            <InputNumber min={1} max={5} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>
      <div style={{ margin: '4px 0 12px', paddingTop: 10, borderTop: '1px solid #E5E7EB', fontWeight: 600, color: '#0F172A' }}>Phụ cấp &amp; thưởng cố định</div>
      <Row gutter={12}>
        <Col span={8}><Form.Item name={n('meal_allowance_per_shift_vnd')} label="Phụ cấp ăn ca"><InputNumber min={0} step={5000} style={{ width: '100%' }} suffix="đ/ca" {...money} /></Form.Item></Col>
        <Col span={8}><Form.Item name={n('attendance_bonus_vnd')} label="Thưởng chuyên cần" tooltip="Chỉ áp dụng khi không có ca vắng mặt trong kỳ"><InputNumber min={0} step={50000} style={{ width: '100%' }} suffix="đ/kỳ" {...money} /></Form.Item></Col>
        <Col span={8}><Form.Item name={n('transport_allowance_vnd')} label="Phụ cấp đi lại"><InputNumber min={0} step={50000} style={{ width: '100%' }} suffix="đ/kỳ" {...money} /></Form.Item></Col>
        <Col span={12}><Form.Item name={n('responsibility_allowance_vnd')} label="Phụ cấp trách nhiệm"><InputNumber min={0} step={100000} style={{ width: '100%' }} suffix="đ/kỳ" {...money} /></Form.Item></Col>
        <Col span={12}><Form.Item name={n('other_allowance_vnd')} label="Phụ cấp khác"><InputNumber min={0} step={50000} style={{ width: '100%' }} suffix="đ/kỳ" {...money} /></Form.Item></Col>
      </Row>
    </>
  );
}
