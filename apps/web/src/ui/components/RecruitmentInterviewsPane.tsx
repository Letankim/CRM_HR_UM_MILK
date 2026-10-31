'use client';

import { App, Button, Col, Descriptions, Form, Input, InputNumber, Modal, Row, Select, Space, Tag } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, SaveOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { StatusTag } from '../StatusTag';
import { BaseDetailDrawer } from './BaseDetailDrawer';
import { SelectableTable } from './BulkActionBar';
import { DateStringPicker, TimeSelect } from './DateTimePickers';
import { FilterToolbar } from './FilterToolbar';
import { usePermissionGuard } from './GuardButton';
import { RowActionButtons } from './RowActionButtons';

const INTERVIEW_STATUS_OPTIONS = [
  { value: 'ALL', label: 'Tất cả trạng thái lịch' }, { value: 'SCHEDULED', label: 'Đã xếp lịch' },
  { value: 'CONFIRMED', label: 'Ứng viên đã xác nhận' }, { value: 'RESCHEDULE_NEEDED', label: 'Cần đổi lịch phỏng vấn' }, { value: 'COMPLETED', label: 'Đã hoàn thành phỏng vấn' },
];
const DECISION_OPTIONS = [
  { value: 'ALL', label: 'Tất cả quyết định HR' }, { value: 'PENDING', label: 'Chờ kết quả phỏng vấn' },
  { value: 'PASS', label: 'Đạt phỏng vấn (Mời thử việc)' }, { value: 'HOLD', label: 'Cân nhắc thêm' }, { value: 'FAIL', label: 'Chưa phù hợp' },
];
interface Props { branches: { value: string; label: string }[]; interviewerOptions?: { value: string; label: string }[]; externalEditTarget?: Record<string, unknown> | null; onClearExternalEdit?: () => void; onOpenScheduleModal: () => void }

