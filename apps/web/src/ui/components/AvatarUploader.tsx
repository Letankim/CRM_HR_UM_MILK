'use client';

import React, { useRef, useState } from 'react';
import { Avatar, Button, Flex, Image, message, Popconfirm, Spin, Tooltip } from 'antd';
import { CameraOutlined, DeleteOutlined, EyeOutlined, LoadingOutlined, UserOutlined } from '@ant-design/icons';
import { compressAvatarFile } from '../../lib/avatar-compressor';
import { api } from '../../lib/api';

export interface AvatarUploaderProps {
  value?: string | null;
  onChange?: (val: string | null) => void;
  uploadUrl?: string;
  deleteUrl?: string;
  onUploaded?: (newUrl: string | null) => void;
  name?: string;
  size?: number;
  disabled?: boolean;
}

export function AvatarUploader({
  value,
  onChange,
  uploadUrl,
  deleteUrl,
  onUploaded,
  name,
  size = 80,
  disabled = false,
}: AvatarUploaderProps) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(value ?? null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setPreview(value ?? null);
  }, [value]);

  const handleSelectFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setLoading(true);
    try {
      const { dataUrl } = await compressAvatarFile(file, { maxDimension: 400, quality: 0.88 });
      setPreview(dataUrl);

      if (uploadUrl) {
        const res = await api.post<{ fileId: string; url: string }>(uploadUrl, { avatar_base64: dataUrl });
        const finalUrl = res?.url || dataUrl;
        setPreview(finalUrl);
        message.success('Cập nhật ảnh đại diện thành công');
        onUploaded?.(finalUrl);
      } else {
        onChange?.(dataUrl);
        message.success('Đã tải ảnh đại diện');
      }
    } catch (err) {
      message.error((err as Error).message || 'Không thể xử lý ảnh đại diện');
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (deleteUrl) {
      setLoading(true);
      try {
        await api.delete(deleteUrl);
        setPreview(null);
        message.success('Đã xóa ảnh đại diện');
        onUploaded?.(null);
      } catch (err) {
        message.error((err as Error).message || 'Không thể xóa ảnh đại diện');
      } finally {
        setLoading(false);
      }
    } else {
      setPreview(null);
      onChange?.(null);
      message.success('Đã gỡ ảnh đại diện');
    }
  };

  const initialLetter = (name || '').trim().charAt(0).toUpperCase();

  return (
    <Flex align="center" gap={16} style={{ padding: '8px 0' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/jpg"
        style={{ display: 'none' }}
        onChange={handleSelectFile}
        disabled={disabled || loading}
      />
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        {loading ? (
          <Flex
            align="center"
            justify="center"
            style={{
              width: size,
              height: size,
              borderRadius: '50%',
              backgroundColor: '#F1F5F9',
              border: '1px solid #CBD5E1',
            }}
          >
            <Spin indicator={<LoadingOutlined style={{ fontSize: 24, color: '#2563EB' }} spin />} />
          </Flex>
        ) : (
          <Tooltip title={preview ? 'Bấm để xem ảnh phóng to' : undefined}>
            <Avatar
              size={size}
              src={preview || undefined}
              icon={!preview && !initialLetter ? <UserOutlined style={{ fontSize: size * 0.45 }} /> : undefined}
              style={{
                backgroundColor: preview ? 'transparent' : '#2563EB',
                color: '#FFFFFF',
                fontSize: size * 0.38,
                fontWeight: 600,
                border: '1px solid #CBD5E1',
                cursor: preview ? 'zoom-in' : disabled ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={() => {
                if (preview) setPreviewVisible(true);
                else if (!disabled && !loading) fileInputRef.current?.click();
              }}
            >
              {!preview && initialLetter ? initialLetter : null}
            </Avatar>
          </Tooltip>
        )}
      </div>

      <Flex vertical gap={6} style={{ flex: 1 }}>
        <Flex gap={8} wrap="wrap">
          {preview && (
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() => setPreviewVisible(true)}
              type="default"
            >
              Xem ảnh
            </Button>
          )}

          <Button
            size="small"
            icon={<CameraOutlined />}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || loading}
            type={preview ? 'default' : 'primary'}
          >
            {preview ? 'Đổi ảnh' : 'Tải ảnh đại diện'}
          </Button>

          {preview && !disabled && (
            <Popconfirm
              title="Xác nhận gỡ ảnh đại diện?"
              okText="Gỡ ảnh"
              cancelText="Hủy"
              onConfirm={handleRemove}
            >
              <Button size="small" danger icon={<DeleteOutlined />} disabled={loading}>
                Gỡ ảnh
              </Button>
            </Popconfirm>
          )}
        </Flex>
      </Flex>

      {preview && (
        <Image
          wrapperStyle={{ display: 'none' }}
          preview={{
            visible: previewVisible,
            src: preview,
            onVisibleChange: (vis) => setPreviewVisible(vis),
          }}
          src={preview}
        />
      )}
    </Flex>
  );
}
