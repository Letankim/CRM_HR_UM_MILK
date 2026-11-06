'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Flex, Modal, Segmented, Space, Spin, Tag, Typography } from 'antd';
import type { ButtonProps } from 'antd';
import { AimOutlined, CheckCircleOutlined, CloseOutlined, CompassOutlined, EnvironmentOutlined, FlagOutlined, ShopOutlined } from '@ant-design/icons';
import { BRAND } from '../theme';
import { loadLeafletLibrary, renderVietnamGpsMap, type MapPointMarker, type VietnamMapRenderConfig } from './vietnam-map-leaflet';

export type { MapPointMarker, VietnamMapRenderConfig };

interface ModalProps extends VietnamMapRenderConfig {
  open: boolean;
  title?: string;
  onClose: () => void;
}

export function VietnamGpsMapModal({
  open,
  title,
  branchName,
  branchAddress,
  branchLat,
  branchLng,
  branchRadiusM = 100,
  points = [],
  onClose,
}: ModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<ReturnType<typeof renderVietnamGpsMap> | null>(null);
  const [tileMode, setTileMode] = useState<'STREET' | 'SATELLITE'>('STREET');
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const hasBranch = branchLat !== undefined && branchLat !== null && branchLng !== undefined && branchLng !== null && !Number.isNaN(Number(branchLat)) && !Number.isNaN(Number(branchLng));
  const validPoints = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);

    const timer = window.setTimeout(() => {
      void loadLeafletLibrary()
        .then((L) => {
          if (cancelled || !containerRef.current) return;
          if (controllerRef.current?.map) {
            controllerRef.current.map.remove();
            controllerRef.current = null;
          }
          containerRef.current.innerHTML = '';
          controllerRef.current = renderVietnamGpsMap(L, containerRef.current, {
            branchName,
            branchAddress,
            branchLat,
            branchLng,
            branchRadiusM,
            points: validPoints,
            tileMode,
          });
          window.setTimeout(() => controllerRef.current?.map?.invalidateSize?.(), 120);
        })
        .catch((e: unknown) => {
          if (!cancelled) setLoadErr(e instanceof Error ? e.message : 'Không thể tải bản đồ');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 60);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (controllerRef.current?.map) {
        controllerRef.current.map.remove();
        controllerRef.current = null;
      }
    };
  }, [open, tileMode, branchName, branchAddress, branchLat, branchLng, branchRadiusM, JSON.stringify(validPoints)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={880}
      style={{ top: 16, maxWidth: '96vw' }}
      destroyOnHidden
      title={
        <Space size={8} wrap>
          <EnvironmentOutlined style={{ color: '#2563EB' }} />
          <span>{title || `Bản đồ Vị trí Cửa hàng & Điểm danh GPS — ${branchName || 'Ụm Bò Milk'}`}</span>
          <Tag color="red" icon={<FlagOutlined />} style={{ margin: 0, fontWeight: 600 }}>
            Chủ quyền Việt Nam: Hoàng Sa &amp; Trường Sa
          </Tag>
        </Space>
      }
      footer={
        <Flex justify="space-between" align="center" wrap="wrap" gap={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Bản đồ trực tuyến miễn phí · Hiển thị đầy đủ Quần đảo Hoàng Sa &amp; Quần đảo Trường Sa thuộc chủ quyền Việt Nam
          </Typography.Text>
          <Button icon={<CloseOutlined />} onClick={onClose}>Đóng bản đồ</Button>
        </Flex>
      }
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Flex justify="space-between" align="center" wrap="wrap" gap={8} style={{ background: '#F8FAFC', border: `1px solid ${BRAND.border}`, borderRadius: 4, padding: '8px 10px' }}>
          <Space size={6} wrap>
            <Button size="small" type="primary" ghost icon={<AimOutlined />} onClick={() => controllerRef.current?.fitMainBounds()}>
              Toàn cảnh Cửa hàng &amp; Điểm danh
            </Button>
            {hasBranch && (
              <Button size="small" icon={<ShopOutlined />} onClick={() => controllerRef.current?.flyToBranch()}>
                Tâm Cửa hàng ({branchRadiusM}m)
              </Button>
            )}
            {validPoints.map((pt, idx) => (
              <Button key={`${pt.kind}_${idx}`} size="small" icon={<CompassOutlined />} onClick={() => controllerRef.current?.flyToPoint(idx)}>
                {pt.kind === 'CHECK_IN' ? 'Vị trí Vào ca' : pt.kind === 'CHECK_OUT' ? 'Vị trí Ra ca' : 'Vị trí Thiết bị'}
                {pt.distanceM !== undefined && pt.distanceM !== null ? ` (${Math.round(pt.distanceM)}m)` : ''}
              </Button>
            ))}
            <Button size="small" danger ghost icon={<FlagOutlined />} onClick={() => controllerRef.current?.flyToSovereignty()}>
              Hoàng Sa &amp; Trường Sa (VN)
            </Button>
          </Space>
          <Segmented
            size="small"
            value={tileMode}
            onChange={(v) => setTileMode(v as 'STREET' | 'SATELLITE')}
            options={[
              { value: 'STREET', label: 'Bản đồ Giao thông' },
              { value: 'SATELLITE', label: 'Ảnh Vệ tinh' },
            ]}
          />
        </Flex>

        {loadErr ? (
          <Alert type="error" showIcon message={loadErr} />
        ) : (
          <Spin spinning={loading} tip="Đang tải bản đồ vị trí cửa hàng & điểm danh...">
            <div
              ref={containerRef}
              style={{ width: '100%', height: 430, borderRadius: 4, border: `1px solid ${BRAND.border}`, background: '#E2E8F0', overflow: 'hidden' }}
            />
          </Spin>
        )}

        <Flex justify="space-between" align="center" wrap="wrap" gap={8} style={{ background: '#FFFFFF', border: `1px solid ${BRAND.border}`, borderRadius: 4, padding: '8px 12px', fontSize: 12 }}>
          {hasBranch && (
            <Space size={6} wrap>
              <Tag color="blue" icon={<ShopOutlined />} style={{ margin: 0, fontWeight: 600 }}>
                Cửa hàng: {branchName || 'Chi nhánh'}
              </Tag>
              <span className="mono" style={{ color: '#475569' }}>({Number(branchLat).toFixed(5)}, {Number(branchLng).toFixed(5)})</span>
              <Tag color="geekblue" style={{ margin: 0 }}>Vùng hợp lệ: {branchRadiusM}m</Tag>
            </Space>
          )}
          {validPoints.map((pt, idx) => {
            const isOut = pt.withinRadius === false || (pt.distanceM !== undefined && pt.distanceM !== null && pt.distanceM > branchRadiusM);
            return (
              <Space key={`leg_${idx}`} size={6} wrap>
                <Tag color={pt.kind === 'CHECK_OUT' ? 'purple' : isOut ? 'red' : 'green'} icon={<CheckCircleOutlined />} style={{ margin: 0, fontWeight: 600 }}>
                  {pt.label}
                </Tag>
                <span className="mono" style={{ color: '#475569' }}>({pt.lat.toFixed(5)}, {pt.lng.toFixed(5)})</span>
                {pt.distanceM !== undefined && pt.distanceM !== null && (
                  <Tag color={isOut ? 'volcano' : 'success'} style={{ margin: 0, fontWeight: 600 }}>
                    Cách cửa hàng: {Math.round(pt.distanceM)}m {isOut ? '(Ngoài vùng)' : '(Hợp lệ)'}
                  </Tag>
                )}
              </Space>
            );
          })}
        </Flex>
      </Space>
    </Modal>
  );
}

interface ButtonTriggerProps extends VietnamMapRenderConfig {
  buttonText?: string;
  modalTitle?: string;
  size?: ButtonProps['size'];
  type?: ButtonProps['type'];
  ghost?: boolean;
  style?: React.CSSProperties;
}

/** Nút mở Popup Bản đồ Vị trí Cửa hàng & Điểm danh ngay trong ứng dụng (thay cho mở tab ngoài). */
export function ViewGpsMapButton({
  buttonText = 'Xem trên bản đồ',
  modalTitle,
  size = 'small',
  type = 'link',
  ghost,
  style,
  ...mapConfig
}: ButtonTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size={size}
        type={type}
        ghost={ghost}
        icon={<EnvironmentOutlined />}
        style={type === 'link' ? { padding: 0, height: 20, fontSize: 12, ...style } : style}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {buttonText}
      </Button>
      {open && <VietnamGpsMapModal open={open} title={modalTitle} onClose={() => setOpen(false)} {...mapConfig} />}
    </>
  );
}
