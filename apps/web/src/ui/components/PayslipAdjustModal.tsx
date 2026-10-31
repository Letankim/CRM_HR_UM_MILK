'use client';

import { Button, Flex, Form, Input, InputNumber, Modal, Segmented, Space, Tag, Typography } from 'antd';
import { CloseOutlined, MinusCircleOutlined, PlusCircleOutlined, SaveOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { fmtVnd, MONEY_INPUT_PROPS } from './payroll-types';

const PRESET_AMOUNTS = [30_000, 50_000, 100_000, 200_000, 500_000];

export function PayslipAdjustModal({
  open,
  employeeLabel,
  currentNetVnd,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  employeeLabel: string;
  currentNetVnd: number;
  loading: boolean;
  onClose: () => void;
  onSubmit: (payload: { delta_vnd: number; reason: string }) => void;
}) {
  const [form] = Form.useForm<{ amount_vnd: number; reason: string }>();
  const [direction, setDirection] = useState<'ADD' | 'DEDUCT'>('ADD');
  const rawAmount = Number(Form.useWatch('amount_vnd', form) || 0);
  const absAmount = Math.max(0, Math.round(Math.abs(rawAmount)));
  const signedDelta = direction === 'DEDUCT' ? -absAmount : absAmount;
  const previewNet = currentNetVnd + signedDelta;

  useEffect(() => {
    if (open) {
      setDirection('ADD');
      form.resetFields();
    }
  }, [open, form]);

  return (
    <Modal
      width={620}
      title={`Điều Chỉnh Bảng Lương / Phiếu Lương — ${employeeLabel}`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Lưu điều chỉnh lương"
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: <SaveOutlined />, danger: direction === 'DEDUCT' }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => {
          const clean = Math.round(Math.abs(Number(v.amount_vnd || 0)));
          onSubmit({ delta_vnd: direction === 'DEDUCT' ? -clean : clean, reason: v.reason.trim() });
        }}
      >
        <Form.Item label="Loại điều chỉnh lương (Chọn Cộng thêm hoặc Khấu trừ)">
          <Segmented
            block
            value={direction}
            onChange={(val) => setDirection(val as 'ADD' | 'DEDUCT')}
            options={[
              {
                value: 'ADD',
                label: (
                  <span style={{ color: direction === 'ADD' ? '#15803D' : undefined, fontWeight: 600 }}>
                    <PlusCircleOutlined /> Cộng thêm vào lương (+)
                  </span>
                ),
              },
              {
                value: 'DEDUCT',
                label: (
                  <span style={{ color: direction === 'DEDUCT' ? '#DC2626' : undefined, fontWeight: 600 }}>
                    <MinusCircleOutlined /> Khấu trừ khỏi lương (-)
                  </span>
                ),
              },
            ]}
          />
        </Form.Item>

        <Form.Item
          name="amount_vnd"
          label={direction === 'ADD' ? 'Số tiền cộng thêm (VNĐ)' : 'Số tiền khấu trừ (VNĐ)'}
          rules={[
            { required: true, message: 'Vui lòng nhập số tiền cần điều chỉnh' },
            {
              validator: (_, val) =>
                Number(val || 0) >= 1000 ? Promise.resolve() : Promise.reject(new Error('Số tiền điều chỉnh tối thiểu 1.000 VNĐ')),
            },
          ]}
        >
          <InputNumber
            style={{ width: '100%' }}
            min={1000}
            step={10000}
            placeholder="Nhập số tiền dương, ví dụ: 150.000"
            suffix="VNĐ"
            {...MONEY_INPUT_PROPS}
          />
        </Form.Item>

        <div style={{ marginTop: -12, marginBottom: 14 }}>
          <Space size={6} wrap>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Chọn nhanh:</Typography.Text>
            {PRESET_AMOUNTS.map((amt) => (
              <Button key={amt} size="small" onClick={() => form.setFieldValue('amount_vnd', amt)}>
                {direction === 'ADD' ? '+' : '-'}{amt.toLocaleString('vi-VN')} đ
              </Button>
            ))}
          </Space>
        </div>

        <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '10px 14px', marginBottom: 14 }}>
          <Flex justify="space-between" align="center" wrap gap={8}>
            <div>
              <div style={{ fontSize: 12, color: '#64748B' }}>Thực lĩnh hiện tại</div>
              <strong className="num">{fmtVnd(currentNetVnd)}</strong>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#64748B' }}>Chênh lệch điều chỉnh</div>
              <Tag color={direction === 'ADD' ? 'green' : 'red'} className="num" style={{ margin: 0, fontWeight: 700 }}>
                {direction === 'ADD' ? `+${fmtVnd(absAmount)}` : `-${fmtVnd(absAmount)}`}
              </Tag>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#64748B' }}>Thực lĩnh mới sau điều chỉnh</div>
              <strong className="num" style={{ fontSize: 15, color: '#2563EB' }}>{fmtVnd(previewNet)}</strong>
            </div>
          </Flex>
        </div>

        <Form.Item
          name="reason"
          label="Lý do điều chỉnh lương (tối thiểu 5 ký tự)"
          rules={[{ required: true, min: 5, message: 'Vui lòng nhập lý do điều chỉnh rõ ràng tối thiểu 5 ký tự' }]}
        >
          <Input.TextArea
            rows={2}
            placeholder={
              direction === 'ADD'
                ? 'VD: Cộng bổ sung phụ cấp ca tối ngày 20/10 sau đối soát công...'
                : 'VD: Khấu trừ tạm ứng lương / đền bù đồng phục theo biên bản đã xác nhận...'
            }
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
