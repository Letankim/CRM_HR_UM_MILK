'use client';

import { Col, Row, Tag, Typography } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

export interface SignatureBoxInfo {
  title: string;
  subtitle: string;
  signatureUrl?: string | null;
  signerName?: string;
  signedAt?: string | null;
}

export function PayslipSignatureBoxes({
  adminSignatureUrl,
  adminSignedBy,
  adminSignedAt,
  financeSignatureUrl,
  financeSignedBy,
  financeSignedAt,
  employeeSignatureUrl,
  employeeName,
  employeeConfirmedAt,
}: {
  adminSignatureUrl?: string | null;
  adminSignedBy?: string;
  adminSignedAt?: string | null;
  financeSignatureUrl?: string | null;
  financeSignedBy?: string;
  financeSignedAt?: string | null;
  employeeSignatureUrl?: string | null;
  employeeName: string;
  employeeConfirmedAt?: string | null;
}) {
  const boxes: SignatureBoxInfo[] = [
    {
      title: 'BAN QUẢN TRỊ PHÊ DUYỆT',
      subtitle: 'Chữ ký số hệ thống',
      signatureUrl: adminSignatureUrl,
      signerName: adminSignedBy || 'Ban Quản trị Ụm Bò Milk',
      signedAt: adminSignedAt,
    },
    {
      title: 'KẾ TOÁN PHÁT HÀNH',
      subtitle: 'Chữ ký Kế toán tiền lương',
      signatureUrl: financeSignatureUrl,
      signerName: financeSignedBy || 'Phòng Kế toán',
      signedAt: financeSignedAt,
    },
    {
      title: 'NHÂN SỰ XÁC NHẬN',
      subtitle: 'Chữ ký trực tiếp nhân viên',
      signatureUrl: employeeSignatureUrl,
      signerName: employeeName,
      signedAt: employeeConfirmedAt,
    },
  ];

  return (
    <div style={{ marginTop: 12, marginBottom: 12, padding: 12, background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>
        CHỮ KÝ XÁC NHẬN 3 BÊN TRÊN PHIẾU LƯƠNG (QUẢN TRỊ — KẾ TOÁN — NHÂN SỰ)
      </div>
      <Row gutter={[10, 10]}>
        {boxes.map((b) => {
          const signed = Boolean(b.signatureUrl || b.signedAt);
          return (
            <Col xs={24} sm={8} key={b.title}>
              <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 4, padding: '8px 10px', textAlign: 'center', height: '100%' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#0F172A' }}>{b.title}</div>
                <div style={{ fontSize: 10, color: '#64748B', marginBottom: 6 }}>{b.subtitle}</div>
                <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px dashed #E5E7EB', marginBottom: 6 }}>
                  {b.signatureUrl ? (
                    <img src={b.signatureUrl} alt={b.title} style={{ maxHeight: 56, maxWidth: '100%', objectFit: 'contain' }} />
                  ) : signed ? (
                    <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>Đã ký xác nhận</Tag>
                  ) : (
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}><ClockCircleOutlined /> Chưa ký</Typography.Text>
                  )}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {b.signerName}
                </div>
                <div className="num" style={{ fontSize: 10, color: signed ? '#15803D' : '#94A3B8' }}>
                  {b.signedAt ? `Đã ký: ${dayjs(b.signedAt).format('HH:mm DD/MM/YYYY')}` : 'Đang chờ chữ ký'}
                </div>
              </div>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