export function RecruitmentInterviewsPane({ branches, interviewerOptions = [], externalEditTarget, onClearExternalEdit, onOpenScheduleModal }: Props) {
  const qc = useQueryClient();
  const canManageRec = usePermissionGuard({ perms: ['interview.manage'] });
  const { message, modal } = App.useApp();

  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [decisionFilter, setDecisionFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const [viewingIv, setViewingIv] = useState<Record<string, unknown> | null>(null);
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
      message.success(isEval ? 'Đã lưu kết quả đánh giá phỏng vấn' : 'Đã cập nhật lịch phỏng vấn thành công');
      setEvalTarget(null); setReschedTarget(null); refreshAll();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Cập nhật thất bại'),
  });

  const delMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.delete(url, body),
    onSuccess: () => { message.success('Đã xóa lịch phỏng vấn'); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa thất bại'),
  });

  const calcAvgScore = (a: unknown, b: unknown, c: unknown) =>
    Math.round((((Number(a ?? 0) || 0) + (Number(b ?? 0) || 0) + (Number(c ?? 0) || 0)) / 3) * 10) / 10;

  const openEvalModal = (r: Record<string, unknown>) => {
    setEvalTarget(r);
    const hasPrev = Boolean(r.decision && r.decision !== 'PENDING');
    const app = hasPrev ? Number(r.appearance_score ?? 0) : 90;
    const att = hasPrev ? Number(r.attitude_score ?? 0) : 90;
    const skl = hasPrev ? Number(r.skill_score ?? 0) : 85;
    evalForm.setFieldsValue({
      appearance_score: app, attitude_score: att, skill_score: skl, score: calcAvgScore(app, att, skl),
      decision: hasPrev ? r.decision : 'PASS',
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
  const liveViewingIv = viewingIv ? (rows.find((x) => x.id === viewingIv.id) ?? viewingIv) : null;
  const exportIvs = (list: Record<string, unknown>[]) => exportToExcel({ fileName: 'Lich_phong_van.xls', sheetTitle: 'Danh sách Lịch Phỏng vấn & Kết quả HR', rows: list, columns: [{ header: 'Mã UV', key: 'candidateCode' }, { header: 'Ứng viên', key: 'candidateName' }, { header: 'Chi nhánh', key: 'branchName' }, { header: 'Người phỏng vấn', key: 'interviewerLabel' }, { header: 'Thời gian', key: 'scheduled_at' }, { header: 'Thời lượng (phút)', key: 'duration_minutes' }, { header: 'Google Meet', key: 'meet_link' }, { header: 'Điểm', key: 'score' }, { header: 'Quyết định HR', key: 'decision' }, { header: 'Nhận xét', key: 'comment' }] });

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
        onExportExcel={() => exportIvs(rows)}
        primaryActionLabel={canManageRec ? 'Đặt lịch phỏng vấn' : undefined}
        onPrimaryAction={canManageRec ? onOpenScheduleModal : undefined}
      />

      <SelectableTable<Record<string, unknown>>
        size="small" rowKey="id" loading={ivQ.isLoading} onRowClick={setViewingIv}
        bulkActions={[
          ...(canManageRec ? [
            { key: 'pass', label: 'Duyệt Đạt phỏng vấn đã chọn', type: 'primary' as const, icon: <CheckCircleOutlined />, eligibleFilter: (x: Record<string, unknown>) => x.decision === 'PENDING', onClick: async (sel: Record<string, unknown>[]) => { for (const r of sel) await api.put(`/admin/interviews/${r.id}/evaluate`, { version: r.version, decision: 'PASS', appearance_score: 90, attitude_score: 90, skill_score: 88, score: 89, comment: 'Đạt yêu cầu phỏng vấn, mời thử việc' }); message.success('Đã duyệt Đạt phỏng vấn cho các lịch hợp lệ'); refreshAll(); } },
            { key: 'delete', label: 'Xóa lịch phỏng vấn đã chọn', danger: true, icon: <DeleteOutlined />, confirm: 'Xác nhận xóa các lịch phỏng vấn đã chọn?', onClick: async (sel: Record<string, unknown>[]) => { for (const r of sel) await api.delete(`/admin/interviews/${r.id}`, { version: r.version }); message.success('Đã xóa các lịch phỏng vấn đã chọn'); refreshAll(); } },
          ] : []),
          { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (sel) => exportIvs(sel) },
        ]}
        pagination={{ current: page, pageSize: perPage, total: ivQ.data?.meta.pagination.total ?? rows.length, showSizeChanger: true, pageSizeOptions: ['10', '12', '20', '50', '100'], showTotal: (t) => `Tổng ${t} lịch phỏng vấn`, onChange: (p, ps) => { setPage(ps !== perPage ? 1 : p); setPerPage(ps); } }}
        dataSource={rows}
        columns={[
          { title: 'Ứng viên phỏng vấn', dataIndex: 'candidateName', ellipsis: true, render: (v: string, r) => <span style={{ fontWeight: 600 }}>{v} {r.candidateCode ? `(${r.candidateCode})` : ''}</span> },
          { title: 'Chi nhánh', dataIndex: 'branchName', width: 165, ellipsis: true },
          { title: 'Người phỏng vấn', dataIndex: 'interviewerLabel', ellipsis: true, render: (v: string, r) => v || String(r.interviewer_id ?? '') },
            { title: 'Thời gian phỏng vấn', dataIndex: 'scheduled_at', width: 165, render: (v: string, r) => <span className="num" style={{ fontWeight: 600 }}>{String(v).slice(0, 16).replace('T', ' ')} ({String(r.duration_minutes ?? 30)}p)</span> },
            { title: 'Xác nhận', dataIndex: 'status', width: 135, render: (_, r) => r.reschedule_requested ? <Tag color="warning" icon={<ClockCircleOutlined />}>Cần đổi lịch</Tag> : r.candidate_confirmed ? <Tag color="success" icon={<CheckCircleOutlined />}>Đã xác nhận</Tag> : <Tag color="default">Chờ xác nhận</Tag> },
            { title: 'Kết quả HR', dataIndex: 'decision', width: 165, render: (v: string, r) => <Space size={4}><StatusTag value={v} />{v !== 'PENDING' && <Tag color="blue" className="num">{String(r.score)}đ</Tag>}</Space> },
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

      <BaseDetailDrawer open={Boolean(liveViewingIv)} title={liveViewingIv ? `Chi tiết Phỏng vấn: ${liveViewingIv.candidateName}` : 'Chi tiết phỏng vấn'} onClose={() => setViewingIv(null)} extra={<>{Boolean(liveViewingIv?.meet_link) && <Button size="small" type="primary" icon={<VideoCameraOutlined />} href={String(liveViewingIv?.meet_link)} target="_blank">Mở Google Meet</Button>}{canManageRec && liveViewingIv && <Button size="small" icon={<ClockCircleOutlined />} onClick={() => { const iv = liveViewingIv; setViewingIv(null); openReschedModal(iv); }}>Chỉnh sửa lịch</Button>}{canManageRec && liveViewingIv && <Button size="small" icon={<EditOutlined />} onClick={() => { const iv = liveViewingIv; setViewingIv(null); openEvalModal(iv); }}>Chấm điểm HR</Button>}</>}>
        {liveViewingIv && (
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="Ứng viên">{String(liveViewingIv.candidateName)} {liveViewingIv.candidateCode ? <Tag color="geekblue">{String(liveViewingIv.candidateCode)}</Tag> : null}</Descriptions.Item>
            <Descriptions.Item label="Số điện thoại">{String(liveViewingIv.candidatePhone || '—')}</Descriptions.Item>
            <Descriptions.Item label="Vị trí ứng tuyển">{String(liveViewingIv.positionLabel || '—')}</Descriptions.Item>
            <Descriptions.Item label="Chi nhánh">{String(liveViewingIv.branchName || '—')}</Descriptions.Item>
            <Descriptions.Item label="Thời gian phỏng vấn">{String(liveViewingIv.scheduled_at || '').slice(0, 16).replace('T', ' ')} ({String(liveViewingIv.duration_minutes ?? 30)} phút)</Descriptions.Item>
            <Descriptions.Item label="Phòng họp trực tuyến">{liveViewingIv.meet_link ? <Button size="small" type="link" icon={<VideoCameraOutlined />} href={String(liveViewingIv.meet_link)} target="_blank" style={{ padding: 0, height: 'auto' }}>{String(liveViewingIv.meet_link)}</Button> : '—'}</Descriptions.Item>
            <Descriptions.Item label="Hội đồng phỏng vấn" span={2}>{String(liveViewingIv.interviewerLabel || liveViewingIv.interviewer_id || '—')}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái xác nhận">{liveViewingIv.reschedule_requested ? <Tag color="warning" icon={<ClockCircleOutlined />}>Cần đổi lịch</Tag> : liveViewingIv.candidate_confirmed ? <Tag color="success" icon={<CheckCircleOutlined />}>Đã xác nhận</Tag> : <Tag>Chờ xác nhận</Tag>}</Descriptions.Item>
            <Descriptions.Item label="Quyết định HR"><Space size={6}><StatusTag value={String(liveViewingIv.decision)} />{liveViewingIv.decision !== 'PENDING' && <Tag color="blue">{String(liveViewingIv.score)} điểm</Tag>}</Space></Descriptions.Item>
            {Boolean(liveViewingIv.reschedule_reason) && <Descriptions.Item label="Lý do xin đổi lịch" span={2}>{String(liveViewingIv.reschedule_reason)}</Descriptions.Item>}
            <Descriptions.Item label="Điểm thành phần" span={2}>Tác phong: <b>{String(liveViewingIv.appearance_score ?? 0)}</b> · Thái độ: <b>{String(liveViewingIv.attitude_score ?? 0)}</b> · Kỹ năng: <b>{String(liveViewingIv.skill_score ?? 0)}</b></Descriptions.Item>
            <Descriptions.Item label="Nhận xét của HR" span={2}>{String(liveViewingIv.comment || 'Chưa có nhận xét đánh giá')}</Descriptions.Item>
          </Descriptions>
        )}
      </BaseDetailDrawer>

      <Modal width={620} open={Boolean(evalTarget)} forceRender destroyOnHidden title={evalTarget ? `Chấm điểm & Quyết định Phỏng vấn: ${evalTarget.candidateName}` : 'Đánh giá phỏng vấn'} okText="Lưu kết quả phỏng vấn" cancelText="Hủy bỏ" okButtonProps={{ icon: <SaveOutlined />, loading: putMut.isPending }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={() => setEvalTarget(null)} onOk={() => evalForm.submit()}>
        <Form form={evalForm} layout="vertical" onValuesChange={(changed, all) => { if ('appearance_score' in changed || 'attitude_score' in changed || 'skill_score' in changed) evalForm.setFieldValue('score', calcAvgScore(all.appearance_score, all.attitude_score, all.skill_score)); }} onFinish={(v) => { const score = calcAvgScore(v.appearance_score, v.attitude_score, v.skill_score); putMut.mutate({ url: `/admin/interviews/${evalTarget!.id}/evaluate`, body: { ...v, score, version: evalTarget!.version } }); }}>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="appearance_score" label="Điểm tác phong (0-100)" rules={[{ required: true }]}><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="attitude_score" label="Điểm thái độ (0-100)" rules={[{ required: true }]}><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="skill_score" label="Điểm kỹ năng (0-100)" rules={[{ required: true }]}><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="score" label="Điểm tổng kết TB (Tự động)"><InputNumber min={0} max={100} disabled style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="decision" label="Quyết định của HR" rules={[{ required: true }]}><Select options={[{ value: 'PASS', label: 'Đạt phỏng vấn — Mời thử việc' }, { value: 'HOLD', label: 'Cân nhắc thêm' }, { value: 'FAIL', label: 'Không đạt / Chưa phù hợp' }]} /></Form.Item></Col>
            <Col span={24}><Form.Item name="comment" label="Nhận xét chi tiết của HR" rules={[{ required: true, message: 'Vui lòng nhập nhận xét đánh giá phỏng vấn' }]}><Input.TextArea rows={3} placeholder="Ghi nhận thái độ, khả năng đáp ứng ca làm việc, kỹ năng giao tiếp..." /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      <Modal width={640} open={Boolean(reschedTarget)} forceRender destroyOnHidden title={reschedTarget ? `Chỉnh sửa / Đổi lịch Phỏng vấn: ${reschedTarget.candidateName}` : 'Chỉnh sửa lịch phỏng vấn'} okText="Lưu cập nhật" cancelText="Hủy bỏ" okButtonProps={{ icon: <SaveOutlined />, loading: putMut.isPending }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={() => setReschedTarget(null)} onOk={() => reschedForm.submit()}>
        <Form form={reschedForm} layout="vertical" onFinish={(v) => putMut.mutate({ url: `/admin/interviews/${reschedTarget!.id}/evaluate`, body: { version: reschedTarget!.version, interviewer_ids: v.interviewer_ids, duration_minutes: Number(v.duration_minutes || 30), meet_link: v.meet_link, candidate_confirmed: Boolean(v.candidate_confirmed), reschedule_requested: Boolean(v.reschedule_requested), reschedule_reason: v.reschedule_reason, scheduled_at: `${v.interview_date}T${v.interview_slot}:00+07:00` } })}>
          <Row gutter={12}>
            <Col span={24}><Form.Item name="interviewer_ids" label="Người tham gia phỏng vấn" rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 người phỏng vấn' }]}><Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder="Chọn người tham gia phỏng vấn" options={interviewerOptions} /></Form.Item></Col>
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
