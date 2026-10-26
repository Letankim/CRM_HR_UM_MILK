'use client';

import { App, Button, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag } from 'antd';
import { CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseOutlined, DeleteOutlined, EditOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { StatusTag } from '../StatusTag';
import { DateStringPicker, TimeSelect } from './DateTimePickers';
import { FilterToolbar } from './FilterToolbar';
import { usePermissionGuard } from './GuardButton';
import { RowActionButtons } from './RowActionButtons';

const INTERVIEW_STATUS_OPTIONS = [
  { value: 'ALL', label: 'Tất cả trạng thái lịch' },
  { value: 'SCHEDULED', label: 'Đã xếp lịch' },
  { value: 'CONFIRMED', label: 'Ứng viên đã xác nhận' },
  { value: 'RESCHEDULE_NEEDED', label: 'Cần đổi lịch phỏng vấn' },
  { value: 'COMPLETED', label: 'Đã hoàn thành phỏng vấn' },
];

const DECISION_OPTIONS = [
  { value: 'ALL', label: 'Tất cả quyết định HR' },
  { value: 'PENDING', label: 'Chờ kết quả phỏng vấn' },
  { value: 'PASS', label: 'Đạt phỏng vấn (Mời thử việc)' },
  { value: 'HOLD', label: 'Cân nhắc thêm' },
  { value: 'FAIL', label: 'Chưa phù hợp' },
];

interface Props {
  branches: { value: string; label: string }[];
  onOpenScheduleModal: () => void;
}

export function RecruitmentInterviewsPane({ branches, onOpenScheduleModal }: Props) {
  const qc = useQueryClient();
  const canManageRec = usePermissionGuard({ perms: ['candidate.manage', 'interview.manage'] });
  const { message, modal } = App.useApp();

  const [q, setQ] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [decisionFilter, setDecisionFilter] = useState('ALL');

  const [evalTarget, setEvalTarget] = useState<Record<string, unknown> | null>(null);
  const [reschedTarget, setReschedTarget] = useState<Record<string, unknown> | null>(null);
  const [evalForm] = Form.useForm();
  const [reschedForm] = Form.useForm();

  const queryParams = new URLSearchParams();
  if (q) queryParams.set('q', q);
  if (branchFilter !== 'ALL') queryParams.set('branch_id', branchFilter);
  if (statusFilter !== 'ALL') queryParams.set('status', statusFilter);
  if (decisionFilter !== 'ALL') queryParams.set('decision', decisionFilter);

  const ivQ = useQuery({
    queryKey: ['interviews', q, branchFilter, statusFilter, decisionFilter],
    queryFn: () => api.get<Record<string, unknown>[]>(`/admin/interviews?${queryParams.toString()}`),
  });

  const refreshAll = () => ['candidates', 'interviews'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const putMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.put(url, body),
    onSuccess: () => {
      message.success('Đã cập nhật lịch phỏng vấn thành công');
      setEvalTarget(null);
      setReschedTarget(null);
      refreshAll();
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
      appearance_score: Number(r.appearance_score || 90),
      attitude_score: Number(r.attitude_score || 90),
      skill_score: Number(r.skill_score || 85),
      score: Number(r.score || 88),
      decision: r.decision && r.decision !== 'PENDING' ? r.decision : 'PASS',
      comment: String(r.comment || 'Thái độ tích cực, phù hợp khung ca đăng ký tại cửa hàng'),
    });
  };

  const openReschedModal = (r: Record<string, unknown>) => {
    setReschedTarget(r);
    const iso = String(r.scheduled_at || '2026-10-26T09:30:00');
    reschedForm.setFieldsValue({
      candidate_confirmed: Boolean(r.candidate_confirmed),
      reschedule_requested: Boolean(r.reschedule_requested),
      reschedule_reason: String(r.reschedule_reason || ''),
      interview_date: iso.slice(0, 10),
      interview_slot: iso.slice(11, 16) || '09:30',
    });
  };

  const rows = ivQ.data ?? [];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <FilterToolbar
        searchPlaceholder="Tìm ứng viên, người phỏng vấn..."
        searchValue={q}
        onSearchChange={setQ}
        selects={[
          { key: 'branch', value: branchFilter, width: 185, options: [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branches], onChange: setBranchFilter },
          { key: 'status', value: statusFilter, width: 190, options: INTERVIEW_STATUS_OPTIONS, onChange: setStatusFilter },
          { key: 'decision', value: decisionFilter, width: 190, options: DECISION_OPTIONS, onChange: setDecisionFilter },
        ]}
        onRefresh={refreshAll}
        refreshing={ivQ.isFetching}
        onExportExcel={() => exportToExcel({ fileName: 'Lich_phong_van.xls', sheetTitle: 'Danh sách Lịch Phỏng vấn & Kết quả HR', rows, columns: [{ header: 'Mã UV', key: 'candidateCode' }, { header: 'Ứng viên', key: 'candidateName' }, { header: 'Chi nhánh', key: 'branchName' }, { header: 'Người phỏng vấn', key: 'interviewerLabel' }, { header: 'Thời gian', key: 'scheduled_at' }, { header: 'Thời lượng (phút)', key: 'duration_minutes' }, { header: 'Google Meet', key: 'meet_link' }, { header: 'Điểm', key: 'score' }, { header: 'Quyết định HR', key: 'decision' }, { header: 'Nhận xét', key: 'comment' }] })}
        primaryActionLabel={canManageRec ? 'Đặt lịch phỏng vấn 30 phút' : undefined}
        onPrimaryAction={canManageRec ? onOpenScheduleModal : undefined}
      />

      <Table
        size="small" rowKey="id" loading={ivQ.isLoading} pagination={{ pageSize: 10 }} dataSource={rows}
        columns={[
          { title: 'Ứng viên phỏng vấn', dataIndex: 'candidateName', render: (v: string, r) => <Space direction="vertical" size={0}><span style={{ fontWeight: 600 }}>{v} {r.candidateCode ? `(${r.candidateCode})` : ''}</span><span style={{ fontSize: 12, color: '#64748B' }}>{String(r.positionLabel || '')} · {String(r.branchName || '')}</span></Space> },
          { title: 'Người phỏng vấn', dataIndex: 'interviewerLabel', render: (v: string, r) => v || String(r.interviewer_id ?? '') },
          {
            title: 'Khung giờ & Google Meet', dataIndex: 'scheduled_at', width: 220,
            render: (v: string, r) => (
              <Space direction="vertical" size={2}>
                <span className="num" style={{ fontWeight: 600 }}>{String(v).slice(0, 16).replace('T', ' ')} ({String(r.duration_minutes ?? 30)}p)</span>
                {Boolean(r.meet_link) && <Button size="small" type="link" icon={<VideoCameraOutlined />} href={String(r.meet_link)} target="_blank" style={{ padding: 0, height: 'auto' }}>Mở Google Meet</Button>}
              </Space>
            ),
          },
          {
            title: 'Xác nhận & Đổi lịch', dataIndex: 'status', width: 175,
            render: (_, r) => (
              <Space direction="vertical" size={2}>
                {r.reschedule_requested ? (
                  <Tag color="warning" icon={<ClockCircleOutlined />}>Cần đổi lịch</Tag>
                ) : r.candidate_confirmed ? (
                  <Tag color="success" icon={<CheckCircleOutlined />}>Đã xác nhận</Tag>
                ) : (
                  <Tag color="default">Chờ xác nhận</Tag>
                )}
                {Boolean(r.reschedule_reason) && <span style={{ fontSize: 11, color: '#B45309' }}>{String(r.reschedule_reason)}</span>}
              </Space>
            ),
          },
          {
            title: 'Chấm điểm & Quyết định HR', dataIndex: 'decision', width: 210,
            render: (v: string, r) => (
              <Space direction="vertical" size={2}>
                <Space size={4}><StatusTag value={v} />{v !== 'PENDING' && <Tag color="blue" className="num">{String(r.score)}đ</Tag>}</Space>
                {Boolean(r.comment) && <span style={{ fontSize: 12, color: '#475569' }}>{String(r.comment)}</span>}
              </Space>
            ),
          },
          {
            title: 'Thao tác', width: 80, fixed: 'right', align: 'right',
            render: (_, r) => canManageRec ? (
              <RowActionButtons
                menuItems={[
                  { key: 'eval', icon: <EditOutlined style={{ color: '#2563EB' }} />, label: 'Chấm điểm & Ra quyết định HR', onClick: () => openEvalModal(r) },
                  { key: 'resched', icon: <ClockCircleOutlined style={{ color: '#D97706' }} />, label: 'Xác nhận / Đổi lịch phỏng vấn', onClick: () => openReschedModal(r) },
                  { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa lịch phỏng vấn', onClick: () => modal.confirm({ title: 'Xóa lịch phỏng vấn này?', content: `Lịch phỏng vấn của ứng viên "${r.candidateName}" sẽ bị xóa.`, okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delMut.mutateAsync({ url: `/admin/interviews/${r.id}`, body: { version: r.version } }) }) },
                ]}
              />
            ) : null,
          },
        ]}
      />

      <Modal width={620} open={Boolean(evalTarget)} forceRender destroyOnHidden title={evalTarget ? `Chấm điểm & Quyết định Phỏng vấn: ${evalTarget.candidateName}` : 'Đánh giá phỏng vấn'} okText="Lưu kết quả phỏng vấn" cancelText="Hủy bỏ" okButtonProps={{ loading: putMut.isPending }} onCancel={() => setEvalTarget(null)} onOk={() => evalForm.submit()}>
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

      <Modal width={560} open={Boolean(reschedTarget)} forceRender destroyOnHidden title="Cập nhật Xác nhận / Yêu cầu Đổi lịch Phỏng vấn" okText="Lưu cập nhật" cancelText="Hủy bỏ" okButtonProps={{ loading: putMut.isPending }} onCancel={() => setReschedTarget(null)} onOk={() => reschedForm.submit()}>
        <Form form={reschedForm} layout="vertical" onFinish={(v) => putMut.mutate({ url: `/admin/interviews/${reschedTarget!.id}/evaluate`, body: { version: reschedTarget!.version, candidate_confirmed: Boolean(v.candidate_confirmed), reschedule_requested: Boolean(v.reschedule_requested), reschedule_reason: v.reschedule_reason, scheduled_at: `${v.interview_date}T${v.interview_slot}:00.000Z` } })}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="candidate_confirmed" label="Trạng thái xác nhận"><Select options={[{ value: true, label: 'Ứng viên đã xác nhận tham gia' }, { value: false, label: 'Chưa xác nhận' }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="reschedule_requested" label="Yêu cầu đổi lịch"><Select options={[{ value: false, label: 'Giữ lịch bình thường' }, { value: true, label: 'Ứng viên xin đổi lịch phỏng vấn' }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="interview_date" label="Ngày phỏng vấn"><DateStringPicker /></Form.Item></Col>
            <Col span={12}><Form.Item name="interview_slot" label="Giờ bắt đầu (30 phút)"><TimeSelect /></Form.Item></Col>
            <Col span={24}><Form.Item name="reschedule_reason" label="Lý do cần đổi lịch / Ghi chú xác nhận"><Input.TextArea rows={2} placeholder="Ví dụ: Ứng viên bận lịch thi ở trường buổi sáng, xin dời sang 14:30..." /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </Space>
  );
}
