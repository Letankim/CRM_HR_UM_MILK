'use client';

import { Alert, App, Button, Space, Tag } from 'antd';
import { CheckCircleOutlined, EditOutlined, FileExcelOutlined, FilePdfOutlined, LockOutlined, QrcodeOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PayPeriodStatus } from '@umbm/shared';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { exportToExcel } from '@/lib/export-excel';
import { downloadBase64File, type ExportFilePayload } from '@/lib/payroll-file-helpers';
import { BaseDetailDrawer } from './BaseDetailDrawer';
import { PayrollBankQrPayModal } from './PayrollBankQrPayModal';
import { payslipLines } from './payroll-sheet-helpers';
import { fmtVnd, type PayrollSnapshotItem, type PayslipRevisionItem } from './payroll-types';
import { PayslipAdjustModal } from './PayslipAdjustModal';
import { PayslipDetailTabs } from './PayslipDetailTabs';
import { useQuickDetail } from './RecordQuickDetailModal';
import { ShiftAttendanceDetailModal } from './ShiftAttendanceDetailModal';

export { payslipLines };

export function PayslipDrawer({ snapshot: propSnap, periodStatus, onClose }: { snapshot: PayrollSnapshotItem | null; periodStatus?: PayPeriodStatus; onClose: () => void }) {
  const [s, setS] = useState<PayrollSnapshotItem | null>(propSnap), [revModal, setRevModal] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false), [downloadingPdf, setDownloadingPdf] = useState(false), [attShiftId, setAttShiftId] = useState<string | null>(null);
  const qc = useQueryClient(), can = useCan(), me = useMe().data?.user;
  const isFinance = me?.role === 'FINANCE', isAdmin = me?.role === 'ADMIN', canManage = can('payroll.manage');
  const { message } = App.useApp(), showDetail = useQuickDetail();

  useEffect(() => { setS(propSnap); if (!propSnap) { setAttShiftId(null); setQrModalOpen(false); } }, [propSnap]);

  const revsQ = useQuery({
    queryKey: ['payslip-revisions', s?.id],
    queryFn: () => api.get<PayslipRevisionItem[]>(`/admin/payroll/payslips/${s!.id}/revisions`),
    enabled: Boolean(s?.id),
    retry: false,
  });

  const invalidateAll = () => {
    ['payslip-revisions', 'payroll-periods', 'payroll-periods-report', 'payroll-snapshots', 'payroll-reconcile', 'payroll-items', 'me'].forEach((k) =>
      void qc.invalidateQueries({ queryKey: [k] }),
    );
  };

  const revMut = useMutation({
    mutationFn: (v: { delta_vnd: number; reason: string }) =>
      api.post<PayslipRevisionItem & { pendingRevision?: PayslipRevisionItem | null }>(`/admin/payroll/payslips/${s!.id}/revisions`, v),
    onSuccess: (res, vars) => {
      const pRev = res?.pendingRevision ?? (res?.status === 'PENDING' ? res : null);
      if (pRev) {
        setS((prev) => (prev ? { ...prev, pendingRevision: pRev } : prev));
        message.success('Đã gửi phiếu điều chỉnh lương cá nhân chờ Ban Quản trị phê duyệt trước khi cập nhật xuống nhân sự');
      } else {
        const delta = Number(vars.delta_vnd || 0);
        setS((prev) =>
          prev
            ? {
                ...prev,
                payslipRevision: (prev.payslipRevision || 1) + 1,
                pendingRevision: null,
                positiveAdjustmentsVnd: delta > 0 ? prev.positiveAdjustmentsVnd + delta : prev.positiveAdjustmentsVnd,
                approvedDeductionsVnd: delta < 0 ? prev.approvedDeductionsVnd + Math.abs(delta) : prev.approvedDeductionsVnd,
                grossVnd: delta > 0 ? prev.grossVnd + delta : prev.grossVnd,
                netVnd: prev.netVnd + delta,
              }
            : prev,
        );
        message.success('Đã lưu điều chỉnh lương và cập nhật thực lĩnh của nhân sự');
      }
      setRevModal(false);
      invalidateAll();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể lưu điều chỉnh lương, vui lòng thử lại'),
  });

  const decideRevMut = useMutation({
    mutationFn: (p: { rev: PayslipRevisionItem; action: 'APPROVE' | 'REJECT' }) =>
      api.post<PayslipRevisionItem>(`/admin/payroll/revisions/${p.rev.id}/decision`, { action: p.action }),
    onSuccess: (_res, vars) => {
      if (vars.action === 'APPROVE') {
        const delta = Number(vars.rev.delta_vnd || 0);
        setS((prev) =>
          prev
            ? {
                ...prev,
                payslipRevision: vars.rev.revision,
                pendingRevision: null,
                positiveAdjustmentsVnd: delta > 0 ? prev.positiveAdjustmentsVnd + delta : prev.positiveAdjustmentsVnd,
                approvedDeductionsVnd: delta < 0 ? prev.approvedDeductionsVnd + Math.abs(delta) : prev.approvedDeductionsVnd,
                grossVnd: delta > 0 ? prev.grossVnd + delta : prev.grossVnd,
                netVnd: vars.rev.after_amount_vnd,
              }
            : prev,
        );
        message.success('Đã phê duyệt điều chỉnh phiếu lương cá nhân và cập nhật thực lĩnh cho nhân sự');
      } else {
        setS((prev) => (prev ? { ...prev, pendingRevision: null } : prev));
        message.success('Đã từ chối phiếu điều chỉnh lương cá nhân');
      }
      invalidateAll();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xử lý phê duyệt điều chỉnh thất bại'),
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
  const isConfirmed = Boolean(s?.employeeConfirmedAt || s?.employeeSignatureUrl);
  const canAdjustSlip = Boolean(s && canManage && !isPaid && !isConfirmed && effStatus !== 'APPROVED' && s.canAdjust !== false);
  const lines = s ? payslipLines(s) : [];
  const revList = revsQ.data ?? s?.revisions ?? [];
  const pendingRev = revList.find((r) => r.status === 'PENDING') ?? s?.pendingRevision ?? null;

  return (
    <BaseDetailDrawer
      title={s ? `Phiếu lương chi tiết — ${s.fullName} (${s.employeeCode})` : 'Phiếu lương'}
      open={!!s}
      onClose={onClose}
      extra={
        <Space size={6} wrap>
          {s && isFinance && isConfirmed && (
            <Button size="small" type={isPaid ? 'default' : 'primary'} icon={<QrcodeOutlined />} onClick={() => setQrModalOpen(true)}>
              {isPaid ? 'Xem QR & Đã TT' : 'Mã QR & Thanh toán'}
            </Button>
          )}
          {s && canManage && (
            canAdjustSlip ? (
              <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => setRevModal(true)}>
                Điều chỉnh
              </Button>
            ) : isPaid ? (
              <Tag color="blue" icon={<LockOutlined />} style={{ margin: 0, borderRadius: 2 }}>Đã thanh toán</Tag>
            ) : isConfirmed ? (
              <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0, borderRadius: 2 }}>NV đã ký — Khóa ĐC</Tag>
            ) : null
          )}
          {s && <Button size="small" icon={<FilePdfOutlined style={{ color: '#DC2626' }} />} loading={downloadingPdf} onClick={() => void handleDownloadPdf()}>Xuất phiếu lương</Button>}
          {s && (
            <Button
              size="small"
              icon={<FileExcelOutlined style={{ color: '#15803D' }} />}
              onClick={() =>
                exportToExcel({
                  fileName: `Phieu_Luong_${s.employeeCode}_${s.periodCode}.xls`,
                  sheetTitle: `PHIẾU LƯƠNG CÁ NHÂN — ${s.fullName} (${s.employeeCode})`,
                  subtitle: `Kỳ lương: ${s.periodCode} | Chi nhánh: ${s.branchName} | Hình thức: ${s.rateTypeLabel} | Ký xác nhận NV: ${s.confirmationLabel || 'Chưa phát hành'}`,
                  columns: [{ header: 'Khoản mục', key: 'label' }, { header: 'Cách tính', key: 'detail' }, { header: 'Số tiền (VNĐ)', key: 'amount', isCurrency: true }],
                  rows: lines,
                  summaryRow: ['THỰC LĨNH', `${s.bankName || ''} ${s.bankAccountNumber || ''}`.trim(), s.netVnd],
                })
              }
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
            <Alert type="success" showIcon style={{ marginBottom: 10 }} message={`Nhân sự đã ký tay trực tiếp phiếu lương lúc ${dayjs(s.employeeConfirmedAt).format('HH:mm DD/MM/YYYY')} — ${isFinance ? 'Mã QR Ngân hàng đã mở khóa để chuyển khoản thanh toán.' : 'Đang chờ Kế toán chuyển khoản thanh toán.'}`} />
          ) : s.disputeStatus === 'OPEN' ? (
            <Alert type="warning" showIcon style={{ marginBottom: 10 }} message={`Nhân sự đang gửi thắc mắc${s.disputeTicketCode ? ` (${s.disputeTicketCode})` : ''} — Kế toán có thể điều chỉnh (+ / -) trình Ban Quản trị duyệt.`} description={s.disputeReason || undefined} />
          ) : effStatus === 'PUBLISHED' ? (
            <Alert type="info" showIcon style={{ marginBottom: 10 }} message="Kỳ lương đã phát hành cho nhân sự. Mọi điều chỉnh phiếu lương cá nhân do Kế toán lập tại bước này bắt buộc được Ban Quản trị phê duyệt trước khi cập nhật cho nhân sự." />
          ) : null}
          {!s.hasSalaryProfile && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="Nhân sự chưa được thiết lập hồ sơ lương cá nhân. Vui lòng thiết lập tại tab Hồ sơ lương nhân sự rồi tính lại kỳ lương." />}

          <PayslipDetailTabs
            snapshot={s}
            revisions={revList}
            pendingRevision={pendingRev}
            isAdmin={isAdmin}
            decidingRevision={decideRevMut.isPending}
            onDecideRevision={(rev, action) => decideRevMut.mutate({ rev, action })}
            onInspectShift={(id) => setAttShiftId(id)}
            onInspectRevision={(item) => showDetail('payslipRevision', item as unknown as Record<string, unknown>)}
          />

          <PayslipAdjustModal
            open={revModal}
            employeeLabel={`${s.fullName} (${s.employeeCode})`}
            currentNetVnd={s.netVnd}
            requiresAdminApproval={effStatus === 'PUBLISHED' && !isAdmin}
            loading={revMut.isPending}
            onClose={() => setRevModal(false)}
            onSubmit={(payload) => revMut.mutate(payload)}
          />
          {isFinance && (
            <PayrollBankQrPayModal
              row={qrModalOpen ? s : null}
              onClose={() => setQrModalOpen(false)}
              onPaidSuccess={(_id, ref) => setS((prev) => (prev ? { ...prev, payslipStatus: 'PAID', paidAt: new Date().toISOString(), paymentReference: ref } : prev))}
            />
          )}
          <ShiftAttendanceDetailModal assignmentId={attShiftId} onClose={() => setAttShiftId(null)} />
        </>
      )}
    </BaseDetailDrawer>
  );
}
