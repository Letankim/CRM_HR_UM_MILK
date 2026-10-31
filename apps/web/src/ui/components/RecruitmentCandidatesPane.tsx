'use client';

import { App, Button, Card, Col, Descriptions, Form, Input, InputNumber, Modal, Row, Select, Space, Tag } from 'antd';
import { CalendarOutlined, CheckCircleOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, MailOutlined, MessageOutlined, PhoneOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import { StatusTag } from '../StatusTag';
import { BaseDetailDrawer } from './BaseDetailDrawer';
import { SelectableTable } from './BulkActionBar';
import { FilterToolbar } from './FilterToolbar';
import { GuardButton, usePermissionGuard } from './GuardButton';
import { useJobPositions } from './JobPositionsManagerModal';
import { MONEY_INPUT_PROPS } from './payroll-types';
import { RowActionButtons } from './RowActionButtons';

const CANDIDATE_STATUS_OPTIONS = [
  { value: 'ALL', label: 'Tất cả giai đoạn' },
  { value: 'NEW', label: 'Mới tiếp nhận' },
  { value: 'CONTACTED', label: 'Đã liên hệ' },
  { value: 'INTERVIEW_SCHEDULED', label: 'Đã xếp lịch phỏng vấn' },
  { value: 'HIRED', label: 'Đạt phỏng vấn / Mời thử việc' },
  { value: 'REJECTED', label: 'Chưa phù hợp' },
];

interface Props {
  branches: { value: string; label: string }[];
  scheduledCandidateIds?: Set<string>;
  onScheduleInterview: (candidateId: string) => void;
}

export function RecruitmentCandidatesPane({ branches, scheduledCandidateIds, onScheduleInterview }: Props) {
  const qc = useQueryClient();
  const canManageRec = usePermissionGuard({ perms: ['candidate.manage'] });
  const canManageIv = usePermissionGuard({ perms: ['interview.manage'] });
  const { message, modal } = App.useApp();
  const { options: jobPositionOptions } = useJobPositions();

  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const [candModal, setCandModal] = useState(false);
  const [editingCand, setEditingCand] = useState<Record<string, unknown> | null>(null);
  const [viewingCand, setViewingCand] = useState<Record<string, unknown> | null>(null);
  const [candForm] = Form.useForm();
  const watchedCandBranchId = Form.useWatch('applied_branch_id', candForm);
  const { options: shiftPrefOptions } = useShiftTemplates(watchedCandBranchId);

  useEffect(() => {
    if (!candModal || shiftPrefOptions.length === 0) return;
    const curShift = candForm.getFieldValue('shift_pref');
    if (!curShift || !shiftPrefOptions.some((o) => o.value === curShift)) {
      candForm.setFieldValue('shift_pref', shiftPrefOptions[0]!.value);
    }
  }, [candModal, watchedCandBranchId, shiftPrefOptions, candForm]);

  const queryParams = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (debouncedQ) queryParams.set('q', debouncedQ);
  if (branchFilter !== 'ALL') queryParams.set('branch_id', branchFilter);
  if (positionFilter !== 'ALL') queryParams.set('staff_group', positionFilter);
  if (statusFilter !== 'ALL') queryParams.set('status', statusFilter);

  const candQ = useQuery({
    queryKey: ['candidates', page, perPage, debouncedQ, branchFilter, positionFilter, statusFilter],
    queryFn: () => api.list<Record<string, unknown>>(`/admin/candidates?${queryParams.toString()}`),
  });

  const refreshAll = () => ['candidates', 'interviews'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const saveMut = useMutation({
    mutationFn: ({ url, method, body }: { url: string; method: 'POST' | 'PUT'; body: unknown }) => (method === 'POST' ? api.post(url, body) : api.put(url, body)),
    onSuccess: () => { message.success('Đã lưu hồ sơ ứng viên thành công'); setCandModal(false); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Lưu hồ sơ ứng viên thất bại'),
  });

  const delMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.delete(url, body),
    onSuccess: () => { message.success('Đã xóa hồ sơ ứng viên'); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa thất bại'),
  });

  const openCreateCand = () => {
    setEditingCand(null);
    candForm.resetFields();
    candForm.setFieldsValue({ applied_position: 'BARISTA', applied_branch_id: branches[0]?.value, shift_pref: 'CA_SANG', expected_salary_vnd: 6500000, birth_year: '2004', gender: 'Nữ' });
    setCandModal(true);
  };

  const openEditCand = (r: Record<string, unknown>) => {
    setEditingCand(r);
    candForm.setFieldsValue({
      full_name: r.full_name, phone: r.phone, email: r.email, applied_branch_id: r.branch_pref,
      applied_position: r.staff_group, shift_pref: r.shift_pref || 'CA_SANG',
      birth_year: r.birth_year || '2004', gender: r.gender || '', experience_note: r.experience_note || '', status: r.status, hr_note: r.hr_note,
    });
    setCandModal(true);
  };

  const rows = candQ.data?.data ?? [];
  const exportCands = (list: Record<string, unknown>[]) => exportToExcel({ fileName: 'Danh_sach_ung_vien.xls', sheetTitle: 'Danh sách Hồ sơ Ứng viên Tuyển dụng', rows: list, columns: [{ header: 'Mã UV', key: 'candidate_code' }, { header: 'Họ và tên', key: 'full_name' }, { header: 'Số điện thoại', key: 'phone' }, { header: 'Email', key: 'email' }, { header: 'Vị trí', key: 'positionLabel' }, { header: 'Chi nhánh nguyện vọng', key: 'branchName' }, { header: 'Ca đăng ký', key: 'shiftPrefLabel' }, { header: 'Giai đoạn', key: 'stage' }, { header: 'Ghi chú HR', key: 'hr_note' }] });

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <FilterToolbar
        searchPlaceholder="Tìm mã UV, họ tên, SĐT, email..."
        searchValue={q}
        onSearchChange={(v) => { setQ(v); setPage(1); }}
        selects={[
          { key: 'branch', value: branchFilter, width: 205, options: [{ value: 'ALL', label: 'Tất cả chi nhánh nguyện vọng' }, ...branches], onChange: (v) => { setBranchFilter(v); setPage(1); } },
          { key: 'pos', value: positionFilter, width: 165, options: [{ value: 'ALL', label: 'Tất cả vị trí' }, ...jobPositionOptions], onChange: (v) => { setPositionFilter(v); setPage(1); } },
          { key: 'status', value: statusFilter, width: 195, options: CANDIDATE_STATUS_OPTIONS, onChange: (v) => { setStatusFilter(v); setPage(1); } },
        ]}
        onRefresh={refreshAll}
        refreshing={candQ.isFetching}
        onExportExcel={() => exportCands(rows)}
        primaryActionLabel={canManageRec ? 'Thêm ứng viên mới' : undefined}
        onPrimaryAction={canManageRec ? openCreateCand : undefined}
      />

      <SelectableTable<Record<string, unknown>>
        size="small" rowKey="id" loading={candQ.isLoading} onRowClick={setViewingCand}
        bulkActions={[
          ...(canManageRec ? [
            { key: 'contacted', label: 'Đánh dấu Đã liên hệ đã chọn', type: 'primary' as const, icon: <CheckCircleOutlined />, eligibleFilter: (x: Record<string, unknown>) => x.status === 'NEW', onClick: async (sel: Record<string, unknown>[]) => { for (const r of sel) await api.put(`/admin/candidates/${r.id}`, { version: r.version, status: 'CONTACTED' }); message.success('Đã cập nhật trạng thái Đã liên hệ cho ứng viên hợp lệ'); refreshAll(); } },
            { key: 'delete', label: 'Xóa ứng viên đã chọn', danger: true, icon: <DeleteOutlined />, confirm: 'Xác nhận xóa các hồ sơ ứng viên đã chọn?', onClick: async (sel: Record<string, unknown>[]) => { for (const r of sel) await api.delete(`/admin/candidates/${r.id}`, { version: r.version }); message.success('Đã xóa các hồ sơ ứng viên đã chọn'); refreshAll(); } },
          ] : []),
          { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (sel) => exportCands(sel) },
        ]}
        pagination={{ current: page, pageSize: perPage, total: candQ.data?.meta.pagination.total ?? rows.length, showSizeChanger: true, pageSizeOptions: ['10', '12', '20', '50', '100'], showTotal: (t) => `Tổng ${t} ứng viên`, onChange: (p, ps) => { setPage(ps !== perPage ? 1 : p); setPerPage(ps); } }}
        dataSource={rows}
        columns={[
          { title: 'Mã UV', dataIndex: 'candidate_code', width: 100, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
          { title: 'Họ và tên', dataIndex: 'full_name', ellipsis: true, render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
          { title: 'Số điện thoại', dataIndex: 'phone', width: 130, render: (v: string) => <span className="num" style={{ fontWeight: 600 }}>{v}</span> },
          { title: 'Vị trí ứng tuyển', dataIndex: 'positionLabel', width: 155, ellipsis: true },
          { title: 'Chi nhánh nguyện vọng', dataIndex: 'branchName', ellipsis: true },
          { title: 'Giai đoạn', dataIndex: 'stage', width: 165, render: (v: string) => <StatusTag value={v} /> },
          {
            title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
            render: (_, r) => {
              const hasIv = Boolean(scheduledCandidateIds?.has(String(r.id)) || scheduledCandidateIds?.has(String(r.candidate_code)) || r.status === 'INTERVIEW_SCHEDULED');
              return (
                <RowActionButtons
                  detailTooltip="Xem chi tiết hồ sơ ứng viên"
                  onViewDetail={() => setViewingCand(r)}
                  menuItems={[
                    ...(canManageRec && r.status === 'NEW' ? [{ key: 'contacted', icon: <CheckCircleOutlined style={{ color: '#2563EB' }} />, label: 'Đánh dấu Đã liên hệ ứng viên', onClick: () => saveMut.mutate({ url: `/admin/candidates/${r.id}`, method: 'PUT', body: { version: r.version, status: 'CONTACTED' } }) }] : []),
                    ...(canManageIv ? [{ key: 'interview', icon: <CalendarOutlined />, label: hasIv ? 'Chỉnh sửa lịch phỏng vấn' : 'Đặt lịch phỏng vấn', onClick: () => onScheduleInterview(String(r.id)) }] : []),
                    ...(canManageRec ? [
                      { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa hồ sơ & ghi chú HR', onClick: () => openEditCand(r) },
                      { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa hồ sơ ứng viên', onClick: () => modal.confirm({ title: `Xóa hồ sơ ứng viên "${r.full_name}"?`, content: 'Hồ sơ ứng viên này sẽ bị xóa khỏi danh sách tuyển dụng.', okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delMut.mutateAsync({ url: `/admin/candidates/${r.id}`, body: { version: r.version } }) }) },
                    ] : []),
                  ]}
                />
              );
            },
          },
        ]}
      />

      <Modal width={660} open={candModal} forceRender destroyOnHidden title={editingCand ? 'Chỉnh sửa Hồ sơ Ứng viên' : 'Tiếp nhận Hồ sơ Ứng viên mới'} okText={editingCand ? 'Lưu cập nhật' : 'Thêm ứng viên'} cancelText="Hủy bỏ" okButtonProps={{ icon: editingCand ? <SaveOutlined /> : <PlusOutlined />, loading: saveMut.isPending }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={() => setCandModal(false)} onOk={() => candForm.submit()}>
        <Form form={candForm} layout="vertical" onFinish={(v) => {
          if (editingCand) saveMut.mutate({ url: `/admin/candidates/${editingCand.id}`, method: 'PUT', body: { ...v, branch_pref: v.applied_branch_id, staff_group: v.applied_position, version: editingCand.version } });
          else saveMut.mutate({ url: '/admin/candidates', method: 'POST', body: v });
        }}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="full_name" label="Họ và tên" rules={[{ required: true }]}><Input placeholder="Nguyễn Văn A" /></Form.Item></Col>
            <Col span={12}><Form.Item name="phone" label="Số điện thoại" rules={[{ required: true }]}><Input placeholder="0909888777" /></Form.Item></Col>
            <Col span={12}><Form.Item name="email" label="Email"><Input placeholder="ungvien@gmail.com" /></Form.Item></Col>
            <Col span={6}><Form.Item name="birth_year" label="Năm sinh"><Input placeholder="2004" /></Form.Item></Col>
            <Col span={6}><Form.Item name="gender" label="Giới tính"><Select options={[{ value: 'Nữ', label: 'Nữ' }, { value: 'Nam', label: 'Nam' }, { value: 'Khác', label: 'Khác' }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="applied_branch_id" label="Chi nhánh nguyện vọng" rules={[{ required: true }]}><Select options={branches} placeholder="Chọn chi nhánh" /></Form.Item></Col>
            <Col span={12}><Form.Item name="applied_position" label="Vị trí ứng tuyển"><Select options={jobPositionOptions} /></Form.Item></Col>
            <Col span={8}><Form.Item name="shift_pref" label="Ca đăng ký (theo chi nhánh)"><Select options={shiftPrefOptions} /></Form.Item></Col>
            <Col span={8}><Form.Item name="expected_salary_vnd" label="Lương mong muốn"><InputNumber min={0} step={500000} style={{ width: '100%' }} suffix="đ" {...MONEY_INPUT_PROPS} /></Form.Item></Col>
            <Col span={8}><Form.Item name="status" label="Trạng thái xử lý"><Select options={CANDIDATE_STATUS_OPTIONS.filter((o) => o.value !== 'ALL')} /></Form.Item></Col>
            <Col span={24}><Form.Item name="experience_note" label="Kinh nghiệm làm việc"><Input placeholder="Ví dụ: 6 tháng pha chế / thu ngân..." /></Form.Item></Col>
            <Col span={24}><Form.Item name="hr_note" label="Ghi chú sàng lọc HR"><Input.TextArea rows={2} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      <BaseDetailDrawer open={Boolean(viewingCand)} title={viewingCand ? `Hồ sơ Ứng viên: ${viewingCand.full_name} (${viewingCand.candidate_code})` : 'Chi tiết ứng viên'} onClose={() => setViewingCand(null)} extra={<><GuardButton size="small" type="primary" icon={<CalendarOutlined />} perms={['interview.manage']} onClick={() => { const id = String(viewingCand!.id); setViewingCand(null); onScheduleInterview(id); }}>{viewingCand && (scheduledCandidateIds?.has(String(viewingCand.id)) || scheduledCandidateIds?.has(String(viewingCand.candidate_code)) || viewingCand.status === 'INTERVIEW_SCHEDULED') ? 'Chỉnh sửa lịch phỏng vấn' : 'Đặt lịch phỏng vấn'}</GuardButton><GuardButton size="small" icon={<EditOutlined />} perms={['candidate.manage']} onClick={() => { const c = viewingCand!; setViewingCand(null); openEditCand(c); }}>Chỉnh sửa</GuardButton></>}>
        {viewingCand && (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Card size="small" title="Kênh liên hệ tích hợp">
              <Space wrap>
                <Button type="primary" icon={<PhoneOutlined />} href={`tel:${viewingCand.phone}`}>Gọi điện thoại ({String(viewingCand.phone)})</Button>
                <Button icon={<MessageOutlined />} href={`https://zalo.me/${viewingCand.phone}`} target="_blank">Mở chat Zalo ({String(viewingCand.phone)})</Button>
                {Boolean(viewingCand.email) && <Button icon={<MailOutlined />} href={`mailto:${viewingCand.email}`}>Gửi Email ({String(viewingCand.email)})</Button>}
              </Space>
            </Card>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="Mã ứng viên"><Tag color="geekblue">{String(viewingCand.candidate_code)}</Tag></Descriptions.Item>
              <Descriptions.Item label="Họ và tên">{String(viewingCand.full_name)}</Descriptions.Item>
              <Descriptions.Item label="Số điện thoại">{String(viewingCand.phone)}</Descriptions.Item>
              <Descriptions.Item label="Email">{String(viewingCand.email || 'Chưa cập nhật')}</Descriptions.Item>
              <Descriptions.Item label="Năm sinh / Giới tính">{String(viewingCand.birth_year || '—')} / {String(viewingCand.gender || '—')}</Descriptions.Item>
              <Descriptions.Item label="Ca đăng ký">{String(viewingCand.shiftPrefLabel || viewingCand.shift_pref || '—')}</Descriptions.Item>
              <Descriptions.Item label="Vị trí ứng tuyển">{String(viewingCand.positionLabel)}</Descriptions.Item>
              <Descriptions.Item label="Chi nhánh nguyện vọng">{String(viewingCand.branchName)}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái sàng lọc"><StatusTag value={String(viewingCand.stage)} /></Descriptions.Item>
              <Descriptions.Item label="Kinh nghiệm ứng viên">{String(viewingCand.experience_note || 'Chưa ghi nhận')}</Descriptions.Item>
              <Descriptions.Item label="Ghi chú HR" span={2}>{String(viewingCand.hr_note || '—')}</Descriptions.Item>
            </Descriptions>
          </Space>
        )}
      </BaseDetailDrawer>
    </Space>
  );
}
