'use client';

import { Alert, App, Button, Descriptions, Space, Table, Tabs, Tag, Typography } from 'antd';
import { CalendarOutlined, CheckCircleOutlined, EditOutlined, FileExcelOutlined, FilePdfOutlined, FileTextOutlined, HistoryOutlined, IdcardOutlined, LockOutlined, QrcodeOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PayPeriodStatus } from '@umbm/shared';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { exportToExcel } from '@/lib/export-excel';
import { downloadBase64File, type ExportFilePayload } from '@/lib/payroll-file-helpers';
import { useClientPagination } from '../hooks/useClientPagination';
import { BaseDetailDrawer } from './BaseDetailDrawer';
import { buildClickableRowProps } from './BulkActionBar';
import { PayrollBankQrPayModal } from './PayrollBankQrPayModal';
import { LOG_STATUS_COLORS, payslipLines, type PayslipLine } from './payroll-sheet-helpers';
import { allowancesOf, fmtVnd, type PayrollSnapshotItem, type ShiftPayrollLog } from './payroll-types';
import { PayslipAdjustModal } from './PayslipAdjustModal';
import { PayslipSignatureBoxes } from './PayslipSignatureBoxes';
import { useQuickDetail } from './RecordQuickDetailModal';
import { ShiftAttendanceDetailModal } from './ShiftAttendanceDetailModal';

export { payslipLines };

