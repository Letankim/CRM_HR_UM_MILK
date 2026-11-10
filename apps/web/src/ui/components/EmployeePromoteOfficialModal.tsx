'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Checkbox, Form, Input, Modal, Space, Spin, Table, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseOutlined, DeleteOutlined, PlusOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { DateStringPicker } from './DateTimePickers';

const { Text } = Typography;

export interface PromoteScheduleItem {
  id?: string;
  action: 'REMOVE' | 'CREATE';
  workDate: string;
  shiftCode: string;
  shiftLabel: string;
  startAt: string;
  endAt: string;
  hours: number;
  reason?: string;
  note?: string;
}

export interface PromotePreviewData {
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    branchId: string;
    branchName: string;
    stage: string;
    defaultShiftCode: string;
    defaultShiftLabel: string;
  };
  officialFrom: string;
  todayStr: string;
  staleShifts: PromoteScheduleItem[];
  suggestedShifts: PromoteScheduleItem[];
  allPreviewItems: PromoteScheduleItem[];
}

export interface EmployeePromoteOfficialModalProps {
  open: boolean;
  employee: { id: string; employeeCode: string; fullName: string; branchId?: string; branchName?: string; version: number } | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function EmployeePromoteOfficialModal({ open, employee, onClose, onSuccess }: EmployeePromoteOfficialModalProps) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const watchedDate = String(Form.useWatch('official_from', form) || dayjs().format('YYYY-MM-DD'));
  const [selectedShiftKeys, setSelectedShiftKeys] = useState<Set<string>>(new Set());

  const previewQ = useQuery({
    queryKey: ['promote-preview', employee?.id, watchedDate],
    queryFn: () => api.get<PromotePreviewData>(`/admin/employees/${employee!.id}/promote-preview?official_from=${encodeURIComponent(watchedDate)}`),
    enabled: open && Boolean(employee?.id) && /^\d{4}-\d{2}-\d{2}$/.test(watchedDate),
    staleTime: 10_000,
  });

  const preview = previewQ.data;

  useEffect(() => {
    if (open && employee) {
      const today = dayjs().format('YYYY-MM-DD');
      form.setFieldsValue({
        official_from: today,
        evaluation_summary: 'Hoàn thành tốt chu kỳ thử việc, đạt chuẩn tác phong và nội quy cửa hàng',
      });
    }
  }, [open, employee, form]);

  useEffect(() => {
    if (preview?.suggestedShifts) {
      setSelectedShiftKeys(new Set(preview.suggestedShifts.map((s) => `${s.workDate}_${s.shiftCode}`)));
    }
  }, [preview?.suggestedShifts]);

