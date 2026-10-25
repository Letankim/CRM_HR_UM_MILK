'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Col, Descriptions, Modal, Row, Space, Tag, Typography } from 'antd';
import { CameraOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, CloseOutlined, EnvironmentOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { getAccurateDeviceLocation } from '@/lib/geolocation';
import { FancyboxImage } from './FancyboxPreview';

export interface AttendanceCheckPayload {
  assignment_id: string; kind: 'CHECK_IN' | 'CHECK_OUT'; lat: number; lng: number;
  accuracy_m: number; selfie_source: 'LIVE_CAMERA'; photo_base64: string; enforce_shift_state: boolean;
}

interface Props {
  open: boolean; kind: 'CHECK_IN' | 'CHECK_OUT'; shift: Record<string, unknown> | null;
  loading?: boolean; onClose: () => void; onConfirm: (payload: AttendanceCheckPayload, photoPreview: string) => void;
}

function parseHm(hm: string): number {
  const [h, m] = (hm || '00:00').split(':').map((x) => Number(x) || 0);
  return (h ?? 0) * 60 + (m ?? 0);
}
function formatDurationVi(mins: number): string {
  if (mins <= 0) return '0 phút';
  if (mins < 60) return `${mins} phút`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h} giờ ${m} phút` : `${h} giờ`;
}
export function formatDistanceVi(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(2).replace('.', ',')} km`;
}
export function calculateHaversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
export function evaluateShiftPunctuality(kind: 'CHECK_IN' | 'CHECK_OUT', nowHm: string, startAt = '07:00', endAt = '12:00') {
  const cur = parseHm(nowHm);
  if (kind === 'CHECK_IN') {
    const diff = cur - parseHm(startAt);
    return diff > 0 ? { status: 'LATE' as const, color: 'volcano', label: `Vào trễ ${formatDurationVi(diff)} (Quy định: ${startAt})` } : { status: 'ON_TIME' as const, color: 'green', label: `Vào đúng giờ (Quy định: ${startAt})` };
  }
  const diff = parseHm(endAt) - cur;
  return diff > 0 ? { status: 'EARLY_LEAVE' as const, color: 'orange', label: `Ra sớm ${formatDurationVi(diff)} (Quy định: ${endAt})` } : { status: 'ON_TIME' as const, color: 'green', label: `Ra đúng giờ (Quy định: ${endAt})` };
}

