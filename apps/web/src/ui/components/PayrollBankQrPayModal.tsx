'use client';

import { Alert, App, Button, Col, Descriptions, Flex, Input, Modal, Row, Space, Tag, Typography } from 'antd';
import { BankOutlined, CheckCircleOutlined, CloseOutlined, CopyOutlined, QrcodeOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
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
  const qc = useQueryClient();
  const can = useCan();
  const canPay = can('payroll.pay', 'payroll.manage', 'system.config');
  const { message } = App.useApp();
  const [reference, setReference] = useState('');

  const suggestedMemo = row ? `LUONG ${row.periodCode} ${row.employeeCode}` : '';

  useEffect(() => {
    if (row) {
      setReference(row.paymentReference || `LUONG ${row.periodCode} ${row.employeeCode}`);
    }
  }, [row]);

  const payMut = useMutation({
    mutationFn: () => {
      const targetId = row?.payslipId || row?.id || '';
      return api.post(`/admin/payroll/payslips/${targetId}/pay`, { payment_reference: reference.trim() });
    },
    onSuccess: () => {
      message.success(`Đã đánh dấu phiếu lương của ${row?.fullName} là Đã thanh toán`);
      ['payroll-snapshots', 'payroll-periods', 'payroll-periods-report', 'me'].forEach((k) =>
        void qc.invalidateQueries({ queryKey: [k] }),
      );
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

  return (
    <Modal
      width={940}
      centered
      style={{ maxWidth: 'calc(100vw - 28px)' }}
      open={Boolean(row)}
      title={row ? `Chuyển Khoản QR & Thanh Toán Phiếu Lương — ${row.fullName} (${row.employeeCode})` : 'Thanh toán lương'}
      onCancel={onClose}
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
      destroyOnHidden
    >
      {row && (
        <>
          {isPaid ? (
            <Alert
              type="success" showIcon style={{ marginBottom: 14 }}
              message={`Phiếu lương này ĐÃ THANH TOÁN${row.paidAt ? ` lúc ${dayjs(row.paidAt).format('HH:mm DD/MM/YYYY')}` : ''}${row.paidByName ? ` bởi ${row.paidByName}` : ''}${row.paymentReference ? ` · Mã tham chiếu: ${row.paymentReference}` : ''}`}
            />
          ) : row.employeeConfirmedAt ? (
            <Alert
              type="info" showIcon style={{ marginBottom: 14 }}
              message={`Nhân sự ${row.fullName} đã ký tay xác nhận phiếu lương lúc ${dayjs(row.employeeConfirmedAt).format('HH:mm DD/MM/YYYY')}. Vui lòng quét mã QR ngân hàng bên dưới để chuyển khoản và đánh dấu Đã thanh toán.`}
            />
          ) : (
            <Alert
              type="warning" showIcon style={{ marginBottom: 14 }}
              message="Nhân sự chưa ký xác nhận phiếu lương nên Mã QR Ngân hàng chưa được mở khóa hiển thị."
            />
          )}

          <Row gutter={[20, 16]} align="stretch">
            <Col xs={24} md={9}>
              <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, background: '#F8FAFC', padding: 16, textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>
                    <QrcodeOutlined /> MÃ QR NGÂN HÀNG NHÂN VIÊN
                  </div>
                  {row.bankQrUrl ? (
                    <img src={row.bankQrUrl} alt="Mã QR Ngân hàng" style={{ maxWidth: '100%', maxHeight: 240, objectFit: 'contain', borderRadius: 4, background: '#FFFFFF', padding: 8, border: '1px solid #E5E7EB' }} />
                  ) : (
                    <div style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                        {row.employeeConfirmedAt
                          ? 'Nhân sự chưa tải ảnh Mã QR Ngân hàng trong Hồ sơ cá nhân (vẫn có thể chuyển khoản theo Số tài khoản bên cạnh)'
                          : 'Mã QR sẽ hiển thị ngay sau khi nhân sự ký xác nhận phiếu lương'}
                      </Typography.Text>
                    </div>
                  )}
                </div>
                {row.employeeSignatureUrl && (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #CBD5E1' }}>
                    <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>Chữ ký trực tiếp của nhân viên</div>
                    <img src={row.employeeSignatureUrl} alt="Chữ ký nhân viên" style={{ maxHeight: 54, maxWidth: '100%', objectFit: 'contain' }} />
                  </div>
                )}
              </div>
            </Col>

            <Col xs={24} md={15}>
              <Descriptions
                size="middle"
                bordered
                column={1}
                styles={{ label: { width: 170, whiteSpace: 'nowrap', fontWeight: 500 }, content: { wordBreak: 'break-word' } }}
              >
                <Descriptions.Item label="Nhân sự">
                  <strong>{row.fullName}</strong> <Tag color="geekblue" style={{ marginLeft: 6 }}>{row.employeeCode}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Ngân hàng">
                  <BankOutlined /> <strong>{row.bankName || 'Chưa cập nhật'}</strong>
                </Descriptions.Item>
                <Descriptions.Item label="Số tài khoản">
                  <Flex justify="space-between" align="center" gap={12} wrap={false}>
                    <strong className="num" style={{ fontSize: 15 }}>{row.bankAccountNumber || 'Chưa cập nhật'}</strong>
                    {row.bankAccountNumber && (
                      <Button size="small" style={{ flexShrink: 0 }} icon={<CopyOutlined />} onClick={() => void copyText('Số tài khoản', row.bankAccountNumber)}>Sao chép</Button>
                    )}
                  </Flex>
                </Descriptions.Item>
                <Descriptions.Item label="Chủ tài khoản">
                  <strong>{row.bankAccountHolder || row.fullName}</strong>
                </Descriptions.Item>
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
                  <Input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="VD: FT26305... hoặc Đã chuyển khoản VietQR thành công"
                  />
                </div>
              )}
            </Col>
          </Row>
        </>
      )}
    </Modal>
  );
}
