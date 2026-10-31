'use client';

import { Alert, App, Button, Flex, Modal, Space, Typography } from 'antd';
import { CheckCircleOutlined, ClearOutlined, CloseOutlined, EditOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { fmtVnd } from './payroll-types';

const CANVAS_CSS_W = 540;
const CANVAS_CSS_H = 190;

export function EmployeeSignaturePadModal({
  open,
  payslipCode,
  periodName,
  netVnd,
  loading,
  onClose,
  onConfirmSign,
}: {
  open: boolean;
  payslipCode: string;
  periodName: string;
  netVnd: number;
  loading: boolean;
  onClose: () => void;
  onConfirmSign: (signaturePngDataUrl: string) => void;
}) {
  const { message } = App.useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const strokeDistRef = useRef(0);
  const [hasSignature, setHasSignature] = useState(false);

  const resetCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = CANVAS_CSS_W * dpr;
    canvas.height = CANVAS_CSS_H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#0F172A';
    drawingRef.current = false;
    lastPtRef.current = null;
    strokeDistRef.current = 0;
    setHasSignature(false);
  };

  useEffect(() => {
    if (open) {
      const id = window.setTimeout(resetCanvas, 40);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const toCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_CSS_W / Math.max(1, rect.width);
    const scaleY = CANVAS_CSS_H / Math.max(1, rect.height);
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const pt = toCanvasPoint(e);
    lastPtRef.current = pt;
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const prev = lastPtRef.current;
    if (!ctx || !prev) return;
    const pt = toCanvasPoint(e);
    const segDist = Math.hypot(pt.x - prev.x, pt.y - prev.y);
    if (segDist < 0.8) return;
    const midX = (prev.x + pt.x) / 2;
    const midY = (prev.y + pt.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    lastPtRef.current = pt;
    strokeDistRef.current += segDist;
    if (strokeDistRef.current >= 24 && !hasSignature) setHasSignature(true);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    drawingRef.current = false;
    lastPtRef.current = null;
  };

  const handleSubmit = () => {
    const canvas = canvasRef.current;
    if (!canvas || strokeDistRef.current < 24) {
      message.warning('Vui lòng ký tay trực tiếp đầy đủ chữ ký của bạn vào khung bên dưới');
      return;
    }
    const pngDataUrl = canvas.toDataURL('image/png');
    onConfirmSign(pngDataUrl);
  };

  return (
    <Modal
      width={600}
      open={open}
      title={`Ký Tay Trực Tiếp Xác Nhận Phiếu Lương — ${periodName}`}
      onCancel={onClose}
      footer={
        <Flex justify="space-between" align="center" wrap gap={8}>
          <Button icon={<ClearOutlined />} onClick={resetCanvas} disabled={loading}>Xóa ký lại</Button>
          <Space>
            <Button icon={<CloseOutlined />} onClick={onClose} disabled={loading}>Hủy bỏ</Button>
            <Button type="primary" icon={<CheckCircleOutlined />} disabled={!hasSignature} loading={loading} onClick={handleSubmit}>
              Xác nhận chữ ký &amp; Đồng ý phiếu lương
            </Button>
          </Space>
        </Flex>
      }
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={`Mã phiếu: ${payslipCode} — Thực lĩnh: ${fmtVnd(netVnd)}`}
        description="Theo quy định bảo mật, nhân sự bắt buộc ký tay trực tiếp trên khung cảm ứng / chuột bên dưới (không được phép tải ảnh từ thiết bị). Sau khi xác nhận, Mã QR Ngân hàng trong hồ sơ của bạn sẽ tự động gửi tới Ban Quản trị & Kế toán để chuyển khoản."
      />
      <div style={{ marginBottom: 6 }}>
        <Typography.Text strong style={{ fontSize: 13 }}>
          <EditOutlined /> Ký trực tiếp chữ ký của bạn vào khung trắng bên dưới:
        </Typography.Text>
      </div>
      <div style={{ border: '1px solid #2563EB', borderRadius: 4, background: '#FFFFFF', padding: 4, userSelect: 'none' }}>
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            width: '100%',
            height: CANVAS_CSS_H,
            display: 'block',
            touchAction: 'none',
            cursor: 'crosshair',
            background: 'linear-gradient(to bottom, #FFFFFF 82%, #F1F5F9 83%, #FFFFFF 84%)',
          }}
        />
      </div>
      <div style={{ fontSize: 11, color: '#64748B', marginTop: 6, textAlign: 'center' }}>
        Dùng ngón tay (trên điện thoại) hoặc chuột / bút cảm ứng (trên máy tính) để ký trên đường kẻ ngang
      </div>
    </Modal>
  );
}
