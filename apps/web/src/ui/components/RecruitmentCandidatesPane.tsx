'use client';

import { Alert, App, Button, Card, Col, Descriptions, Drawer, Form, Input, Modal, Row, Select, Space, Table, Tag, Tooltip } from 'antd';
import { CalendarOutlined, CheckCircleOutlined, CloseOutlined, CloudDownloadOutlined, DeleteOutlined, EditOutlined, ExpandAltOutlined, FileTextOutlined, MailOutlined, MessageOutlined, PhoneOutlined, PlusOutlined, SaveOutlined, ShrinkOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { StatusTag } from '../StatusTag';
import { FilterToolbar } from './FilterToolbar';
import { GuardButton, usePermissionGuard } from './GuardButton';
import { useJobPositions } from './JobPositionsManagerModal';
import { RowActionButtons } from './RowActionButtons';

const CANDIDATE_STATUS_OPTIONS = [
  { value: 'ALL', label: 'Tất cả giai đoạn' },
  { value: 'NEW', label: 'Mới tiếp nhận' },
  { value: 'CONTACTED', label: 'Đã liên hệ' },
  { value: 'INTERVIEW_SCHEDULED', label: 'Đã xếp lịch phỏng vấn' },
  { value: 'HIRED', label: 'Đạt phỏng vấn / Mời thử việc' },
  { value: 'REJECTED', label: 'Chưa phù hợp' },
];

const SOURCE_CHANNEL_OPTIONS = [
  { value: 'ALL', label: 'Tất cả nguồn ứng tuyển' },
  { value: 'GOOGLE_FORM', label: 'Google Form (FROM_NHAN_VIEN)' },
  { value: 'WEB', label: 'Nhập trực tiếp trên Web' },
  { value: 'REFERRAL', label: 'Nhân viên nội bộ giới thiệu' },
  { value: 'SOCIAL', label: 'Kênh mạng xã hội / QR Cửa hàng' },
];

const SHIFT_PREF_OPTIONS = [
  { value: 'CA_SANG', label: 'Ca sáng (07:00 - 12:00)' },
  { value: 'CA_CHIEU', label: 'Ca chiều (12:00 - 17:00)' },
  { value: 'CA_TOI', label: 'Ca tối (17:00 - 22:30)' },
  { value: 'CA_FULL', label: 'Ca gãy / Linh hoạt' },
];

interface Props {
  branches: { value: string; label: string }[];
  onScheduleInterview: (candidateId: string) => void;
}

export function RecruitmentCandidatesPane({ branches, onScheduleInterview }: Props) {
  const qc = useQueryClient();
  const canManageRec = usePermissionGuard({ perms: ['candidate.manage', 'interview.manage'] });
  const { message, modal } = App.useApp();
  const { options: jobPositionOptions } = useJobPositions();

  const [q, setQ] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');

  const [candModal, setCandModal] = useState(false);
  const [formSimModal, setFormSimModal] = useState(false);
  const [editingCand, setEditingCand] = useState<Record<string, unknown> | null>(null);
  const [viewingCand, setViewingCand] = useState<Record<string, unknown> | null>(null);
  const [drawerWide, setDrawerWide] = useState(false);
  const [candForm] = Form.useForm();
  const [simForm] = Form.useForm();

  const queryParams = new URLSearchParams({ per_page: '100' });
  if (q) queryParams.set('q', q);
  if (branchFilter !== 'ALL') queryParams.set('branch_id', branchFilter);
  if (positionFilter !== 'ALL') queryParams.set('staff_group', positionFilter);
  if (statusFilter !== 'ALL') queryParams.set('status', statusFilter);
  if (sourceFilter !== 'ALL') queryParams.set('source_channel', sourceFilter);

  const candQ = useQuery({
    queryKey: ['candidates', q, branchFilter, positionFilter, statusFilter, sourceFilter],
    queryFn: () => api.list<Record<string, unknown>>(`/admin/candidates?${queryParams.toString()}`),
  });

  const refreshAll = () => ['candidates', 'interviews'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const syncMut = useMutation({
    mutationFn: (body?: Record<string, unknown>) => api.post<{ syncedCount: number; totalFormRows: number }>('/admin/candidates/sync-form', body ?? {}),
    onSuccess: (res) => {
      message.success(res.syncedCount > 0 ? `Đã đồng bộ ${res.syncedCount} ứng viên mới từ Google Form (FROM_NHAN_VIEN)` : `Toàn bộ ${res.totalFormRows} phản hồi từ FROM_NHAN_VIEN đã được đồng bộ đầy đủ`);
      setFormSimModal(false);
      simForm.resetFields();
      refreshAll();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Đồng bộ Google Form thất bại'),
  });

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
    candForm.setFieldsValue({ applied_position: 'BARISTA', applied_branch_id: branches[0]?.value, shift_pref: 'CA_SANG', source_channel: 'GOOGLE_FORM', birth_year: '2004', gender: 'Nữ' });
    setCandModal(true);
  };

  const openEditCand = (r: Record<string, unknown>) => {
    setEditingCand(r);
    candForm.setFieldsValue({
      full_name: r.full_name, phone: r.phone, email: r.email, applied_branch_id: r.branch_pref,
      applied_position: r.staff_group, shift_pref: r.shift_pref || 'CA_SANG', source_channel: r.source_channel || 'GOOGLE_FORM',
      birth_year: r.birth_year || '2004', gender: r.gender || '', experience_note: r.experience_note || '', status: r.status, hr_note: r.hr_note,
    });
    setCandModal(true);
  };

  const rows = candQ.data?.data ?? [];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="Kênh tiếp nhận tự động từ Google Form (Tab FROM_NHAN_VIEN trên Spreadsheet 02_HR)"
        description="Khi ứng viên điền biểu mẫu ứng tuyển Google Form, dữ liệu đổ vào tab FROM_NHAN_VIEN và được hệ thống tự động đồng bộ sang danh sách ứng viên (không tự loại theo tiêu chí ngoài công việc)."
        action={
          <Space wrap size={6}>
            <GuardButton size="small" icon={<CloudDownloadOutlined />} loading={syncMut.isPending} perms={['candidate.manage']} onClick={() => syncMut.mutate({})}>
              Đồng bộ ngay từ FROM_NHAN_VIEN
            </GuardButton>
            <GuardButton size="small" icon={<FileTextOutlined />} perms={['candidate.manage']} onClick={() => { simForm.resetFields(); simForm.setFieldsValue({ position: 'BARISTA', branch_pref: branches[0]?.value, shift_pref: 'CA_SANG', birth_year: '2004', gender: 'Nữ' }); setFormSimModal(true); }}>
              Tiếp nhận / Test biểu mẫu Google Form
            </GuardButton>
          </Space>
        }
      />

      <FilterToolbar
        searchPlaceholder="Tìm mã UV, họ tên, SĐT, email..."
        searchValue={q}
        onSearchChange={setQ}
        selects={[
          { key: 'branch', value: branchFilter, width: 205, options: [{ value: 'ALL', label: 'Tất cả chi nhánh nguyện vọng' }, ...branches], onChange: setBranchFilter },
          { key: 'pos', value: positionFilter, width: 165, options: [{ value: 'ALL', label: 'Tất cả vị trí' }, ...jobPositionOptions], onChange: setPositionFilter },
          { key: 'status', value: statusFilter, width: 185, options: CANDIDATE_STATUS_OPTIONS, onChange: setStatusFilter },
          { key: 'source', value: sourceFilter, width: 195, options: SOURCE_CHANNEL_OPTIONS, onChange: setSourceFilter },
        ]}
        onRefresh={() => syncMut.mutate({})}
        refreshing={candQ.isFetching || syncMut.isPending}
        onExportExcel={() => exportToExcel({ fileName: 'Danh_sach_ung_vien.xls', sheetTitle: 'Danh sách Hồ sơ Ứng viên Tuyển dụng', rows, columns: [{ header: 'Mã UV', key: 'candidate_code' }, { header: 'Họ và tên', key: 'full_name' }, { header: 'Số điện thoại', key: 'phone' }, { header: 'Email', key: 'email' }, { header: 'Vị trí', key: 'positionLabel' }, { header: 'Chi nhánh nguyện vọng', key: 'branchName' }, { header: 'Ca đăng ký', key: 'shiftPrefLabel' }, { header: 'Nguồn', key: 'sourceChannelLabel' }, { header: 'Giai đoạn', key: 'stage' }, { header: 'Ghi chú HR', key: 'hr_note' }] })}
        primaryActionLabel={canManageRec ? 'Thêm ứng viên mới' : undefined}
        onPrimaryAction={canManageRec ? openCreateCand : undefined}
      />

      <Table
        size="small" rowKey="id" loading={candQ.isLoading} pagination={{ pageSize: 10 }} dataSource={rows}
        columns={[
          { title: 'Mã UV', dataIndex: 'candidate_code', width: 95, render: (v: string, r) => <Space direction="vertical" size={0}><Tag color="geekblue">{v}</Tag><span style={{ fontSize: 11, color: '#64748B' }}>{String(r.source_row || '')}</span></Space> },
          { title: 'Họ và tên', dataIndex: 'full_name', render: (v: string, r) => <Space direction="vertical" size={0}><span style={{ fontWeight: 600 }}>{v}</span><span style={{ fontSize: 12, color: '#64748B' }}>{r.gender ? `${r.gender} · ` : ''}{r.birth_year ? `SN ${r.birth_year}` : ''}</span></Space> },
          {
            title: 'Liên hệ nhanh', dataIndex: 'phone', width: 190,
            render: (v: string, r) => (
              <Space size={4} wrap>
                <span className="num" style={{ fontWeight: 600 }}>{v}</span>
                <Tooltip title={`Gọi điện ${v}`}><Button size="small" type="text" icon={<PhoneOutlined style={{ color: '#2563EB' }} />} href={`tel:${v}`} /></Tooltip>
                <Tooltip title={`Nhắn Zalo ${v}`}><Button size="small" type="text" icon={<MessageOutlined style={{ color: '#0284C7' }} />} href={`https://zalo.me/${v}`} target="_blank" /></Tooltip>
                {Boolean(r.email) && <Tooltip title={`Gửi Email: ${r.email}`}><Button size="small" type="text" icon={<MailOutlined style={{ color: '#16A34A' }} />} href={`mailto:${r.email}`} /></Tooltip>}
              </Space>
            ),
          },
          { title: 'Vị trí & Ca', dataIndex: 'positionLabel', width: 155, render: (v: string, r) => <Space direction="vertical" size={0}><span>{v}</span><span style={{ fontSize: 12, color: '#64748B' }}>{String(r.shiftPrefLabel || '')}</span></Space> },
          { title: 'Chi nhánh nguyện vọng', dataIndex: 'branchName' },
          { title: 'Nguồn', dataIndex: 'sourceChannelLabel', width: 170, render: (v: string) => <Tag>{v}</Tag> },
          { title: 'Trạng thái xử lý', dataIndex: 'stage', width: 145, render: (v: string) => <StatusTag value={v} /> },
          {
            title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem hồ sơ & ghi chú HR"
                onViewDetail={() => setViewingCand(r)}
                menuItems={canManageRec ? [
                  ...(r.status === 'NEW' ? [{ key: 'contacted', icon: <CheckCircleOutlined style={{ color: '#2563EB' }} />, label: 'Đánh dấu Đã liên hệ ứng viên', onClick: () => saveMut.mutate({ url: `/admin/candidates/${r.id}`, method: 'PUT', body: { version: r.version, status: 'CONTACTED' } }) }] : []),
                  { key: 'interview', icon: <CalendarOutlined />, label: 'Đặt lịch phỏng vấn 30 phút', onClick: () => onScheduleInterview(String(r.id)) },
                  { key: 'edit', icon: <EditOutlined />, label: 'Cập nhật hồ sơ & ghi chú HR', onClick: () => openEditCand(r) },
                  { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa hồ sơ ứng viên', onClick: () => modal.confirm({ title: `Xóa hồ sơ ứng viên "${r.full_name}"?`, content: 'Hồ sơ ứng viên sẽ được chuyển sang trạng thái xóa mềm.', okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delMut.mutateAsync({ url: `/admin/candidates/${r.id}`, body: { version: r.version } }) }) },
                ] : []}
              />
            ),
          },
        ]}
      />

      <Modal width={680} open={candModal} forceRender destroyOnHidden title={editingCand ? 'Cập nhật Hồ sơ & Ghi chú HR' : 'Tiếp nhận Hồ sơ Ứng viên mới'} okText={editingCand ? 'Lưu cập nhật' : 'Thêm ứng viên'} cancelText="Hủy bỏ" okButtonProps={{ icon: editingCand ? <SaveOutlined /> : <PlusOutlined />, loading: saveMut.isPending }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={() => setCandModal(false)} onOk={() => candForm.submit()}>
        <Form form={candForm} layout="vertical" onFinish={(v) => {
          if (editingCand) saveMut.mutate({ url: `/admin/candidates/${editingCand.id}`, method: 'PUT', body: { ...v, branch_pref: v.applied_branch_id, staff_group: v.applied_position, version: editingCand.version } });
          else saveMut.mutate({ url: '/admin/candidates', method: 'POST', body: v });
        }}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="full_name" label="Họ và tên ứng viên" rules={[{ required: true }]}><Input placeholder="Nguyễn Văn A" /></Form.Item></Col>
            <Col span={12}><Form.Item name="phone" label="Số điện thoại (10 số)" rules={[{ required: true }]}><Input placeholder="0909888777" /></Form.Item></Col>
            <Col span={12}><Form.Item name="email" label="Email liên hệ"><Input placeholder="ungvien@gmail.com" /></Form.Item></Col>
            <Col span={6}><Form.Item name="birth_year" label="Năm sinh"><Input placeholder="2004" /></Form.Item></Col>
            <Col span={6}><Form.Item name="gender" label="Giới tính"><Select options={[{ value: 'Nữ', label: 'Nữ' }, { value: 'Nam', label: 'Nam' }, { value: 'Khác', label: 'Khác' }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="applied_branch_id" label="Chi nhánh nguyện vọng" rules={[{ required: true }]}><Select options={branches} placeholder="Chọn chi nhánh" /></Form.Item></Col>
            <Col span={12}><Form.Item name="applied_position" label="Vị trí ứng tuyển"><Select options={jobPositionOptions} /></Form.Item></Col>
            <Col span={8}><Form.Item name="shift_pref" label="Ca đăng ký"><Select options={SHIFT_PREF_OPTIONS} /></Form.Item></Col>
            <Col span={8}><Form.Item name="source_channel" label="Nguồn ứng tuyển"><Select options={SOURCE_CHANNEL_OPTIONS.filter((o) => o.value !== 'ALL')} /></Form.Item></Col>
            <Col span={8}><Form.Item name="status" label="Trạng thái xử lý"><Select options={CANDIDATE_STATUS_OPTIONS.filter((o) => o.value !== 'ALL')} /></Form.Item></Col>
            <Col span={24}><Form.Item name="experience_note" label="Kinh nghiệm làm việc"><Input placeholder="Ví dụ: 6 tháng pha chế / thu ngân..." /></Form.Item></Col>
            <Col span={24}><Form.Item name="hr_note" label="Ghi chú sàng lọc của HR"><Input.TextArea rows={2} placeholder="Ghi chú nhận xét khi trao đổi qua điện thoại/Zalo..." /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      <Modal width={640} open={formSimModal} forceRender destroyOnHidden title="Gửi phản hồi vào bảng FROM_NHAN_VIEN (Google Form) & Đồng bộ" okText="Ghi vào FROM_NHAN_VIEN & Đồng bộ" cancelText="Đóng" okButtonProps={{ icon: <CloudDownloadOutlined />, loading: syncMut.isPending }} onCancel={() => setFormSimModal(false)} onOk={() => simForm.submit()}>
        <Form form={simForm} layout="vertical" onFinish={(v) => syncMut.mutate(v)}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="full_name" label="Họ và tên (Google Form)" rules={[{ required: true }]}><Input placeholder="Trần Minh Anh" /></Form.Item></Col>
            <Col span={12}><Form.Item name="phone" label="Số điện thoại" rules={[{ required: true }]}><Input placeholder="0901222333" /></Form.Item></Col>
            <Col span={12}><Form.Item name="email" label="Email"><Input placeholder="minhanh.uv@gmail.com" /></Form.Item></Col>
            <Col span={6}><Form.Item name="birth_year" label="Năm sinh"><Input placeholder="2005" /></Form.Item></Col>
            <Col span={6}><Form.Item name="gender" label="Giới tính"><Select options={[{ value: 'Nữ', label: 'Nữ' }, { value: 'Nam', label: 'Nam' }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="branch_pref" label="Chi nhánh nguyện vọng" rules={[{ required: true }]}><Select options={branches} /></Form.Item></Col>
            <Col span={12}><Form.Item name="position" label="Vị trí ứng tuyển"><Select options={jobPositionOptions} /></Form.Item></Col>
            <Col span={12}><Form.Item name="shift_pref" label="Ca mong muốn"><Select options={SHIFT_PREF_OPTIONS} /></Form.Item></Col>
            <Col span={12}><Form.Item name="experience_note" label="Kinh nghiệm"><Input placeholder="Đã làm pha chế 1 năm" /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      <Drawer open={Boolean(viewingCand)} title={viewingCand ? `Hồ sơ Ứng viên: ${viewingCand.full_name} (${viewingCand.candidate_code})` : 'Chi tiết ứng viên'} width={drawerWide ? '95vw' : '70vw'} onClose={() => setViewingCand(null)} destroyOnHidden extra={<Space><GuardButton size="small" type="primary" icon={<CalendarOutlined />} perms={['interview.manage']} onClick={() => { const id = String(viewingCand!.id); setViewingCand(null); onScheduleInterview(id); }}>Đặt lịch phỏng vấn</GuardButton><GuardButton size="small" icon={<EditOutlined />} perms={['candidate.manage']} onClick={() => { const c = viewingCand!; setViewingCand(null); openEditCand(c); }}>Chỉnh sửa &amp; Ghi chú HR</GuardButton><Button size="small" icon={drawerWide ? <ShrinkOutlined /> : <ExpandAltOutlined />} onClick={() => setDrawerWide((v) => !v)}>{drawerWide ? 'Thu gọn' : 'Mở rộng'}</Button><Button size="small" icon={<CloseOutlined />} onClick={() => setViewingCand(null)}>Đóng</Button></Space>}>
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
              <Descriptions.Item label="Nguồn tiếp nhận"><Tag>{String(viewingCand.sourceChannelLabel || viewingCand.source_channel)} ({String(viewingCand.source_row || '—')})</Tag></Descriptions.Item>
              <Descriptions.Item label="Họ và tên">{String(viewingCand.full_name)}</Descriptions.Item>
              <Descriptions.Item label="Năm sinh / Giới tính">{String(viewingCand.birth_year || '—')} / {String(viewingCand.gender || '—')}</Descriptions.Item>
              <Descriptions.Item label="Số điện thoại">{String(viewingCand.phone)}</Descriptions.Item>
              <Descriptions.Item label="Email">{String(viewingCand.email || 'Chưa cập nhật')}</Descriptions.Item>
              <Descriptions.Item label="Vị trí ứng tuyển">{String(viewingCand.positionLabel)}</Descriptions.Item>
              <Descriptions.Item label="Chi nhánh nguyện vọng">{String(viewingCand.branchName)}</Descriptions.Item>
              <Descriptions.Item label="Ca đăng ký">{String(viewingCand.shiftPrefLabel || viewingCand.shift_pref)}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái xử lý"><StatusTag value={String(viewingCand.stage)} /></Descriptions.Item>
              <Descriptions.Item label="Kinh nghiệm ứng viên" span={2}>{String(viewingCand.experience_note || 'Chưa ghi nhận')}</Descriptions.Item>
              <Descriptions.Item label="Ghi chú của HR" span={2}>{String(viewingCand.hr_note || '—')}</Descriptions.Item>
            </Descriptions>
          </Space>
        )}
      </Drawer>
    </Space>
  );
}
