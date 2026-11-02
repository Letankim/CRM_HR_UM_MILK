'use client';

import { App, Space, Tag } from 'antd';
import { BellOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, MessageOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  INTERVIEW_EXPERIENCE_TRACK_LABELS, INTERVIEW_EXPERIENCE_TRACK_SHORT_LABELS,
  STATUS_VISUAL_MAP, type InterviewExperienceTrack,
} from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { StatusTag } from '../StatusTag';
import { SelectableTable } from './BulkActionBar';
import { FilterToolbar } from './FilterToolbar';
import { usePermissionGuard } from './GuardButton';
import { InterviewEvaluateModal } from './InterviewEvaluateModal';
import { InterviewRescheduleModal } from './InterviewScheduleModals';
import { InterviewDetailDrawer } from './RecruitmentSubModals';
import { RowActionButtons } from './RowActionButtons';
import { UpcomingInterviewsBanner } from './UpcomingInterviewsBanner';
import { useWorkflowDecisionModal } from './WorkflowDecisionModal';
import type { ZaloHrAccountItem } from './ZaloHrAccountsModal';

const INTERVIEW_STATUS_OPTIONS = [
  { value: 'ALL', label: 'Tất cả trạng thái lịch' }, { value: 'SCHEDULED', label: 'Đã xếp lịch' },
  { value: 'CONFIRMED', label: 'Ứng viên đã xác nhận' }, { value: 'RESCHEDULE_NEEDED', label: 'Cần đổi lịch phỏng vấn' }, { value: 'COMPLETED', label: 'Đã hoàn thành phỏng vấn' },
];
const DECISION_OPTIONS = [
  { value: 'ALL', label: 'Tất cả quyết định HR' }, { value: 'PENDING', label: 'Chờ kết quả phỏng vấn' },
  { value: 'PASS', label: 'Đạt phỏng vấn (Mời thử việc)' }, { value: 'HOLD', label: 'Cân nhắc thêm' }, { value: 'FAIL', label: 'Chưa phù hợp' },
];
const TRACK_OPTIONS = [
  { value: 'ALL', label: 'Tất cả nhóm kinh nghiệm' },
  { value: 'INEXPERIENCED', label: INTERVIEW_EXPERIENCE_TRACK_LABELS.INEXPERIENCED },
  { value: 'EXPERIENCED', label: INTERVIEW_EXPERIENCE_TRACK_LABELS.EXPERIENCED },
];
const PASS_SUGGESTIONS = ['Đạt yêu cầu phỏng vấn, thái độ tốt, mời nhận việc thử việc'];
const FAIL_SUGGESTIONS = [
  'Tác phong và kỹ năng chưa đáp ứng yêu cầu vận hành tại cửa hàng',
  'Ứng viên vắng mặt phỏng vấn không thông báo trước',
];

interface Props {
  branches: { value: string; label: string }[];
  interviewerOptions?: { value: string; label: string }[];
  zaloAccounts?: ZaloHrAccountItem[];
  allInterviews?: Record<string, unknown>[];
  externalEditTarget?: Record<string, unknown> | null;
  onClearExternalEdit?: () => void;
  onOpenScheduleModal: () => void;
  onOpenZaloNotify?: (iv: Record<string, unknown>) => void;
}

const getTrack = (r: Record<string, unknown>): InterviewExperienceTrack =>
  r.experience_track === 'EXPERIENCED' ? 'EXPERIENCED' : 'INEXPERIENCED';

