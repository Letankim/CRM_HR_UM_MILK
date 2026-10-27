'use client';

import { App, Button, Card, Descriptions, Drawer, Segmented, Space, Tabs, Tag } from 'antd';
import { ClockCircleOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, EnvironmentOutlined, ExpandAltOutlined, IdcardOutlined, ShopOutlined, ShrinkOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import { BRANCH_STATUS_OPTIONS, type BranchStatus } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { buildBranchColumns, exportBranchesExcel } from '@/ui/components/branch-table-columns';
import { BranchFormModal, type BranchRowItem } from '@/ui/components/BranchFormModal';
import { DataTableCard } from '@/ui/components/DataTableCard';
import { FilterToolbar } from '@/ui/components/FilterToolbar';
import { JobPositionsTableCard } from '@/ui/components/JobPositionsManagerModal';
import { ShiftTemplatesCard, type ShiftTemplateItem } from '@/ui/components/ShiftTemplatesCard';
import { StatusTag } from '@/ui/StatusTag';

function BranchesView() {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const can = useCan();
  const canConfig = can('system.config');
  const canManagePos = can('system.config', 'employee.manage');

  const [tab, setTab] = useState<'branches' | 'shifts' | 'positions'>('branches');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<BranchStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(12);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BranchRowItem | null>(null);
  const [viewing, setViewing] = useState<BranchRowItem | null>(null);
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const buildUrl = (force = false) => {
    const sp = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (status !== 'ALL') sp.set('status', status);
    if (q.trim()) sp.set('q', q.trim());
    if (force) sp.set('refresh', '1');
    return `/admin/branches?${sp}`;
  };

  const branchesQuery = useQuery({
    queryKey: ['branches', status, q, page, perPage],
    queryFn: () => api.list<BranchRowItem>(buildUrl(false)),
  });

  const handleManualRefresh = async () => {
    setManualRefreshing(true);
    const hide = message.loading('Đang làm mới danh mục chi nhánh & mẫu ca...', 0);
    try {
      const [freshBranches, freshShifts] = await Promise.all([
        api.list<BranchRowItem>(buildUrl(true)),
        api.get<ShiftTemplateItem[]>('/admin/shift-templates'),
      ]);
      qc.setQueryData(['branches', status, q, page, perPage], freshBranches);
      qc.setQueryData(['shift-templates'], freshShifts);
      message.success('Đã cập nhật dữ liệu chi nhánh & mẫu ca mới nhất');
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Làm mới thất bại');
    } finally {
      hide();
      setManualRefreshing(false);
    }
  };

  const deleteBranch = useMutation({
    mutationFn: async (items: BranchRowItem[]) => {
      for (const r of items) await api.delete(`/admin/branches/${r.id}`, { version: r.version });
    },
    onSuccess: () => { message.success('Đã xóa chi nhánh thành công'); qc.invalidateQueries({ queryKey: ['branches'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa chi nhánh thất bại'),
  });

  const columns = buildBranchColumns({
    canConfig,
    onViewDetail: (r) => setViewing(r),
    onEdit: (r) => { setEditing(r); setModalOpen(true); },
    onDelete: (r) =>
      modal.confirm({
        title: `Xóa chi nhánh ${r.name}?`,
        content: 'Chi nhánh sẽ được ngừng sử dụng và ẩn khỏi danh sách hoạt động.',
        okText: 'Xác nhận xóa', okButtonProps: { danger: true, icon: <DeleteOutlined /> },
        cancelText: 'Hủy bỏ', cancelButtonProps: { icon: <CloseOutlined /> },
        onOk: () => deleteBranch.mutateAsync([r]),
      }),
  });

  const existingCodes = (branchesQuery.data?.data ?? []).map((b) => b.code);

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as 'branches' | 'shifts' | 'positions')}
          options={[
            { value: 'branches', icon: <ShopOutlined />, label: 'Danh sách Chi nhánh & Tọa độ GPS' },
            { value: 'shifts', icon: <ClockCircleOutlined />, label: 'Danh mục Khung ca mẫu' },
            { value: 'positions', icon: <IdcardOutlined />, label: 'Danh mục Vị trí Công việc' },
          ]}
        />
      </Card>

      {tab === 'branches' ? (
        <>
          <FilterToolbar
            searchPlaceholder="Tìm mã CN01, tên chi nhánh, địa chỉ..."
            searchValue={q}
            onSearchChange={(val) => { setPage(1); setQ(val); }}
            selects={[
              { key: 'status', value: status, width: 190, options: [{ value: 'ALL', label: 'Tất cả trạng thái' }, ...BRANCH_STATUS_OPTIONS], onChange: (val) => { setPage(1); setStatus(val as BranchStatus | 'ALL'); } },
            ]}
            onExportExcel={() => exportBranchesExcel(branchesQuery.data?.data ?? [])}
            onRefresh={handleManualRefresh}
            refreshing={manualRefreshing}
            primaryActionLabel={canConfig ? 'Thêm chi nhánh mới' : undefined}
            onPrimaryAction={canConfig ? () => { setEditing(null); setModalOpen(true); } : undefined}
          />

          <DataTableCard<BranchRowItem>
            columns={columns}
            dataSource={branchesQuery.data?.data}
            meta={branchesQuery.data?.meta}
            loading={branchesQuery.isLoading || branchesQuery.isFetching || manualRefreshing}
            codeExtractor={(r) => r.code}
            onPageChange={(nextPage, nextSize) => { setPage(nextPage); setPerPage(nextSize); }}
            bulkActions={[
              { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportBranchesExcel(rows) },
              ...(canConfig ? [{ key: 'delete', label: 'Xóa chi nhánh đã chọn', danger: true, icon: <DeleteOutlined />, loading: deleteBranch.isPending, confirm: 'Xác nhận xóa các chi nhánh đã chọn?', onClick: (rows: BranchRowItem[]) => deleteBranch.mutate(rows) }] : []),
            ]}
          />
        </>
      ) : tab === 'shifts' ? (
        <ShiftTemplatesCard canConfig={can('system.config', 'schedule.publish')} />
      ) : (
        <JobPositionsTableCard canManage={canManagePos} />
      )}

      <BranchFormModal open={modalOpen} editing={editing} existingCodes={existingCodes} onClose={() => setModalOpen(false)} />

      <Drawer
        title={viewing ? `Chi tiết Chi nhánh: ${viewing.name} (${viewing.code})` : 'Chi tiết Chi nhánh'}
        open={!!viewing}
        onClose={() => setViewing(null)}
        width={drawerExpanded ? 920 : 660}
        destroyOnHidden
        extra={
          <Space size={8}>
            {viewing && canConfig && (
              <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => { const cur = viewing; setViewing(null); setEditing(cur); setModalOpen(true); }}>
                Sửa Chi nhánh &amp; GPS
              </Button>
            )}
            <Button size="small" icon={drawerExpanded ? <ShrinkOutlined /> : <ExpandAltOutlined />} onClick={() => setDrawerExpanded((v) => !v)}>
              {drawerExpanded ? 'Thu gọn' : 'Mở rộng'}
            </Button>
            <Button size="small" icon={<CloseOutlined />} onClick={() => setViewing(null)}>Đóng</Button>
          </Space>
        }
      >
        {viewing && (
          <Tabs
            defaultActiveKey="info"
            items={[
              {
                key: 'info',
                label: <span><ShopOutlined /> Thông tin Cửa hàng &amp; Giờ mở cửa</span>,
                children: (
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label="Mã chi nhánh"><Tag color="blue" style={{ borderRadius: 2, fontWeight: 600 }}>{viewing.code}</Tag></Descriptions.Item>
                    <Descriptions.Item label="Tên chi nhánh"><strong>{viewing.name}</strong></Descriptions.Item>
                    <Descriptions.Item label="Địa chỉ cửa hàng">{viewing.address || 'TP. Hồ Chí Minh'}</Descriptions.Item>
                    <Descriptions.Item label="Số điện thoại liên hệ">{viewing.phoneContact || 'Chưa cập nhật'}</Descriptions.Item>
                    <Descriptions.Item label="Giờ hoạt động"><span className="num">{viewing.openTime} – {viewing.closeTime}</span></Descriptions.Item>
                    <Descriptions.Item label="Số lượng nhân sự"><Tag color="geekblue" style={{ borderRadius: 2 }}>{viewing.employeeCount} nhân sự</Tag></Descriptions.Item>
                    <Descriptions.Item label="Ngày hiệu lực"><span className="num">{viewing.effectiveFrom}</span></Descriptions.Item>
                    <Descriptions.Item label="Trạng thái"><StatusTag value={viewing.status} /></Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: 'gps',
                label: <span><EnvironmentOutlined /> Tọa độ GPS &amp; Bán kính Điểm danh</span>,
                children: (
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label="Vĩ độ & Kinh độ GPS">
                      <Space size={8} wrap>
                        <span className="num" style={{ fontWeight: 600 }}>{viewing.lat}, {viewing.lng}</span>
                        <Button size="small" type="primary" ghost icon={<EnvironmentOutlined />} href={`https://www.google.com/maps?q=${viewing.lat},${viewing.lng}`} target="_blank" rel="noopener noreferrer">
                          Xem trên Google Maps
                        </Button>
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="Bán kính điểm danh hợp lệ"><span className="num"><strong>{viewing.radiusM}m</strong> quanh tâm chi nhánh</span></Descriptions.Item>
                    <Descriptions.Item label="Độ sai số GPS tối đa cho phép"><span className="num">{viewing.maxAccuracyM}m</span></Descriptions.Item>
                    <Descriptions.Item label="Múi giờ vận hành">{viewing.timezone}</Descriptions.Item>
                  </Descriptions>
                ),
              },
            ]}
          />
        )}
      </Drawer>
    </>
  );
}

export default function BranchesPage() {
  return <Suspense><BranchesView /></Suspense>;
}
