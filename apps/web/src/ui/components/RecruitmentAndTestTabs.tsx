'use client';

import { App, Button, Card, Col, Descriptions, Drawer, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tabs, Tag } from 'antd';
import { BookOutlined, CalendarOutlined, CheckCircleOutlined, CloseCircleOutlined, CloseOutlined, DeleteOutlined, EditOutlined, ExpandAltOutlined, PlusOutlined, SaveOutlined, ShrinkOutlined, SolutionOutlined, TeamOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { StatusTag } from '../StatusTag';
import { DateStringPicker, TimeSelect } from './DateTimePickers';
import { GuardButton, usePermissionGuard } from './GuardButton';
import { useJobPositions } from './JobPositionsManagerModal';
import { MONEY_INPUT_PROPS } from './payroll-types';
import { RowActionButtons } from './RowActionButtons';
import { TestBankManagerPane } from './TestBankManagerPane';

interface Props {
  branches: { value: string; label: string }[];
  employees: { value: string; label: string }[];
  activeTab?: 'recruitment' | 'tests';
  onTabChange?: (tab: 'recruitment' | 'tests') => void;
}

const DEFAULT_INTERVIEWERS = [
  { value: 'u-hr-01', label: 'Nguyễn Thị Mai — Quản lý Nhân sự (HR)' },
  { value: 'u-store-01', label: 'Trần Quốc Bảo — Cửa hàng trưởng (CN Quận 1)' },
  { value: 'u-admin-01', label: 'Ban Giám đốc — Quản trị hệ thống (ADMIN)' },
];

export function RecruitmentAndTestTabs({ branches, employees, activeTab, onTabChange }: Props) {
  const qc = useQueryClient();
  const can = useCan();
  const canManageRec = usePermissionGuard({ perms: ['candidate.manage', 'interview.manage'] });
  const { message, modal } = App.useApp();
  const [recSubTab, setRecSubTab] = useState<'candidates' | 'interviews'>('candidates');
  const [candModal, setCandModal] = useState(false);
  const [editingCand, setEditingCand] = useState<Record<string, unknown> | null>(null);
  const [viewingCand, setViewingCand] = useState<Record<string, unknown> | null>(null);
  const [drawerWide, setDrawerWide] = useState(false);
  const [ivModal, setIvModal] = useState(false);
  const [candForm] = Form.useForm();
  const [ivForm] = Form.useForm();
  const { options: jobPositionOptions } = useJobPositions();

  const candQ = useQuery({ queryKey: ['candidates'], queryFn: () => api.list<Record<string, unknown>>('/admin/candidates?per_page=50') });
  const ivQ = useQuery({ queryKey: ['interviews'], queryFn: () => api.get<Record<string, unknown>[]>('/admin/interviews') });
  const testsQ = useQuery({ queryKey: ['tests-bank'], queryFn: () => api.get<{ tests: Record<string, unknown>[]; assignments: Record<string, unknown>[]; attempts: Record<string, unknown>[] }>('/admin/tests/bank') });

  const interviewerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of DEFAULT_INTERVIEWERS) map.set(d.value, d.label);
    for (const e of employees) if (!map.has(e.value)) map.set(e.value, e.label);
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [employees]);

  const refreshAll = () => ['candidates', 'interviews', 'tests-bank'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const postMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.post(url, body),
    onSuccess: () => { message.success('Thao tác thành công'); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại'),
  });
  const putMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.put(url, body),
    onSuccess: () => { message.success('Cập nhật thành công'); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Cập nhật thất bại'),
  });
  const delMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.delete(url, body),
    onSuccess: () => { message.success('Đã xóa bản ghi thành công'); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa thất bại'),
  });

  const openCreateCand = () => {
    setEditingCand(null); candForm.resetFields();
    candForm.setFieldsValue({ applied_position: 'BARISTA', expected_salary_vnd: 6500000, applied_branch_id: branches[0]?.value });
    setCandModal(true);
  };
  const openEditCand = (r: Record<string, unknown>) => {
    setEditingCand(r);
    candForm.setFieldsValue({ full_name: r.full_name, phone: r.phone, email: r.email, applied_branch_id: r.branch_pref, applied_position: r.staff_group, hr_note: r.hr_note });
    setCandModal(true);
  };

  const candidatesTable = (
    <Card size="small" title="Danh sách Hồ sơ Ứng viên tuyển dụng" extra={<GuardButton size="small" type="primary" icon={<PlusOutlined />} perms={['candidate.manage']} onClick={openCreateCand}>Thêm ứng viên mới</GuardButton>}>
      <Table
        size="small" rowKey="id" pagination={{ pageSize: 10 }} dataSource={candQ.data?.data ?? []}
        columns={[
          { title: 'Mã UV', dataIndex: 'candidate_code', width: 95, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
          { title: 'Họ và tên', dataIndex: 'full_name' },
          { title: 'Số điện thoại', dataIndex: 'phone', width: 130 },
          { title: 'Email', dataIndex: 'email', render: (v: string) => v || '—' },
          { title: 'Vị trí ứng tuyển', dataIndex: 'positionLabel', width: 140 },
          { title: 'Chi nhánh nguyện vọng', dataIndex: 'branchName' },
          { title: 'Giai đoạn', dataIndex: 'stage', width: 135, render: (v: string) => <StatusTag value={v} /> },
          {
            title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem chi tiết ứng viên"
                onViewDetail={() => setViewingCand(r)}
                menuItems={canManageRec ? [
                  { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa hồ sơ ứng viên', onClick: () => openEditCand(r) },
                  { key: 'interview', icon: <CalendarOutlined />, label: 'Đặt lịch phỏng vấn', onClick: () => { ivForm.setFieldsValue({ candidate_id: String(r.id) }); setIvModal(true); } },
                  { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa hồ sơ ứng viên', onClick: () => modal.confirm({ title: `Xóa hồ sơ ứng viên "${r.full_name}"?`, content: 'Hồ sơ ứng viên sẽ được chuyển sang trạng thái xóa mềm.', okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delMut.mutateAsync({ url: `/admin/candidates/${r.id}`, body: { version: r.version } }) }) },
                ] : []}
              />
            ),
          },
        ]}
      />
    </Card>
  );

  const interviewsTable = (
    <Card size="small" title="Lịch Phỏng vấn & Google Meet" extra={<GuardButton size="small" type="primary" icon={<CalendarOutlined />} perms={['interview.manage']} onClick={() => setIvModal(true)}>Đặt lịch phỏng vấn</GuardButton>}>
      <Table
        size="small" rowKey="id" pagination={{ pageSize: 10 }} dataSource={ivQ.data ?? []}
        columns={[
          { title: 'Ứng viên phỏng vấn', dataIndex: 'candidateName' },
          { title: 'Người phỏng vấn', dataIndex: 'interviewerLabel', render: (v: string, r) => v || String(r.interviewer_id ?? '') },
          { title: 'Khung giờ & Thời lượng', dataIndex: 'scheduled_at', width: 185, render: (v: string, r) => `${String(v).slice(0, 16).replace('T', ' ')} (${r.duration_minutes ?? 30} phút)` },
          { title: 'Kết quả', dataIndex: 'decision', width: 135, render: (v: string, r) => <Space size={4}><StatusTag value={v} />{v !== 'PENDING' && <Tag color="blue">{String(r.score)}đ</Tag>}</Space> },
          {
            title: 'Thao tác', width: 80, fixed: 'right', align: 'right',
            render: (_, r) => canManageRec ? (
              <RowActionButtons
                menuItems={[
                  ...(r.decision === 'PENDING' ? [
                    { key: 'pass', icon: <CheckCircleOutlined style={{ color: '#16A34A' }} />, label: 'Chấm ĐẠT phỏng vấn (Mời thử việc)', onClick: () => putMut.mutate({ url: `/admin/interviews/${r.id}/evaluate`, body: { version: r.version, score: 90, decision: 'PASSED', result_note: 'Đạt phỏng vấn, mời thử việc' } }) },
                    { key: 'fail', icon: <CloseCircleOutlined style={{ color: '#DC2626' }} />, label: 'Chấm LOẠI phỏng vấn', onClick: () => putMut.mutate({ url: `/admin/interviews/${r.id}/evaluate`, body: { version: r.version, score: 50, decision: 'FAILED', result_note: 'Chưa phù hợp ca làm việc' } }) },
                  ] : []),
                  { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa lịch phỏng vấn', onClick: () => modal.confirm({ title: 'Xóa lịch phỏng vấn này?', content: `Lịch phỏng vấn của ứng viên "${r.candidateName}" sẽ bị xóa.`, okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delMut.mutateAsync({ url: `/admin/interviews/${r.id}`, body: { version: r.version } }) }) },
                ]}
              />
            ) : null,
          },
        ]}
      />
    </Card>
  );

  const recruitmentPane = (
    <Tabs activeKey={recSubTab} onChange={(k) => setRecSubTab(k as 'candidates' | 'interviews')} items={[{ key: 'candidates', label: <span><TeamOutlined /> Hồ sơ Ứng viên tuyển dụng ({candQ.data?.data?.length ?? 0})</span>, children: candidatesTable }, { key: 'interviews', label: <span><CalendarOutlined /> Lịch Phỏng vấn &amp; Google Meet ({ivQ.data?.length ?? 0})</span>, children: interviewsTable }]} />
  );

  const testsPane = <TestBankManagerPane tests={testsQ.data?.tests ?? []} assignments={testsQ.data?.assignments ?? []} attempts={testsQ.data?.attempts ?? []} employees={employees} canManage={can('test.manage')} />;

  return (
    <Card size="small">
      {activeTab ? (activeTab === 'tests' ? testsPane : recruitmentPane) : (
        <Tabs
          onChange={(k) => onTabChange?.(k as 'recruitment' | 'tests')}
          items={[
            { key: 'recruitment', label: <span><SolutionOutlined /> Tuyển dụng &amp; Phỏng vấn ({candQ.data?.data?.length ?? 0})</span>, children: recruitmentPane },
            { key: 'tests', label: <span><BookOutlined /> Ngân hàng Đề &amp; Thi TEST Nghiệp Vụ ({testsQ.data?.tests?.length ?? 0} đề)</span>, children: testsPane },
          ]}
        />
      )}

      <Modal width={660} open={candModal} forceRender title={editingCand ? 'Chỉnh sửa Hồ sơ Ứng viên' : 'Tiếp nhận hồ sơ Ứng viên mới'} okText={editingCand ? 'Lưu cập nhật' : 'Thêm ứng viên'} cancelText="Hủy bỏ" okButtonProps={{ icon: editingCand ? <SaveOutlined /> : <PlusOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={() => setCandModal(false)} onOk={() => candForm.submit()}>
        <Form form={candForm} layout="vertical" onFinish={(v) => {
          if (editingCand) putMut.mutate({ url: `/admin/candidates/${editingCand.id}`, body: { ...v, branch_pref: v.applied_branch_id, staff_group: v.applied_position, version: editingCand.version } });
          else postMut.mutate({ url: '/admin/candidates', body: v });
          setCandModal(false);
        }}>
          <Form.Item name="full_name" label="Họ và tên" rules={[{ required: true }]}><Input placeholder="Nguyễn Văn A" /></Form.Item>
          <Form.Item name="phone" label="Số điện thoại" rules={[{ required: true }]}><Input placeholder="0909888777" /></Form.Item>
          <Form.Item name="email" label="Email"><Input placeholder="ungvien@gmail.com" /></Form.Item>
          <Form.Item name="applied_branch_id" label="Chi nhánh" rules={[{ required: true }]}><Select options={branches} placeholder="Chọn chi nhánh" /></Form.Item>
          <Form.Item name="applied_position" label="Vị trí ứng tuyển"><Select options={jobPositionOptions} /></Form.Item>
          <Form.Item name="expected_salary_vnd" label="Mức lương mong muốn"><InputNumber min={0} step={500000} style={{ width: '100%' }} suffix="đ" {...MONEY_INPUT_PROPS} /></Form.Item>
          <Form.Item name="hr_note" label="Ghi chú sàng lọc HR"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal width={680} open={ivModal} forceRender title="Đặt lịch phỏng vấn & Google Meet" okText="Đặt lịch phỏng vấn" cancelText="Hủy bỏ" okButtonProps={{ icon: <CalendarOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={() => setIvModal(false)} onOk={() => ivForm.submit()}>
        <Form
          form={ivForm} layout="vertical" initialValues={{ interviewer_ids: ['u-hr-01'], interview_date: '2026-10-26', interview_slot: '09:30', duration_minutes: 30 }}
          onFinish={(v) => {
            postMut.mutate({ url: '/admin/interviews', body: { candidate_id: v.candidate_id, interviewer_ids: v.interviewer_ids, scheduled_at: `${v.interview_date}T${v.interview_slot}:00.000Z`, duration_minutes: Number(v.duration_minutes || 30), meet_link: v.meet_link } });
            setIvModal(false);
            setRecSubTab('interviews');
          }}
        >
          <Form.Item name="candidate_id" label="Ứng viên" rules={[{ required: true, message: 'Vui lòng chọn ứng viên' }]}><Select showSearch optionFilterProp="label" placeholder="Chọn ứng viên phỏng vấn" options={(candQ.data?.data ?? []).map((c) => ({ value: String(c.id), label: `${c.candidate_code} — ${c.full_name} (${c.phone})` }))} /></Form.Item>
          <Form.Item name="interviewer_ids" label="Người phỏng vấn" rules={[{ required: true, message: 'Chọn ít nhất 1 người phỏng vấn' }]}><Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder="Chọn một hoặc nhiều người phỏng vấn" options={interviewerOptions} /></Form.Item>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="interview_date" label="Ngày phỏng vấn" rules={[{ required: true }]}><DateStringPicker /></Form.Item></Col>
            <Col span={8}><Form.Item name="interview_slot" label="Giờ bắt đầu" rules={[{ required: true }]}><TimeSelect placeholder="Chọn giờ bắt đầu" /></Form.Item></Col>
            <Col span={8}><Form.Item name="duration_minutes" label="Thời lượng (phút)" rules={[{ required: true }]}><InputNumber min={5} max={240} step={5} style={{ width: '100%' }} suffix="phút" /></Form.Item></Col>
          </Row>
          <Form.Item name="meet_link" label="Link Google Meet"><Input placeholder="https://meet.google.com/umb-milk-hr" /></Form.Item>
        </Form>
      </Modal>

      <Drawer open={Boolean(viewingCand)} title={viewingCand ? `Hồ sơ Ứng viên: ${viewingCand.full_name} (${viewingCand.candidate_code})` : 'Chi tiết ứng viên'} width={drawerWide ? '95vw' : '70vw'} onClose={() => setViewingCand(null)} destroyOnHidden extra={<Space><GuardButton size="small" icon={<EditOutlined />} perms={['candidate.manage']} onClick={() => { const c = viewingCand!; setViewingCand(null); openEditCand(c); }}>Chỉnh sửa</GuardButton><Button size="small" icon={drawerWide ? <ShrinkOutlined /> : <ExpandAltOutlined />} onClick={() => setDrawerWide((v) => !v)}>{drawerWide ? 'Thu gọn' : 'Mở rộng'}</Button><Button size="small" icon={<CloseOutlined />} onClick={() => setViewingCand(null)}>Đóng</Button></Space>}>
        {viewingCand && (
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="Mã ứng viên"><Tag color="geekblue">{String(viewingCand.candidate_code)}</Tag></Descriptions.Item>
            <Descriptions.Item label="Họ và tên">{String(viewingCand.full_name)}</Descriptions.Item>
            <Descriptions.Item label="Số điện thoại">{String(viewingCand.phone)}</Descriptions.Item>
            <Descriptions.Item label="Email">{String(viewingCand.email || 'Chưa cập nhật')}</Descriptions.Item>
            <Descriptions.Item label="Vị trí ứng tuyển">{String(viewingCand.positionLabel)}</Descriptions.Item>
            <Descriptions.Item label="Chi nhánh nguyện vọng">{String(viewingCand.branchName)}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái sàng lọc"><StatusTag value={String(viewingCand.stage)} /></Descriptions.Item>
            <Descriptions.Item label="Ghi chú HR">{String(viewingCand.hr_note || '—')}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </Card>
  );
}