export function RecruitmentInterviewsPane({
  branches, interviewerOptions = [], zaloAccounts = [], allInterviews = [], externalEditTarget, onClearExternalEdit, onOpenScheduleModal, onOpenZaloNotify,
}: Props) {
  const qc = useQueryClient();
  const canManageRec = usePermissionGuard({ perms: ['interview.manage'] });
  const { message, modal } = App.useApp();
  const { promptDecision, decisionModalElement } = useWorkflowDecisionModal();

  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [decisionFilter, setDecisionFilter] = useState('ALL');
  const [trackFilter, setTrackFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const [viewingIv, setViewingIv] = useState<Record<string, unknown> | null>(null);
  const [evalTarget, setEvalTarget] = useState<Record<string, unknown> | null>(null);
  const [reschedTarget, setReschedTarget] = useState<Record<string, unknown> | null>(null);

  const queryParams = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (debouncedQ) queryParams.set('q', debouncedQ);
  if (branchFilter !== 'ALL') queryParams.set('branch_id', branchFilter);
  if (statusFilter !== 'ALL') queryParams.set('status', statusFilter);
  if (decisionFilter !== 'ALL') queryParams.set('decision', decisionFilter);
  if (trackFilter !== 'ALL') queryParams.set('experience_track', trackFilter);

  const ivQ = useQuery({
    queryKey: ['interviews', page, perPage, debouncedQ, branchFilter, statusFilter, decisionFilter, trackFilter],
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

  useEffect(() => {
    if (externalEditTarget) { setReschedTarget(externalEditTarget); onClearExternalEdit?.(); }
  }, [externalEditTarget, onClearExternalEdit]);

  const rows = ivQ.data?.data ?? [];
  const bannerInterviews = allInterviews.length > 0 ? allInterviews : rows;
  const liveViewingIv = viewingIv ? (rows.find((x) => x.id === viewingIv.id) ?? bannerInterviews.find((x) => x.id === viewingIv.id) ?? viewingIv) : null;

  const exportIvs = (list: Record<string, unknown>[]) =>
    exportToExcel<Record<string, unknown>>({
      fileName: 'Lich_phong_van.xls', sheetTitle: 'Danh sách Lịch Phỏng vấn & Kết quả HR',
      rows: list.map((r) => ({ ...r, trackVi: INTERVIEW_EXPERIENCE_TRACK_LABELS[getTrack(r)], decisionVi: STATUS_VISUAL_MAP[String(r.decision)]?.label ?? String(r.decision || '') })),
      columns: [
        { header: 'Mã UV', key: 'candidateCode' }, { header: 'Ứng viên', key: 'candidateName' },
        { header: 'Phân loại kinh nghiệm', key: 'trackVi' }, { header: 'Chi nhánh', key: 'branchName' },
        { header: 'Người phỏng vấn', key: 'interviewerLabel' }, { header: 'Thời gian', key: 'scheduled_at' },
        { header: 'Thời lượng (phút)', key: 'duration_minutes' }, { header: 'Google Meet', key: 'meet_link' },
        { header: 'Điểm tổng kết', key: 'score' }, { header: 'Quyết định HR', key: 'decisionVi' }, { header: 'Nhận xét', key: 'comment' },
      ],
    });

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <UpcomingInterviewsBanner interviews={bannerInterviews} canManage={canManageRec} onViewDetail={setViewingIv} onEvaluate={setEvalTarget} onOpenZaloNotify={onOpenZaloNotify} />
      <FilterToolbar searchPlaceholder="Tìm ứng viên, người phỏng vấn..." searchValue={q} onSearchChange={(v) => { setQ(v); setPage(1); }}
        selects={[
          { key: 'branch', value: branchFilter, width: 175, options: [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branches], onChange: (v) => { setBranchFilter(v); setPage(1); } },
          { key: 'status', value: statusFilter, width: 185, options: INTERVIEW_STATUS_OPTIONS, onChange: (v) => { setStatusFilter(v); setPage(1); } },
          { key: 'decision', value: decisionFilter, width: 185, options: DECISION_OPTIONS, onChange: (v) => { setDecisionFilter(v); setPage(1); } },
          { key: 'track', value: trackFilter, width: 205, options: TRACK_OPTIONS, onChange: (v) => { setTrackFilter(v); setPage(1); } },
        ]}
        onRefresh={refreshAll} refreshing={ivQ.isFetching} onExportExcel={() => exportIvs(rows)}
        primaryActionLabel={canManageRec ? 'Đặt lịch phỏng vấn' : undefined} onPrimaryAction={canManageRec ? onOpenScheduleModal : undefined} />

      <SelectableTable<Record<string, unknown>>
        size="small" rowKey="id" loading={ivQ.isLoading} onRowClick={setViewingIv}
        bulkActions={[
          ...(canManageRec ? [
            {
              key: 'pass', label: 'Duyệt Đạt phỏng vấn đã chọn', type: 'primary' as const, icon: <CheckCircleOutlined />,
              eligibleFilter: (x: Record<string, unknown>) => x.decision === 'PENDING',
              onClick: (sel: Record<string, unknown>[], clr: () => void) =>
                promptDecision({
                  title: `Duyệt Đạt phỏng vấn hàng loạt (${sel.length} ứng viên)`,
                  subtitle: 'Hệ thống sẽ ghi nhận quyết định Đạt phỏng vấn và chuyển hồ sơ ứng viên sang bước Tiếp nhận thử việc.',
                  required: true, noteLabel: 'Nhận xét đánh giá phỏng vấn của HR', suggestions: PASS_SUGGESTIONS, okText: 'Xác nhận Đạt phỏng vấn',
                  onConfirm: async (note) => {
                    for (const r of sel) await api.put(`/admin/interviews/${r.id}/evaluate`, { version: r.version, experience_track: getTrack(r), decision: 'PASS', appearance_score: 90, attitude_score: 90, skill_score: 88, comment: note });
                    clr(); message.success('Đã duyệt Đạt phỏng vấn cho các lịch hợp lệ'); refreshAll();
                  },
                }),
            },
            {
              key: 'fail', label: 'Đánh dấu Không đạt đã chọn', danger: true, icon: <CloseCircleOutlined />,
              eligibleFilter: (x: Record<string, unknown>) => x.decision === 'PENDING',
              onClick: (sel: Record<string, unknown>[], clr: () => void) =>
                promptDecision({
                  title: `Đánh dấu Không đạt phỏng vấn (${sel.length} ứng viên)`,
                  subtitle: 'Hồ sơ ứng viên tương ứng sẽ được cập nhật sang trạng thái Chưa phù hợp.',
                  required: true, danger: true, noteLabel: 'Lý do từ chối / Kết quả chưa đạt phỏng vấn', suggestions: FAIL_SUGGESTIONS, okText: 'Xác nhận Không đạt',
                  onConfirm: async (note) => {
                    for (const r of sel) await api.put(`/admin/interviews/${r.id}/evaluate`, { version: r.version, experience_track: getTrack(r), decision: 'FAIL', appearance_score: 50, attitude_score: 50, skill_score: 50, comment: note });
                    clr(); message.success('Đã cập nhật kết quả Không đạt phỏng vấn cho các lịch đã chọn'); refreshAll();
                  },
                }),
            },
            { key: 'delete', label: 'Xóa lịch phỏng vấn đã chọn', danger: true, icon: <DeleteOutlined />, confirm: 'Xác nhận xóa các lịch phỏng vấn đã chọn?', onClick: async (sel: Record<string, unknown>[], clr: () => void) => { for (const r of sel) await api.delete(`/admin/interviews/${r.id}`, { version: r.version }); clr(); message.success('Đã xóa các lịch phỏng vấn đã chọn'); refreshAll(); } },
          ] : []),
          { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (sel) => exportIvs(sel) },
        ]}
        pagination={{ current: page, pageSize: perPage, total: ivQ.data?.meta.pagination.total ?? rows.length, showSizeChanger: true, pageSizeOptions: ['10', '12', '20', '50', '100'], showTotal: (t) => `Tổng ${t} lịch phỏng vấn`, onChange: (p, ps) => { setPage(ps !== perPage ? 1 : p); setPerPage(ps); } }}
        dataSource={rows}
        columns={[
          { title: 'Ứng viên phỏng vấn', dataIndex: 'candidateName', ellipsis: true, render: (v: string, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{v} {r.candidateCode ? `(${String(r.candidateCode)})` : ''}</span><Tag color={getTrack(r) === 'EXPERIENCED' ? 'purple' : 'cyan'} style={{ margin: 0 }}>{INTERVIEW_EXPERIENCE_TRACK_SHORT_LABELS[getTrack(r)]}</Tag></Space> },
          { title: 'Chi nhánh', dataIndex: 'branchName', width: 155, ellipsis: true },
          { title: 'Người phỏng vấn', dataIndex: 'interviewerLabel', ellipsis: true, render: (v: string, r) => v || String(r.interviewer_id ?? '') },
          { title: 'Thời gian phỏng vấn', dataIndex: 'scheduled_at', width: 165, render: (v: string, r) => <span className="num" style={{ fontWeight: 600 }}>{String(v).slice(0, 16).replace('T', ' ')} ({String(r.duration_minutes ?? 30)}p)</span> },
          { title: 'Xác nhận & Nhắc Zalo', dataIndex: 'status', width: 175, render: (_, r) => <Space size={4} wrap>{r.reschedule_requested ? <Tag color="warning" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>Cần đổi lịch</Tag> : r.candidate_confirmed ? <Tag color="success" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>Đã xác nhận</Tag> : <Tag color="default" style={{ margin: 0 }}>Chờ xác nhận</Tag>}{r.zalo_reminder_sent_at ? <Tag color="blue" icon={<BellOutlined />} style={{ margin: 0 }}>Đã nhắc Zalo</Tag> : r.candidate_confirmed ? <Tag color="cyan" style={{ margin: 0 }}>Tự nhắc Zalo</Tag> : null}</Space> },
          { title: 'Kết quả HR', dataIndex: 'decision', width: 165, render: (v: string, r) => <Space size={4}><StatusTag value={v} />{v !== 'PENDING' && <Tag color="blue" className="num">{String(r.score)}đ</Tag>}</Space> },
          {
            title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem chi tiết lịch phỏng vấn" onViewDetail={() => setViewingIv(r)}
                menuItems={canManageRec ? [
                  ...(onOpenZaloNotify ? [{ key: 'zalo', icon: <MessageOutlined style={{ color: '#2563EB' }} />, label: 'Nhắn Zalo', onClick: () => onOpenZaloNotify(r) }] : []),
                  ...(r.meet_link ? [{ key: 'meet', icon: <VideoCameraOutlined style={{ color: '#2563EB' }} />, label: 'Mở phòng họp Google Meet', onClick: () => window.open(String(r.meet_link), '_blank') }] : []),
                  { key: 'eval', icon: <EditOutlined style={{ color: '#2563EB' }} />, label: 'Chấm điểm & Ra quyết định HR', onClick: () => setEvalTarget(r) },
                  { key: 'resched', icon: <ClockCircleOutlined style={{ color: '#D97706' }} />, label: 'Chỉnh sửa / Đổi lịch phỏng vấn', onClick: () => setReschedTarget(r) },
                  { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa lịch phỏng vấn', onClick: () => modal.confirm({ title: 'Xóa lịch phỏng vấn này?', content: `Lịch phỏng vấn của ứng viên "${r.candidateName}" sẽ bị xóa.`, okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delMut.mutateAsync({ url: `/admin/interviews/${r.id}`, body: { version: r.version } }) }) },
                ] : []}
              />
            ),
          },
        ]}
      />

      <InterviewDetailDrawer interview={liveViewingIv} canManage={canManageRec} onClose={() => setViewingIv(null)} onReschedule={setReschedTarget} onEvaluate={setEvalTarget} onOpenZaloNotify={onOpenZaloNotify} />
      <InterviewEvaluateModal target={evalTarget} loading={putMut.isPending} onClose={() => setEvalTarget(null)} onSubmit={(id, body) => putMut.mutate({ url: `/admin/interviews/${id}/evaluate`, body })} />
      <InterviewRescheduleModal target={reschedTarget} interviewerOptions={interviewerOptions} zaloAccounts={zaloAccounts} existingInterviews={bannerInterviews} loading={putMut.isPending} onClose={() => setReschedTarget(null)} onSubmit={(id, body) => putMut.mutate({ url: `/admin/interviews/${id}/evaluate`, body })} />
      {decisionModalElement}
    </Space>
  );
}
