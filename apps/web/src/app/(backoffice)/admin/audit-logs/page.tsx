'use client';

import { Alert, App, Segmented, Space, Tag, Typography } from 'antd';
import { AuditOutlined, CloseOutlined, DownloadOutlined, FolderOpenOutlined, RollbackOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import dayjs from 'dayjs';
import { ROLE_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { AuditLogDetailDrawer, type AuditLogItem } from '@/ui/components/AuditLogDetailDrawer';
import { DataTableCard } from '@/ui/components/DataTableCard';
import { FilterToolbar } from '@/ui/components/FilterToolbar';
import { RowActionButtons } from '@/ui/components/RowActionButtons';

const ENTITY_FILTER_OPTIONS = [
  { value: 'ALL', label: 'Tất cả phân hệ dữ liệu' },
  { value: 'USERS', label: 'Tài khoản & Phân quyền' },
  { value: 'EMPLOYEES', label: 'Hồ sơ Nhân sự' },
  { value: 'BRANCHES', label: 'Chi nhánh & Tọa độ GPS' },
  { value: 'SHIFT_TEMPLATES', label: 'Mẫu Ca làm việc' },
  { value: 'ATTENDANCE_EVENTS', label: 'Sự kiện Điểm danh' },
  { value: 'SYSTEM', label: 'Hệ thống & Đối soát' },
];

function exportAuditExcel(rows: AuditLogItem[], view: 'ACTIVE' | 'ARCHIVED') {
  exportToExcel({
    fileName: `Nhat_Ky_Kiem_Toan_${view}_${dayjs().format('YYYYMMDD_HHmm')}.xls`,
    sheetTitle: view === 'ARCHIVED' ? 'Kho Lưu Trữ Nhật Ký Kiểm Toán Đã Dọn' : 'Nhật Ký Kiểm Toán Hệ Thống Hiện Hành',
    columns: [
      { header: 'Thời điểm', render: (r) => dayjs(r.created_at).format('HH:mm:ss DD/MM/YYYY') },
      { header: 'Người thực hiện', key: 'actorDisplayName' },
      { header: 'Tài khoản', render: (r) => `@${r.actorUsername}` },
      { header: 'Vai trò', key: 'actorRoleLabel' },
      { header: 'Hành động', key: 'actionLabel' },
      { header: 'Phân hệ', key: 'entityLabel' },
      { header: 'IP', key: 'ip' },
    ],
    rows,
  });
}

function AuditLogsView() {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();

  const [view, setView] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('ALL');
  const [actorRole, setActorRole] = useState('ALL');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(12);
  const [selected, setSelected] = useState<AuditLogItem | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const buildUrl = (force = false) => {
    const sp = new URLSearchParams({ page: String(page), per_page: String(perPage), view });
    if (entity !== 'ALL') sp.set('entity', entity);
    if (actorRole !== 'ALL') sp.set('actor_role', actorRole);
    if (q.trim()) sp.set('q', q.trim());
    if (force) sp.set('refresh', '1');
    return `/admin/audit-logs?${sp}`;
  };

  const query = useQuery({
    queryKey: ['audit-logs', view, entity, actorRole, q, page, perPage],
    queryFn: () => api.list<AuditLogItem>(buildUrl(false)),
  });

  const archiveMut = useMutation({
    mutationFn: (payload: { mode: 'SELECTED' | 'ALL_ACTIVE' | 'RESTORE'; ids?: string[]; reason?: string }) =>
      api.post('/admin/audit-logs/archive', payload),
    onSuccess: (_, vars) => {
      message.success(
        vars.mode === 'RESTORE'
          ? 'Đã khôi phục bản ghi kiểm toán về danh sách hiện hành'
          : 'Đã lưu trữ vào Kho Lưu Trữ và làm trống danh sách hiện hành',
      );
      setSelected(null);
      qc.invalidateQueries({ queryKey: ['audit-logs'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác lưu trữ thất bại'),
  });

  const handleManualRefresh = async () => {
    setManualRefreshing(true);
    const hide = message.loading('Đang đồng bộ nhật ký kiểm toán...', 0);
    try {
      const fresh = await api.list<AuditLogItem>(buildUrl(true));
      qc.setQueryData(['audit-logs', view, entity, actorRole, q, page, perPage], fresh);
      message.success('Đã cập nhật nhật ký kiểm toán mới nhất');
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Làm mới thất bại');
    } finally {
      hide();
      setManualRefreshing(false);
    }
  };

  const handleArchiveAllActive = () => {
    if (view === 'ARCHIVED') {
      modal.confirm({
        title: 'Khôi phục toàn bộ nhật ký lưu trữ về danh sách hiện hành?',
        content: 'Tất cả bản ghi trong Kho Lưu Trữ sẽ được đưa trở lại danh sách Nhật ký Hiện hành.',
        okText: 'Khôi phục tất cả', cancelText: 'Hủy bỏ',
        okButtonProps: { icon: <RollbackOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> },
        onOk: () => archiveMut.mutateAsync({ mode: 'RESTORE', ids: [] }),
      });
      return;
    }
    modal.confirm({
      title: 'Lưu trữ & Làm trống danh sách Nhật ký Hiện hành?',
      content: 'Toàn bộ phiên/nhật ký hiện tại sẽ được làm trống khỏi màn hình chính nhưng vẫn được bảo toàn 100% trong tab "Kho Lưu trữ Đã dọn" và ghi nhận vào Nhật ký Sao lưu Hệ thống.',
      okText: 'Xác nhận Lưu trữ & Làm trống', cancelText: 'Hủy bỏ',
      okButtonProps: { icon: <FolderOpenOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> },
      onOk: () => archiveMut.mutateAsync({ mode: 'ALL_ACTIVE', reason: 'Quản trị viên lưu trữ và dọn trống phiên kiểm toán hiện hành' }),
    });
  };

  const items = query.data?.data ?? [];

  return (
    <>
      <Alert
        type={view === 'ARCHIVED' ? 'warning' : 'info'} showIcon style={{ marginBottom: 12 }}
        message={view === 'ARCHIVED' ? 'Kho Lưu trữ Đã dọn: Toàn bộ các phiên và nhật ký kiểm toán đã làm trống khỏi màn hình chính đều được lưu trữ an toàn tại đây. Bạn có thể tra cứu, xuất Excel hoặc khôi phục bất kỳ lúc nào.' : 'Nhật ký Kiểm toán Hệ thống: Bạn có thể chọn từng phiên hoặc bấm "Lưu trữ & Làm trống" để dọn gọn màn hình hiện hành mà vẫn bảo toàn 100% lịch sử trong Kho Lưu trữ.'}
      />

      <FilterToolbar
        searchPlaceholder="Tìm người thực hiện, hành động, phân hệ..."
        searchValue={q}
        onSearchChange={(val) => { setPage(1); setQ(val); }}
        selects={[
          { key: 'entity', value: entity, width: 200, options: ENTITY_FILTER_OPTIONS, onChange: (v) => { setPage(1); setEntity(v); } },
          { key: 'role', value: actorRole, width: 185, options: [{ value: 'ALL', label: 'Tất cả vai trò' }, ...ROLE_OPTIONS], onChange: (v) => { setPage(1); setActorRole(v); } },
        ]}
        extraRight={
          <Segmented
            value={view}
            onChange={(v) => { setPage(1); setView(v as 'ACTIVE' | 'ARCHIVED'); }}
            options={[
              { value: 'ACTIVE', icon: <AuditOutlined />, label: 'Nhật ký Hiện hành' },
              { value: 'ARCHIVED', icon: <FolderOpenOutlined />, label: 'Kho Lưu trữ Đã dọn' },
            ]}
          />
        }
        onExportExcel={() => exportAuditExcel(items, view)}
        onRefresh={handleManualRefresh}
        refreshing={manualRefreshing}
        primaryActionLabel={view === 'ACTIVE' ? 'Lưu trữ & Làm trống' : 'Khôi phục tất cả'}
        onPrimaryAction={handleArchiveAllActive}
      />

      <DataTableCard<AuditLogItem>
        columns={[
          { title: 'Thời điểm ghi nhận', dataIndex: 'created_at', width: 165, render: (v: string) => <span className="num" style={{ fontSize: 12 }}>{dayjs(v).format('HH:mm:ss DD/MM/YYYY')}</span> },
          {
            title: 'Người thực hiện', key: 'actor', width: 210,
            render: (_, r) => (
              <div>
                <Typography.Text strong style={{ fontSize: 13 }}>{r.actorDisplayName}</Typography.Text>
                <div style={{ marginTop: 2 }}><Space size={4}><span style={{ fontSize: 12, color: '#64748B' }}>@{r.actorUsername}</span><Tag color="blue" style={{ margin: 0, borderRadius: 2, fontSize: 11 }}>{r.actorRoleLabel}</Tag></Space></div>
              </div>
            ),
          },
          {
            title: 'Hành động nghiệp vụ', dataIndex: 'actionLabel',
            render: (v: string, r) => (
              <div>
                <Typography.Text strong style={{ color: '#2563EB' }}>{v}</Typography.Text>
                <div style={{ fontSize: 12, color: '#64748B' }}>Phân hệ: {r.entityLabel}</div>
              </div>
            ),
          },
          { title: 'Trạng thái', key: 'state', width: 145, render: (_, r) => r.isArchived ? <Tag color="gold">Đã lưu trữ</Tag> : <Tag color="green">Hiện hành</Tag> },
          { title: 'Truy vết', key: 'trace', width: 130, render: (_, r) => <span style={{ fontSize: 12, color: '#64748B' }}>IP: {r.ip || 'Nội bộ'}</span> },
          {
            title: 'Thao tác', key: 'actions', width: 110, align: 'right',
            render: (_, r) => (
              <RowActionButtons
                onViewDetail={() => setSelected(r)}
                menuItems={[
                  r.isArchived
                    ? { key: 'restore', icon: <RollbackOutlined />, label: 'Khôi phục về hiện hành', onClick: () => archiveMut.mutate({ mode: 'RESTORE', ids: [r.id] }) }
                    : { key: 'archive', icon: <FolderOpenOutlined />, label: 'Lưu trữ & Làm trống dòng này', onClick: () => archiveMut.mutate({ mode: 'SELECTED', ids: [r.id] }) },
                ]}
              />
            ),
          },
        ]}
        dataSource={items}
        meta={query.data?.meta}
        loading={query.isLoading || query.isFetching || manualRefreshing}
        codeExtractor={(r) => dayjs(r.created_at).format('HH:mm:ss')}
        onPageChange={(nextPage, nextSize) => { setPage(nextPage); setPerPage(nextSize); }}
        emptyText={view === 'ARCHIVED' ? 'Kho lưu trữ hiện đang trống' : 'Danh sách nhật ký hiện hành đã được dọn trống'}
        bulkActions={[
          view === 'ACTIVE'
            ? { key: 'archive-sel', label: 'Lưu trữ & Làm trống đã chọn', icon: <FolderOpenOutlined />, type: 'primary', loading: archiveMut.isPending, eligibleFilter: (r) => !r.isArchived, onClick: async (rows, clear) => { await archiveMut.mutateAsync({ mode: 'SELECTED', ids: rows.map((x) => x.id) }); clear(); } }
            : { key: 'restore-sel', label: 'Khôi phục đã chọn', icon: <RollbackOutlined />, type: 'primary', loading: archiveMut.isPending, eligibleFilter: (r) => Boolean(r.isArchived), onClick: async (rows, clear) => { await archiveMut.mutateAsync({ mode: 'RESTORE', ids: rows.map((x) => x.id) }); clear(); } },
          { key: 'export-sel', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportAuditExcel(rows, view) },
        ]}
      />

      <AuditLogDetailDrawer
        selected={selected}
        onClose={() => setSelected(null)}
        onArchiveOrRestore={(item) => archiveMut.mutate({ mode: item.isArchived ? 'RESTORE' : 'SELECTED', ids: [item.id] })}
      />
    </>
  );
}

export default function AuditLogsPage() {
  return <Suspense><AuditLogsView /></Suspense>;
}
