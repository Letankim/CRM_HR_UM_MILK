'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Flex, Modal, Space, Tag } from 'antd';
import { CameraOutlined, CheckOutlined, ClockCircleOutlined, CloseOutlined, EnvironmentOutlined, ReloadOutlined, RetweetOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getAccurateDeviceLocation, type AccurateCoords } from '@/lib/geolocation';

export interface EvidenceCameraModalProps {
  open: boolean;
  watermarkTitle?: string;
  onClose: () => void;
  onCapture: (jpegDataUrl: string) => void;
}

function stampEvidenceWatermark(canvas: HTMLCanvasElement, watermarkTitle: string, coords: AccurateCoords | null): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  const barH = Math.max(76, Math.round(h * 0.15));
  ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
  ctx.fillRect(0, h - barH, w, barH);
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  const titleFontPx = Math.max(14, Math.round(w * 0.024));
  const subFontPx = Math.max(12, Math.round(w * 0.02));
  ctx.font = `600 ${titleFontPx}px sans-serif`;
  ctx.fillText(watermarkTitle || 'MINH CHỨNG BỔ SUNG CÔNG · CAMERA TRỰC TIẾP', 18, h - barH + Math.round(barH * 0.42));
  ctx.fillStyle = '#CBD5E1';
  ctx.font = `${subFontPx}px monospace`;
  const gpsText = coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)} (±${coords.accuracy}m)` : 'Không xác định tọa độ GPS thiết bị';
  ctx.fillText(`Chụp lúc: ${dayjs().format('DD/MM/YYYY HH:mm:ss')} · GPS: ${gpsText}`, 18, h - barH + Math.round(barH * 0.78));
}

/**
 * Hộp thoại chụp ảnh minh chứng trực tiếp qua Camera (tự động đóng dấu thời gian chụp & tọa độ GPS lên ảnh như điểm danh).
 * Tuyệt đối không cho phép tải ảnh có sẵn từ máy tính hoặc thư viện thiết bị.
 */
export function EvidenceCameraModal({ open, watermarkTitle, onClose, onCapture }: EvidenceCameraModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [coords, setCoords] = useState<AccurateCoords | null>(null);
  const [locating, setLocating] = useState(false);
  const [nowStr, setNowStr] = useState(() => dayjs().format('DD/MM/YYYY HH:mm:ss'));

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const locateGps = useCallback(async () => {
    setLocating(true);
    try {
      const pos = await getAccurateDeviceLocation();
      setCoords(pos);
    } catch {
      setCoords(null);
    } finally {
      setLocating(false);
    }
  }, []);

  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    stopStream();
    setCameraError('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Trình duyệt hiện tại không hỗ trợ mở luồng Camera trực tiếp. Hệ thống bắt buộc chụp ảnh trực tiếp qua Camera (không cho phép tải ảnh từ máy), vui lòng mở hệ thống trên trình duyệt Chrome / Safari có hỗ trợ Camera.');
      return;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraReady(true);
    } catch {
      setCameraError('Chưa cấp quyền truy cập Camera trên trình duyệt. Chấm công và Bù công bắt buộc phải chụp ảnh trực tiếp qua Camera (tuyệt đối không cho phép tải ảnh có sẵn từ thiết bị). Vui lòng bấm vào biểu tượng ổ khóa trên thanh địa chỉ trình duyệt, bật quyền Camera rồi bấm nút bên dưới.');
    }
  }, [stopStream]);

  useEffect(() => {
    if (!open) {
      stopStream();
      setPreviewUrl('');
      setCameraError('');
      return;
    }
    setPreviewUrl('');
    void startCamera(facingMode);
    void locateGps();
    const timer = setInterval(() => setNowStr(dayjs().format('DD/MM/YYYY HH:mm:ss')), 1000);
    return () => {
      clearInterval(timer);
      stopStream();
    };
  }, [open, facingMode, startCamera, locateGps, stopStream]);

  const handleSnap = () => {
    const video = videoRef.current;
    if (!video || !cameraReady || video.videoWidth <= 0) return;
    const rawW = video.videoWidth || 960;
    const rawH = video.videoHeight || 720;
    const scale = Math.min(1, 1280 / Math.max(rawW, rawH));
    const w = Math.max(640, Math.round(rawW * scale));
    const h = Math.max(480, Math.round(rawH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, 0, 0, w, h);
    stampEvidenceWatermark(canvas, watermarkTitle || 'MINH CHỨNG BỔ SUNG CÔNG · CAMERA TRỰC TIẾP', coords);
    setPreviewUrl(canvas.toDataURL('image/jpeg', 0.89));
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      destroyOnHidden
      centered
      width={560}
      title={<span><CameraOutlined /> Chụp ảnh minh chứng trực tiếp (Đóng dấu Thời gian &amp; GPS)</span>}
      footer={
        <Flex justify="space-between" align="center" gap={8} wrap="wrap" style={{ width: '100%' }}>
          <Button
            icon={<RetweetOutlined />}
            disabled={Boolean(previewUrl) || !cameraReady}
            onClick={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
          >
            Đổi góc Camera
          </Button>
          <Space size={8}>
            <Button icon={<CloseOutlined />} onClick={onClose}>Hủy bỏ</Button>
            {previewUrl ? (
              <>
                <Button icon={<ReloadOutlined />} onClick={() => setPreviewUrl('')}>Chụp lại</Button>
                <Button type="primary" icon={<CheckOutlined />} onClick={() => { onCapture(previewUrl); onClose(); }}>
                  Xác nhận dùng ảnh này
                </Button>
              </>
            ) : (
              <Button type="primary" icon={<CameraOutlined />} disabled={!cameraReady} onClick={handleSnap}>
                Chụp ảnh ngay
              </Button>
            )}
          </Space>
        </Flex>
      }
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Flex justify="space-between" align="center" wrap="wrap" gap={6} style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '6px 10px' }}>
          <Space size={6} wrap>
            <Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{nowStr}</Tag>
            {locating ? (
              <Tag color="processing" style={{ margin: 0 }}>Đang lấy tọa độ GPS...</Tag>
            ) : coords ? (
              <Tag color="green" icon={<EnvironmentOutlined />} style={{ margin: 0 }}>GPS: ({coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}) · ±{coords.accuracy}m</Tag>
            ) : (
              <Tag color="warning" style={{ margin: 0 }}>Chưa xác định GPS (vẫn chụp được ảnh)</Tag>
            )}
          </Space>
          <Button size="small" icon={<ReloadOutlined />} loading={locating} onClick={() => void locateGps()}>Lấy lại GPS</Button>
        </Flex>
        {cameraError ? (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Alert type="error" showIcon message={cameraError} />
            <Button type="primary" icon={<ReloadOutlined />} onClick={() => void startCamera(facingMode)}>
              Cấp quyền &amp; Mở lại Camera trực tiếp
            </Button>
          </Space>
        ) : (
          <div style={{ background: '#0F172A', borderRadius: 4, overflow: 'hidden', border: '1px solid #E5E7EB', position: 'relative' }}>
            {previewUrl ? (
              <img src={previewUrl} alt="Ảnh vừa chụp" style={{ width: '100%', maxHeight: 340, objectFit: 'contain', display: 'block' }} />
            ) : (
              <video ref={videoRef} playsInline muted autoPlay style={{ width: '100%', maxHeight: 340, objectFit: 'contain', display: 'block' }} />
            )}
          </div>
        )}
      </Space>
    </Modal>
  );
}