  const promoteMut = useMutation({
    mutationFn: (values: { official_from: string; evaluation_summary: string }) => {
      const createShifts = (preview?.suggestedShifts ?? [])
        .filter((s) => selectedShiftKeys.has(`${s.workDate}_${s.shiftCode}`))
        .map((s) => ({ work_date: s.workDate, shift_code: s.shiftCode, note: s.note }));

      return api.post(`/admin/employees/${employee!.id}/promote-official`, {
        version: employee!.version,
        official_from: values.official_from,
        evaluation_summary: values.evaluation_summary,
        create_shifts: createShifts,
      });
    },
    onSuccess: () => {
      message.success(`Đã chuyển chính thức và cập nhật lịch tuần cho ${employee?.fullName}`);
      ['employees', 'employee-contracts', 'schedule-planner-probation', 'schedule-planner-week', 'schedules', 'notifications'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      onSuccess();
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Chuyển chính thức thất bại'),
  });

  const toggleShift = (key: string) => {
    setSelectedShiftKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const columns = [
    {
      title: 'Hành động',
      key: 'action',
      width: 140,
      render: (_: unknown, r: PromoteScheduleItem) => {
        if (r.action === 'REMOVE') {
          return <Tag color="error" icon={<DeleteOutlined />}>Thu hồi ca cũ</Tag>;
        }
        const k = `${r.workDate}_${r.shiftCode}`;
        return (
          <Checkbox checked={selectedShiftKeys.has(k)} onChange={() => toggleShift(k)}>
            <Tag color="success" icon={<PlusOutlined />} style={{ marginLeft: 4 }}>Bổ sung ca</Tag>
          </Checkbox>
        );
      },
    },
    {
      title: 'Ngày làm việc',
      dataIndex: 'workDate',
      key: 'workDate',
      width: 130,
      render: (v: string, r: PromoteScheduleItem) => (
        <Text strong style={{ color: r.action === 'REMOVE' ? '#DC2626' : '#16A34A' }}>
          {dayjs(v).format('DD/MM/YYYY')}
        </Text>
      ),
    },
    {
      title: 'Khung ca',
      key: 'shift',
      render: (_: unknown, r: PromoteScheduleItem) => (
        <span>
          <Text strong>{r.shiftLabel}</Text>
          <div style={{ fontSize: 12, color: '#64748B' }}>{r.startAt} – {r.endAt} ({r.hours}h)</div>
        </span>
      ),
    },
    {
      title: 'Lý do / Giải trình',
      dataIndex: 'reason',
      key: 'reason',
      render: (v: string, r: PromoteScheduleItem) => (
        <span style={{ fontSize: 12, color: r.action === 'REMOVE' ? '#B91C1C' : '#15803D' }}>{v}</span>
      ),
    },
  ];

  return (
    <Modal
      width={780} open={open} forceRender destroyOnHidden centered
      title={<Space><UserSwitchOutlined style={{ color: '#2563EB' }} /><span>Duyệt chuyển Nhân viên chính thức & Sắp xếp lịch</span></Space>}
      onCancel={onClose}
      footer={[
        <Button key="cancel" icon={<CloseOutlined />} onClick={onClose}>Hủy bỏ</Button>,
        <Button key="submit" type="primary" icon={<CheckCircleOutlined />} loading={promoteMut.isPending} onClick={() => form.submit()} style={{ background: '#2563EB' }}>
          Xác nhận chuyển chính thức & Cập nhật lịch
        </Button>,
      ]}
    >
      <Spin spinning={previewQ.isFetching}>
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message={`${employee?.fullName} (${employee?.employeeCode}) · ${employee?.branchName ?? 'Chi nhánh'}`}
          description="Hệ thống tự động rà soát lịch tuần: Thu hồi các ca thử việc cũ sau ngày chính thức để tránh trùng định biên (tô đỏ) và gợi ý bổ sung các ca chính thức theo định biên còn trống (tô xanh). Tuyệt đối không xếp ca trong quá khứ."
        />

        <Form form={form} layout="vertical" onFinish={(v) => promoteMut.mutate(v)}>
          <Form.Item name="official_from" label="Ngày hiệu lực Chính thức" rules={[{ required: true, message: 'Vui lòng chọn ngày hiệu lực' }]}>
            <DateStringPicker />
          </Form.Item>
          <Form.Item name="evaluation_summary" label="Nhận xét đánh giá của HR & Tiêu chí chuyển chính thức" rules={[{ required: true, message: 'Vui lòng nhập nhận xét đánh giá' }]}>
            <Input.TextArea rows={2} placeholder="Nhập tóm tắt đánh giá nghiệp vụ, tác phong và nội quy cửa hàng..." />
          </Form.Item>
        </Form>

        <Typography.Title level={5} style={{ margin: '8px 0' }}>
          Xem trước thay đổi Lịch làm việc trong tuần ({preview?.allPreviewItems?.length ?? 0} ca)
        </Typography.Title>

        <Table
          size="small" pagination={false} rowKey={(r) => `${r.action}_${r.workDate}_${r.shiftCode}`}
          columns={columns} dataSource={preview?.allPreviewItems ?? []}
          rowClassName={(r) => (r.action === 'REMOVE' ? 'ant-table-row-error' : 'ant-table-row-success')}
          locale={{ emptyText: 'Không có ca thử việc cũ cần thu hồi và không có ca chính thức trống định biên trong tuần' }}
        />
      </Spin>
    </Modal>
  );
}
