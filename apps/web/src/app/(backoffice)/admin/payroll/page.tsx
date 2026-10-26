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
  const [revForm] = Form.useForm();

  const periodsQuery = useQuery({ queryKey: ['payroll-periods'], queryFn: () => api.get<PayPeriodRow[]>('/admin/payroll/periods') });
  const periods = periodsQuery.data ?? [];
  useEffect(() => {
    if (periods.length > 0 && !periods.some((p) => p.id === selectedPeriodId)) setSelectedPeriodId(periods[0]!.id);
  }, [periods, selectedPeriodId]);
  const currentPeriod = useMemo(() => periods.find((p) => p.id === selectedPeriodId), [periods, selectedPeriodId]);

  const snapshotsQuery = useQuery({
    queryKey: ['payroll-snapshots', currentPeriod?.id],
    queryFn: () => api.get<{ period: PayPeriodRow; snapshots: PayrollSnapshotItem[] }>(`/admin/payroll/periods/${currentPeriod!.id}/snapshots`),
    enabled: !!currentPeriod?.id,
  });
  const itemsQuery = useQuery({
    queryKey: ['payroll-items', currentPeriod?.id],
    queryFn: () => api.get<PayrollItemRow[]>(`/admin/payroll/items?period_id=${currentPeriod!.id}`),
    enabled: !!currentPeriod?.id,
  });
  const revInputsQuery = useQuery({
    queryKey: ['payroll-revenue-inputs'],
    queryFn: () => api.get<Record<string, unknown>[]>('/admin/payroll/revenue-inputs'),
    enabled: tab === 'REPORTS',
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

  const snapshots = snapshotsQuery.data?.snapshots ?? [];
  const isLocked = !!currentPeriod && currentPeriod.status !== 'DRAFT' && currentPeriod.status !== 'RECONCILE';
  const refreshAll = () => ['payroll-periods', 'payroll-snapshots', 'payroll-items', 'payroll-revenue-inputs'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const openRevModal = () => {
    revForm.resetFields();
    revForm.setFieldsValue({ period_id: currentPeriod?.id || undefined, branch_id: 'ALL', revenue_vnd: 120000000 });
    setRevInputOpen(true);
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
                <Button icon={<FileExcelOutlined style={{ color: '#15803D' }} />} onClick={() => currentPeriod && exportPayrollSheet(currentPeriod, snapshots)} disabled={!currentPeriod}>Xuất Bảng lương Excel</Button>
              )}
              {canManage && tab === 'REPORTS' && (
                <Button type="primary" icon={<BarChartOutlined />} onClick={openRevModal}>Nhập Doanh thu đối chiếu</Button>
              )}
              {canManage && (tab === 'SHEET' || tab === 'ITEMS') && currentPeriod && !isLocked && (
                <Button icon={<GiftOutlined />} onClick={() => { setEditingItem(null); setItemModalOpen(true); }}>Thêm Thưởng / Phụ cấp</Button>
              )}
              <Button icon={<ReloadOutlined />} loading={periodsQuery.isFetching || snapshotsQuery.isFetching || revInputsQuery.isFetching} onClick={refreshAll}>Làm mới</Button>
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
      {tab === 'SHEET' && currentPeriod && <PayrollSheetCard rows={snapshots} loading={snapshotsQuery.isLoading} onOpenPayslip={setPayslipSnap} />}
      {tab === 'RECONCILE' && currentPeriod && <PayrollAttendanceReconcileCard period={currentPeriod} snapshots={snapshots} loading={snapshotsQuery.isLoading} onOpenPayslip={setPayslipSnap} />}
      {tab === 'ITEMS' && currentPeriod && (
        <PayrollItemsCard items={itemsQuery.data ?? []} loading={itemsQuery.isLoading} canManage={canManage} isLockedPeriod={isLocked} onAddItem={() => { setEditingItem(null); setItemModalOpen(true); }} onEditItem={(i) => { setEditingItem(i); setItemModalOpen(true); }} />
      )}
      {tab === 'REPORTS' && (
        <Card size="small" styles={{ body: { padding: '10px 18px 18px' } }}>
          <Tabs
            activeKey={reportSubTab}
            onChange={(k) => setReportSubTab(k as 'revenue' | 'periods')}
            items={[
              {
                key: 'revenue',
                label: <span><BarChartOutlined /> Đối chiếu Chi phí Lương / Doanh thu ({(revInputsQuery.data ?? []).length})</span>,
                children: (
                  <Table
                    size="small" rowKey="id" pagination={false} loading={revInputsQuery.isLoading} dataSource={revInputsQuery.data ?? []}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu đối chiếu doanh thu. Nhấn 'Nhập Doanh thu đối chiếu' để thêm báo cáo." /> }}
                    columns={[
                      { title: 'Kỳ lương đối chiếu', dataIndex: 'periodName', render: (v: string) => <strong>{v || 'Kỳ lương hiện hành'}</strong> },
                      { title: 'Phạm vi chi nhánh', dataIndex: 'branchName', render: (v: string) => <Tag color="blue">{v}</Tag> },
                      { title: 'Doanh thu kỳ (VNĐ)', dataIndex: 'revenue_vnd', align: 'right', render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{fmtVnd(v)}</span> },
                      { title: 'Tổng chi phí lương Gross (VNĐ)', dataIndex: 'payroll_cost_vnd', align: 'right', render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{fmtVnd(v)}</span> },
                      { title: 'Tỷ lệ Chi phí Lương / Doanh thu', dataIndex: 'labor_cost_percent', align: 'right', render: (v: number) => <Tag color={v <= 25 ? 'green' : 'orange'} className="num">{v}%</Tag> },
                      { title: 'Ghi chú tài chính', dataIndex: 'note', render: (v: string) => v || '—' },
                    ]}
                  />
                ),
              },
              {
                key: 'periods',
                label: <span><CalendarOutlined /> Tổng hợp Quỹ lương theo Kỳ lương ({periods.length})</span>,
                children: (
                  <Table<PayPeriodRow>
                    size="small" rowKey="id" pagination={false} loading={periodsQuery.isLoading} dataSource={periods}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có kỳ lương nào. Hãy thiết lập hồ sơ lương cho nhân sự, sau đó tạo kỳ lương mới." /> }}
                    columns={[
                      { title: 'Mã kỳ', dataIndex: 'period_code', width: 140, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
                      { title: 'Tên kỳ lương', dataIndex: 'name', render: (v: string) => <strong>{v}</strong> },
                      { title: 'Từ ngày – Đến ngày', width: 195, render: (_, r) => <span className="num">{r.from_date} – {r.to_date}</span> },
                      { title: 'Nhân sự', dataIndex: 'total_employees', width: 95, align: 'right', render: (v: number) => <span className="num">{v} NV</span> },
                      { title: 'Tổng giờ công', dataIndex: 'total_approved_hours', width: 120, align: 'right', render: (v: number) => <span className="num">{v} giờ</span> },
                      { title: 'Tổng quỹ lương Gross', dataIndex: 'total_gross_vnd', align: 'right', render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{fmtVnd(v)}</span> },
                      { title: 'Tổng thực lĩnh Net', dataIndex: 'total_net_vnd', align: 'right', render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#16A34A' }}>{fmtVnd(v)}</span> },
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
