'use client';

import { App, Button, Card, Form, Popconfirm, Select, Space, Tabs, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, SyncOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { StatusTag } from '@/ui/StatusTag';
import { useClientPagination } from '../hooks/useClientPagination';
import { SelectableTable } from './BulkActionBar';
import { RowActionButtons } from './RowActionButtons';
import { ShiftTemplateModals } from './ShiftTemplateModals';

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

/** Danh mục Mẫu Ca Làm Việc & Định Biên Nhân Sự Theo Ca (Chuẩn vận hành 1 nhân sự / ca). */
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
  const rulesPag = useClientPagination(12, 'định biên');

  const branchesQuery = useQuery({ queryKey: ['branches', 'select'], queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=100') });
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
    mutationFn: async (items: ShiftTemplateItem[]) => { for (const s of items) await api.delete(`/admin/shift-templates/${s.id}`, { version: s.version }); },
    onSuccess: () => { message.success('Đã xóa mẫu ca làm việc'); qc.invalidateQueries({ queryKey: ['shift-templates'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa mẫu ca thất bại'),
  });

  const saveRule = useMutation({
    mutationFn: (v: Record<string, unknown>) => editingRule ? api.put(`/admin/staffing-rules/${editingRule.id}`, { ...v, version: editingRule.version }) : api.post('/admin/staffing-rules', v),
    onSuccess: () => { message.success(editingRule ? 'Đã cập nhật định biên nhân sự theo ca' : 'Đã thêm quy tắc định biên nhân sự theo ca'); setRuleModalOpen(false); setEditingRule(null); qc.invalidateQueries({ queryKey: ['staffing-rules'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Lưu định biên thất bại'),
  });

  const deleteRule = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await api.delete(`/admin/staffing-rules/${id}`, {}); },
    onSuccess: () => { message.success('Đã xóa định biên ca làm'); qc.invalidateQueries({ queryKey: ['staffing-rules'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa định biên thất bại'),
  });

  const normalizeSingleMut = useMutation({
    mutationFn: () => api.post<{ updatedRules: number; createdRules: number; rebalancedEmployees: number; trimmedFutureShifts: number }>('/admin/staffing-rules/normalize-single', {}),
    onSuccess: (res) => {
      message.success(`Đã chuẩn hóa 1 người/ca (cập nhật ${res.updatedRules}, tạo mới ${res.createdRules}), cân bằng ca mặc định cho ${res.rebalancedEmployees} nhân sự và gỡ ${res.trimmedFutureShifts} ca tương lai xếp trùng.`);
      ['staffing-rules', 'employees', 'schedules', 'schedule-planner-week', 'schedule-planner-probation'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Chuẩn hóa định biên 1 người/ca thất bại'),
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
    <SelectableTable<ShiftTemplateItem>
      size="small" rowKey="id" scroll={{ x: 880 }} pagination={shiftsPag} loading={shiftsQuery.isLoading} dataSource={filteredShifts}
      bulkActions={[
        { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportToExcel({ fileName: 'Danh_muc_khung_ca.xls', sheetTitle: 'Danh mục Mẫu Ca Làm Việc', rows, columns: [{ header: 'Mã ca', key: 'code' }, { header: 'Tên ca', key: 'name' }, { header: 'Chi nhánh', key: 'branchName' }, { header: 'Giờ bắt đầu', key: 'startTime' }, { header: 'Giờ kết thúc', key: 'endTime' }, { header: 'Giờ chuẩn', key: 'standardHours', align: 'right' }, { header: 'Trạng thái', key: 'statusLabel' }] }) },
        ...(canConfig ? [{ key: 'delete', label: 'Xóa mẫu ca đã chọn', danger: true, icon: <DeleteOutlined />, loading: deleteShift.isPending, confirm: 'Xác nhận xóa các mẫu ca đã chọn?', onClick: (rows: ShiftTemplateItem[]) => deleteShift.mutate(rows) }] : []),
      ]}
      columns={[
        { title: 'Tên ca làm việc', dataIndex: 'name', width: 170, render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
        { title: 'Chi nhánh áp dụng', dataIndex: 'branchName', width: 210, render: (v: string, r) => <Tag color={!r.branchId || r.branchId === 'ALL' ? 'default' : 'blue'}>{v || 'Tất cả chi nhánh'}</Tag> },
        { title: 'Khung giờ ca', key: 'hours', width: 145, render: (_, r) => <span className="num">{r.startTime} – {r.endTime}</span> },
        { title: 'Số giờ công chuẩn', dataIndex: 'standardHours', width: 150, align: 'right', render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{v} giờ</span> },
        { title: 'Ngày hiệu lực', dataIndex: 'effectiveFrom', width: 125 },
        { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (v: string) => <StatusTag value={v} /> },
        {
          title: 'Thao tác', key: 'actions', width: 88, fixed: 'right', align: 'right',
          render: (_, s) => (
            <RowActionButtons
              detailTooltip="Xem chi tiết mẫu ca" onViewDetail={() => setViewingShift(s)} loading={deleteShift.isPending}
              menuItems={canConfig ? [
                { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa mẫu ca', onClick: () => openEditShift(s) },
                { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa mẫu ca', onClick: () => modal.confirm({ title: `Xác nhận xóa mẫu ca "${s.name}"?`, okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => deleteShift.mutateAsync([s]) }) },
              ] : []}
            />
          ),
        },
      ]}
    />
  );

  const rulesPane = (
    <SelectableTable<StaffingRuleItem>
      size="small" rowKey="id" scroll={{ x: 1020 }} pagination={rulesPag} loading={rulesQuery.isLoading} dataSource={filteredRules}
      bulkActions={[
        { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportToExcel({ fileName: 'Dinh_bien_nhan_su_ca.xls', sheetTitle: 'Định Biên Nhân Sự Theo Ca', rows, columns: [{ header: 'Chi nhánh', key: 'branchName' }, { header: 'Khung ca', key: 'shiftName' }, { header: 'Tối thiểu', key: 'min_staff', align: 'right' }, { header: 'Tối đa', key: 'max_staff', align: 'right' }, { header: 'Kiểm soát', key: 'enforcement' }, { header: 'Ghi chú', key: 'note' }] }) },
        ...(canConfig ? [{ key: 'delete', label: 'Xóa định biên đã chọn', danger: true, icon: <DeleteOutlined />, loading: deleteRule.isPending, confirm: 'Xác nhận xóa các định biên đã chọn?', onClick: (rows: StaffingRuleItem[]) => deleteRule.mutate(rows.map((r) => String(r.id))) }] : []),
      ]}
      columns={[
        { title: 'Chi nhánh áp dụng', dataIndex: 'branchName', width: 225, render: (v: string, r) => <Tag color={r.branchId === 'ALL' ? 'default' : 'blue'}><strong>{v}</strong></Tag> },
        { title: 'Khung ca áp dụng', dataIndex: 'shiftName', width: 190, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
        {
          title: 'Định biên Tối thiểu – Tối đa', width: 185,
          render: (_, r) => <span className="num"><strong>{String(r.min_staff)}</strong> – <strong>{String(r.max_staff)}</strong> nhân sự/ca</span>,
        },
        { title: 'Chế độ kiểm soát', dataIndex: 'enforcement', width: 205, render: (v: string) => <Tag color={v === 'HARD_BLOCK' ? 'red' : 'orange'}>{v === 'HARD_BLOCK' ? 'Chặn cứng khi thiếu / vượt' : 'Cảnh báo mềm khi thiếu người'}</Tag> },
        { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
        { title: 'Thao tác', width: 76, fixed: 'right', align: 'right', render: (_, r) => canConfig ? <RowActionButtons menuItems={[{ key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa định biên', onClick: () => openEditRule(r) }, { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa định biên ca', onClick: () => modal.confirm({ title: `Xóa định biên của "${r.branchName}" (${r.shiftName})?`, okText: 'Xóa định biên', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => deleteRule.mutateAsync([String(r.id)]) }) }]} /> : null },
      ]}
    />
  );

  return (
    <>
      <Card
        size="small" style={{ marginTop: 16 }} title="Mẫu ca & Định biên nhân sự"
        extra={
          <Space wrap>
            <Select size="small" style={{ width: 210 }} value={branchFilter} onChange={setBranchFilter} options={[{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))]} />
            {canConfig && (
              <>
                <Popconfirm
                  title="Chuẩn hóa 1 người/ca & cân bằng ca mặc định"
                  description={<div style={{ maxWidth: 360 }}>Hệ thống sẽ đặt toàn bộ định biên ca về đúng 1 – 1 nhân sự/ca (chặn cứng), phân bổ đều ca mặc định của nhân sự theo chi nhánh và gỡ các ca tương lai đang xếp trùng trên 1 người/ca.</div>}
                  okText="Chuẩn hóa ngay" cancelText="Hủy bỏ" okButtonProps={{ icon: <CheckCircleOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
                  onConfirm={() => normalizeSingleMut.mutate()}
                >
                  <Button size="small" icon={<SyncOutlined />} loading={normalizeSingleMut.isPending}>Chuẩn hóa 1 người/ca</Button>
                </Popconfirm>
                <Button size="small" icon={<PlusOutlined />} onClick={() => { setEditingRule(null); ruleForm.resetFields(); ruleForm.setFieldsValue({ branch_id: branchFilter, shift_template_id: 'ALL', min_staff: 1, max_staff: 1, enforcement: 'HARD_BLOCK', note: 'Định biên chuẩn: 1 nhân sự / ca (không nhiều hơn, không ít hơn)' }); setRuleModalOpen(true); }}>Thêm định biên</Button>
                <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => { setEditingShift(null); shiftForm.resetFields(); shiftForm.setFieldsValue({ branch_id: branchFilter, start_time: '07:00', end_time: '12:00', standard_hours: 5, status: 'ACTIVE' }); setShiftModalOpen(true); }}>Thêm mẫu ca</Button>
              </>
            )}
          </Space>
        }
      >
        <Tabs items={[
          { key: 'shifts', label: `Mẫu ca chuẩn (${filteredShifts.length})`, children: shiftPane },
          { key: 'rules', label: `Định biên theo ca (${filteredRules.length})`, children: rulesPane },
        ]} />
      </Card>

      <ShiftTemplateModals
        canConfig={canConfig} branches={branches} shifts={shiftsQuery.data ?? []}
        viewingShift={viewingShift} onCloseViewShift={() => setViewingShift(null)} onEditFromView={openEditShift}
        shiftModalOpen={shiftModalOpen} editingShift={editingShift} shiftForm={shiftForm} savingShift={saveShift.isPending}
        onCloseShiftModal={() => { setShiftModalOpen(false); setEditingShift(null); }} onSaveShift={(v) => saveShift.mutate(v)}
        ruleModalOpen={ruleModalOpen} editingRule={editingRule} ruleForm={ruleForm} savingRule={saveRule.isPending}
        onCloseRuleModal={() => { setRuleModalOpen(false); setEditingRule(null); }} onSaveRule={(v) => saveRule.mutate(v)}
      />
    </>
  );
}
