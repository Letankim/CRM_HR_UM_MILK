'use client';

import { Alert, App, Button, Checkbox, DatePicker, Descriptions, Form, Modal, Space, Typography } from 'antd';
import { CheckCircleOutlined, CloseOutlined, PlusOutlined, WarningOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { PARTITION_TABLE_LABELS } from '@umbm/shared';

/** Nhãn tiếng Việt cho các bảng phân vùng theo tháng (khai báo tập trung tại @umbm/shared). */
export const PARTITION_BASE_LABELS: Record<string, string> = PARTITION_TABLE_LABELS;

/** Suy ra nhãn bảng từ tên tab (VD: tab tháng có hậu tố _YYYY_MM). */
export function partitionTabLabel(tab: string): string {
  const base = Object.keys(PARTITION_BASE_LABELS).find((b) => tab === b || tab.startsWith(`${b}_`));
  return base ? PARTITION_BASE_LABELS[base]! : 'Bảng dữ liệu khác';
}

/** Hiển thị "Tháng MM/YYYY" từ mã YYYY_MM. */
export function monthKeyLabel(monthKey: string): string {
  const m = /^(\d{4})_(\d{2})$/.exec(monthKey);
  return m ? `Tháng ${m[2]}/${m[1]}` : 'Sheet gốc';
}

interface RolloverResult {
  monthKey: string;
  label: string;
  carried: Record<string, number>;
  pendingLeftBehind: Record<string, number>;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function DataPartitionRolloverModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [month, setMonth] = useState<Dayjs | null>(dayjs().add(1, 'month').startOf('month'));
  const [carryForward, setCarryForward] = useState(true);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [result, setResult] = useState<RolloverResult | null>(null);

  const mut = useMutation({
    mutationFn: (body: { month_key: string; carry_forward: boolean }) => api.post<RolloverResult>('/admin/data-partitions/rollover', body),
    onSuccess: async (data) => {
      setResult(data);
      message.success(`Đã tạo và chuyển hệ thống sang sheet ${data.label || monthKeyLabel(data.monthKey)}`);
      await qc.invalidateQueries();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiClientError) {
        const d = e.details.find((x) => x.field === 'month_key');
        setFieldError(d ? d.message : null);
        message.error(e.message);
      } else message.error('Không thể tạo sheet tháng mới, vui lòng thử lại');
    },
  });

  const handleClose = () => {
    setResult(null);
    setFieldError(null);
    mut.reset();
    onClose();
  };

  const submit = () => {
    if (!month) {
      setFieldError('Vui lòng chọn tháng cần tạo sheet');
      return;
    }
    setFieldError(null);
    mut.mutate({ month_key: month.format('YYYY_MM'), carry_forward: carryForward });
  };

  const pendingEntries = result ? Object.entries(result.pendingLeftBehind ?? {}).filter(([, n]) => Number(n) > 0) : [];
  const pendingTotal = pendingEntries.reduce((sum, [, n]) => sum + Number(n), 0);

  return (
    <Modal
      open={open}
      title="Tạo sheet dữ liệu tháng mới"
      onCancel={handleClose}
      destroyOnHidden
      maskClosable={!mut.isPending}
      footer={
        result ? (
          <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleClose}>Hoàn tất</Button>
        ) : (
          <Space>
            <Button icon={<CloseOutlined />} onClick={handleClose} disabled={mut.isPending}>Hủy bỏ</Button>
            <Button type="primary" icon={<PlusOutlined />} loading={mut.isPending} onClick={submit}>Tạo sheet &amp; chuyển hệ thống</Button>
          </Space>
        )
      }
    >
      {result ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert type="success" showIcon message={`Hệ thống đang dùng sheet ${result.label || monthKeyLabel(result.monthKey)}`} />
          <Descriptions
            size="small"
            bordered
            column={1}
            title={<span style={{ fontSize: 13 }}>Dữ liệu đã chuyển tiếp sang sheet mới</span>}
            items={Object.keys(PARTITION_BASE_LABELS).map((base) => ({
              key: base,
              label: PARTITION_BASE_LABELS[base],
              children: <span><span className="num">{Number(result.carried?.[base] ?? 0).toLocaleString('vi-VN')}</span> bản ghi</span>,
            }))}
          />
          {pendingTotal > 0 && (
            <Alert
              type="warning"
              showIcon
              icon={<WarningOutlined />}
              message={`Còn ${pendingTotal} bản ghi chờ duyệt ở tháng cũ — hãy chuyển lại sheet cũ để xử lý`}
              description={pendingEntries.map(([base, n]) => `${PARTITION_BASE_LABELS[base] ?? 'Bảng dữ liệu khác'}: ${n}`).join(' · ')}
            />
          )}
        </Space>
      ) : (
        <Form layout="vertical">
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="Nên chốt kỳ lương tháng cũ trước khi chuyển sheet"
            description="Hệ thống sẽ tự tạo các sheet Lịch phân ca, Đơn nghỉ OFF, Đổi ca / Nhường ca, Chấm công Vào/Ra và Phiếu bổ sung công cho tháng được chọn, sau đó toàn bộ thao tác đọc/ghi sẽ chuyển sang sheet mới."
          />
          <Form.Item label="Tháng cần tạo sheet" required validateStatus={fieldError ? 'error' : undefined} help={fieldError ?? undefined}>
            <DatePicker
              picker="month"
              format="MM/YYYY"
              placeholder="Chọn tháng (MM/YYYY)"
              style={{ width: '100%' }}
              value={month}
              onChange={(d) => { setMonth(d); setFieldError(null); }}
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Checkbox checked={carryForward} onChange={(e) => setCarryForward(e.target.checked)}>
              Chuyển tiếp dữ liệu từ đầu tháng mới trở đi (ca đã xếp, đơn OFF, đổi ca...)
            </Checkbox>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '6px 0 0 24px' }}>
              Các bản ghi có ngày thuộc tháng mới trở đi sẽ được sao chép sang sheet mới để nhân viên và quản lý tiếp tục làm việc liền mạch.
            </Typography.Paragraph>
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}
