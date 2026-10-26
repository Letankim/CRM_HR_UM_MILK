'use client';

import { App, Button, Col, Descriptions, Drawer, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag } from 'antd';
import { CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseOutlined, DeleteOutlined, EditOutlined, ExpandAltOutlined, SaveOutlined, ShrinkOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { StatusTag } from '../StatusTag';
import { DateStringPicker, TimeSelect } from './DateTimePickers';
import { FilterToolbar } from './FilterToolbar';
import { usePermissionGuard } from './GuardButton';
import { RowActionButtons } from './RowActionButtons';

const INTERVIEW_STATUS_OPTIONS = [
  { value: 'ALL', label: 'Tất cả trạng thái lịch' }, { value: 'SCHEDULED', label: 'Đã xếp lịch' },
  { value: 'CONFIRMED', label: 'Ứng viên đã xác nhận' }, { value: 'RESCHEDULE_NEEDED', label: 'Cần đổi lịch phỏng vấn' },
  { value: 'COMPLETED', label: 'Đã hoàn thành phỏng vấn' },
];
const DECISION_OPTIONS = [
  { value: 'ALL', label: 'Tất cả quyết định HR' }, { value: 'PENDING', label: 'Chờ kết quả phỏng vấn' },
  { value: 'PASS', label: 'Đạt phỏng vấn (Mời thử việc)' }, { value: 'HOLD', label: 'Cân nhắc thêm' }, { value: 'FAIL', label: 'Chưa phù hợp' },
];

interface Props {
  branches: { value: string; label: string }[];
  interviewerOptions?: { value: string; label: string }[];
  externalEditTarget?: Record<string, unknown> | null;
  onClearExternalEdit?: () => void;
  onOpenScheduleModal: () => void;
}

export function RecruitmentInterviewsPane({ branches, interviewerOptions = [], externalEditTarget, onClearExternalEdit, onOpenScheduleModal }: Props) {
  const qc = useQueryClient();
  const canManageRec = usePermissionGuard({ perms: ['candidate.manage', 'interview.manage', 'system.config'] });
  const { message, modal } = App.useApp();

  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [decisionFilter, setDecisionFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const [viewingIv, setViewingIv] = useState<Record<string, unknown> | null>(null);
  const [drawerWide, setDrawerWide] = useState(false);
  const [evalTarget, setEvalTarget] = useState<Record<string, unknown> | null>(null);
  const [reschedTarget, setReschedTarget] = useState<Record<string, unknown> | null>(null);
  const [evalForm] = Form.useForm();
  const [reschedForm] = Form.useForm();
  const reschedDate = Form.useWatch('interview_date', reschedForm);
  const todayStr = dayjs().format('YYYY-MM-DD'), nowTimeStr = dayjs().format('HH:mm');

  const queryParams = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (debouncedQ) queryParams.set('q', debouncedQ);
  if (branchFilter !== 'ALL') queryParams.set('branch_id', branchFilter);
  if (statusFilter !== 'ALL') queryParams.set('status', statusFilter);
  if (decisionFilter !== 'ALL') queryParams.set('decision', decisionFilter);

  const ivQ = useQuery({
    queryKey: ['interviews', page, perPage, debouncedQ, branchFilter, statusFilter, decisionFilter],
    queryFn: () => api.list<Record<string, unknown>>(`/admin/interviews?${queryParams.toString()}`),
  });

  const refreshAll = () => ['candidates', 'interviews', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const putMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.put(url, body),
    onSuccess: (_, vars) => {
      const isEval = typeof vars.body === 'object' && vars.body !== null && 'decision' in vars.body;
      message.success(isEval ? 'Đã lưu kết quả đánh giá phỏng vấn' : 'Đã cập nhật lịch phỏng vấn và gửi thông báo đến những người liên quan');
      setEvalTarget(null); setReschedTarget(null); refreshAll();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Cập nhật thất bại'),
  });

  const delMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.delete(url, body),
    onSuccess: () => { message.success('Đã xóa lịch phỏng vấn'); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa thất bại'),
  });

  const openEvalModal = (r: Record<string, unknown>) => {
    setEvalTarget(r);
    evalForm.setFieldsValue({
      appearance_score: Number(r.appearance_score || 90), attitude_score: Number(r.attitude_score || 90),
      skill_score: Number(r.skill_score || 85), score: Number(r.score || 88),
      decision: r.decision && r.decision !== 'PENDING' ? r.decision : 'PASS',
      comment: String(r.comment || 'Thái độ tích cực, phù hợp khung ca đăng ký tại cửa hàng'),
    });
  };

  const openReschedModal = (r: Record<string, unknown>) => {
    setReschedTarget(r);
    const iso = String(r.scheduled_at || `${todayStr}T09:30:00`);
    const rawIds = String(r.interviewer_id || '').split(',').map((s) => s.trim()).filter(Boolean);
    const mappedIds = rawIds.map((raw) => interviewerOptions.find((o) => o.value === raw || o.label.includes(`(@${raw})`))?.value ?? raw);
    reschedForm.setFieldsValue({
      interviewer_ids: mappedIds, candidate_confirmed: Boolean(r.candidate_confirmed),
      reschedule_requested: Boolean(r.reschedule_requested), reschedule_reason: String(r.reschedule_reason || ''),
      interview_date: iso.slice(0, 10), interview_slot: iso.slice(11, 16) || '09:30',
      duration_minutes: Number(r.duration_minutes || 30), meet_link: String(r.meet_link || 'https://meet.google.com/umb-milk-hr'),
    });
  };

  useEffect(() => {
    if (externalEditTarget) { openReschedModal(externalEditTarget); onClearExternalEdit?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalEditTarget]);

  const rows = ivQ.data?.data ?? [];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <FilterToolbar
        searchPlaceholder="Tìm ứng viên, người phỏng vấn..."
        searchValue={q}
        onSearchChange={(v) => { setQ(v); setPage(1); }}
        selects={[
          { key: 'branch', value: branchFilter, width: 185, options: [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branches], onChange: (v) => { setBranchFilter(v); setPage(1); } },
          { key: 'status', value: statusFilter, width: 190, options: INTERVIEW_STATUS_OPTIONS, onChange: (v) => { setStatusFilter(v); setPage(1); } },
          { key: 'decision', value: decisionFilter, width: 190, options: DECISION_OPTIONS, onChange: (v) => { setDecisionFilter(v); setPage(1); } },
        ]}
        onRefresh={refreshAll}
        refreshing={ivQ.isFetching}
        onExportExcel={() => exportToExcel({ fileName: 'Lich_phong_van.xls', sheetTitle: 'Danh sách Lịch Phỏng vấn & Kết quả HR', rows, columns: [{ header: 'Mã UV', key: 'candidateCode' }, { header: 'Ứng viên', key: 'candidateName' }, { header: 'Chi nhánh', key: 'branchName' }, { header: 'Người phỏng vấn', key: 'interviewerLabel' }, { header: 'Thời gian', key: 'scheduled_at' }, { header: 'Thời lượng (phút)', key: 'duration_minutes' }, { header: 'Google Meet', key: 'meet_link' }, { header: 'Điểm', key: 'score' }, { header: 'Quyết định HR', key: 'decision' }, { header: 'Nhận xét', key: 'comment' }] })}
        primaryActionLabel={canManageRec ? 'Đặt lịch phỏng vấn' : undefined}
        onPrimaryAction={canManageRec ? onOpenScheduleModal : undefined}
      />

      <Table
        size="small" rowKey="id" loading={ivQ.isLoading}
        pagination={{ current: page, pageSize: perPage, total: ivQ.data?.meta.pagination.total ?? rows.length, showSizeChanger: true, pageSizeOptions: ['10', '12', '20', '50', '100'], showTotal: (t) => `Tổng ${t} lịch phỏng vấn`, onChange: (p, ps) => { setPage(ps !== perPage ? 1 : p); setPerPage(ps); } }}
        dataSource={rows}
        columns={[
          { title: 'Ứng viên phỏng vấn', dataIndex: 'candidateName', ellipsis: true, render: (v: string, r) => <span style={{ fontWeight: 600 }}>{v} {r.candidateCode ? `(${r.candidateCode})` : ''}</span> },
          { title: 'Chi nhánh', dataIndex: 'branchName', width: 165, ellipsis: true },
          { title: 'Người phỏng vấn', dataIndex: 'interviewerLabel', ellipsis: true, render: (v: string, r) => v || String(r.interviewer_id ?? '') },
          {
            title: 'Thời gian phỏng vấn', dataIndex: 'scheduled_at', width: 165,
            render: (v: string, r) => <span className="num" style={{ fontWeight: 600 }}>{String(v).slice(0, 16).replace('T', ' ')} ({String(r.duration_minutes ?? 30)}p)</span>,
          },
          {
            title: 'Xác nhận', dataIndex: 'status', width: 135,
            render: (_, r) => r.reschedule_requested ? <Tag color="warning" icon={<ClockCircleOutlined />}>Cần đổi lịch</Tag> : r.candidate_confirmed ? <Tag color="success" icon={<CheckCircleOutlined />}>Đã xác nhận</Tag> : <Tag color="default">Chờ xác nhận</Tag>,
          },
          {
            title: 'Kết quả HR', dataIndex: 'decision', width: 165,
            render: (v: string, r) => <Space size={4}><StatusTag value={v} />{v !== 'PENDING' && <Tag color="blue" className="num">{String(r.score)}đ</Tag>}</Space>,
          },
          {
            title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem chi tiết lịch phỏng vấn"
                onViewDetail={() => setViewingIv(r)}
                menuItems={canManageRec ? [
                  ...(r.meet_link ? [{ key: 'meet', icon: <VideoCameraOutlined style={{ color: '#2563EB' }} />, label: 'Mở phòng họp Google Meet', onClick: () => window.open(String(r.meet_link), '_blank') }] : []),
                  { key: 'eval', icon: <EditOutlined style={{ color: '#2563EB' }} />, label: 'Chấm điểm & Ra quyết định HR', onClick: () => openEvalModal(r) },
                  { key: 'resched', icon: <ClockCircleOutlined style={{ color: '#D97706' }} />, label: 'Chỉnh sửa / Đổi lịch phỏng vấn', onClick: () => openReschedModal(r) },
                  { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa lịch phỏng vấn', onClick: () => modal.confirm({ title: 'Xóa lịch phỏng vấn này?', content: `Lịch phỏng vấn của ứng viên "${r.candidateName}" sẽ bị xóa.`, okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delMut.mutateAsync({ url: `/admin/interviews/${r.id}`, body: { version: r.version } }) }) },
                ] : []}
              />
            ),
          },
        ]}
      />

      <Drawer open={Boolean(viewingIv)} title={viewingIv ? `Chi tiết Phỏng vấn: ${viewingIv.candidateName}` : 'Chi tiết phỏng vấn'} width={drawerWide ? '95vw' : '65vw'} onClose={() => setViewingIv(null)} destroyOnHidden extra={<Space>{Boolean(viewingIv?.meet_link) && <Button size="small" type="primary" icon={<VideoCameraOutlined />} href={String(viewingIv?.meet_link)} target="_blank">Mở Google Meet</Button>}{canManageRec && viewingIv && <Button size="small" icon={<ClockCircleOutlined />} onClick={() => { const iv = viewingIv; setViewingIv(null); openReschedModal(iv); }}>Chỉnh sửa lịch</Button>}{canManageRec && viewingIv && <Button size="small" icon={<EditOutlined />} onClick={() => { const iv = viewingIv; setViewingIv(null); openEvalModal(iv); }}>Chấm điểm HR</Button>}<Button size="small" icon={drawerWide ? <ShrinkOutlined /> : <ExpandAltOutlined />} onClick={() => setDrawerWide((v) => !v)}>{drawerWide ? 'Thu gọn' : 'Mở rộng'}</Button><Button size="small" icon={<CloseOutlined />} onClick={() => setViewingIv(null)}>Đóng</Button></Space>}>
        {viewingIv && (
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="Ứng viên">{String(viewingIv.candidateName)} {viewingIv.candidateCode ? <Tag color="geekblue">{String(viewingIv.candidateCode)}</Tag> : null}</Descriptions.Item>
            <Descriptions.Item label="Số điện thoại">{String(viewingIv.candidatePhone || '—')}</Descriptions.Item>
            <Descriptions.Item label="Vị trí ứng tuyển">{String(viewingIv.positionLabel || '—')}</Descriptions.Item>
            <Descriptions.Item label="Chi nhánh">{String(viewingIv.branchName || '—')}</Descriptions.Item>
            <Descriptions.Item label="Thời gian phỏng vấn">{String(viewingIv.scheduled_at || '').slice(0, 16).replace('T', ' ')} ({String(viewingIv.duration_minutes ?? 30)} phút)</Descriptions.Item>
            <Descriptions.Item label="Phòng họp trực tuyến">{viewingIv.meet_link ? <Button size="small" type="link" icon={<VideoCameraOutlined />} href={String(viewingIv.meet_link)} target="_blank" style={{ padding: 0, height: 'auto' }}>{String(viewingIv.meet_link)}</Button> : '—'}</Descriptions.Item>
            <Descriptions.Item label="Hội đồng phỏng vấn" span={2}>{String(viewingIv.interviewerLabel || viewingIv.interviewer_id || '—')}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái xác nhận">{viewingIv.reschedule_requested ? <Tag color="warning" icon={<ClockCircleOutlined />}>Cần đổi lịch</Tag> : viewingIv.candidate_confirmed ? <Tag color="success" icon={<CheckCircleOutlined />}>Đã xác nhận</Tag> : <Tag>Chờ xác nhận</Tag>}</Descriptions.Item>
            <Descriptions.Item label="Quyết định HR"><Space size={6}><StatusTag value={String(viewingIv.decision)} />{viewingIv.decision !== 'PENDING' && <Tag color="blue">{String(viewingIv.score)} điểm</Tag>}</Space></Descriptions.Item>
            {Boolean(viewingIv.reschedule_reason) && <Descriptions.Item label="Lý do xin đổi lịch" span={2}>{String(viewingIv.reschedule_reason)}</Descriptions.Item>}
            <Descriptions.Item label="Điểm thành phần" span={2}>Tác phong: <b>{String(viewingIv.appearance_score ?? 0)}</b> · Thái độ: <b>{String(viewingIv.attitude_score ?? 0)}</b> · Kỹ năng: <b>{String(viewingIv.skill_score ?? 0)}</b></Descriptions.Item>
            <Descriptions.Item label="Nhận xét của HR" span={2}>{String(viewingIv.comment || 'Chưa có nhận xét đánh giá')}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>

      <Modal width={620} open={Boolean(evalTarget)} forceRender destroyOnHidden title={evalTarget ? `Chấm điểm & Quyết định Phỏng vấn: ${evalTarget.candidateName}` : 'Đánh giá phỏng vấn'} okText="Lưu kết quả phỏng vấn" cancelText="Hủy bỏ" okButtonProps={{ icon: <SaveOutlined />, loading: putMut.isPending }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={() => setEvalTarget(null)} onOk={() => evalForm.submit()}>
        <Form form={evalForm} layout="vertical" onFinish={(v) => putMut.mutate({ url: `/admin/interviews/${evalTarget!.id}/evaluate`, body: { ...v, version: evalTarget!.version } })}>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="appearance_score" label="Điểm tác phong (0-100)" rules={[{ required: true }]}><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="attitude_score" label="Điểm thái độ (0-100)" rules={[{ required: true }]}><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="skill_score" label="Điểm kỹ năng (0-100)" rules={[{ required: true }]}><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="score" label="Điểm tổng kết (0-100)"><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="decision" label="Quyết định của HR" rules={[{ required: true }]}><Select options={[{ value: 'PASS', label: 'Đạt phỏng vấn — Mời thử việc' }, { value: 'HOLD', label: 'Cân nhắc thêm' }, { value: 'FAIL', label: 'Không đạt / Chưa phù hợp' }]} /></Form.Item></Col>
            <Col span={24}><Form.Item name="comment" label="Nhận xét chi tiết của HR" rules={[{ required: true, message: 'Vui lòng nhập nhận xét đánh giá phỏng vấn' }]}><Input.TextArea rows={3} placeholder="Ghi nhận thái độ, khả năng đáp ứng ca làm việc, kỹ năng giao tiếp..." /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      <Modal width={640} open={Boolean(reschedTarget)} forceRender destroyOnHidden title={reschedTarget ? `Chỉnh sửa / Đổi lịch Phỏng vấn: ${reschedTarget.candidateName}` : 'Chỉnh sửa lịch phỏng vấn'} okText="Lưu chỉnh sửa & Thông báo" cancelText="Hủy bỏ" okButtonProps={{ icon: <SaveOutlined />, loading: putMut.isPending }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={() => setReschedTarget(null)} onOk={() => reschedForm.submit()}>
        <Form form={reschedForm} layout="vertical" onFinish={(v) => putMut.mutate({ url: `/admin/interviews/${reschedTarget!.id}/evaluate`, body: { version: reschedTarget!.version, interviewer_ids: v.interviewer_ids, duration_minutes: Number(v.duration_minutes || 30), meet_link: v.meet_link, candidate_confirmed: Boolean(v.candidate_confirmed), reschedule_requested: Boolean(v.reschedule_requested), reschedule_reason: v.reschedule_reason, scheduled_at: `${v.interview_date}T${v.interview_slot}:00+07:00` } })}>
          <Row gutter={12}>
            <Col span={24}><Form.Item name="interviewer_ids" label="Người tham gia phỏng vấn (tự động nhận thông báo chỉnh sửa)" rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 người phỏng vấn' }]}><Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder="Chọn người tham gia phỏng vấn" options={interviewerOptions} /></Form.Item></Col>
            <Col span={8}><Form.Item name="interview_date" label="Ngày phỏng vấn" rules={[{ required: true }]}><DateStringPicker minDate={todayStr} /></Form.Item></Col>
            <Col span={8}><Form.Item name="interview_slot" label="Giờ bắt đầu" rules={[{ required: true }]}><TimeSelect minTime={reschedDate === todayStr ? nowTimeStr : undefined} /></Form.Item></Col>
            <Col span={8}><Form.Item name="duration_minutes" label="Thời lượng" rules={[{ required: true }]}><InputNumber min={5} max={240} step={5} style={{ width: '100%' }} suffix="phút" /></Form.Item></Col>
            <Col span={24}><Form.Item name="meet_link" label="Link Google Meet / Calendar"><Input placeholder="https://meet.google.com/umb-milk-hr" /></Form.Item></Col>
            <Col span={12}><Form.Item name="candidate_confirmed" label="Trạng thái xác nhận"><Select options={[{ value: true, label: 'Ứng viên đã xác nhận tham gia' }, { value: false, label: 'Chưa xác nhận' }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="reschedule_requested" label="Yêu cầu đổi lịch"><Select options={[{ value: false, label: 'Giữ lịch bình thường' }, { value: true, label: 'Ứng viên xin đổi lịch phỏng vấn' }]} /></Form.Item></Col>
            <Col span={24}><Form.Item name="reschedule_reason" label="Lý do đổi lịch / Ghi chú chỉnh sửa"><Input.TextArea rows={2} placeholder="Ví dụ: Ứng viên bận lịch thi ở trường buổi sáng, xin dời sang 14:30..." /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </Space>
  );
}
