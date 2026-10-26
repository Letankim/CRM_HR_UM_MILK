'use client';

import { App, Button, Card, Col, Descriptions, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { CloseOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { generateShiftCode } from '@/lib/auto-generate';
import { StatusTag } from '@/ui/StatusTag';
import { useClientPagination } from '../hooks/useClientPagination';
import { DateStringPicker, TimeSelect } from './DateTimePickers';
import { RowActionButtons } from './RowActionButtons';

export interface ShiftTemplateItem {
  id: string; code: string; name: string; startTime: string; endTime: string; standardHours: number;
  breakMinutes?: number; effectiveFrom: string; branchId?: string; branchCode?: string; branchName?: string;
  status: string; statusLabel: string; note?: string; version: number;
}
export interface StaffingRuleItem {
  id: string; branch_id: string; branchId: string; branchCode: string; branchName: string;
  shift_template_id: string; shiftName: string; shiftTimeRange?: string;
  min_staff: number; max_staff: number; enforcement: string; note?: string; version: number;
}

/** Danh mục Mẫu Ca Làm Việc & Định Biên Nhân Sự Theo Ca (Cấu hình theo từng chi nhánh). */
export function ShiftTemplatesCard({ canConfig }: { canConfig: boolean }) {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<ShiftTemplateItem | null>(null);
  const [editingRule, setEditingRule] = useState<StaffingRuleItem | null>(null);
  const [viewingShift, setViewingShift] = useState<ShiftTemplateItem | null>(null);
  const [shiftForm] = Form.useForm();
  const [ruleForm] = Form.useForm();
  const shiftsPag = useClientPagination(10, 'khung ca');
  const rulesPag = useClientPagination(10, 'định biên');

  const branchesQuery = useQuery({ queryKey: ['branches', 'select'], queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=50') });
  const shiftsQuery = useQuery({ queryKey: ['shift-templates'], queryFn: () => api.get<ShiftTemplateItem[]>('/admin/shift-templates') });
  const rulesQuery = useQuery({ queryKey: ['staffing-rules'], queryFn: () => api.get<StaffingRuleItem[]>('/admin/staffing-rules') });
  const branches = branchesQuery.data?.data ?? [];

  const filteredShifts = useMemo(() => (shiftsQuery.data ?? []).filter((s) => branchFilter === 'ALL' || (s.branchId ?? 'ALL') === branchFilter || (s.branchId ?? 'ALL') === 'ALL'), [shiftsQuery.data, branchFilter]);
  const filteredRules = useMemo(() => (rulesQuery.data ?? []).filter((r) => branchFilter === 'ALL' || (r.branchId ?? r.branch_id) === branchFilter || (r.branchId ?? r.branch_id) === 'ALL'), [rulesQuery.data, branchFilter]);

  const saveShift = useMutation({
    mutationFn: (values: Record<string, unknown>) => editingShift ? api.put(`/admin/shift-templates/${editingShift.id}`, { ...values, version: editingShift.version }) : api.post('/admin/shift-templates', values),
    onSuccess: () => { message.success(editingShift ? 'Đã cập nhật mẫu ca làm việc' : 'Đã thêm mẫu ca làm việc mới'); setShiftModalOpen(false); setEditingShift(null); qc.invalidateQueries({ queryKey: ['shift-templates'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Lưu mẫu ca thất bại'),
  });

  const deleteShift = useMutation({
    mutationFn: (s: ShiftTemplateItem) => api.delete(`/admin/shift-templates/${s.id}`, { version: s.version }),
    onSuccess: () => { message.success('Đã xóa mẫu ca làm việc'); qc.invalidateQueries({ queryKey: ['shift-templates'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa mẫu ca thất bại'),
  });

  const saveRule = useMutation({
    mutationFn: (v: Record<string, unknown>) => editingRule ? api.put(`/admin/staffing-rules/${editingRule.id}`, { ...v, version: editingRule.version }) : api.post('/admin/staffing-rules', v),
    onSuccess: () => { message.success(editingRule ? 'Đã cập nhật định biên nhân sự theo ca' : 'Đã thêm quy tắc định biên nhân sự theo ca'); setRuleModalOpen(false); setEditingRule(null); qc.invalidateQueries({ queryKey: ['staffing-rules'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Lưu định biên thất bại'),
  });

  const deleteRule = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/staffing-rules/${id}`, {}),
    onSuccess: () => { message.success('Đã xóa định biên ca làm'); qc.invalidateQueries({ queryKey: ['staffing-rules'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa định biên thất bại'),
  });

  const openEditShift = (s: ShiftTemplateItem) => {
    setEditingShift(s);
    shiftForm.setFieldsValue({ code: s.code, name: s.name, branch_id: s.branchId ?? 'ALL', start_time: s.startTime, end_time: s.endTime, standard_hours: s.standardHours, break_minutes: s.breakMinutes ?? 0, effective_from: s.effectiveFrom, status: s.status, note: s.note ?? '' });
    setShiftModalOpen(true);
  };

  const openEditRule = (r: StaffingRuleItem) => {
    setEditingRule(r);
    ruleForm.setFieldsValue({ branch_id: r.branchId ?? r.branch_id ?? 'ALL', shift_template_id: r.shift_template_id, min_staff: r.min_staff, max_staff: r.max_staff, enforcement: r.enforcement, note: r.note ?? '' });
    setRuleModalOpen(true);
  };

  const shiftPane = (
    <Table<ShiftTemplateItem>
      size="small" rowKey="id" pagination={shiftsPag} loading={shiftsQuery.isLoading} dataSource={filteredShifts}
      columns={[
        { title: 'Tên ca làm việc', dataIndex: 'name', render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
        { title: 'Chi nhánh áp dụng', dataIndex: 'branchName', render: (v: string, r) => <Tag color={!r.branchId || r.branchId === 'ALL' ? 'default' : 'blue'}>{v || 'Tất cả chi nhánh'}</Tag> },
        { title: 'Khung giờ ca', key: 'hours', render: (_, r) => <span className="num">{r.startTime} – {r.endTime}</span> },
        { title: 'Số giờ công chuẩn', dataIndex: 'standardHours', align: 'right', render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{v} giờ</span> },
        { title: 'Ngày hiệu lực', dataIndex: 'effectiveFrom', width: 120 },
        { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (v: string) => <StatusTag value={v} /> },
        {
          title: 'Thao tác', key: 'actions', width: 88, fixed: 'right', align: 'right',
          render: (_, s) => (
            <RowActionButtons
              detailTooltip="Xem chi tiết mẫu ca" onViewDetail={() => setViewingShift(s)}
              loading={deleteShift.isPending && deleteShift.variables?.id === s.id}
              menuItems={canConfig ? [
                { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa mẫu ca', onClick: () => openEditShift(s) },
                { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa mẫu ca', onClick: () => modal.confirm({ title: `Xác nhận xóa mẫu ca "${s.name}"?`, okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true }, onOk: () => deleteShift.mutateAsync(s) }) },
              ] : []}
            />
          ),
        },
      ]}
    />
  );

  const rulesPane = (
    <Table<StaffingRuleItem>
      size="small" rowKey="id" pagination={rulesPag} loading={rulesQuery.isLoading} dataSource={filteredRules}
      columns={[
        { title: 'Chi nhánh áp dụng', dataIndex: 'branchName', render: (v: string, r) => <Tag color={r.branchId === 'ALL' ? 'default' : 'blue'}><strong>{v}</strong></Tag> },
        { title: 'Khung ca áp dụng', dataIndex: 'shiftName', render: (v: string) => <Tag color="geekblue">{v}</Tag> },
        { title: 'Định biên Tối thiểu – Tối đa', render: (_, r) => <span className="num"><strong>{String(r.min_staff)}</strong> – <strong>{String(r.max_staff)}</strong> nhân sự/ca</span> },
        { title: 'Chế độ kiểm soát', dataIndex: 'enforcement', render: (v: string) => <Tag color={v === 'HARD_BLOCK' ? 'red' : 'orange'}>{v === 'HARD_BLOCK' ? 'Chặn cứng khi thiếu định biên' : 'Cảnh báo mềm khi thiếu người'}</Tag> },
        { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
        { title: 'Thao tác', width: 100, align: 'right', render: (_, r) => canConfig ? <Space size={4}><Button size="small" icon={<EditOutlined />} onClick={() => openEditRule(r)} /><Button size="small" danger icon={<DeleteOutlined />} onClick={() => modal.confirm({ title: `Xóa định biên của "${r.branchName}" (${r.shiftName})?`, okText: 'Xóa định biên', cancelText: 'Hủy bỏ', okButtonProps: { danger: true }, onOk: () => deleteRule.mutateAsync(String(r.id)) })} /></Space> : null },
      ]}
    />
  );

  return (
    <>
      <Card
        size="small" style={{ marginTop: 16 }} title="Danh mục Mẫu Ca Làm Việc & Định Biên Nhân Sự Theo Ca (Theo Chi Nhánh)"
        extra={
          <Space wrap>
            <Select size="small" style={{ width: 240 }} value={branchFilter} onChange={setBranchFilter} options={[{ value: 'ALL', label: 'Lọc: Tất cả chi nhánh' }, ...branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))]} />
            {canConfig && (
              <>
                <Button size="small" icon={<PlusOutlined />} onClick={() => { setEditingRule(null); ruleForm.resetFields(); ruleForm.setFieldsValue({ branch_id: branchFilter, shift_template_id: 'ALL', min_staff: 2, max_staff: 6, enforcement: 'HARD_BLOCK' }); setRuleModalOpen(true); }}>Thêm định biên ca</Button>
                <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => { setEditingShift(null); shiftForm.resetFields(); shiftForm.setFieldsValue({ branch_id: branchFilter, start_time: '07:00', end_time: '12:00', standard_hours: 5, status: 'ACTIVE' }); setShiftModalOpen(true); }}>Thêm mẫu ca</Button>
              </>
            )}
          </Space>
        }
      >
        <Tabs items={[
          { key: 'shifts', label: `Mẫu Ca Làm Việc Chuẩn (${filteredShifts.length})`, children: shiftPane },
          { key: 'rules', label: `Định Biên Nhân Sự Theo Ca (${filteredRules.length})`, children: rulesPane },
        ]} />
      </Card>

      <Modal title={viewingShift ? `Chi tiết Mẫu Ca — ${viewingShift.name}` : 'Chi tiết mẫu ca'} open={!!viewingShift} onCancel={() => setViewingShift(null)} width={600} destroyOnHidden footer={<Space>{viewingShift && canConfig && <Button type="primary" icon={<EditOutlined />} onClick={() => { const cur = viewingShift; setViewingShift(null); openEditShift(cur); }}>Chỉnh sửa mẫu ca</Button>}<Button icon={<CloseOutlined />} onClick={() => setViewingShift(null)}>Đóng</Button></Space>}>
        {viewingShift && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Tên ca làm việc"><strong>{viewingShift.name}</strong></Descriptions.Item>
            <Descriptions.Item label="Chi nhánh áp dụng"><Tag color={!viewingShift.branchId || viewingShift.branchId === 'ALL' ? 'default' : 'blue'}>{viewingShift.branchName || 'Tất cả chi nhánh'}</Tag></Descriptions.Item>
            <Descriptions.Item label="Khung giờ làm việc"><span className="num">{viewingShift.startTime} – {viewingShift.endTime}</span></Descriptions.Item>
            <Descriptions.Item label="Số giờ công chuẩn"><span className="num" style={{ fontWeight: 700 }}>{viewingShift.standardHours} giờ (Nghỉ giữa ca: {viewingShift.breakMinutes ?? 0} phút)</span></Descriptions.Item>
            <Descriptions.Item label="Ngày bắt đầu hiệu lực"><span className="num">{viewingShift.effectiveFrom}</span></Descriptions.Item>
            <Descriptions.Item label="Trạng thái"><StatusTag value={viewingShift.status} /></Descriptions.Item>
            <Descriptions.Item label="Ghi chú">{viewingShift.note || '—'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Modal width={720} title={editingShift ? `Sửa Mẫu Ca — ${editingShift.name}` : 'Thêm Mẫu Ca Làm Việc Mới'} open={shiftModalOpen} onOk={async () => saveShift.mutate(await shiftForm.validateFields())} onCancel={() => { setShiftModalOpen(false); setEditingShift(null); }} okText={editingShift ? 'Lưu cập nhật' : 'Thêm mẫu ca'} cancelText="Hủy bỏ" okButtonProps={{ icon: editingShift ? <SaveOutlined /> : <PlusOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} confirmLoading={saveShift.isPending} forceRender>
        <Form form={shiftForm} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={12}>
            <Col xs={24} md={8}><Form.Item name="branch_id" label="Chi nhánh áp dụng" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={[{ value: 'ALL', label: 'Tất cả chi nhánh (Dùng chung)' }, ...branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))]} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name="name" label="Tên ca hiển thị" rules={[{ required: true }]}><Input placeholder="Ví dụ: Ca sáng" /></Form.Item></Col>
            <Col xs={24} md={8}>
              <Form.Item name="code" label="Mã định danh ca" rules={[{ required: true, message: 'Nhập mã định danh ca' }]}>
                <Input disabled={!!editingShift} placeholder="Ví dụ: CA_LINH_HOAT" suffix={!editingShift ? <span style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#2563EB' }} onClick={() => shiftForm.setFieldsValue({ code: generateShiftCode(shiftForm.getFieldValue('name'), shiftForm.getFieldValue('code')) })}><ThunderboltOutlined /> Tự sinh</span> : undefined} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col xs={12} md={6}><Form.Item name="start_time" label="Giờ bắt đầu" rules={[{ required: true }]}><TimeSelect /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name="end_time" label="Giờ kết thúc" rules={[{ required: true }]}><TimeSelect /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name="standard_hours" label="Giờ công chuẩn" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={0.5} max={24} step={0.5} suffix="giờ" /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name="break_minutes" label="Nghỉ giữa ca (phút)"><InputNumber style={{ width: '100%' }} min={0} max={180} suffix="phút" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} md={8}><Form.Item name="effective_from" label="Ngày hiệu lực"><DateStringPicker /></Form.Item></Col>
            <Col xs={24} md={16}><Form.Item name="note" label="Ghi chú ca làm việc"><Input placeholder="Ghi chú đặc thù ca làm việc..." /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      <Modal width={720} title={editingRule ? 'Chỉnh sửa Định biên Nhân sự Theo Ca' : 'Thiết lập Định biên Nhân sự Theo Ca'} open={ruleModalOpen} onOk={async () => saveRule.mutate(await ruleForm.validateFields())} onCancel={() => { setRuleModalOpen(false); setEditingRule(null); }} okText={editingRule ? 'Lưu cập nhật' : 'Lưu định biên'} cancelText="Hủy bỏ" okButtonProps={{ icon: <SaveOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} confirmLoading={saveRule.isPending} forceRender>
        <Form form={ruleForm} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="branch_id" label="Chi nhánh áp dụng" rules={[{ required: true, message: 'Vui lòng chọn chi nhánh áp dụng' }]}>
                <Select showSearch optionFilterProp="label" options={[{ value: 'ALL', label: 'Tất cả chi nhánh (Định biên mặc định chung)' }, ...branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="shift_template_id" label="Khung ca áp dụng" rules={[{ required: true, message: 'Vui lòng chọn khung ca áp dụng' }]}>
                <Select showSearch optionFilterProp="label" options={[{ value: 'ALL', label: 'Mọi khung ca làm việc' }, ...(shiftsQuery.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.startTime} – ${s.endTime})${s.branchId && s.branchId !== 'ALL' ? ` · ${s.branchName}` : ''}` }))]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col xs={12} md={7}><Form.Item name="min_staff" label="Số NS tối thiểu / ca" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={1} max={30} suffix="người" /></Form.Item></Col>
            <Col xs={12} md={7}><Form.Item name="max_staff" label="Số NS tối đa / ca" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={1} max={50} suffix="người" /></Form.Item></Col>
            <Col xs={24} md={10}>
              <Form.Item name="enforcement" label="Chế độ kiểm soát định biên">
                <Select options={[{ value: 'HARD_BLOCK', label: 'Chặn cứng khi thiếu định biên' }, { value: 'SOFT_WARN', label: 'Cảnh báo mềm khi thiếu người' }]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="note" label="Ghi chú vận hành">
            <Input placeholder="VD: Bắt buộc tối thiểu 2 Pha chế/ca khi duyệt đơn OFF hoặc đổi ca tại chi nhánh này" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
