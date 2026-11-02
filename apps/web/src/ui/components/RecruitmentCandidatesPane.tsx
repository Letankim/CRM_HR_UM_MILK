'use client';

import { App, Button, Flex, Form, Space, Tag, Tooltip } from 'antd';
import { CalendarOutlined, CheckCircleOutlined, CloseCircleOutlined, CloseOutlined, CloudSyncOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, LinkOutlined, MessageOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import { StatusTag } from '../StatusTag';
import { SelectableTable } from './BulkActionBar';
import { FilterToolbar } from './FilterToolbar';
import { usePermissionGuard } from './GuardButton';
import { useJobPositions } from './JobPositionsManagerModal';
import { RecruitmentFormSheetSyncModal } from './RecruitmentFormSheetSyncModal';
import { buildCandidateFormInitials, CANDIDATE_26_EXCEL_COLUMNS } from './CandidateFormModal';
import { CANDIDATE_STATUS_OPTIONS, CandidateDetailDrawer, CandidateFormModal } from './RecruitmentSubModals';
import { RowActionButtons } from './RowActionButtons';
import { useWorkflowDecisionModal } from './WorkflowDecisionModal';

const REJECT_CANDIDATE_SUGGESTIONS = [
  'Khung giờ ca đăng ký chưa phù hợp nhu cầu vận hành tại chi nhánh',
  'Không liên hệ được với ứng viên sau nhiều lần kết nối',
  'Ứng viên xin rút hồ sơ / đã nhận công việc khác',
];

interface Props {
  branches: { value: string; label: string }[];
  scheduledCandidateIds?: Set<string>;
  onScheduleInterview: (candidateId: string) => void;
  onOpenZaloNotify?: (cand: Record<string, unknown>) => void;
}

export function RecruitmentCandidatesPane({ branches, scheduledCandidateIds, onScheduleInterview, onOpenZaloNotify }: Props) {
  const qc = useQueryClient(), { message, modal } = App.useApp();
  const canManageRec = usePermissionGuard({ perms: ['candidate.manage'] }), canManageIv = usePermissionGuard({ perms: ['interview.manage'] });
  const { options: jobPositionOptions } = useJobPositions(), { promptDecision, decisionModalElement } = useWorkflowDecisionModal();

  const [q, setQ] = useState(''), debouncedQ = useDebouncedValue(q, 400);
  const [branchFilter, setBranchFilter] = useState('ALL'), [positionFilter, setPositionFilter] = useState('ALL'), [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1), [perPage, setPerPage] = useState(10);
  const [candModal, setCandModal] = useState(false), [sheetConfigOpen, setSheetConfigOpen] = useState(false);
  const [editingCand, setEditingCand] = useState<Record<string, unknown> | null>(null), [viewingCand, setViewingCand] = useState<Record<string, unknown> | null>(null);
  const [candForm] = Form.useForm();
  const watchedCandBranchId = Form.useWatch('applied_branch_id', candForm);
  const { options: shiftPrefOptions } = useShiftTemplates(watchedCandBranchId);

  useEffect(() => {
    if (!candModal || shiftPrefOptions.length === 0) return;
    const curShift = candForm.getFieldValue('shift_pref');
    if (!curShift || !shiftPrefOptions.some((o) => o.value === curShift)) candForm.setFieldValue('shift_pref', shiftPrefOptions[0]!.value);
  }, [candModal, watchedCandBranchId, shiftPrefOptions, candForm]);

  const queryParams = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (debouncedQ) queryParams.set('q', debouncedQ);
  if (branchFilter !== 'ALL') queryParams.set('branch_id', branchFilter);
  if (positionFilter !== 'ALL') queryParams.set('staff_group', positionFilter);
  if (statusFilter !== 'ALL') queryParams.set('status', statusFilter);

  const candQ = useQuery({ queryKey: ['candidates', page, perPage, debouncedQ, branchFilter, positionFilter, statusFilter], queryFn: () => api.list<Record<string, unknown>>(`/admin/candidates?${queryParams.toString()}`) });
  const refreshAll = () => ['candidates', 'interviews', 'recruitment-form-sync-config'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const syncSheetMut = useMutation({
    mutationFn: () => api.post<{ newCount: number; skippedCount: number; message: string }>('/admin/candidates/sync-google-sheet', {}),
    onSuccess: (res) => { message.success(res.message || `Đã đồng bộ ${res.newCount} ứng viên mới`); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Đồng bộ Google Sheet Form thất bại'),
  });

  const toggleVipMut = useMutation({
    mutationFn: (r: Record<string, unknown>) => api.put(`/admin/candidates/${r.id}/vip`, { version: r.version, is_vip: !r.is_vip }),
    onSuccess: (_, r) => { message.success(!r.is_vip ? `Đã gắn nhãn Ưu tiên VIP cho ${r.full_name}` : `Đã gỡ nhãn VIP của ${r.full_name}`); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Cập nhật VIP thất bại'),
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

  const promptContacted = (targets: Record<string, unknown>[], clear?: () => void) =>
    promptDecision({
      title: targets.length > 1 ? `Đánh dấu Đã liên hệ hàng loạt (${targets.length} ứng viên)` : `Đánh dấu Đã liên hệ: ${String(targets[0]?.full_name ?? '')}`,
      subtitle: 'Cập nhật trạng thái sàng lọc sang "Đã liên hệ" và lưu ghi chú trao đổi của bộ phận Nhân sự.',
      required: false, noteLabel: 'Ghi chú kết quả liên hệ ứng viên', okText: 'Xác nhận Đã liên hệ',
      placeholder: 'Ví dụ: Đã gọi điện trao đổi khung ca, ứng viên xác nhận sẵn sàng tham gia phỏng vấn...',
      onConfirm: async (note) => {
        for (const r of targets) await api.put(`/admin/candidates/${r.id}`, { version: r.version, status: 'CONTACTED', ...(note ? { hr_note: note } : {}) });
        message.success(`Đã cập nhật trạng thái Đã liên hệ cho ${targets.length} ứng viên`); clear?.(); refreshAll();
      },
    });

  const promptRejectCandidate = (targets: Record<string, unknown>[], clear?: () => void) =>
    promptDecision({
      title: targets.length > 1 ? `Từ chối hồ sơ hàng loạt (${targets.length} ứng viên)` : `Từ chối hồ sơ ứng viên: ${String(targets[0]?.full_name ?? '')}`,
      subtitle: 'Hồ sơ ứng viên sẽ chuyển sang trạng thái "Chưa phù hợp" kèm lý do sàng lọc của HR.',
      required: true, danger: true, noteLabel: 'Lý do từ chối hồ sơ ứng viên', okText: 'Xác nhận từ chối hồ sơ', suggestions: REJECT_CANDIDATE_SUGGESTIONS,
      onConfirm: async (note) => {
        for (const r of targets) await api.put(`/admin/candidates/${r.id}`, { version: r.version, status: 'REJECTED', hr_note: note });
        message.success(`Đã cập nhật từ chối hồ sơ cho ${targets.length} ứng viên`); clear?.(); refreshAll();
      },
    });

  const openCreateCand = () => {
    setEditingCand(null); candForm.resetFields();
    candForm.setFieldsValue(buildCandidateFormInitials(null, branches[0]?.value));
    setCandModal(true);
  };

  const openEditCand = (r: Record<string, unknown>) => {
    setEditingCand(r);
    candForm.setFieldsValue(buildCandidateFormInitials(r));
    setCandModal(true);
  };

  const rows = candQ.data?.data ?? [];
  const liveViewingCand = viewingCand ? (rows.find((x) => x.id === viewingCand.id) ?? viewingCand) : null;
  const checkHasIv = (r: Record<string, unknown> | null) => Boolean(r && (scheduledCandidateIds?.has(String(r.id)) || scheduledCandidateIds?.has(String(r.candidate_code)) || r.status === 'INTERVIEW_SCHEDULED'));

  const exportCands = (list: Record<string, unknown>[]) =>
    exportToExcel({ fileName: 'Danh_sach_ung_vien.xls', sheetTitle: 'Danh sách Hồ sơ Ứng viên Tuyển dụng', rows: list, columns: CANDIDATE_26_EXCEL_COLUMNS });

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {canManageRec && (
        <Flex justify="space-between" align="center" wrap gap={8} style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '8px 12px' }}>
          <Space size={8} wrap>
            <Tag color="blue" style={{ margin: 0, fontWeight: 600 }}>Google Sheet Form (FROM_NHAN_VIEN)</Tag>
            <span style={{ fontSize: 12, color: '#475569' }}>Tự động đồng bộ hàng giờ · Chống lấy trùng 100% · Tự động chấm điểm AI 14đ</span>
          </Space>
          <Space size={8} wrap>
            <Button size="small" icon={<LinkOutlined />} onClick={() => setSheetConfigOpen(true)}>Cấu hình Link Sheet Form (Tự động hàng giờ)</Button>
            <Button size="small" type="primary" icon={<CloudSyncOutlined />} loading={syncSheetMut.isPending} onClick={() => syncSheetMut.mutate()}>Đồng bộ Sheet Form Tuyển dụng</Button>
          </Space>
        </Flex>
      )}

      <FilterToolbar
        searchPlaceholder="Tìm mã UV, họ tên, SĐT, email..." searchValue={q} onSearchChange={(v) => { setQ(v); setPage(1); }}
        selects={[
          { key: 'branch', value: branchFilter, width: 205, options: [{ value: 'ALL', label: 'Tất cả chi nhánh nguyện vọng' }, ...branches], onChange: (v) => { setBranchFilter(v); setPage(1); } },
          { key: 'pos', value: positionFilter, width: 165, options: [{ value: 'ALL', label: 'Tất cả vị trí' }, ...jobPositionOptions], onChange: (v) => { setPositionFilter(v); setPage(1); } },
          { key: 'status', value: statusFilter, width: 195, options: CANDIDATE_STATUS_OPTIONS, onChange: (v) => { setStatusFilter(v); setPage(1); } },
        ]}
        onRefresh={refreshAll} refreshing={candQ.isFetching} onExportExcel={() => exportCands(rows)}
        primaryActionLabel={canManageRec ? 'Thêm ứng viên mới' : undefined} onPrimaryAction={canManageRec ? openCreateCand : undefined}
      />

      <SelectableTable<Record<string, unknown>>
        size="small" rowKey="id" loading={candQ.isLoading} onRowClick={setViewingCand}
        bulkActions={[
          ...(canManageRec ? [
            { key: 'contacted', label: 'Đánh dấu Đã liên hệ đã chọn', type: 'primary' as const, icon: <CheckCircleOutlined />, eligibleFilter: (x: Record<string, unknown>) => x.status === 'NEW', onClick: (sel: Record<string, unknown>[], clr: () => void) => promptContacted(sel, clr) },
            { key: 'reject', label: 'Từ chối hồ sơ đã chọn', danger: true, icon: <CloseCircleOutlined />, eligibleFilter: (x: Record<string, unknown>) => x.status !== 'REJECTED' && x.status !== 'HIRED', onClick: (sel: Record<string, unknown>[], clr: () => void) => promptRejectCandidate(sel, clr) },
            { key: 'delete', label: 'Xóa ứng viên đã chọn', danger: true, icon: <DeleteOutlined />, confirm: 'Xác nhận xóa các hồ sơ ứng viên đã chọn?', onClick: async (sel: Record<string, unknown>[], clr: () => void) => { for (const r of sel) await api.delete(`/admin/candidates/${r.id}`, { version: r.version }); clr(); message.success('Đã xóa các hồ sơ ứng viên đã chọn'); refreshAll(); } },
          ] : []),
          { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (sel) => exportCands(sel) },
        ]}
        pagination={{ current: page, pageSize: perPage, total: candQ.data?.meta.pagination.total ?? rows.length, showSizeChanger: true, pageSizeOptions: ['10', '12', '20', '50', '100'], showTotal: (t) => `Tổng ${t} ứng viên`, onChange: (p, ps) => { setPage(ps !== perPage ? 1 : p); setPerPage(ps); } }}
        dataSource={rows}
        columns={[
          { title: 'Mã UV & VIP', dataIndex: 'candidate_code', width: 130, render: (v: string, r) => <Space size={4} wrap><Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag>{Boolean(r.is_vip) && <Tag color="gold" style={{ margin: 0, fontWeight: 600 }}><StarFilled /> VIP #{Number(r.vip_rank || 1)}</Tag>}</Space> },
          { title: 'Họ và tên', dataIndex: 'full_name', ellipsis: true, render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
          { title: 'Số điện thoại', dataIndex: 'phone', width: 120, render: (v: string) => <span className="num" style={{ fontWeight: 600 }}>{v}</span> },
          { title: 'Chấm điểm AI (14đ)', key: 'aiScore', width: 165, render: (_, r) => <Tooltip title={String(r.red_flag_reason || `Điểm sàng lọc tự động 9 tiêu chí Google Form: ${Number(r.ai_score_14 || 0)}/14 điểm`)}><Tag color={r.red_flag_reason ? 'error' : r.ai_qualified ? 'success' : 'warning'} style={{ margin: 0, fontWeight: 600 }}>{Number(r.ai_score_14 || 0)}/14đ · {r.red_flag_reason ? 'Cờ loại' : r.ai_qualified ? 'Đạt sơ loại' : 'Cân nhắc'}</Tag></Tooltip> },
          { title: 'Vị trí & Ca', key: 'posShift', width: 165, ellipsis: true, render: (_, r) => <div><div>{String(r.positionLabel || '')}</div><div style={{ fontSize: 11, color: '#64748B' }}>{String(r.shiftPrefLabel || '')}</div></div> },
          { title: 'Chi nhánh nguyện vọng', dataIndex: 'branchName', ellipsis: true },
          { title: 'Giai đoạn', dataIndex: 'stage', width: 155, render: (v: string) => <StatusTag value={v} /> },
          {
            title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem chi tiết hồ sơ ứng viên" onViewDetail={() => setViewingCand(r)}
                menuItems={[
                  ...(canManageRec ? [{ key: 'vip', icon: r.is_vip ? <StarFilled style={{ color: '#D97706' }} /> : <StarOutlined />, label: r.is_vip ? 'Gỡ nhãn Ưu tiên VIP' : 'Gắn nhãn Ưu tiên VIP (Đầu bảng)', onClick: () => toggleVipMut.mutate(r) }] : []),
                  ...(onOpenZaloNotify ? [{ key: 'zalo', icon: <MessageOutlined style={{ color: '#2563EB' }} />, label: 'Nhắn Zalo', onClick: () => onOpenZaloNotify(r) }] : []),
                  ...(canManageRec && r.status === 'NEW' ? [{ key: 'contacted', icon: <CheckCircleOutlined style={{ color: '#2563EB' }} />, label: 'Đánh dấu Đã liên hệ ứng viên', onClick: () => promptContacted([r]) }] : []),
                  ...(canManageIv ? [{ key: 'interview', icon: <CalendarOutlined />, label: checkHasIv(r) ? 'Chỉnh sửa lịch phỏng vấn' : 'Đặt lịch phỏng vấn', onClick: () => onScheduleInterview(String(r.id)) }] : []),
                  ...(canManageRec && r.status !== 'REJECTED' && r.status !== 'HIRED' ? [{ key: 'reject', icon: <CloseCircleOutlined />, danger: true, label: 'Từ chối hồ sơ ứng viên', onClick: () => promptRejectCandidate([r]) }] : []),
                  ...(canManageRec ? [
                    { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa hồ sơ & ghi chú HR', onClick: () => openEditCand(r) },
                    { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa hồ sơ ứng viên', onClick: () => modal.confirm({ title: `Xóa hồ sơ ứng viên "${r.full_name}"?`, content: 'Hồ sơ ứng viên này sẽ bị xóa khỏi danh sách tuyển dụng.', okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delMut.mutateAsync({ url: `/admin/candidates/${r.id}`, body: { version: r.version } }) }) },
                  ] : []),
                ]}
              />
            ),
          },
        ]}
      />

      <CandidateFormModal
        open={candModal} editingCand={editingCand} form={candForm} branches={branches}
        jobPositionOptions={jobPositionOptions} shiftPrefOptions={shiftPrefOptions} loading={saveMut.isPending}
        onClose={() => setCandModal(false)}
        onFinish={(v) => {
          if (editingCand) saveMut.mutate({ url: `/admin/candidates/${editingCand.id}`, method: 'PUT', body: { ...v, branch_pref: v.applied_branch_id, staff_group: v.applied_position, version: editingCand.version } });
          else saveMut.mutate({ url: '/admin/candidates', method: 'POST', body: v });
        }}
      />
      <CandidateDetailDrawer candidate={liveViewingCand} hasInterview={checkHasIv(liveViewingCand)} onClose={() => setViewingCand(null)} onScheduleInterview={onScheduleInterview} onEdit={openEditCand} onMarkContacted={(c) => promptContacted([c])} onReject={(c) => promptRejectCandidate([c])} onOpenZaloNotify={onOpenZaloNotify} />
      <RecruitmentFormSheetSyncModal open={sheetConfigOpen} onClose={() => setSheetConfigOpen(false)} onSynced={refreshAll} />
      {decisionModalElement}
    </Space>
  );
}
