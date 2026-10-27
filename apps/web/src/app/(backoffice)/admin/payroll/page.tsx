'use client';

import { App, Button, Card, Col, Empty, Flex, Form, Input, InputNumber, Modal, Row, Segmented, Select, Space, Table, Tabs, Tag } from 'antd';
import { BarChartOutlined, CalendarOutlined, CloseOutlined, FileExcelOutlined, GiftOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { PayrollAttendanceReconcileCard } from '@/ui/components/PayrollAttendanceReconcileCard';
import { CreatePeriodModal, PayrollItemModal } from '@/ui/components/PayrollModals';
import { PayrollItemsCard } from '@/ui/components/PayrollItemsCard';
import { PayrollPeriodBar } from '@/ui/components/PayrollPeriodBar';
import { exportPayrollSheet, PayrollSheetCard } from '@/ui/components/PayrollSheetCard';
import { fmtVnd, MONEY_INPUT_PROPS, type PayPeriodRow, type PayrollItemRow, type PayrollSnapshotItem } from '@/ui/components/payroll-types';
import { PayslipDrawer } from '@/ui/components/PayslipDrawer';
import { SalaryProfilesTab } from '@/ui/components/SalaryProfilesTab';
import { StatusTag } from '@/ui/StatusTag';

type TabKey = 'SHEET' | 'RECONCILE' | 'ITEMS' | 'SALARY' | 'REPORTS';

function PayrollView() {
  const qc = useQueryClient();
  const can = useCan();
  const canManage = can('payroll.manage');
  const canManageSalary = can('payroll.manage');
  const { message } = App.useApp();

  const [tab, setTab] = useState<TabKey>('SHEET');
  const [reportSubTab, setReportSubTab] = useState<'revenue' | 'periods'>('revenue');
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [revInputOpen, setRevInputOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PayrollItemRow | null>(null);
  const [payslipSnap, setPayslipSnap] = useState<PayrollSnapshotItem | null>(null);
  const [revPage, setRevPage] = useState(1);
  const [revPerPage, setRevPerPage] = useState(12);
  const [perPageNum, setPerPageNum] = useState(1);
  const [perPageSize, setPerPageSize] = useState(12);
  const [revForm] = Form.useForm();

  const periodsQuery = useQuery({ queryKey: ['payroll-periods'], queryFn: () => api.get<PayPeriodRow[]>('/admin/payroll/periods?per_page=100') });
  const periods = periodsQuery.data ?? [];
  useEffect(() => {
    if (periods.length > 0 && !periods.some((p) => p.id === selectedPeriodId)) setSelectedPeriodId(periods[0]!.id);
  }, [periods, selectedPeriodId]);
  const currentPeriod = useMemo(() => periods.find((p) => p.id === selectedPeriodId), [periods, selectedPeriodId]);

  const revInputsQuery = useQuery({
    queryKey: ['payroll-revenue-inputs', revPage, revPerPage],
    queryFn: () => api.list<Record<string, unknown>>(`/admin/payroll/revenue-inputs?page=${revPage}&per_page=${revPerPage}`),
    enabled: tab === 'REPORTS',
  });
  const periodsReportQuery = useQuery({
    queryKey: ['payroll-periods-report', perPageNum, perPageSize],
    queryFn: () => api.list<PayPeriodRow>(`/admin/payroll/periods?page=${perPageNum}&per_page=${perPageSize}`),
    enabled: tab === 'REPORTS' && reportSubTab === 'periods',
  });
  const branchesQuery = useQuery({
    queryKey: ['branches-select'],
    queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=100'),
  });
  const employeesQuery = useQuery({
    queryKey: ['employees', 'payroll-select'],
    queryFn: () => api.list<{ id: string; employeeCode: string; fullName: string }>('/admin/employees?per_page=100&sort_by=employeeCode&sort_order=asc'),
  });
  const empOptions = useMemo(() => (employeesQuery.data?.data ?? []).map((e) => ({ value: e.id, label: `${e.employeeCode} — ${e.fullName}` })), [employeesQuery.data]);
  const branchOptions = useMemo(() => [{ value: 'ALL', label: 'Toàn chuỗi Ụm Bò Milk' }, ...(branchesQuery.data?.data ?? []).map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))], [branchesQuery.data]);

  const saveRevMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => api.post('/admin/payroll/revenue-inputs', { ...v, period_id: v.period_id || currentPeriod?.id || '' }),
    onSuccess: () => { message.success('Đã lưu doanh thu đối chiếu & tính tỷ lệ chi phí lương/doanh thu'); setRevInputOpen(false); qc.invalidateQueries({ queryKey: ['payroll-revenue-inputs'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Lưu doanh thu đối chiếu thất bại'),
  });

  const isLocked = !!currentPeriod && currentPeriod.status !== 'DRAFT' && currentPeriod.status !== 'RECONCILE';
  const refreshAll = () => ['payroll-periods', 'payroll-periods-report', 'payroll-snapshots', 'payroll-reconcile', 'payroll-items', 'payroll-revenue-inputs'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const openRevModal = () => {
    revForm.resetFields();
    revForm.setFieldsValue({ period_id: currentPeriod?.id || undefined, branch_id: 'ALL', revenue_vnd: 120000000 });
    setRevInputOpen(true);
  };
  const handleExportSheet = async () => {
    if (!currentPeriod) return;
    const res = await api.get<{ period: PayPeriodRow; snapshots: PayrollSnapshotItem[] }>(`/admin/payroll/periods/${currentPeriod.id}/snapshots`);
    exportPayrollSheet(currentPeriod, res.snapshots);
  };

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Card size="small">
        <Flex justify="space-between" align="center" wrap gap={10}>
          <Space size={10} wrap>
            <Segmented
              value={tab} onChange={(v) => setTab(v as TabKey)}
              options={[
                { value: 'SHEET', label: 'Bảng lương & Phiếu lương' },
                { value: 'RECONCILE', label: 'Bảng chấm công & Đối soát' },
                { value: 'ITEMS', label: 'Thưởng, Phụ cấp & Khấu trừ' },
                { value: 'SALARY', label: 'Hồ sơ lương nhân sự' },
                { value: 'REPORTS', label: 'Báo cáo Lương / Doanh thu' },
              ]}
            />
            {(tab === 'SHEET' || tab === 'RECONCILE' || tab === 'ITEMS') && (
              <Select
                value={currentPeriod?.id} placeholder="Chọn kỳ lương" style={{ width: 290 }} loading={periodsQuery.isLoading}
                onChange={setSelectedPeriodId} options={periods.map((p) => ({ value: p.id, label: `${p.name} (${p.statusLabel})` }))}
              />
            )}
          </Space>
          {tab !== 'SALARY' && (
            <Space size={8} wrap>
              {tab !== 'REPORTS' && (
                <Button icon={<FileExcelOutlined style={{ color: '#15803D' }} />} onClick={() => void handleExportSheet()} disabled={!currentPeriod}>Xuất Bảng lương Excel</Button>
              )}
              {canManage && tab === 'REPORTS' && (
                <Button type="primary" icon={<BarChartOutlined />} onClick={openRevModal}>Nhập Doanh thu đối chiếu</Button>
              )}
              {canManage && (tab === 'SHEET' || tab === 'ITEMS') && currentPeriod && !isLocked && (
                <Button icon={<GiftOutlined />} onClick={() => { setEditingItem(null); setItemModalOpen(true); }}>Thêm Thưởng / Phụ cấp</Button>
              )}
              <Button icon={<ReloadOutlined />} loading={periodsQuery.isFetching || revInputsQuery.isFetching} onClick={refreshAll}>Làm mới</Button>
              {canManage && <Button type={tab === 'REPORTS' ? 'default' : 'primary'} icon={<PlusOutlined />} onClick={() => setPeriodModalOpen(true)}>Tạo kỳ lương mới</Button>}
            </Space>
          )}
        </Flex>
        {(tab === 'SHEET' || tab === 'RECONCILE' || tab === 'ITEMS') && currentPeriod && (
          <PayrollPeriodBar period={currentPeriod} canManage={canManage} onDeleted={() => setSelectedPeriodId('')} />
        )}
      </Card>

      {tab === 'SALARY' && <SalaryProfilesTab canManage={canManageSalary} employeeOptions={empOptions} />}
      {(tab === 'SHEET' || tab === 'RECONCILE' || tab === 'ITEMS') && !currentPeriod && !periodsQuery.isLoading && (
        <Card size="small"><Empty description="Chưa có kỳ lương nào. Hãy thiết lập hồ sơ lương cho nhân sự, sau đó tạo kỳ lương mới." /></Card>
      )}
      {tab === 'SHEET' && currentPeriod && <PayrollSheetCard period={currentPeriod} onOpenPayslip={setPayslipSnap} />}
      {tab === 'RECONCILE' && currentPeriod && <PayrollAttendanceReconcileCard period={currentPeriod} onOpenPayslip={setPayslipSnap} />}
      {tab === 'ITEMS' && currentPeriod && (
        <PayrollItemsCard periodId={currentPeriod.id} canManage={canManage} isLockedPeriod={isLocked} onAddItem={() => { setEditingItem(null); setItemModalOpen(true); }} onEditItem={(i) => { setEditingItem(i); setItemModalOpen(true); }} />
      )}
      {tab === 'REPORTS' && (
        <Card size="small" styles={{ body: { padding: '10px 18px 18px' } }}>
          <Tabs
            activeKey={reportSubTab}
            onChange={(k) => setReportSubTab(k as 'revenue' | 'periods')}
            items={[
              {
                key: 'revenue',
                label: <span><BarChartOutlined /> Đối chiếu Chi phí Lương / Doanh thu ({revInputsQuery.data?.meta.pagination.total ?? 0})</span>,
                children: (
                  <Table
                    size="small" rowKey="id"
                    pagination={{ current: revPage, pageSize: revPerPage, total: revInputsQuery.data?.meta.pagination.total ?? 0, showSizeChanger: true, pageSizeOptions: ['10', '12', '15', '20', '50', '100'], showTotal: (t) => `Tổng ${t} bản ghi`, onChange: (p, ps) => { setRevPage(ps !== revPerPage ? 1 : p); setRevPerPage(ps); } }}
                    loading={revInputsQuery.isLoading || revInputsQuery.isFetching} dataSource={revInputsQuery.data?.data ?? []}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu đối chiếu doanh thu. Nhấn 'Nhập Doanh thu đối chiếu' để thêm báo cáo." /> }}
                    columns={[
                      { title: 'Kỳ lương đối chiếu', dataIndex: 'periodName', render: (v: string) => <strong>{v || 'Kỳ lương hiện hành'}</strong> },
                      { title: 'Phạm vi chi nhánh', dataIndex: 'branchName', render: (v: string) => <Tag color="blue">{v}</Tag> },
                      { title: 'Doanh thu kỳ (VNĐ)', dataIndex: 'revenue_vnd', align: 'right', render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{fmtVnd(v)}</span> },
                      { title: 'Tổng chi phí lương (VNĐ)', dataIndex: 'payroll_cost_vnd', align: 'right', render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{fmtVnd(v)}</span> },
                      { title: 'Tỷ lệ Chi phí Lương / Doanh thu', dataIndex: 'labor_cost_percent', align: 'right', render: (v: number) => <Tag color={v <= 25 ? 'green' : 'orange'} className="num">{v}%</Tag> },
                      { title: 'Ghi chú tài chính', dataIndex: 'note', render: (v: string) => v || '—' },
                    ]}
                  />
                ),
              },
              {
                key: 'periods',
                label: <span><CalendarOutlined /> Tổng hợp Quỹ lương theo Kỳ lương ({periodsReportQuery.data?.meta.pagination.total ?? periods.length})</span>,
                children: (
                  <Table<PayPeriodRow>
                    size="small" rowKey="id"
                    pagination={{ current: perPageNum, pageSize: perPageSize, total: periodsReportQuery.data?.meta.pagination.total ?? periods.length, showSizeChanger: true, pageSizeOptions: ['10', '12', '15', '20', '50', '100'], showTotal: (t) => `Tổng ${t} kỳ lương`, onChange: (p, ps) => { setPerPageNum(ps !== perPageSize ? 1 : p); setPerPageSize(ps); } }}
                    loading={periodsReportQuery.isLoading || periodsReportQuery.isFetching} dataSource={periodsReportQuery.data?.data ?? periods}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có kỳ lương nào. Hãy thiết lập hồ sơ lương cho nhân sự, sau đó tạo kỳ lương mới." /> }}
                    columns={[
                      { title: 'Mã kỳ', dataIndex: 'period_code', width: 140, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
                      { title: 'Tên kỳ lương', dataIndex: 'name', render: (v: string) => <strong>{v}</strong> },
                      { title: 'Từ ngày – Đến ngày', width: 195, render: (_, r) => <span className="num">{r.from_date} – {r.to_date}</span> },
                      { title: 'Nhân sự', dataIndex: 'total_employees', width: 95, align: 'right', render: (v: number) => <span className="num">{v} NV</span> },
                      { title: 'Tổng giờ công', dataIndex: 'total_approved_hours', width: 120, align: 'right', render: (v: number) => <span className="num">{v} giờ</span> },
                      { title: 'Tổng quỹ lương', dataIndex: 'total_gross_vnd', align: 'right', render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{fmtVnd(v)}</span> },
                      { title: 'Tổng thực lĩnh', dataIndex: 'total_net_vnd', align: 'right', render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#16A34A' }}>{fmtVnd(v)}</span> },
                      { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (v: string, r) => <StatusTag value={v} label={r.statusLabel} /> },
                    ]}
                  />
                ),
              },
            ]}
          />
        </Card>
      )}

      <CreatePeriodModal open={periodModalOpen} onClose={() => setPeriodModalOpen(false)} />
      {currentPeriod && <PayrollItemModal open={itemModalOpen} periodId={currentPeriod.id} employees={empOptions} editing={editingItem} onClose={() => { setItemModalOpen(false); setEditingItem(null); }} />}
      <PayslipDrawer snapshot={payslipSnap} onClose={() => setPayslipSnap(null)} />
      <Modal width={680} title="Nhập Doanh Thu Đối Chiếu & Tính Tỷ Lệ Chi Phí Lương" open={revInputOpen} onCancel={() => setRevInputOpen(false)} onOk={() => revForm.submit()} okText="Lưu đối chiếu" cancelText="Hủy bỏ" okButtonProps={{ icon: <SaveOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} confirmLoading={saveRevMut.isPending}>
        <Form form={revForm} layout="vertical" onFinish={(v) => saveRevMut.mutate(v)} style={{ marginTop: 12 }}>
          <Row gutter={12}>
            <Col xs={24} md={12}><Form.Item name="period_id" label="Kỳ lương áp dụng"><Select allowClear placeholder="Chọn kỳ lương (hoặc kỳ hiện hành)" options={periods.map((p) => ({ value: p.id, label: `${p.name} (${p.statusLabel})` }))} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="branch_id" label="Phạm vi chi nhánh đối chiếu"><Select options={branchOptions} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} md={12}><Form.Item name="revenue_vnd" label="Doanh thu thuần trong kỳ lương (VNĐ)" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={1000000} step={5000000} suffix="VNĐ" {...MONEY_INPUT_PROPS} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="payroll_cost_vnd" label="Quỹ lương đối chiếu (Để trống = tự lấy theo kỳ)"><InputNumber style={{ width: '100%' }} min={0} step={1000000} suffix="VNĐ" placeholder="Tự động tổng hợp từ kỳ lương" {...MONEY_INPUT_PROPS} /></Form.Item></Col>
          </Row>
          <Form.Item name="note" label="Ghi chú báo cáo tài chính"><Input placeholder="VD: Doanh thu POS chốt kỳ tháng 10/2026" /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

export default function PayrollPage() {
  return <Suspense><PayrollView /></Suspense>;
}
