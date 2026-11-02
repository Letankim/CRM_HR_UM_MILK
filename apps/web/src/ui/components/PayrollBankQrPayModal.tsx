'use client';

import { Alert, App, Button, Col, Descriptions, Flex, Input, Modal, Row, Space, Spin, Tag, Typography } from 'antd';
import { BankOutlined, CheckCircleOutlined, CloseOutlined, CopyOutlined, QrcodeOutlined, ZoomInOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { buildDynamicVietQrUrl } from '@umbm/shared';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { openFancyboxGallery } from './FancyboxPreview';
import { fmtVnd, type PayrollSnapshotItem } from './payroll-types';

export function PayrollBankQrPayModal({
  row,
  onClose,
  onPaidSuccess,
}: {
  row: PayrollSnapshotItem | null;
  onClose: () => void;
  onPaidSuccess?: (payslipId: string, reference: string) => void;
}) {
  const qc = useQueryClient(), can = useCan(), isFinance = useMe().data?.user.role === 'FINANCE';
  const canPay = isFinance && can('payroll.pay', 'payroll.manage'), { message } = App.useApp();
  const [reference, setReference] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
  const [qrHovered, setQrHovered] = useState(false);

  const suggestedMemo = row ? `LUONG ${row.periodCode} ${row.employeeCode}` : '';
  const dynamicVietQrUrl = row && row.bankAccountNumber
    ? buildDynamicVietQrUrl({
        bankNameOrBin: row.bankName || 'VCB',
        accountNumber: row.bankAccountNumber,
        accountHolder: row.bankAccountHolder || row.fullName,
        amountVnd: row.netVnd,
        periodCode: row.periodCode,
        employeeCode: row.employeeCode,
      })
    : '';

  useEffect(() => {
    if (row) setReference(row.paymentReference || `LUONG ${row.periodCode} ${row.employeeCode}`);
  }, [row]);

  useEffect(() => {
    setQrLoading(Boolean(row?.employeeConfirmedAt && dynamicVietQrUrl));
    setQrFailed(false);
  }, [row?.id, row?.employeeConfirmedAt, dynamicVietQrUrl]);

  const payMut = useMutation({
    mutationFn: () => api.post(`/admin/payroll/payslips/${row?.payslipId || row?.id || ''}/pay`, { payment_reference: reference.trim() }),
    onSuccess: () => {
      message.success(`Đã đánh dấu phiếu lương của ${row?.fullName} là Đã thanh toán`);
      ['payroll-snapshots', 'payroll-periods', 'payroll-periods-report', 'me'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
      if (row) onPaidSuccess?.(row.payslipId || row.id, reference.trim());
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Đánh dấu thanh toán thất bại'),
  });

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(`Đã sao chép ${label}`);
    } catch {
      message.warning(`Không thể sao chép tự động: ${text}`);
    }
  };

  const isPaid = row?.payslipStatus === 'PAID' || row?.periodStatus === 'PAID';
  if (!isFinance) return null;

  const openQrPreview = () => {
    if (!dynamicVietQrUrl || !row) return;
    openFancyboxGallery([{ src: dynamicVietQrUrl, caption: `Mã QR thanh toán — ${row.fullName} (${row.employeeCode}) · ${fmtVnd(row.netVnd)}` }], 0);
  };

  return (
    <Modal
      width={940} centered style={{ maxWidth: 'calc(100vw - 28px)' }} open={Boolean(row)}
      title={row ? `Chuyển Khoản QR & Thanh Toán Phiếu Lương — ${row.fullName} (${row.employeeCode})` : 'Thanh toán lương'}
      onCancel={onClose} destroyOnHidden
      footer={
        <Space>
          <Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
          {row && canPay && !isPaid && (
            <Button type="primary" icon={<CheckCircleOutlined />} loading={payMut.isPending} onClick={() => payMut.mutate()}>
              Đánh dấu Phiếu lương Đã thanh toán
            </Button>
          )}
        </Space>
      }
    >
      {row && (
        <>
          {isPaid ? (
            <Alert type="success" showIcon style={{ marginBottom: 14 }} message={`Phiếu lương này ĐÃ THANH TOÁN${row.paidAt ? ` lúc ${dayjs(row.paidAt).format('HH:mm DD/MM/YYYY')}` : ''}${row.paidByName ? ` bởi ${row.paidByName}` : ''}${row.paymentReference ? ` · Mã tham chiếu: ${row.paymentReference}` : ''}`} />
          ) : row.employeeConfirmedAt ? (
            <Alert type="info" showIcon style={{ marginBottom: 14 }} message={`Nhân sự ${row.fullName} đã ký tay xác nhận phiếu lương lúc ${dayjs(row.employeeConfirmedAt).format('HH:mm DD/MM/YYYY')}. Vui lòng quét mã QR thanh toán bên dưới để chuyển khoản và đánh dấu Đã thanh toán.`} />
          ) : (
            <Alert type="warning" showIcon style={{ marginBottom: 14 }} message="Nhân sự chưa ký xác nhận phiếu lương nên Mã QR thanh toán chưa được mở khóa hiển thị." />
          )}

          <Row gutter={[16, 16]} align="stretch">
            <Col xs={24} md={10}>
              <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, background: '#F8FAFC', padding: 14, textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', marginBottom: 10 }}>
                    <QrcodeOutlined style={{ color: '#2563EB', marginRight: 6 }} />
                    Mã QR thanh toán
                  </div>
                  {row.employeeConfirmedAt && dynamicVietQrUrl && !qrFailed ? (
                    <div
                      role="button" tabIndex={0} title="Bấm để phóng to Mã QR thanh toán"
                      onClick={openQrPreview}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openQrPreview(); } }}
                      onMouseEnter={() => setQrHovered(true)} onMouseLeave={() => setQrHovered(false)}
                      style={{ position: 'relative', minHeight: 240, borderRadius: 4, background: '#FFFFFF', padding: 10, border: '1px solid #CBD5E1', cursor: 'zoom-in', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
                    >
                      {qrLoading && (
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.9)', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                          <Spin size="default" />
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Đang tải mã QR thanh toán...</Typography.Text>
                        </div>
                      )}
                      <img
                        src={dynamicVietQrUrl} alt="Mã QR thanh toán"
                        onLoad={() => setQrLoading(false)} onError={() => { setQrLoading(false); setQrFailed(true); }}
                        style={{ maxWidth: '100%', maxHeight: 230, objectFit: 'contain', display: 'block', transition: 'transform 0.18s ease', transform: qrHovered ? 'scale(1.03)' : 'scale(1)' }}
                      />
                      {!qrLoading && (
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.36)', opacity: qrHovered ? 1 : 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', transition: 'opacity 0.16s ease' }}>
                          <span style={{ background: 'rgba(15, 23, 42, 0.85)', color: '#FFFFFF', fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <ZoomInOutlined /> Xem lớn
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ padding: 24, background: '#FFFFFF', border: '1px dashed #CBD5E1', borderRadius: 4 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {row.employeeConfirmedAt ? 'Chưa có Số tài khoản ngân hàng để hiển thị Mã QR thanh toán' : 'Mã QR thanh toán sẽ mở khóa sau khi nhân sự ký xác nhận phiếu lương'}
                      </Typography.Text>
                    </div>
                  )}
                </div>

                {row.employeeSignatureUrl && (
                  <div style={{ paddingTop: 10, borderTop: '1px dashed #CBD5E1' }}>
                    <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>Chữ ký trực tiếp của nhân viên</div>
                    <img src={row.employeeSignatureUrl} alt="Chữ ký nhân viên" style={{ maxHeight: 48, maxWidth: '100%', objectFit: 'contain' }} />
                  </div>
                )}
              </div>
            </Col>

            <Col xs={24} md={14}>
              <Descriptions size="middle" bordered column={1} styles={{ label: { width: 170, whiteSpace: 'nowrap', fontWeight: 500 }, content: { wordBreak: 'break-word' } }}>
                <Descriptions.Item label="Nhân sự"><strong>{row.fullName}</strong> <Tag color="geekblue" style={{ marginLeft: 6 }}>{row.employeeCode}</Tag></Descriptions.Item>
                <Descriptions.Item label="Ngân hàng"><BankOutlined /> <strong>{row.bankName || 'Chưa cập nhật'}</strong></Descriptions.Item>
                <Descriptions.Item label="Số tài khoản">
                  <Flex justify="space-between" align="center" gap={12} wrap={false}>
                    <strong className="num" style={{ fontSize: 15 }}>{row.bankAccountNumber || 'Chưa cập nhật'}</strong>
                    {row.bankAccountNumber && <Button size="small" style={{ flexShrink: 0 }} icon={<CopyOutlined />} onClick={() => void copyText('Số tài khoản', row.bankAccountNumber)}>Sao chép</Button>}
                  </Flex>
                </Descriptions.Item>
                <Descriptions.Item label="Chủ tài khoản"><strong>{row.bankAccountHolder || row.fullName}</strong></Descriptions.Item>
                <Descriptions.Item label="Số tiền Thực lĩnh">
                  <Flex justify="space-between" align="center" gap={12} wrap={false}>
                    <strong className="num" style={{ fontSize: 17, color: '#15803D' }}>{fmtVnd(row.netVnd)}</strong>
                    <Button size="small" style={{ flexShrink: 0 }} icon={<CopyOutlined />} onClick={() => void copyText('Số tiền thực lĩnh', String(Math.round(row.netVnd)))}>Sao chép số</Button>
                  </Flex>
                </Descriptions.Item>
                <Descriptions.Item label="Nội dung CK gợi ý">
                  <Flex justify="space-between" align="center" gap={12} wrap={false}>
                    <span className="num" style={{ fontWeight: 500 }}>{suggestedMemo}</span>
                    <Button size="small" style={{ flexShrink: 0 }} icon={<CopyOutlined />} onClick={() => void copyText('Nội dung chuyển khoản', suggestedMemo)}>Sao chép</Button>
                  </Flex>
                </Descriptions.Item>
              </Descriptions>

              {canPay && !isPaid && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>Mã giao dịch / Nội dung xác nhận chuyển khoản</div>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="VD: FT26305... hoặc Đã chuyển khoản thành công" />
                </div>
              )}
            </Col>
          </Row>
        </>
      )}
    </Modal>
  );
}
