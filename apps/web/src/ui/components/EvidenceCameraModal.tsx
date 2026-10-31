'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Flex, Modal, Space } from 'antd';
import { CameraOutlined, CheckOutlined, CloseOutlined, ReloadOutlined, RetweetOutlined } from '@ant-design/icons';

export interface EvidenceCameraModalProps {
  open: boolean;
  onClose: () => void;
  onCapture: (jpegDataUrl: string) => void;
  onFallbackFile: (file: File) => void;
}

/**
 * Hộp thoại chụp ảnh minh chứng trực tiếp qua Camera (hỗ trợ cả Webcam máy tính và Camera điện thoại).
 * Có nút chuyển đổi Camera trước/sau và phương án mở ứng dụng Camera gốc của thiết bị khi trình duyệt chặn quyền.
 */
export function EvidenceCameraModal({ open, onClose, onCapture, onFallbackFile }: EvidenceCameraModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeInputRef = useRef<HTMLInputElement | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    stopStream();
    setCameraError('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Trình duyệt hiện tại không hỗ trợ mở Camera trực tiếp. Bạn có thể bấm nút bên dưới để mở Camera thiết bị hoặc đóng hộp thoại để tải ảnh từ máy.');
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
      setCameraError('Không mở được Camera (chưa cấp quyền hoặc thiết bị không có Camera). Vui lòng cấp quyền Camera hoặc đóng để tải ảnh có sẵn từ máy.');
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
    return () => stopStream();
  }, [open, facingMode, startCamera, stopStream]);

  const handleSnap = () => {
    const video = videoRef.current;
    if (!video || !cameraReady) return;
    const rawW = video.videoWidth || 960;
    const rawH = video.videoHeight || 720;
    const scale = Math.min(1, 1280 / Math.max(rawW, rawH));
    const w = Math.max(1, Math.round(rawW * scale));
    const h = Math.max(1, Math.round(rawH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    setPreviewUrl(canvas.toDataURL('image/jpeg', 0.85));
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      destroyOnHidden
      centered
      width={520}
      title={<span><CameraOutlined /> Chụp ảnh minh chứng trực tiếp</span>}
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
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  onClick={() => {
                    onCapture(previewUrl);
                    onClose();
                  }}
                >
                  Dùng ảnh này
                </Button>
              </>
            ) : (
              <Button type="primary" icon={<CameraOutlined />} disabled={!cameraReady} onClick={handleSnap}>
                Chụp ảnh
              </Button>
            )}
          </Space>
        </Flex>
      }
    >
      <input
        ref={nativeInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = '';
          if (file) {
            onFallbackFile(file);
            onClose();
          }
        }}
      />
      {cameraError ? (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Alert type="warning" showIcon message={cameraError} />
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void startCamera(facingMode)}>Thử mở lại Camera</Button>
            <Button type="primary" icon={<CameraOutlined />} onClick={() => nativeInputRef.current?.click()}>
              Mở Camera thiết bị
            </Button>
          </Space>
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
    </Modal>
  );
}
