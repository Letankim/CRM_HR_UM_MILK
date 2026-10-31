'use client';

import { Alert, App, Button, Checkbox, DatePicker, Descriptions, Flex, Form, Modal, Space, Tag, Typography } from 'antd';
import { CalendarOutlined, CheckCircleOutlined, CloseOutlined, PlusOutlined, WarningOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { PARTITION_TABLE_LABELS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';

/** Nhãn tiếng Việt cho các bảng phân vùng theo tháng (khai báo tập trung tại @umbm/shared). */
export const PARTITION_BASE_LABELS: Record<string, string> = PARTITION_TABLE_LABELS;

/** Suy ra mã bảng gốc từ tên tab (VD: tab tháng có hậu tố _YYYY_MM). */
export function partitionBaseKey(tab: string): string | undefined {
  return Object.keys(PARTITION_BASE_LABELS).find((b) => tab === b || tab.startsWith(`${b}_`));
}

/** Suy ra nhãn bảng từ tên tab (VD: tab tháng có hậu tố _YYYY_MM). */
export function partitionTabLabel(tab: string): string {
  const base = partitionBaseKey(tab);
  return base ? PARTITION_BASE_LABELS[base]! : 'Bảng dữ liệu khác';
}

/** Hiển thị "Tháng MM/YYYY" từ mã YYYY_MM. */
export function monthKeyLabel(monthKey: string): string {
  const m = /^(\d{4})_(\d{2})$/.exec(monthKey);
  return m ? `Tháng ${m[2]}/${m[1]}` : 'Sheet gốc (Mặc định)';
}

interface RolloverResult {
  monthKey: string;
  label: string;
  carried: Record<string, number>;
  pendingLeftBehind: Record<string, number>;
}

export interface DataPartitionRolloverModalProps {
  open: boolean;
  activeMonth?: string;
  existingMonthKeys?: string[];
  onClose: () => void;
}

export function DataPartitionRolloverModal({ open, activeMonth = '', existingMonthKeys = [], onClose }: DataPartitionRolloverModalProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const nowMonth = dayjs().startOf('month');
  const nextMonth = nowMonth.add(1, 'month');
  const prevMonth = nowMonth.subtract(1, 'month');
  const [month, setMonth] = useState<Dayjs | null>(nowMonth);
  const [carryForward, setCarryForward] = useState(true);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [result, setResult] = useState<RolloverResult | null>(null);

  useEffect(() => {
    if (!open) return;
    const curKey = dayjs().format('YYYY_MM');
    setMonth(!activeMonth || activeMonth !== curKey ? dayjs().startOf('month') : dayjs().add(1, 'month').startOf('month'));
    setCarryForward(true);
    setFieldError(null);
    setResult(null);
  }, [open, activeMonth]);

  const mut = useMutation({
    mutationFn: (body: { month_key: string; carry_forward: boolean }) => api.post<RolloverResult>('/admin/data-partitions/rollover', body),
    onSuccess: async (data) => {
      setResult(data);
      message.success(`Đã khởi tạo và chuyển hệ thống sang ${data.label || monthKeyLabel(data.monthKey)}`);
      await qc.invalidateQueries();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiClientError) {
        const d = e.details.find((x) => x.field === 'month_key');
        setFieldError(d ? d.message : null);
        message.error(e.message);
      } else {
        message.error('Không thể khởi tạo phân vùng tháng mới, vui lòng thử lại');
      }
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
      setFieldError('Vui lòng chọn tháng cần tạo phân vùng dữ liệu');
      return;
    }
    setFieldError(null);
    mut.mutate({ month_key: month.format('YYYY_MM'), carry_forward: carryForward });
  };

  const selectedKey = month ? month.format('YYYY_MM') : '';
  const alreadyExists = Boolean(selectedKey && existingMonthKeys.includes(selectedKey));
  const pendingEntries = result ? Object.entries(result.pendingLeftBehind ?? {}).filter(([, n]) => Number(n) > 0) : [];
  const pendingTotal = pendingEntries.reduce((sum, [, n]) => sum + Number(n), 0);

  return (
    <Modal
      open={open}
      title={<span><CalendarOutlined /> Khởi tạo &amp; Chuyển sang Phân vùng Dữ liệu Tháng</span>}
      onCancel={handleClose}
      destroyOnHidden
      centered
      width={540}
      maskClosable={!mut.isPending}
      footer={
        result ? (
          <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleClose}>Hoàn tất</Button>
        ) : (
          <Space>
            <Button icon={<CloseOutlined />} onClick={handleClose} disabled={mut.isPending}>Hủy bỏ</Button>
            <Button type="primary" icon={<PlusOutlined />} loading={mut.isPending} disabled={selectedKey === activeMonth && Boolean(selectedKey)} onClick={submit}>
              {alreadyExists ? 'Chuyển sang tháng đã chọn' : 'Tạo phân vùng & Áp dụng ngay'}
            </Button>
          </Space>
        )
      }
    >
      {result ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert type="success" showIcon message={`Hệ thống đã chuyển sang phân vùng ${result.label || monthKeyLabel(result.monthKey)}`} />
          <Descriptions
            size="small"
            bordered
            column={1}
            title={<span style={{ fontSize: 13 }}>Số bản ghi đã chuyển tiếp sang phân vùng mới</span>}
            items={Object.keys(PARTITION_BASE_LABELS).map((base) => ({
              key: base,
              label: PARTITION_BASE_LABELS[base],
              children: <span><strong className="num">{Number(result.carried?.[base] ?? 0).toLocaleString('vi-VN')}</strong> bản ghi</span>,
            }))}
          />
          {pendingTotal > 0 && (
            <Alert
              type="warning"
              showIcon
              icon={<WarningOutlined />}
              message={`Còn ${pendingTotal} bản ghi chờ duyệt ở phân vùng cũ — có thể chuyển lại bất kỳ lúc nào để xử lý`}
              description={pendingEntries.map(([base, n]) => `${PARTITION_BASE_LABELS[base] ?? 'Bảng khác'}: ${n}`).join(' · ')}
            />
          )}
        </Space>
      ) : (
        <Form layout="vertical">
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 14 }}
            message="Tự động tạo đủ 5 bảng dữ liệu theo tháng trên Google Sheets"
            description="Bao gồm Lịch phân ca, Đơn nghỉ OFF, Đổi ca / Nhường ca, Chấm công Vào/Ra và Phiếu bổ sung công. Khuyến nghị chốt xong kỳ lương tháng cũ trước khi tách sang tháng mới."
          />
          <Form.Item
            label={
              <Flex align="center" gap={8} wrap="wrap">
                <span>Chọn tháng dữ liệu</span>
                {selectedKey && (
                  selectedKey === activeMonth
                    ? <Tag color="green" style={{ margin: 0 }}>Đang sử dụng</Tag>
                    : alreadyExists
                      ? <Tag color="blue" style={{ margin: 0 }}>Đã có sẵn phân vùng</Tag>
                      : <Tag color="gold" style={{ margin: 0 }}>Sẽ tạo phân vùng mới</Tag>
                )}
              </Flex>
            }
            required
            validateStatus={fieldError ? 'error' : undefined}
            help={fieldError ?? undefined}
          >
            <Flex gap={6} wrap="wrap" style={{ marginBottom: 8 }}>
              {[
                { label: `Tháng trước (${prevMonth.format('MM/YYYY')})`, val: prevMonth },
                { label: `Tháng này (${nowMonth.format('MM/YYYY')})`, val: nowMonth },
                { label: `Tháng tới (${nextMonth.format('MM/YYYY')})`, val: nextMonth },
              ].map((preset) => {
                const active = month?.format('YYYY_MM') === preset.val.format('YYYY_MM');
                return (
                  <Button
                    key={preset.label}
                    size="small"
                    type={active ? 'primary' : 'default'}
                    ghost={active}
                    onClick={() => { setMonth(preset.val); setFieldError(null); }}
                  >
                    {preset.label}
                  </Button>
                );
              })}
            </Flex>
            <DatePicker
              picker="month"
              format="MM/YYYY"
              placeholder="Chọn tháng bất kỳ (MM/YYYY)"
              style={{ width: '100%' }}
              value={month}
              onChange={(d) => { setMonth(d); setFieldError(null); }}
            />
          </Form.Item>
          <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, background: '#F8FAFC', padding: '10px 12px' }}>
            <Checkbox checked={carryForward} onChange={(e) => setCarryForward(e.target.checked)}>
              <span style={{ fontWeight: 500 }}>Chuyển tiếp dữ liệu có ngày từ đầu tháng đã chọn trở đi</span>
            </Checkbox>
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4, paddingLeft: 24 }}>
              Các ca làm việc đã xếp trước, đơn nghỉ OFF và yêu cầu đổi ca thuộc tháng mới sẽ được mang sang để vận hành liền mạch.
            </Typography.Text>
          </div>
        </Form>
      )}
    </Modal>
  );
}
