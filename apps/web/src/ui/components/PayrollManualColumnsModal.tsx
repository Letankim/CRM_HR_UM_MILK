'use client';

import { useEffect } from 'react';
import { Alert, App, Button, Col, Descriptions, Form, InputNumber, Modal, Row, Space, Tag } from 'antd';
import { CalculatorOutlined, CloseOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import { fmtVnd, MONEY_INPUT_PROPS, type PayrollSnapshotItem } from './payroll-types';

export interface ManualColumnsFormValues {
  manual_base_add_vnd: number;
  manual_ot_add_vnd: number;
  manual_bonus_vnd: number;
  manual_advance_deduct_vnd: number;
  manual_kpi_deduct_vnd: number;
  manual_uniform_deduct_vnd: number;
}

export function PayrollManualColumnsModal({
  row,
  onClose,
  onSaved,
}: {
  row: PayrollSnapshotItem | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<ManualColumnsFormValues>();

  useEffect(() => {
    if (!row) return;
    form.setFieldsValue({
      manual_base_add_vnd: Number(row.manualBaseAddVnd ?? row.manual_base_add_vnd ?? 0),
      manual_ot_add_vnd: Number(row.manualOtAddVnd ?? row.manual_ot_add_vnd ?? 0),
      manual_bonus_vnd: Number(row.manualBonusVnd ?? row.manual_bonus_vnd ?? 0),
      manual_advance_deduct_vnd: Number(row.manualAdvanceDeductVnd ?? row.manual_advance_deduct_vnd ?? 0),
      manual_kpi_deduct_vnd: Number(row.manualKpiDeductVnd ?? row.manual_kpi_deduct_vnd ?? 0),
      manual_uniform_deduct_vnd: Number(row.manualUniformDeductVnd ?? row.manual_uniform_deduct_vnd ?? 0),
    });
  }, [row, form]);

  const watched = Form.useWatch([], form);
  const totalAdd =
    Number(watched?.manual_base_add_vnd || 0) +
    Number(watched?.manual_ot_add_vnd || 0) +
    Number(watched?.manual_bonus_vnd || 0);
  const totalDeduct =
    Number(watched?.manual_advance_deduct_vnd || 0) +
    Number(watched?.manual_kpi_deduct_vnd || 0) +
    Number(watched?.manual_uniform_deduct_vnd || 0);
  const netDelta = totalAdd - totalDeduct;

  const saveMut = useMutation({
    mutationFn: (values: ManualColumnsFormValues) =>
      api.put(`/admin/payroll/snapshots/${row?.id}/manual-columns`, {
        manual_base_add_vnd: Math.max(0, Math.round(Number(values.manual_base_add_vnd) || 0)),
        manual_ot_add_vnd: Math.max(0, Math.round(Number(values.manual_ot_add_vnd) || 0)),
        manual_bonus_vnd: Math.max(0, Math.round(Number(values.manual_bonus_vnd) || 0)),
        manual_advance_deduct_vnd: Math.max(0, Math.round(Number(values.manual_advance_deduct_vnd) || 0)),
        manual_kpi_deduct_vnd: Math.max(0, Math.round(Number(values.manual_kpi_deduct_vnd) || 0)),
        manual_uniform_deduct_vnd: Math.max(0, Math.round(Number(values.manual_uniform_deduct_vnd) || 0)),
      }),
    onSuccess: () => {
      message.success(`Đã cập nhật 6 cột nhập tay Kế toán cho nhân sự ${row?.fullName}`);
      ['payroll-snapshots', 'payroll-periods', 'payroll-periods-report', 'payroll-reconcile'].forEach((k) =>
        void qc.invalidateQueries({ queryKey: [k] }),
      );
      onSaved?.();
      onClose();
    },
    onError: (e) => {
      message.error(e instanceof ApiClientError ? e.message : 'Không thể lưu 6 cột nhập tay Kế toán');
    },
  });

  return (
    <Modal
      width={720}
      open={Boolean(row)}
      destroyOnHidden
      title={
        row ? (
          <span>
            <CalculatorOutlined /> Nhập tay 6 Cột Kế toán — {row.fullName} ({row.employeeCode})
          </span>
        ) : (
          'Nhập tay 6 cột Kế toán'
        )
      }
      onCancel={onClose}
      footer={
        <Space>
          <Button icon={<CloseOutlined />} onClick={onClose}>
            Đóng
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saveMut.isPending} onClick={() => form.submit()}>
            Lưu 6 cột Kế toán &amp; Tính lại Thực lĩnh
          </Button>
        </Space>
      }
    >
      {row && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Cơ chế Bán tự động (Hybrid Payroll): 3 cột cộng (+) và 3 cột khấu trừ (-) do Kế toán nhập tay được cộng/trừ trực tiếp vào Thực lĩnh của kỳ lương."
          />
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="Nhân sự">
              <strong>{row.fullName}</strong> <Tag color="geekblue">{row.employeeCode}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Chi nhánh &amp; Giai đoạn">
              {row.branchName} · {row.stageLabel}
            </Descriptions.Item>
            <Descriptions.Item label="Tổng cộng thêm (+)">
              <span className="num" style={{ fontWeight: 700, color: '#15803D' }}>+{fmtVnd(totalAdd)}</span>
            </Descriptions.Item>
            <Descriptions.Item label="Tổng khấu trừ (-)">
              <span className="num" style={{ fontWeight: 700, color: '#DC2626' }}>-{fmtVnd(totalDeduct)}</span>
            </Descriptions.Item>
            <Descriptions.Item label="Chênh lệch ròng 6 cột" span={2}>
              <span className="num" style={{ fontWeight: 800, color: netDelta >= 0 ? '#2563EB' : '#DC2626' }}>
                {netDelta >= 0 ? `+${fmtVnd(netDelta)}` : fmtVnd(netDelta)}
              </span>
            </Descriptions.Item>
          </Descriptions>

          <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item name="manual_base_add_vnd" label="1. Lương cơ bản bổ sung (+ VNĐ)">
                  <InputNumber {...MONEY_INPUT_PROPS} min={0} style={{ width: '100%' }} addonAfter="đ" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="manual_ot_add_vnd" label="2. Tiền OT phát sinh thêm (+ VNĐ)">
                  <InputNumber {...MONEY_INPUT_PROPS} min={0} style={{ width: '100%' }} addonAfter="đ" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="manual_bonus_vnd" label="3. Thưởng hiệu quả (Bonus) (+ VNĐ)">
                  <InputNumber {...MONEY_INPUT_PROPS} min={0} style={{ width: '100%' }} addonAfter="đ" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="manual_advance_deduct_vnd" label="4. Tiền tạm ứng trong kỳ (- VNĐ)">
                  <InputNumber {...MONEY_INPUT_PROPS} min={0} style={{ width: '100%' }} addonAfter="đ" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="manual_kpi_deduct_vnd" label="5. Khấu trừ vi phạm KPI (- VNĐ)">
                  <InputNumber {...MONEY_INPUT_PROPS} min={0} style={{ width: '100%' }} addonAfter="đ" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="manual_uniform_deduct_vnd" label="6. Khấu trừ đồng phục mới (- VNĐ)">
                  <InputNumber {...MONEY_INPUT_PROPS} min={0} style={{ width: '100%' }} addonAfter="đ" />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Space>
      )}
    </Modal>
  );
}
