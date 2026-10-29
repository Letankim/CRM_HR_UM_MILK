'use client';

import { useEffect, useRef, useState } from 'react';
import { App, Button, Col, Flex, Form, Input, InputNumber, Modal, Row, Select, Space, Switch, Tag, Upload } from 'antd';
import type { FormInstance } from 'antd';
import {
  CheckCircleOutlined, CloseOutlined, CloudUploadOutlined, DeleteOutlined,
  FilePdfOutlined, LoadingOutlined, PlusOutlined, SaveOutlined,
} from '@ant-design/icons';
import { api } from '@/lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { FancyboxImage } from './FancyboxPreview';
import { MEDIA_CATEGORY_OPTIONS, formatMediaBytes, normalizeClientMediaItem } from './MediaAttachmentCards';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

interface ProbedMediaInfo {
  reachable: boolean;
  fileName: string;
  mimeType: string;
  mimeLabel: string;
  sizeBytes: number;
  sizeFormatted: string;
  isImage: boolean;
  previewUrl: string;
}

export function MktMediaModal({
  open,
  editing,
  form,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editing: Record<string, unknown> | null;
  form: FormInstance;
  loading?: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const { message } = App.useApp();
  const [probing, setProbing] = useState(false);
  const [probedPreviewUrl, setProbedPreviewUrl] = useState('');
  const [probeStatusText, setProbeStatusText] = useState('');
  const lastProbedUrlRef = useRef('');

  const fileBase64 = String(Form.useWatch('file_base64', form) || '');
  const externalUrl = String(Form.useWatch('external_url', form) || '').trim();
  const debouncedExternalUrl = useDebouncedValue(externalUrl, 450);
  const watchedName = String(Form.useWatch('file_name', form) || '');
  const watchedSize = Number(Form.useWatch('size_bytes', form) || 0);
  const watchedMime = String(Form.useWatch('mime_type', form) || 'image/png');
  const existingNorm = editing ? normalizeClientMediaItem(editing) : null;

  useEffect(() => {
    if (!open) {
      setProbing(false);
      setProbedPreviewUrl('');
      setProbeStatusText('');
      lastProbedUrlRef.current = '';
    }
  }, [open]);

  useEffect(() => {
    if (!open || fileBase64) return;
    if (!debouncedExternalUrl || !/^https?:\/\//i.test(debouncedExternalUrl)) {
      lastProbedUrlRef.current = '';
      setProbedPreviewUrl('');
      setProbeStatusText('');
      if (!editing) form.setFieldValue('size_bytes', 0);
      return;
    }
    if (editing && debouncedExternalUrl === String(editing.externalSourceUrl || '').trim() && Number(editing.size_bytes || 0) > 0) {
      return;
    }
    if (lastProbedUrlRef.current === debouncedExternalUrl) return;
    lastProbedUrlRef.current = debouncedExternalUrl;

    let cancelled = false;
    setProbing(true);
    setProbeStatusText('');
    api.post<ProbedMediaInfo>('/mkt/media/probe', { url: debouncedExternalUrl })
      .then((info) => {
        if (cancelled) return;
        if (info.reachable) {
          const curName = String(form.getFieldValue('file_name') || '').trim();
          const patch: Record<string, unknown> = {
            size_bytes: info.sizeBytes,
            mime_type: info.mimeType,
          };
          if (!curName && info.fileName) patch.file_name = info.fileName;
          if (info.mimeType === 'application/pdf' && form.getFieldValue('category') === 'BANNER') patch.category = 'SOP_DOC';
          form.setFieldsValue(patch);
          setProbedPreviewUrl(info.previewUrl || '');
          setProbeStatusText(`Đã nhận diện: ${info.sizeFormatted}`);
        } else {
          form.setFieldValue('size_bytes', 0);
          setProbedPreviewUrl('');
          setProbeStatusText('Chưa đọc được dung lượng từ liên kết');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProbedPreviewUrl('');
          setProbeStatusText('Chưa đọc được dung lượng từ liên kết');
        }
      })
      .finally(() => { if (!cancelled) setProbing(false); });
    return () => { cancelled = true; };
  }, [open, fileBase64, debouncedExternalUrl, editing, form]);

  const previewImgSrc = fileBase64.startsWith('data:image/')
    ? fileBase64
    : probedPreviewUrl || (!fileBase64 && existingNorm?.isImage && existingNorm.previewUrl ? existingNorm.previewUrl : '');

  const handlePickFile = (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      message.warning('Dung lượng tệp tải lên tối đa 10 MB');
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      const detectedMime = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/png');
      const curName = String(form.getFieldValue('file_name') || '').trim();
      const nextPatch: Record<string, unknown> = {
        file_base64: dataUrl,
        file_name: (!editing || !curName) ? file.name : curName,
        mime_type: detectedMime,
        size_bytes: file.size,
      };
      if (detectedMime === 'application/pdf' && form.getFieldValue('category') === 'BANNER') nextPatch.category = 'SOP_DOC';
      setProbedPreviewUrl('');
      setProbeStatusText('');
      form.setFieldsValue(nextPatch);
      void form.validateFields(['external_url']).catch(() => undefined);
    };
    reader.readAsDataURL(file);
    return false;
  };

  const sizeDisplayValue = probing
    ? 'Đang tự động kiểm tra dung lượng...'
    : watchedSize > 0
      ? `${formatMediaBytes(watchedSize)} (${watchedSize.toLocaleString('vi-VN')} Bytes)`
      : 'Tự động tính khi tải tệp hoặc điền liên kết';

  return (
    <Modal
      open={open} forceRender width={720} style={{ top: 20 }}
      title={editing ? `Cập nhật Tệp Media — ${editing.file_name}` : 'Tải Ảnh / Tài liệu lên Kho Media Hệ thống'}
      okText={editing ? 'Lưu cập nhật' : 'Tải lên & Lưu Kho Media'} cancelText="Hủy bỏ"
      okButtonProps={{ icon: editing ? <SaveOutlined /> : <PlusOutlined />, loading: loading || probing }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose} onOk={() => form.submit()}
    >
      <Form
        form={form} layout="vertical"
        initialValues={{ category: 'BANNER', mime_type: 'image/png', size_bytes: 0, is_internal_only: true, file_base64: '', external_url: '' }}
        onFinish={(vals) => { const { external_url, ...rest } = vals; onSubmit({ ...rest, drive_url: String(external_url || '').trim() }); }}
      >
        <Form.Item name="file_base64" hidden><Input /></Form.Item>
        <Form.Item name="size_bytes" hidden><InputNumber /></Form.Item>
        <Form.Item label="Tải tệp trực tiếp từ thiết bị">
          <Upload.Dragger accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" multiple={false} showUploadList={false} beforeUpload={handlePickFile} style={{ padding: '10px 12px', borderRadius: 4 }}>
            <Space direction="vertical" size={2}>
              <CloudUploadOutlined style={{ fontSize: 24, color: '#2563EB' }} />
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Bấm chọn hoặc kéo thả Hình ảnh (PNG, JPG, WebP, GIF) hoặc Tài liệu PDF</div>
            </Space>
          </Upload.Dragger>
          {fileBase64 && (
            <Flex justify="space-between" align="center" wrap gap={8} style={{ marginTop: 8, padding: '6px 10px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4 }}>
              <Space size={6} wrap>
                {watchedMime === 'application/pdf' && <FilePdfOutlined style={{ color: '#DC2626' }} />}
                <Tag color="blue" style={{ margin: 0 }}>Tệp đã chọn</Tag>
                <strong style={{ fontSize: 13 }}>{watchedName || 'Tệp mới'}</strong>
                <span className="num" style={{ fontSize: 12, color: '#475569' }}>({formatMediaBytes(watchedSize)})</span>
              </Space>
              <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => form.setFieldsValue({ file_base64: '', size_bytes: editing ? Number(editing.size_bytes || 0) : 0 })}>Bỏ tệp vừa chọn</Button>
            </Flex>
          )}
        </Form.Item>
        {previewImgSrc && (
          <div style={{ marginBottom: 14, borderRadius: 4, overflow: 'hidden', border: '1px solid #E5E7EB' }}>
            <FancyboxImage src={previewImgSrc} alt={watchedName || 'Xem trước hình ảnh'} height={175} objectFit="contain" />
          </div>
        )}
        <Row gutter={12}>
          <Col xs={24} md={10}><Form.Item name="file_name" label="Tên tệp / Tài liệu truyền thông" rules={[{ required: true, message: 'Vui lòng nhập tên tệp' }]}><Input placeholder="VD: banner-sop-pha-che-v5.png" /></Form.Item></Col>
          <Col xs={12} md={7}><Form.Item name="category" label="Phân loại nội dung"><Select options={MEDIA_CATEGORY_OPTIONS} /></Form.Item></Col>
          <Col xs={12} md={7}><Form.Item name="mime_type" label="Định dạng tệp"><Select disabled options={[{ value: 'image/png', label: 'Hình ảnh PNG' }, { value: 'image/jpeg', label: 'Hình ảnh JPEG' }, { value: 'image/webp', label: 'Hình ảnh WebP' }, { value: 'image/gif', label: 'Hình ảnh GIF' }, { value: 'image/svg+xml', label: 'Hình ảnh SVG' }, { value: 'application/pdf', label: 'Tài liệu PDF' }]} /></Form.Item></Col>
        </Row>
        <Form.Item
          name="external_url" label="Hoặc liên kết Google Drive / URL tệp"
          rules={[{ validator: async (_, val) => { if (editing || Boolean(form.getFieldValue('file_base64')) || Boolean(String(val || '').trim())) return; throw new Error('Vui lòng chọn tệp tải lên từ thiết bị hoặc nhập đường dẫn tệp'); } }]}
        >
          <Input placeholder="Dán liên kết Google Drive hoặc https://..." suffix={probing ? <span style={{ fontSize: 12, color: '#2563EB' }}><LoadingOutlined /> Đang kiểm tra...</span> : probeStatusText ? <span style={{ fontSize: 12, color: watchedSize > 0 ? '#16A34A' : '#64748B' }}>{watchedSize > 0 && <CheckCircleOutlined />} {probeStatusText}</span> : null} />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} md={10}><Form.Item label="Dung lượng tệp"><Input disabled prefix={probing ? <LoadingOutlined /> : undefined} value={sizeDisplayValue} /></Form.Item></Col>
          <Col xs={24} md={14}><Form.Item name="is_internal_only" label="Phạm vi bảo mật tài liệu" valuePropName="checked"><Switch checkedChildren="Chỉ lưu hành nội bộ" unCheckedChildren="Công khai có kiểm soát" /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}
