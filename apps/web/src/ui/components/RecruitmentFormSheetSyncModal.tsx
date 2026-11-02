'use client';

import { Alert, App, Button, Descriptions, Form, Input, InputNumber, Modal, Space, Switch, Tag } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, CloudSyncOutlined, LinkOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { api, ApiClientError } from '@/lib/api';

export interface RecruitmentFormSheetConfigDto {
  sheet_url: string;
  spreadsheet_id: string;
  gid: string;
  tab_name: string;
  hourly_auto_sync: boolean;
  sync_interval_minutes: number;
  last_synced_at: string;
  last_new_count: number;
  last_skipped_count: number;
  last_total_rows: number;
  last_status: 'IDLE' | 'SUCCESS' | 'ERROR';
  last_message: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSynced?: () => void;
}

export function RecruitmentFormSheetSyncModal({ open, onClose, onSynced }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm();

  const cfgQ = useQuery({
    queryKey: ['recruitment-form-sync-config'],
    queryFn: () => api.get<RecruitmentFormSheetConfigDto>('/admin/candidates/form-sync-config'),
    enabled: open,
  });

  useEffect(() => {
    if (open && cfgQ.data) {
      form.setFieldsValue({
        sheet_url: cfgQ.data.sheet_url,
        tab_name: cfgQ.data.tab_name || 'FROM_NHAN_VIEN',
        hourly_auto_sync: cfgQ.data.hourly_auto_sync ?? true,
        sync_interval_minutes: cfgQ.data.sync_interval_minutes || 60,
      });
    }
  }, [open, cfgQ.data, form]);

  const saveMut = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.put<RecruitmentFormSheetConfigDto>('/admin/candidates/form-sync-config', values),
    onSuccess: () => {
      message.success('Đã lưu cấu hình đường dẫn Google Sheet Form và chế độ tự động đồng bộ hàng giờ');
      void qc.invalidateQueries({ queryKey: ['recruitment-form-sync-config'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Lưu cấu hình thất bại'),
  });

  const syncNowMut = useMutation({
    mutationFn: async () => {
      const vals = await form.validateFields();
      await api.put('/admin/candidates/form-sync-config', vals);
      return api.post<{ newCount: number; skippedCount: number; totalRows: number; message: string }>('/admin/candidates/sync-google-sheet', {
        sheet_url: vals.sheet_url,
      });
    },
    onSuccess: (res) => {
      message.success(res.message || `Đã đồng bộ ${res.newCount} ứng viên mới (bỏ qua ${res.skippedCount} hồ sơ đã lấy trước đó)`);
      void qc.invalidateQueries({ queryKey: ['recruitment-form-sync-config'] });
      void qc.invalidateQueries({ queryKey: ['candidates'] });
      onSynced?.();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Đồng bộ Google Sheet Form thất bại'),
  });

  const cfg = cfgQ.data;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      destroyOnHidden
      width={680}
      title={
        <Space size={8}>
          <CloudSyncOutlined style={{ color: '#2563EB' }} />
          <span>Cấu hình Đồng bộ Google Sheet Form Tuyển dụng (FROM_NHAN_VIEN)</span>
        </Space>
      }
      footer={
        <Space wrap>
          <Button onClick={onClose}>Đóng</Button>
          <Button
            icon={<SaveOutlined />}
            loading={saveMut.isPending}
            onClick={async () => {
              const vals = await form.validateFields();
              saveMut.mutate(vals);
            }}
          >
            Lưu cấu hình
          </Button>
          <Button
            type="primary"
            icon={<CloudSyncOutlined />}
            loading={syncNowMut.isPending}
            onClick={() => syncNowMut.mutate()}
          >
            Lưu &amp; Đồng bộ ngay lập tức
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="Đồng bộ tự động hàng giờ & Chống trùng lặp tuyệt đối"
          description="Hệ thống đọc trực tiếp từ đường dẫn Google Sheet lưu câu trả lời Google Form (FROM_NHAN_VIEN), tự động chấm điểm AI 14 điểm (9 tiêu chí + cờ loại Red Flag) và tự động bỏ qua 100% các ứng viên đã lấy trước đó (so khớp theo mã dòng, số điện thoại 10 số và email)."
        />

        {cfg && (
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="Trạng thái tự động">
              {cfg.hourly_auto_sync ? (
                <Tag color="success" icon={<ClockCircleOutlined />}>Tự động mỗi {cfg.sync_interval_minutes || 60} phút</Tag>
              ) : (
                <Tag color="default">Chỉ đồng bộ thủ công</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Lần đồng bộ gần nhất">
              {cfg.last_synced_at ? dayjs(cfg.last_synced_at).format('HH:mm:ss DD/MM/YYYY') : 'Chưa đồng bộ'}
            </Descriptions.Item>
            <Descriptions.Item label="Kết quả gần nhất" span={2}>
              <Space size={6} wrap>
                <Tag color="blue" icon={<CheckCircleOutlined />}>Mới lấy: {cfg.last_new_count} UV</Tag>
                <Tag color="default">Đã bỏ qua (tránh trùng): {cfg.last_skipped_count} UV</Tag>
                <span style={{ fontSize: 12, color: '#64748B' }}>{cfg.last_message}</span>
              </Space>
            </Descriptions.Item>
          </Descriptions>
        )}

        <Form form={form} layout="vertical" initialValues={{ tab_name: 'FROM_NHAN_VIEN', hourly_auto_sync: true, sync_interval_minutes: 60 }}>
          <Form.Item
            name="sheet_url"
            label="Đường dẫn (Link) Google Sheet lưu kết quả Form Tuyển dụng"
            rules={[{ required: true, message: 'Vui lòng nhập đường dẫn Google Sheet Form tuyển dụng' }]}
            extra="Dán nguyên đường link Google Sheets (ví dụ: https://docs.google.com/spreadsheets/d/.../edit#gid=0). Hãy bật quyền 'Bất kỳ ai có đường liên kết đều có thể xem' trên file Sheet Form để hệ thống tự động đọc dữ liệu."
          >
            <Input prefix={<LinkOutlined />} placeholder="https://docs.google.com/spreadsheets/d/1.../edit#gid=0" />
          </Form.Item>

          <Space size={12} style={{ width: '100%' }} align="start" wrap>
            <Form.Item name="tab_name" label="Tên trang tính (Tab Sheet)" style={{ width: 240 }}>
              <Input placeholder="FROM_NHAN_VIEN" />
            </Form.Item>
            <Form.Item name="sync_interval_minutes" label="Chu kỳ tự động lấy (phút)" style={{ width: 190 }}>
              <InputNumber min={15} max={1440} style={{ width: '100%' }} addonAfter="phút" />
            </Form.Item>
            <Form.Item name="hourly_auto_sync" label="Tự động đồng bộ hàng giờ" valuePropName="checked">
              <Switch checkedChildren="Đang bật" unCheckedChildren="Đang tắt" />
            </Form.Item>
          </Space>
        </Form>
      </Space>
    </Modal>
  );
}
