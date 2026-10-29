'use client';

import { Alert, App, Button, Descriptions, Drawer, Form, Input, InputNumber, Modal, Space, Table, Tabs, Tag, Typography } from 'antd';
import { CalendarOutlined, CloseOutlined, EditOutlined, ExpandAltOutlined, FileExcelOutlined, FileTextOutlined, HistoryOutlined, IdcardOutlined, SaveOutlined, ShrinkOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { exportToExcel } from '@/lib/export-excel';
import { useClientPagination } from '../hooks/useClientPagination';
import { allowancesOf, deductionsOf, fmtVnd, MONEY_INPUT_PROPS, type PayrollSnapshotItem, type ShiftPayrollLog } from './payroll-types';

interface Line { label: string; detail: string; amount: number }

const LOG_STATUS_COLORS: Record<ShiftPayrollLog['status'], string> = {
  ATTENDANCE_FULL: 'green',
  ATTENDANCE_CHECKIN: 'processing',
  ADJUSTMENT_APPROVED: 'cyan',
  SCHEDULE_PUBLISHED: 'blue',
  LEAVE_OFF: 'gold',
  SWAPPED_OUT: 'purple',
  EMERGENCY_LEAVE: 'volcano',
  ABSENT: 'red',
};

/** Dựng các dòng phiếu lương (dùng chung cho Drawer và Xuất Excel phiếu lương) */
export function payslipLines(s: PayrollSnapshotItem): Line[] {
  const lines: Line[] = s.segments.map((seg) => ({
    label: `Lương ${seg.stage === 'PROBATION' ? `thử việc (${seg.percent}%)` : 'chính thức'}`,
    detail: `${seg.quantity} ${seg.unit} x ${fmtVnd(seg.unitRateVnd)} (${dayjs(seg.fromDate).format('DD/MM')} - ${dayjs(seg.toDate).format('DD/MM')}, ${seg.hours} giờ)`,
    amount: seg.amountVnd,
  }));
  if (s.otPayVnd > 0) lines.push({ label: 'Tăng ca (OT)', detail: `${s.otHours} giờ x ${fmtVnd(s.otRateVnd)}`, amount: s.otPayVnd });
  for (const a of s.allowanceLines) {
    lines.push({ label: a.label, detail: a.code === 'ALLOWANCE_SWAP' ? `${s.shiftSwapCount} ca nhận đổi` : 'Theo hồ sơ lương / khoản mục đã duyệt', amount: a.amount });
  }
  if (s.kpiBonusVnd > 0) lines.push({ label: 'Thưởng KPI / Doanh số', detail: 'Khoản thưởng đã duyệt trong kỳ', amount: s.kpiBonusVnd });
  if (s.positiveAdjustmentsVnd > 0) lines.push({ label: 'Điều chỉnh cộng', detail: 'Khoản bổ sung đã duyệt', amount: s.positiveAdjustmentsVnd });
  if (deductionsOf(s) > 0) lines.push({ label: 'Khấu trừ & tạm ứng đã duyệt', detail: 'Chỉ áp dụng khoản đã phê duyệt', amount: -deductionsOf(s) });
  return lines;
}

export function PayslipDrawer({ snapshot: propSnap, onClose }: { snapshot: PayrollSnapshotItem | null; onClose: () => void }) {
  const [s, setS] = useState<PayrollSnapshotItem | null>(propSnap);
  const [expanded, setExpanded] = useState(false);
  const [revModal, setRevModal] = useState(false);
  const [revForm] = Form.useForm();
  const logPag = useClientPagination(10, 'ca');
  const revPag = useClientPagination(10, 'lần điều chỉnh');
  const qc = useQueryClient();
  const can = useCan();
  const canManage = can('payroll.manage');
  const { message } = App.useApp();

  useEffect(() => { setS(propSnap); }, [propSnap]);

  const revsQ = useQuery({
    queryKey: ['payslip-revisions', s?.id],
    queryFn: () => api.get<Record<string, unknown>[]>(`/admin/payroll/payslips/${s!.id}/revisions`),
    enabled: Boolean(s?.id),
    retry: false,
  });

  const revMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => api.post(`/admin/payroll/payslips/${s!.id}/revisions`, v),
    onSuccess: (_res, vars) => {
      const delta = Number(vars.delta_vnd || 0);
      setS((prev) =>
        prev
          ? {
              ...prev,
              positiveAdjustmentsVnd: delta > 0 ? prev.positiveAdjustmentsVnd + delta : prev.positiveAdjustmentsVnd,
              approvedDeductionsVnd: delta < 0 ? prev.approvedDeductionsVnd + Math.abs(delta) : prev.approvedDeductionsVnd,
              grossVnd: delta > 0 ? prev.grossVnd + delta : prev.grossVnd,
              netVnd: prev.netVnd + delta,
            }
          : prev,
      );
      message.success('Đã lưu điều chỉnh lương và cập nhật thực lĩnh của nhân sự');
      setRevModal(false);
      ['payslip-revisions', 'payroll-periods', 'payroll-periods-report', 'payroll-snapshots', 'payroll-reconcile', 'payroll-items'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể lưu điều chỉnh lương, vui lòng thử lại'),
  });

  const lines = s ? payslipLines(s) : [];
  return (
    <Drawer
      title={s ? `Phiếu lương chi tiết — ${s.fullName} (${s.employeeCode})` : 'Phiếu lương'}
      open={!!s} onClose={onClose} width={expanded ? '95vw' : '70vw'} destroyOnHidden
      extra={
        <Space size={8}>
          {s && canManage && (
            <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => { revForm.resetFields(); setRevModal(true); }}>
              Tạo bản điều chỉnh
            </Button>
          )}
          {s && (
            <Button
              size="small" icon={<FileExcelOutlined style={{ color: '#15803D' }} />}
              onClick={() =>
                exportToExcel({
                  fileName: `Phieu_Luong_${s.employeeCode}_${s.periodCode}.xls`,
                  sheetTitle: `PHIẾU LƯƠNG CÁ NHÂN — ${s.fullName} (${s.employeeCode})`,
                  subtitle: `Kỳ lương: ${s.periodCode} | Chi nhánh: ${s.branchName} | Hình thức: ${s.rateTypeLabel}`,
                  columns: [{ header: 'Khoản mục', key: 'label' }, { header: 'Cách tính', key: 'detail' }, { header: 'Số tiền (VNĐ)', key: 'amount', isCurrency: true }],
                  rows: lines,
                  summaryRow: ['THỰC LĨNH', `${s.bankName || ''} ${s.bankAccountNumber || ''}`.trim(), s.netVnd],
                })
              }
            >
              Xuất phiếu lương Excel
            </Button>
          )}
          <Button size="small" icon={expanded ? <ShrinkOutlined /> : <ExpandAltOutlined />} onClick={() => setExpanded((v) => !v)}>{expanded ? 'Thu gọn' : 'Mở rộng'}</Button>
          <Button size="small" icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
        </Space>
      }
    >
      {s && (
        <>
          {!s.hasSalaryProfile && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Nhân sự chưa được thiết lập hồ sơ lương cá nhân. Vui lòng thiết lập tại tab Hồ sơ lương nhân sự rồi tính lại kỳ lương." />}
          {s.missingProfileShifts > 0 && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`Có ${s.missingProfileShifts} ca làm nằm ngoài thời gian hiệu lực của hồ sơ lương nên chưa được tính.`} />}
          <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '10px 12px', marginBottom: 12 }}>
            <Space size={[8, 6]} wrap>
              <Tag color="blue" style={{ margin: 0 }}>Tổng công: {s.totalShiftsCount} ca ({s.approvedHours} giờ · {s.workedDays} ngày)</Tag>
              <Tag color="green" style={{ margin: 0 }}>Điểm danh GPS: {s.checkedInShiftsCount ?? 0} ca</Tag>
              {(s.adjustedShiftsCount ?? 0) > 0 && <Tag color="cyan" style={{ margin: 0 }}>Bổ sung công duyệt: {s.adjustedShiftsCount} ca</Tag>}
              <Tag color="gold" style={{ margin: 0 }}>Nghỉ OFF đã duyệt: {s.leaveOffCount ?? 0} ngày</Tag>
              <Tag color="purple" style={{ margin: 0 }}>Nhận đổi ca: +{s.shiftSwapCount} ca · Chuyển ca: -{s.swappedOutCount ?? 0} ca</Tag>
              {(s.lateCount ?? 0) > 0 && <Tag color="warning" style={{ margin: 0 }}>Đi trễ: {s.lateCount} lần ({s.lateMinutesTotal ?? 0} phút)</Tag>}
              {(s.absentCount ?? 0) > 0 && <Tag color="error" style={{ margin: 0 }}>Vắng không phép: {s.absentCount} ca</Tag>}
            </Space>
          </div>
          <Tabs
            defaultActiveKey="lines"
            items={[
              {
                key: 'lines', label: <span><FileTextOutlined /> Chi tiết Khoản mục Lương</span>,
                children: (
                  <Table<Line>
                    size="small" rowKey={(r, i) => `${r.label}-${i}`} pagination={false} dataSource={lines}
                    columns={[
                      { title: 'Khoản mục', dataIndex: 'label', render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
                      { title: 'Cách tính', dataIndex: 'detail', render: (v: string) => <span style={{ fontSize: 12, color: '#64748B' }}>{v}</span> },
                      { title: 'Số tiền', dataIndex: 'amount', align: 'right', render: (v: number) => <span className="num" style={{ fontWeight: 600, color: v < 0 ? '#DC2626' : '#0F172A' }}>{fmtVnd(v)}</span> },
                    ]}
                    summary={() => (
                      <>
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={2}>Tổng thu nhập · Phụ cấp {fmtVnd(allowancesOf(s))}</Table.Summary.Cell>
                          <Table.Summary.Cell index={1} align="right"><span className="num" style={{ fontWeight: 700 }}>{fmtVnd(s.grossVnd)}</span></Table.Summary.Cell>
                        </Table.Summary.Row>
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={2}><strong>THỰC LĨNH</strong> · {s.bankName || 'Chưa cập nhật ngân hàng'} {s.bankAccountNumber}</Table.Summary.Cell>
                          <Table.Summary.Cell index={1} align="right"><span className="num" style={{ fontWeight: 800, color: '#15803D', fontSize: 15 }}>{fmtVnd(s.netVnd)}</span></Table.Summary.Cell>
                        </Table.Summary.Row>
                      </>
                    )}
                  />
                ),
              },
              {
                key: 'attendance-logs', label: <span><CalendarOutlined /> Đối soát Chấm công, Nghỉ OFF &amp; Đổi ca ({(s.shiftLogs ?? []).length})</span>,
                children: (
                  <Table<ShiftPayrollLog>
                    size="small" rowKey={(r, i) => `${r.date}-${r.shiftCode}-${i}`} pagination={logPag} dataSource={s.shiftLogs ?? []}
                    columns={[
                      { title: 'Ngày', dataIndex: 'date', width: 105, render: (v: string) => <strong className="num">{dayjs(v).format('DD/MM/YYYY')}</strong> },
                      { title: 'Ca làm việc', width: 165, render: (_, r) => <div><strong>{r.shiftLabel}</strong><div style={{ fontSize: 11, color: '#64748B' }}>{r.shiftTime}</div></div> },
                      { title: 'Vào – Ra thực tế', width: 130, render: (_, r) => <span className="num">{r.checkInHm || '—'} – {r.checkOutHm || '—'}</span> },
                      { title: 'Trạng thái đối soát', width: 210, render: (_, r) => <Space size={4} wrap><Tag color={LOG_STATUS_COLORS[r.status] || 'default'} style={{ margin: 0 }}>{r.statusLabel}</Tag>{r.isSwapIn && <Tag color="purple" style={{ margin: 0 }}>+30.000đ đổi ca</Tag>}</Space> },
                      { title: 'Giờ tính lương', width: 120, align: 'right', render: (_, r) => <span className="num"><strong>{r.hours} giờ</strong>{r.otHours > 0 ? <div style={{ fontSize: 11, color: '#2563EB' }}>+{r.otHours}h OT</div> : null}</span> },
                      { title: 'Ghi chú', dataIndex: 'note', ellipsis: true, render: (v: string) => v || '—' },
                    ]}
                  />
                ),
              },
              {
                key: 'info', label: <span><IdcardOutlined /> Thông tin Công &amp; Ngân hàng</span>,
                children: (
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label="Nhân sự">{s.fullName} ({s.employeeCode}) · {s.branchName} · {s.stageLabel}</Descriptions.Item>
                    <Descriptions.Item label="Hình thức &amp; Mức lương">{s.rateTypeLabel} — {fmtVnd(s.rateVnd)}/{s.unitLabel}{s.probationPercent ? ` · Thử việc ${s.probationPercent}%` : ''}</Descriptions.Item>
                    <Descriptions.Item label="Công tính lương">{s.totalShiftsCount} ca · {s.workedDays} ngày · {s.approvedHours} giờ ({s.workSourceLabel || '—'})</Descriptions.Item>
                    <Descriptions.Item label="Đối soát chấm công &amp; phép">Điểm danh GPS: {s.checkedInShiftsCount ?? 0} ca · Bổ sung công: {s.adjustedShiftsCount ?? 0} ca · Nghỉ OFF: {s.leaveOffCount ?? 0} ngày · Nhận đổi ca: {s.shiftSwapCount} ca · Chuyển ca: {s.swappedOutCount ?? 0} ca</Descriptions.Item>
                    <Descriptions.Item label="Tài khoản nhận lương">{s.bankName || 'Chưa cập nhật'} · {s.bankAccountNumber || '—'}</Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: 'revisions', label: <span><HistoryOutlined /> Lịch sử Điều chỉnh ({revsQ.data?.length ?? 0})</span>,
                children: (
                  <Table
                    size="small" rowKey="id" pagination={revPag} dataSource={revsQ.data ?? []}
                    columns={[
                      { title: 'Lần điều chỉnh', dataIndex: 'revision', width: 130, render: (v: number) => <Tag color="geekblue">Lần #{v}</Tag> },
                      { title: 'Chênh lệch (+/-)', dataIndex: 'delta_vnd', width: 150, render: (v: number) => <span className="num" style={{ fontWeight: 700, color: v >= 0 ? '#16A34A' : '#DC2626' }}>{v >= 0 ? `+${fmtVnd(v)}` : fmtVnd(v)}</span> },
                      { title: 'Thực lĩnh mới', dataIndex: 'after_amount_vnd', width: 150, render: (v: number) => <span className="num" style={{ fontWeight: 700 }}>{fmtVnd(v)}</span> },
                      { title: 'Lý do điều chỉnh', dataIndex: 'reason' },
                    ]}
                  />
                ),
              },
            ]}
          />
          <Modal width={680} title="Điều Chỉnh Bảng Lương / Phiếu Lương Nhân Sự" open={revModal} onCancel={() => setRevModal(false)} onOk={() => revForm.submit()} okText="Lưu điều chỉnh" cancelText="Hủy bỏ" okButtonProps={{ icon: <SaveOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} confirmLoading={revMut.isPending}>
            <Form form={revForm} layout="vertical" onFinish={(v) => revMut.mutate(v)}>
              <Form.Item name="delta_vnd" label="Số tiền điều chỉnh chênh lệch (+ cộng thêm / - khấu trừ)" rules={[{ required: true, message: 'Vui lòng nhập số tiền điều chỉnh' }]}><InputNumber style={{ width: '100%' }} step={50000} placeholder="VD: 150.000 hoặc -50.000" suffix="VNĐ" {...MONEY_INPUT_PROPS} /></Form.Item>
              <Form.Item name="reason" label="Lý do điều chỉnh lương (tối thiểu 5 ký tự)" rules={[{ required: true, min: 5, message: 'Vui lòng nhập lý do điều chỉnh tối thiểu 5 ký tự' }]}><Input.TextArea rows={2} placeholder="VD: Bổ sung phụ cấp ca tối ngày 20/10 sau đối soát..." /></Form.Item>
            </Form>
          </Modal>
        </>
      )}
    </Drawer>
  );
}
