'use client';

import { App, Button, Card, Col, Descriptions, Form, Input, Modal, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { CloseOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { STAFF_GROUP_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { GuardButton, usePermissionGuard } from './GuardButton';
import { RowActionButtons } from './RowActionButtons';

function toPosCode(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
}

export interface JobPositionItem {
  code: string;
  label: string;
  department: string;
  description: string;
  employeeCount?: number;
  isDefault?: boolean;
}

const DEPARTMENT_OPTIONS = [
  { value: 'Cửa hàng (Vận hành)', label: 'Cửa hàng (Vận hành)' },
  { value: 'Cửa hàng (Quản lý ca)', label: 'Cửa hàng (Quản lý ca)' },
  { value: 'Cửa hàng (Quản lý)', label: 'Cửa hàng (Quản lý)' },
  { value: 'Văn phòng (Backoffice)', label: 'Văn phòng (Backoffice)' },
  { value: 'Xưởng & Kho trung tâm', label: 'Xưởng & Kho trung tâm' },
  { value: 'Kinh doanh & Phát triển', label: 'Kinh doanh & Phát triển' },
  { value: 'Truyền thông & Marketing', label: 'Truyền thông & Marketing' },
];

export function useJobPositions() {
  const q = useQuery({
    queryKey: ['job-positions'],
    queryFn: () => api.get<JobPositionItem[]>('/admin/job-positions'),
    staleTime: 30_000,
  });
  const positions = q.data ?? [];
  const options = useMemo(
    () => (positions.length > 0 ? positions.map((p) => ({ value: p.code, label: p.label })) : STAFF_GROUP_OPTIONS),
    [positions],
  );
  return { positions, options, isLoading: q.isLoading, isFetching: q.isFetching };
}

export function JobPositionsTableCard({ canManage = true }: { canManage?: boolean }) {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const { positions, isLoading } = useJobPositions();
  const canEditPos = usePermissionGuard({ perms: ['employee.manage', 'system.config'], roles: ['ADMIN', 'HR'], allowed: canManage });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<JobPositionItem | null>(null);
  const [viewing, setViewing] = useState<JobPositionItem | null>(null);
  const [form] = Form.useForm();

  const refresh = () => {
    ['job-positions', 'employees', 'mkt-comms', 'candidates'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const onErr = (fb: string) => (e: unknown) => message.error(e instanceof ApiClientError ? e.message : fb);

  const saveMut = useMutation({
    mutationFn: (v: Record<string, unknown>) =>
      editing ? api.put(`/admin/job-positions/${editing.code}`, v) : api.post('/admin/job-positions', v),
    onSuccess: () => { message.success(editing ? 'Đã cập nhật vị trí công việc' : 'Đã thêm vị trí công việc mới'); setFormOpen(false); setEditing(null); refresh(); },
    onError: onErr('Lưu vị trí công việc thất bại'),
  });

  const delMut = useMutation({
    mutationFn: (code: string) => api.delete(`/admin/job-positions/${code}`, {}),
    onSuccess: () => { message.success('Đã xóa vị trí công việc'); refresh(); },
    onError: onErr('Xóa vị trí công việc thất bại'),
  });

  const openCreate = () => {
    setEditing(null); form.resetFields();
    form.setFieldsValue({ department: 'Cửa hàng (Vận hành)' });
    setFormOpen(true);
  };

  const openEdit = (r: JobPositionItem) => {
    setEditing(r);
    form.setFieldsValue({ code: r.code, label: r.label, department: r.department || 'Cửa hàng (Vận hành)', description: r.description || '' });
    setFormOpen(true);
  };

  return (
    <>
      <Card
        size="small"
        title="Danh mục Vị trí Công việc & Phân nhóm Nhân sự"
        extra={
          <GuardButton
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            perms={['employee.manage', 'system.config']}
            roles={['ADMIN', 'HR']}
            allowed={canManage}
            onClick={openCreate}
          >
            Thêm vị trí công việc
          </GuardButton>
        }
      >
        <Table<JobPositionItem>
          size="small" rowKey="code" pagination={false} loading={isLoading} dataSource={positions}
          columns={[
            { title: 'Mã vị trí', dataIndex: 'code', width: 160, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
            { title: 'Tên vị trí công việc', dataIndex: 'label', render: (v: string, r) => <Typography.Link strong onClick={() => setViewing(r)}>{v}</Typography.Link> },
            { title: 'Khối / Bộ phận trực thuộc', dataIndex: 'department', width: 240, render: (v: string) => <Tag color="blue">{v || 'Cửa hàng (Vận hành)'}</Tag> },
            { title: 'Nhân sự hiện có', dataIndex: 'employeeCount', width: 160, align: 'right', render: (v: number) => <Tag color={(v ?? 0) > 0 ? 'green' : 'default'}>{v ?? 0} nhân sự</Tag> },
            {
              title: 'Thao tác', width: 105, align: 'right',
              render: (_, r) => (
                <RowActionButtons
                  detailTooltip="Xem chi tiết & mô tả vị trí công việc"
                  onViewDetail={() => setViewing(r)}
                  menuItems={canEditPos ? [
                    { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa vị trí công việc', onClick: () => openEdit(r) },
                    { key: 'del', icon: <DeleteOutlined />, danger: true, label: 'Xóa vị trí công việc', onClick: () => modal.confirm({ title: `Xóa vị trí công việc "${r.label}"?`, okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true }, onOk: () => delMut.mutateAsync(r.code) }) },
                  ] : []}
                />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        width={680} open={Boolean(viewing)} onCancel={() => setViewing(null)} destroyOnHidden
        title={viewing ? `Chi tiết Vị trí Công việc — ${viewing.label}` : 'Chi tiết vị trí công việc'}
        footer={
          <Space>
            {viewing && (
              <GuardButton
                type="primary"
                icon={<EditOutlined />}
                perms={['employee.manage', 'system.config']}
                roles={['ADMIN', 'HR']}
                allowed={canManage}
                onClick={() => { const cur = viewing; setViewing(null); openEdit(cur); }}
              >
                Chỉnh sửa vị trí
              </GuardButton>
            )}
            <Button icon={<CloseOutlined />} onClick={() => setViewing(null)}>Đóng</Button>
          </Space>
        }
      >
        {viewing && (
          <Descriptions column={1} bordered size="small" style={{ marginTop: 8 }}>
            <Descriptions.Item label="Mã định danh vị trí"><Tag color="geekblue">{viewing.code}</Tag></Descriptions.Item>
            <Descriptions.Item label="Tên vị trí công việc"><strong>{viewing.label}</strong></Descriptions.Item>
            <Descriptions.Item label="Khối / Bộ phận trực thuộc"><Tag color="blue">{viewing.department || 'Cửa hàng (Vận hành)'}</Tag></Descriptions.Item>
            <Descriptions.Item label="Số lượng nhân sự hiện có"><Tag color={(viewing.employeeCount ?? 0) > 0 ? 'green' : 'default'}>{viewing.employeeCount ?? 0} nhân sự đang làm việc</Tag></Descriptions.Item>
            <Descriptions.Item label="Mô tả nhiệm vụ công việc">{viewing.description || 'Chưa cập nhật mô tả chi tiết cho vị trí này.'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Modal
        width={680} open={formOpen} forceRender destroyOnHidden
        title={editing ? `Chỉnh sửa Vị trí Công việc — ${editing.label}` : 'Thêm Vị trí Công việc Mới'}
        okText={editing ? 'Lưu cập nhật' : 'Thêm vị trí'} cancelText="Hủy bỏ"
        okButtonProps={{ icon: editing ? <SaveOutlined /> : <PlusOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
        confirmLoading={saveMut.isPending} onCancel={() => setFormOpen(false)} onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)} style={{ marginTop: 12 }}>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="label" label="Tên vị trí công việc hiển thị" rules={[{ required: true, message: 'Nhập tên vị trí công việc' }]}>
                <Input placeholder="VD: Kiểm soát chất lượng (QC), Giao hàng..." onChange={(e) => { if (!editing) form.setFieldValue('code', toPosCode(e.target.value)); }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="code" label="Mã định danh vị trí" rules={[{ required: true, message: 'Nhập mã định danh vị trí' }]}>
                <Input
                  disabled={!!editing} placeholder="VD: QC_STAFF"
                  suffix={!editing ? <span style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#2563EB' }} onClick={() => form.setFieldValue('code', toPosCode(String(form.getFieldValue('label') || 'VI_TRI')) || `POS_${Math.floor(10 + Math.random() * 89)}`)}><ThunderboltOutlined /> Tự sinh</span> : undefined}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="department" label="Khối / Bộ phận trực thuộc">
            <Select options={DEPARTMENT_OPTIONS} />
          </Form.Item>
          <Form.Item name="description" label="Mô tả chức năng / nhiệm vụ của vị trí">
            <Input.TextArea rows={3} placeholder="Mô tả chi tiết trách nhiệm công việc của vị trí này (sẽ hiển thị khi bấm nút Xem chi tiết)..." />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export function JobPositionsManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      width="90vw" style={{ top: 24, maxWidth: 1440 }} open={open} onCancel={onClose} destroyOnHidden
      title="Quản lý & Cấu hình Danh mục Vị trí Công việc"
      footer={<Button type="primary" icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>}
    >
      <JobPositionsTableCard canManage />
    </Modal>
  );
}