export function PayslipDrawer({ snapshot: propSnap, periodStatus, onClose }: { snapshot: PayrollSnapshotItem | null; periodStatus?: PayPeriodStatus; onClose: () => void }) {
  const [s, setS] = useState<PayrollSnapshotItem | null>(propSnap), [revModal, setRevModal] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false), [downloadingPdf, setDownloadingPdf] = useState(false);
  const [attShiftId, setAttShiftId] = useState<string | null>(null);
  const logPag = useClientPagination(10, 'ca'), revPag = useClientPagination(10, 'lần điều chỉnh');
  const qc = useQueryClient(), can = useCan(), canManage = can('payroll.manage'), { message } = App.useApp(), showDetail = useQuickDetail();

  useEffect(() => { setS(propSnap); if (!propSnap) { setAttShiftId(null); setQrModalOpen(false); } }, [propSnap]);

  const revsQ = useQuery({ queryKey: ['payslip-revisions', s?.id], queryFn: () => api.get<Record<string, unknown>[]>(`/admin/payroll/payslips/${s!.id}/revisions`), enabled: Boolean(s?.id), retry: false });

  const revMut = useMutation({
    mutationFn: (v: { delta_vnd: number; reason: string }) => api.post(`/admin/payroll/payslips/${s!.id}/revisions`, v),
    onSuccess: (_res, vars) => {
      const delta = Number(vars.delta_vnd || 0);
      setS((prev) => prev ? {
        ...prev, payslipRevision: (prev.payslipRevision || 1) + 1,
        positiveAdjustmentsVnd: delta > 0 ? prev.positiveAdjustmentsVnd + delta : prev.positiveAdjustmentsVnd,
        approvedDeductionsVnd: delta < 0 ? prev.approvedDeductionsVnd + Math.abs(delta) : prev.approvedDeductionsVnd,
        grossVnd: delta > 0 ? prev.grossVnd + delta : prev.grossVnd, netVnd: prev.netVnd + delta,
      } : prev);
      message.success('Đã lưu điều chỉnh lương và cập nhật thực lĩnh của nhân sự');
      setRevModal(false);
      ['payslip-revisions', 'payroll-periods', 'payroll-periods-report', 'payroll-snapshots', 'payroll-reconcile', 'payroll-items'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể lưu điều chỉnh lương, vui lòng thử lại'),
  });

  const handleDownloadPdf = async () => {
    if (!s) return;
    setDownloadingPdf(true);
    try {
      const out = await api.get<ExportFilePayload>(`/admin/payroll/payslips/${s.payslipId || s.id}/export-pdf`);
      downloadBase64File(out.base64, out.fileName, out.mimeType);
      message.success(`Đã tải PDF phiếu lương: ${out.fileName}`);
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Tải PDF phiếu lương thất bại');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const effStatus = periodStatus ?? s?.periodStatus ?? 'DRAFT';
  const isPaid = effStatus === 'PAID' || s?.payslipStatus === 'PAID';
  const isConfirmed = Boolean(s?.employeeConfirmedAt);
  const canAdjustSlip = Boolean(s && canManage && !isPaid && !isConfirmed && s.canAdjust !== false);
  const lines = s ? payslipLines(s) : [];

  return (
    <BaseDetailDrawer
      title={s ? `Phiếu lương chi tiết — ${s.fullName} (${s.employeeCode})` : 'Phiếu lương'}
      open={!!s} onClose={onClose}
      extra={
        <Space size={6} wrap>
          {s && isConfirmed && (
            <Button size="small" type={isPaid ? 'default' : 'primary'} icon={<QrcodeOutlined />} onClick={() => setQrModalOpen(true)}>
              {isPaid ? 'Xem QR & Đã TT' : 'Mã QR & Thanh toán'}
            </Button>
          )}
          {s && canManage && (
            canAdjustSlip ? (
              <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => setRevModal(true)}>Điều chỉnh lương (+ / -)</Button>
            ) : isPaid ? (
              <Tag color="blue" icon={<LockOutlined />} style={{ margin: 0, borderRadius: 2 }}>Đã thanh toán</Tag>
            ) : isConfirmed ? (
              <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0, borderRadius: 2 }}>NV đã ký — Khóa ĐC</Tag>
            ) : null
          )}
          {s && <Button size="small" icon={<FilePdfOutlined style={{ color: '#DC2626' }} />} loading={downloadingPdf} onClick={() => void handleDownloadPdf()}>Tải PDF</Button>}
          {s && (
            <Button
              size="small" icon={<FileExcelOutlined style={{ color: '#15803D' }} />}
              onClick={() => exportToExcel({
                fileName: `Phieu_Luong_${s.employeeCode}_${s.periodCode}.xls`,
                sheetTitle: `PHIẾU LƯƠNG CÁ NHÂN — ${s.fullName} (${s.employeeCode})`,
                subtitle: `Kỳ lương: ${s.periodCode} | Chi nhánh: ${s.branchName} | Hình thức: ${s.rateTypeLabel} | Ký xác nhận NV: ${s.confirmationLabel || 'Chưa phát hành'}`,
                columns: [{ header: 'Khoản mục', key: 'label' }, { header: 'Cách tính', key: 'detail' }, { header: 'Số tiền (VNĐ)', key: 'amount', isCurrency: true }],
                rows: lines, summaryRow: ['THỰC LĨNH', `${s.bankName || ''} ${s.bankAccountNumber || ''}`.trim(), s.netVnd],
              })}
            >
              Xuất Excel
            </Button>
          )}
        </Space>
      }
    >
      {s && (
        <>
          {isPaid ? (
            <Alert type="success" showIcon style={{ marginBottom: 10 }} message={`Phiếu lương ĐÃ THANH TOÁN${s.paidAt ? ` lúc ${dayjs(s.paidAt).format('HH:mm DD/MM/YYYY')}` : ''}${s.paymentReference ? ` · Mã tham chiếu: ${s.paymentReference}` : ''}.`} />
          ) : isConfirmed ? (
            <Alert type="success" showIcon style={{ marginBottom: 10 }} message={`Nhân sự đã ký tay trực tiếp phiếu lương lúc ${dayjs(s.employeeConfirmedAt).format('HH:mm DD/MM/YYYY')} — Mã QR Ngân hàng đã mở khóa để chuyển khoản thanh toán.`} />
          ) : s.disputeStatus === 'OPEN' ? (
            <Alert type="warning" showIcon style={{ marginBottom: 10 }} message={`Nhân sự đang gửi thắc mắc${s.disputeTicketCode ? ` (${s.disputeTicketCode})` : ''} — Kế toán vẫn có thể điều chỉnh (+ / -).`} description={s.disputeReason || undefined} />
          ) : effStatus === 'PUBLISHED' ? (
            <Alert type="info" showIcon style={{ marginBottom: 10 }} message="Nhân sự chưa ký xác nhận phiếu lương — Kế toán vẫn có thể điều chỉnh cộng thêm hoặc khấu trừ nếu phát hiện sai lệch." />
          ) : null}
          {!s.hasSalaryProfile && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="Nhân sự chưa được thiết lập hồ sơ lương cá nhân. Vui lòng thiết lập tại tab Hồ sơ lương nhân sự rồi tính lại kỳ lương." />}
          <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '8px 12px', marginBottom: 10 }}>
            <Space size={[8, 6]} wrap>
              <Tag color="blue" style={{ margin: 0 }}>Tổng công: {s.totalShiftsCount} ca ({s.approvedHours} giờ · {s.workedDays} ngày)</Tag>
              <Tag color="green" style={{ margin: 0 }}>Điểm danh GPS: {s.checkedInShiftsCount ?? 0} ca</Tag>
              {(s.adjustedShiftsCount ?? 0) > 0 && <Tag color="cyan" style={{ margin: 0 }}>Bổ sung công: {s.adjustedShiftsCount} ca</Tag>}
              <Tag color="gold" style={{ margin: 0 }}>Nghỉ OFF: {s.leaveOffCount ?? 0} ngày</Tag>
              <Tag color="purple" style={{ margin: 0 }}>Đổi ca: +{s.shiftSwapCount} / -{s.swappedOutCount ?? 0}</Tag>
            </Space>
          </div>
          <Tabs
            defaultActiveKey="lines"
            items={[
              {
                key: 'lines', label: <span><FileTextOutlined /> Chi tiết Khoản mục &amp; Chữ ký</span>,
                children: (
                  <>
                    <Table<PayslipLine>
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
                    <PayslipSignatureBoxes adminSignatureUrl={s.adminSignatureUrl} adminSignedBy={s.adminSignedBy} adminSignedAt={s.adminSignedAt} financeSignatureUrl={s.financeSignatureUrl} financeSignedBy={s.financeSignedBy} financeSignedAt={s.financeSignedAt} employeeSignatureUrl={s.employeeSignatureUrl} employeeName={`${s.fullName} (${s.employeeCode})`} employeeConfirmedAt={s.employeeConfirmedAt} />
                  </>
                ),
              },
              {
                key: 'attendance-logs', label: <span><CalendarOutlined /> Đối soát Chấm công ({(s.shiftLogs ?? []).length})</span>,
                children: (
                  <Table<ShiftPayrollLog>
                    size="small" rowKey={(r, i) => `${r.date}-${r.shiftCode}-${i}`} pagination={logPag} dataSource={s.shiftLogs ?? []}
                    onRow={(r) => r.assignmentId ? buildClickableRowProps(r, (item) => setAttShiftId(String(item.assignmentId))) : {}}
                    columns={[
                      { title: 'Ngày', dataIndex: 'date', width: 105, render: (v: string) => <strong className="num">{dayjs(v).format('DD/MM/YYYY')}</strong> },
                      { title: 'Ca làm việc', width: 165, render: (_, r) => <div><strong>{r.shiftLabel}</strong><div style={{ fontSize: 11, color: '#64748B' }}>{r.shiftTime}</div></div> },
                      { title: 'Vào – Ra', width: 130, render: (_, r) => <span className="num">{r.checkInHm || '—'} – {r.checkOutHm || '—'}</span> },
                      { title: 'Trạng thái', width: 220, render: (_, r) => <Space size={4} wrap><Tag color={LOG_STATUS_COLORS[r.status] || 'default'} style={{ margin: 0 }}>{r.statusLabel}</Tag>{r.isSwapIn && <Tag color={(r.swapAllowanceVnd ?? 0) > 0 ? 'purple' : 'default'} style={{ margin: 0 }}>{(r.swapAllowanceVnd ?? 0) > 0 ? `+${fmtVnd(r.swapAllowanceVnd!)} đổi ca` : 'Nhận đổi ca'}</Tag>}</Space> },
                      { title: 'Giờ công', width: 110, align: 'right', render: (_, r) => <span className="num"><strong>{r.hours} giờ</strong>{r.otHours > 0 ? <div style={{ fontSize: 11, color: '#2563EB' }}>+{r.otHours}h OT</div> : null}</span> },
                      { title: 'Ghi chú', dataIndex: 'note', ellipsis: true, render: (v: string) => v || '—' },
                    ]}
                  />
                ),
              },
              {
                key: 'info', label: <span><IdcardOutlined /> Ngân hàng &amp; Hồ sơ</span>,
                children: (
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label="Nhân sự">{s.fullName} ({s.employeeCode}) · {s.branchName} · {s.stageLabel}</Descriptions.Item>
                    <Descriptions.Item label="Ký xác nhận NV">{s.employeeConfirmedAt ? `Đã ký trực tiếp lúc ${dayjs(s.employeeConfirmedAt).format('HH:mm DD/MM/YYYY')}` : (s.confirmationLabel || 'Chưa phát hành')}{s.payslipCode ? ` · Mã phiếu: ${s.payslipCode}` : ''}</Descriptions.Item>
                    <Descriptions.Item label="Hình thức &amp; Mức lương">{s.rateTypeLabel} — {fmtVnd(s.rateVnd)}/{s.unitLabel}{s.probationPercent ? ` · Thử việc ${s.probationPercent}%` : ''}</Descriptions.Item>
                    <Descriptions.Item label="Tài khoản nhận lương">{s.bankName || 'Chưa cập nhật'} · {s.bankAccountNumber || '—'}{s.bankAccountHolder ? ` · ${s.bankAccountHolder}` : ''}</Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: 'revisions', label: <span><HistoryOutlined /> Lịch sử Điều chỉnh ({revsQ.data?.length ?? 0})</span>,
                children: (
                  <Table
                    size="small" rowKey="id" pagination={revPag} dataSource={revsQ.data ?? []}
                    onRow={(r) => buildClickableRowProps(r, (item) => showDetail('payslipRevision', item))}
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
          <PayslipAdjustModal open={revModal} employeeLabel={`${s.fullName} (${s.employeeCode})`} currentNetVnd={s.netVnd} loading={revMut.isPending} onClose={() => setRevModal(false)} onSubmit={(payload) => revMut.mutate(payload)} />
          <PayrollBankQrPayModal row={qrModalOpen ? s : null} onClose={() => setQrModalOpen(false)} onPaidSuccess={(_id, ref) => setS((prev) => prev ? { ...prev, payslipStatus: 'PAID', paidAt: new Date().toISOString(), paymentReference: ref } : prev)} />
          <ShiftAttendanceDetailModal assignmentId={attShiftId} onClose={() => setAttShiftId(null)} />
        </>
      )}
    </BaseDetailDrawer>
  );
}