export function AttendanceCameraModal({ open, kind, shift, loading, onClose, onConfirm }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string>('');
  const [cameraReady, setCameraReady] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [freshShift, setFreshShift] = useState<Record<string, unknown> | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [nowStr, setNowStr] = useState(() => dayjs().format('HH:mm:ss'));

  const activeShift = freshShift ?? shift;
  const branchName = String(activeShift?.branchName || 'Chi nhánh làm việc');
  const branchLat = activeShift?.branchLat !== undefined && activeShift?.branchLat !== null ? Number(activeShift.branchLat) : null;
  const branchLng = activeShift?.branchLng !== undefined && activeShift?.branchLng !== null ? Number(activeShift.branchLng) : null;
  const branchRadiusM = Number(activeShift?.branchRadiusM || 100);
  const empBranchId = String(activeShift?.employeeBranchId || '');
  const shiftBranchId = String(activeShift?.branchId || '');
  const branchMismatch = Boolean(empBranchId && shiftBranchId && empBranchId !== shiftBranchId);
  const hasBranchCoords = branchLat !== null && branchLng !== null && !Number.isNaN(branchLat) && !Number.isNaN(branchLng);
  const distanceM = coords && hasBranchCoords ? calculateHaversineMeters(coords.lat, coords.lng, branchLat!, branchLng!) : null;
  const withinRadius = Boolean(coords && distanceM !== null && distanceM <= branchRadiusM && !branchMismatch);

  const stopStream = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    stopStream();
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
      setCameraReady(true);
    } catch {
      setCameraReady(false);
    }
  }, [stopStream]);

  const locateGps = useCallback(async (bLat?: number | null, bLng?: number | null, bRad?: number) => {
    setLocating(true); setGpsError(null);
    try {
      const pos = await getAccurateDeviceLocation({
        targetBranch: !branchMismatch ? { lat: bLat ?? branchLat, lng: bLng ?? branchLng, radiusM: bRad ?? branchRadiusM } : undefined,
      });
      setCoords({ lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });
    } catch {
      setCoords(null);
      setGpsError('Không lấy được vị trí hiện tại. Vui lòng cấp quyền truy cập Vị trí (GPS) trên trình duyệt rồi bấm "Lấy vị trí hiện tại".');
    } finally {
      setLocating(false);
    }
  }, [branchLat, branchLng, branchRadiusM, branchMismatch]);

  useEffect(() => {
    if (!open) { stopStream(); setFreshShift(null); return; }
    setPhotoDataUrl('');
    void startCamera();
    void (async () => {
      let latestB: { lat?: number | null; lng?: number | null; radiusM?: number } = {};
      try {
        const res = await api.get<{ shifts: Record<string, unknown>[] }>('/my-attendance');
        const matched = res.shifts?.find((s) => String(s.id) === String(shift?.id));
        if (matched) { setFreshShift(matched); latestB = { lat: Number(matched.branchLat), lng: Number(matched.branchLng), radiusM: Number(matched.branchRadiusM || 100) }; }
      } catch { /* ignore */ }
      await locateGps(latestB.lat, latestB.lng, latestB.radiusM);
    })();
    const timer = setInterval(() => setNowStr(dayjs().format('HH:mm:ss')), 1000);
    return () => { clearInterval(timer); stopStream(); };
  }, [open, shift?.id, startCamera, stopStream, locateGps]);

  const handleCapture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 360; canvas.height = 270;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (videoRef.current && cameraReady && videoRef.current.videoWidth > 0) {
      const vw = videoRef.current.videoWidth, vh = videoRef.current.videoHeight;
      const targetRatio = canvas.width / canvas.height, videoRatio = vw / vh;
      const sw = videoRatio > targetRatio ? vh * targetRatio : vw;
      const sh = videoRatio > targetRatio ? vh : vw / targetRatio;
      ctx.drawImage(videoRef.current, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#0F172A'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#1E293B'; ctx.beginPath(); ctx.arc(180, 108, 42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#94A3B8'; ctx.font = '600 13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(activeShift?.employeeName ?? 'Nhân sự Ụm Bò Milk'), 180, 175);
      ctx.font = '11px sans-serif'; ctx.fillText('Ảnh xác thực Camera trực tiếp', 180, 194);
    }
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)'; ctx.fillRect(0, 224, canvas.width, 46);
    ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'left'; ctx.font = '600 11px sans-serif';
    const cleanShift = String(activeShift?.shiftLabel ?? 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();
    ctx.fillText(`${kind === 'CHECK_IN' ? 'VÀO CA' : 'RA CA'} · ${cleanShift} · ${branchName}`, 10, 242);
    ctx.fillStyle = '#CBD5E1'; ctx.font = '10px monospace';
    const gpsText = coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)} (${distanceM !== null ? formatDistanceVi(distanceM) : '?'})` : 'Chưa có GPS';
    ctx.fillText(`${dayjs().format('DD/MM/YYYY HH:mm:ss')} · GPS: ${gpsText}`, 10, 259);
    let dataUrl = canvas.toDataURL('image/jpeg', 0.52);
    if (dataUrl.length > 14000) dataUrl = canvas.toDataURL('image/jpeg', 0.42);
    setPhotoDataUrl(dataUrl);
    stopStream();
  };

  const startAt = String(activeShift?.startAt || activeShift?.start_at || '07:00');
  const endAt = String(activeShift?.endAt || activeShift?.end_at || '12:00');
  const cleanShiftTitle = String(activeShift?.shiftLabel ?? 'Ca sáng').replace(/\s*\([^)]*\)\s*/g, '').trim();
  const punc = evaluateShiftPunctuality(kind, nowStr.slice(0, 5), startAt, endAt);

  return (
    <Modal
      open={open} onCancel={onClose} width={840} style={{ top: 12, maxWidth: '98vw' }} destroyOnHidden
      title={kind === 'CHECK_IN' ? 'Chụp ảnh Camera & Xác nhận Vào ca' : 'Chụp ảnh Camera & Xác nhận Ra ca'}
      footer={
        <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
          <Space wrap style={{ justifyContent: 'center' }}>
            <Button icon={<CloseOutlined />} onClick={onClose}>Hủy bỏ</Button>
            <Button type="primary" icon={<CheckCircleOutlined />} disabled={!photoDataUrl || !activeShift || !coords || !withinRadius || branchMismatch || locating} loading={loading} onClick={() => activeShift && coords && onConfirm({ assignment_id: String(activeShift.id), kind, lat: coords.lat, lng: coords.lng, accuracy_m: coords.accuracy, selfie_source: 'LIVE_CAMERA', photo_base64: photoDataUrl, enforce_shift_state: true }, photoDataUrl)}>{kind === 'CHECK_IN' ? 'Xác nhận Vào ca' : 'Xác nhận Ra ca'}</Button>
          </Space>
        </div>
      }
    >
      <Row gutter={[12, 12]} align="top">
        <Col xs={24} md={13}>
          <Descriptions size="small" bordered column={1} styles={{ label: { width: 96 }, content: { wordBreak: 'break-word' } }}>
            <Descriptions.Item label="Ca làm việc">
              <strong>{cleanShiftTitle} ({startAt} – {endAt})</strong> · Ngày {String(activeShift?.workDate ?? activeShift?.work_date ?? '')}
            </Descriptions.Item>
            <Descriptions.Item label="Chi nhánh">
              <div><strong>{branchName}</strong> <Tag color="blue" style={{ marginLeft: 4 }}>Bán kính {branchRadiusM}m</Tag></div>
              {hasBranchCoords && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  <span className="mono" style={{ fontSize: 12, color: '#475569' }}>Tọa độ: ({branchLat!.toFixed(5)}, {branchLng!.toFixed(5)})</span>
                  <Button size="small" type="link" icon={<EnvironmentOutlined />} style={{ padding: 0, height: 20, fontSize: 12 }} href={`https://www.google.com/maps?q=${branchLat},${branchLng}`} target="_blank" rel="noopener noreferrer">Xem trên Google Maps</Button>
                </div>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Giờ hiện tại">
              <Space wrap size={6}><Tag icon={<ClockCircleOutlined />} color="blue" style={{ margin: 0 }}>{nowStr}</Tag><Tag color={punc.color} style={{ margin: 0, fontWeight: 600 }}>{punc.label}</Tag></Space>
            </Descriptions.Item>
            <Descriptions.Item label="Vị trí GPS">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                {locating ? <Tag color="processing" style={{ margin: 0 }}>Đang lấy vị trí hiện tại...</Tag> : branchMismatch ? <Tag color="red" icon={<CloseCircleOutlined />} style={{ margin: 0 }}>Sai chi nhánh ({String(activeShift?.employeeBranchName || 'chi nhánh khác')})</Tag> : !coords ? <Tag color="red" icon={<CloseCircleOutlined />} style={{ margin: 0 }}>Chưa xác định được tọa độ GPS</Tag> : withinRadius ? <Tag color="green" icon={<EnvironmentOutlined />} style={{ margin: 0, fontWeight: 600 }}>Hợp lệ tại {branchName}: Cách {formatDistanceVi(distanceM!)} / {branchRadiusM}m</Tag> : <Tag color="red" icon={<CloseCircleOutlined />} style={{ margin: 0, fontWeight: 600 }}>Ngoài vùng cho phép: Cách {formatDistanceVi(distanceM!)} (Tối đa {branchRadiusM}m)</Tag>}
                <Button size="small" icon={<ReloadOutlined />} loading={locating} onClick={() => void locateGps()}>Lấy vị trí hiện tại</Button>
              </div>
              {coords && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                  <span className="mono" style={{ fontSize: 12, color: '#475569' }}>Thiết bị: ({coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}) · ±{coords.accuracy}m</span>
                  <Button size="small" type="link" icon={<EnvironmentOutlined />} style={{ padding: 0, height: 20, fontSize: 12 }} href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`} target="_blank" rel="noopener noreferrer">Xem trên Google Maps</Button>
                </div>
              )}
            </Descriptions.Item>
          </Descriptions>
          {branchMismatch && <Alert type="error" showIcon message={`Bạn thuộc "${String(activeShift?.employeeBranchName)}", không được phép Vào/Ra ca tại "${branchName}".`} style={{ marginTop: 10 }} />}
          {gpsError && <Alert type="error" showIcon message={gpsError} style={{ marginTop: 10 }} />}
        </Col>
        <Col xs={24} md={11}>
          <div style={{ position: 'relative', width: '100%', height: 250, background: '#0F172A', borderRadius: 4, overflow: 'hidden', marginBottom: 10, border: '1px solid #CBD5E1' }}>
            {photoDataUrl ? <FancyboxImage src={photoDataUrl} alt="Ảnh chụp điểm danh" caption={`${kind === 'CHECK_IN' ? 'Ảnh Vào ca' : 'Ảnh Ra ca'} — ${branchName}`} height={250} /> : <video ref={videoRef} autoPlay playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: cameraReady ? 'block' : 'none' }} />}
            {!photoDataUrl && !cameraReady && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', textAlign: 'center', padding: 12 }}><CameraOutlined style={{ fontSize: 30, marginBottom: 6 }} /><Typography.Text style={{ color: '#E2E8F0', fontSize: 12 }}>Khung chụp ảnh xác thực Camera trực tiếp</Typography.Text></div>}
          </div>
          {!photoDataUrl ? (
            <Button type="primary" icon={<CameraOutlined />} block disabled={!coords || !withinRadius || branchMismatch || locating} onClick={handleCapture}>
              {!coords ? 'Vui lòng lấy vị trí GPS trước khi chụp ảnh' : !withinRadius ? `Ngoài bán kính (${formatDistanceVi(distanceM!)} / ${branchRadiusM}m)` : 'Chụp ảnh khuôn mặt'}
            </Button>
          ) : <Space style={{ width: '100%', justifyContent: 'space-between' }}><Tag color="green" icon={<CheckCircleOutlined />}>Đã chụp ảnh xác thực</Tag><Button size="small" icon={<ReloadOutlined />} onClick={() => { setPhotoDataUrl(''); void startCamera(); }}>Chụp lại ảnh</Button></Space>}
        </Col>
      </Row>
    </Modal>
  );
}
