'use client';

import { App, Button, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Tabs } from 'antd';
import {
  CloseOutlined,
  EnvironmentOutlined,
  PlusOutlined,
  SaveOutlined,
  ShopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BRANCH_STATUS_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { generateBranchCode } from '@/lib/auto-generate';
import { getAccurateDeviceLocation, saveDeviceGpsAnchor } from '@/lib/geolocation';
import { DateStringPicker, TimeSelect } from './DateTimePickers';

export interface BranchRowItem {
  id: string; code: string; name: string; address: string; lat: number; lng: number;
  radiusM: number; maxAccuracyM: number; timezone: string; openTime: string; closeTime: string;
  phoneContact: string; effectiveFrom: string; status: 'ACTIVE' | 'INACTIVE'; statusLabel: string;
  employeeCount: number; note: string; version: number; created_at: string; updated_at: string;
}

interface BranchFormValues {
  code: string; name: string; address: string; lat: number; lng: number; radius_m: number; max_accuracy_m: number;
  open_time: string; close_time: string; phone_contact: string; effective_from: string; status: 'ACTIVE' | 'INACTIVE'; note?: string;
}

export function BranchFormModal({
  open, editing, existingCodes = [], onClose,
}: { open: boolean; editing: BranchRowItem | null; existingCodes?: string[]; onClose: () => void }) {
  const [form] = Form.useForm<BranchFormValues>();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('info');
  const [locatingGps, setLocatingGps] = useState(false);

  const handleUseDeviceGps = async () => {
    setLocatingGps(true);
    try {
      const curLat = Number(form.getFieldValue('lat') || editing?.lat || 0);
      const curLng = Number(form.getFieldValue('lng') || editing?.lng || 0);
      const isDefaultHcm = Math.abs(curLat - 10.7769) < 0.001 && Math.abs(curLng - 106.7009) < 0.001;
      const pos = await getAccurateDeviceLocation({
        pinAnchor: true,
        targetBranch: !isDefaultHcm && curLat && curLng ? { lat: curLat, lng: curLng, radiusM: Number(form.getFieldValue('radius_m') || 100) } : undefined,
      });
      form.setFieldsValue({ lat: pos.lat, lng: pos.lng });
      message.success(`Đã lấy vị trí hiện tại: (${pos.lat}, ${pos.lng})`);
    } catch {
      message.error('Không lấy được vị trí hiện tại. Vui lòng bật quyền Vị trí (GPS) trên trình duyệt.');
    } finally {
      setLocatingGps(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setActiveTab('info');
    if (editing) {
      form.setFieldsValue({
        code: editing.code,
        name: editing.name,
        address: editing.address,
        lat: editing.lat,
        lng: editing.lng,
        radius_m: editing.radiusM,
        max_accuracy_m: editing.maxAccuracyM,
        open_time: editing.openTime,
        close_time: editing.closeTime,
        phone_contact: editing.phoneContact,
        effective_from: editing.effectiveFrom,
        status: editing.status,
        note: editing.note ?? '',
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ code: generateBranchCode(existingCodes) });
    }
  }, [open, editing, existingCodes, form]);

  const mutation = useMutation({
    mutationFn: (values: BranchFormValues) =>
      editing
        ? api.put(`/admin/branches/${editing.id}`, { ...values, version: editing.version })
        : api.post('/admin/branches', values),
    onSuccess: (_res, values) => {
      saveDeviceGpsAnchor(Number(values.lat), Number(values.lng), 15, true);
      message.success(editing ? 'Đã cập nhật cấu hình chi nhánh & tọa độ GPS' : 'Đã thêm chi nhánh mới');
      ['branches', 'my-attendance', 'schedules', 'nv-schedules'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        if (err.details.length > 0) {
          form.setFields(err.details.map((d) => ({ name: d.field as keyof BranchFormValues, errors: [d.message] })));
        }
        message.error(err.message);
      } else {
        message.error('Lưu cấu hình chi nhánh thất bại');
      }
    },
  });

  const handleGenCode = () => {
    form.setFieldsValue({ code: generateBranchCode(existingCodes, form.getFieldValue('code')) });
  };

  return (
    <Modal
      title={editing ? `Cấu hình Chi nhánh & Tọa độ GPS: ${editing.name}` : 'Thêm Chi nhánh mới'}
      open={open}
      onOk={async () => mutation.mutate(await form.validateFields())}
      onCancel={onClose}
      okText={editing ? 'Lưu cập nhật' : 'Tạo chi nhánh'}
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: editing ? <SaveOutlined /> : <PlusOutlined /> }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      confirmLoading={mutation.isPending}
      width="70vw"
      forceRender
    >
      <Form<BranchFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          lat: 10.7769,
          lng: 106.7009,
          radius_m: 100,
          max_accuracy_m: 50,
          open_time: '07:00',
          close_time: '22:30',
          phone_contact: '0901000000',
          effective_from: '2026-01-01',
          status: 'ACTIVE',
        }}
        style={{ marginTop: 8 }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'info',
              forceRender: true,
              label: <span><ShopOutlined /> Thông tin Chi nhánh &amp; Giờ mở cửa</span>,
              children: (
                <>
                  <Row gutter={12}>
                    <Col span={10}>
                      <Form.Item label="Mã chi nhánh" required>
                        <Space.Compact style={{ width: '100%' }}>
                          <Form.Item name="code" noStyle rules={[{ required: true, message: 'Nhập mã chi nhánh' }]}>
                            <Input placeholder="Ví dụ: CN05" disabled={!!editing} />
                          </Form.Item>
                          {!editing && <Button icon={<ThunderboltOutlined />} onClick={handleGenCode}>Tự sinh</Button>}
                        </Space.Compact>
                      </Form.Item>
                    </Col>
                    <Col span={14}>
                      <Form.Item name="name" label="Tên chi nhánh" rules={[{ required: true, message: 'Nhập tên chi nhánh' }]}>
                        <Input placeholder="Ví dụ: Ụm Bò Milk Chi nhánh 5" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col span={16}><Form.Item name="address" label="Địa chỉ cửa hàng"><Input placeholder="Số nhà, đường, quận/huyện, TP. Hồ Chí Minh" /></Form.Item></Col>
                    <Col span={8}><Form.Item name="phone_contact" label="SĐT liên hệ cửa hàng"><Input placeholder="0901000000" /></Form.Item></Col>
                  </Row>
                  <Row gutter={12}>
                    <Col span={6}><Form.Item name="open_time" label="Giờ mở cửa"><TimeSelect /></Form.Item></Col>
                    <Col span={6}><Form.Item name="close_time" label="Giờ đóng cửa"><TimeSelect /></Form.Item></Col>
                    <Col span={6}><Form.Item name="effective_from" label="Ngày hiệu lực"><DateStringPicker /></Form.Item></Col>
                    <Col span={6}><Form.Item name="status" label="Trạng thái"><Select options={BRANCH_STATUS_OPTIONS} /></Form.Item></Col>
                  </Row>
                  <Form.Item name="note" label="Ghi chú vận hành chi nhánh"><Input placeholder="Ghi chú vận hành, định biên hoặc đặc thù cửa hàng" /></Form.Item>
                </>
              ),
            },
            {
              key: 'gps',
              forceRender: true,
              label: <span><EnvironmentOutlined /> Tọa độ GPS &amp; Bán kính Điểm danh</span>,
              children: (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ fontSize: 12, color: '#64748B' }}>Nhập tọa độ cửa hàng hoặc lấy trực tiếp tọa độ GPS từ trình duyệt đang sử dụng:</span>
                    <Space size={6} wrap>
                      <Button size="small" icon={<EnvironmentOutlined />} onClick={() => window.open(`https://www.google.com/maps?q=${form.getFieldValue('lat') || 10.7769},${form.getFieldValue('lng') || 106.7009}`, '_blank', 'noopener,noreferrer')}>Xem trên Google Maps</Button>
                      <Button size="small" type="primary" ghost icon={<EnvironmentOutlined />} loading={locatingGps} onClick={() => void handleUseDeviceGps()}>Lấy vị trí hiện tại</Button>
                    </Space>
                  </div>
                  <Row gutter={12}>
                    <Col span={6}><Form.Item name="lat" label="Vĩ độ GPS (Lat)" rules={[{ required: true }]}><InputNumber step={0.00001} style={{ width: '100%' }} /></Form.Item></Col>
                    <Col span={6}><Form.Item name="lng" label="Kinh độ GPS (Lng)" rules={[{ required: true }]}><InputNumber step={0.00001} style={{ width: '100%' }} /></Form.Item></Col>
                    <Col span={6}><Form.Item name="radius_m" label="Bán kính GPS (m)" rules={[{ required: true }]}><InputNumber min={10} max={2000} style={{ width: '100%' }} /></Form.Item></Col>
                    <Col span={6}><Form.Item name="max_accuracy_m" label="Sai số tối đa (m)"><InputNumber min={5} max={500} style={{ width: '100%' }} /></Form.Item></Col>
                  </Row>
                </>
              ),
            },
          ]}
        />
      </Form>
    </Modal>
  );
}
