'use client';

import { useEffect, useRef, useState } from 'react';
import { App, Button, Col, Flex, Form, Input, InputNumber, Modal, Row, Select, Space, Switch, Tag, Upload } from 'antd';
import type { FormInstance } from 'antd';
import { CheckCircleOutlined, CloseOutlined, CloudUploadOutlined, DeleteOutlined, LoadingOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { FancyboxImage } from './FancyboxPreview';
import {
  MEDIA_CATEGORY_OPTIONS, formatMediaBytes, guessClientMimeByExt,
  inferCategoryForMime, normalizeClientMediaItem, renderMediaIcon, resolveMediaMimeLabel,
} from './MediaAttachmentCards';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = '.png,.jpg,.jpeg,.webp,.gif,.svg,.bmp,.pdf,.zip,.rar,.7z,.gz,.tgz,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.json,.md,.mp4,.webm,.mov,.mp3,.wav';

interface ProbedMediaInfo {
  reachable: boolean; fileName: string; mimeType: string; mimeLabel: string;
  sizeBytes: number; sizeFormatted: string; isImage: boolean; previewUrl: string;
}

export function MktMediaModal({
  open, editing, form, loading, onClose, onSubmit,
}: {
  open: boolean; editing: Record<string, unknown> | null; form: FormInstance;
  loading?: boolean; onClose: () => void; onSubmit: (values: Record<string, unknown>) => void;
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
  const watchedMime = String(Form.useWatch('mime_type', form) || '').trim();
  const existingNorm = editing ? normalizeClientMediaItem(editing) : null;

  useEffect(() => {
    if (!open) { setProbing(false); setProbedPreviewUrl(''); setProbeStatusText(''); lastProbedUrlRef.current = ''; }
  }, [open]);

  useEffect(() => {
    if (!open || fileBase64) return;
    if (!debouncedExternalUrl || !/^https?:\/\//i.test(debouncedExternalUrl)) {
      lastProbedUrlRef.current = ''; setProbedPreviewUrl(''); setProbeStatusText('');
      if (!editing) form.setFieldsValue({ size_bytes: 0, mime_type: '' });
      return;
    }
    if (editing && debouncedExternalUrl === String(editing.externalSourceUrl || '').trim() && Number(editing.size_bytes || 0) > 0) return;
    if (lastProbedUrlRef.current === debouncedExternalUrl) return;
    lastProbedUrlRef.current = debouncedExternalUrl;

    let cancelled = false;
    setProbing(true); setProbeStatusText('');
    api.post<ProbedMediaInfo>('/mkt/media/probe', { url: debouncedExternalUrl })
      .then((info) => {
        if (cancelled) return;
        if (info.reachable) {
          const curName = String(form.getFieldValue('file_name') || '').trim();
          const effectiveName = (!curName && info.fileName) ? info.fileName : curName;
          const patch: Record<string, unknown> = { size_bytes: info.sizeBytes, mime_type: info.mimeType };
          if (!curName && info.fileName) patch.file_name = info.fileName;
          if (!editing && form.getFieldValue('category') === 'BANNER') patch.category = inferCategoryForMime(info.mimeType, effectiveName);
          form.setFieldsValue(patch);
          setProbedPreviewUrl(info.isImage ? (info.previewUrl || '') : '');
          setProbeStatusText(`Đã nhận diện: ${info.mimeLabel} · ${info.sizeFormatted}`);
        } else {
          form.setFieldsValue({ size_bytes: 0, mime_type: guessClientMimeByExt(watchedName || debouncedExternalUrl) });
          setProbedPreviewUrl(''); setProbeStatusText('Chưa đọc được dung lượng từ liên kết');
        }
      })
      .catch(() => { if (!cancelled) { setProbedPreviewUrl(''); setProbeStatusText('Chưa đọc được dung lượng từ liên kết'); } })
      .finally(() => { if (!cancelled) setProbing(false); });
    return () => { cancelled = true; };
  }, [open, fileBase64, debouncedExternalUrl, editing, form, watchedName]);

  const effectiveMime = (watchedMime && watchedMime !== 'application/octet-stream') ? watchedMime : guessClientMimeByExt(watchedName || externalUrl);
  const isImageAsset = effectiveMime.toLowerCase().startsWith('image/');
  const previewImgSrc = isImageAsset
    ? (fileBase64.startsWith('data:image/') ? fileBase64 : (probedPreviewUrl || (!fileBase64 && existingNorm?.isImage && existingNorm.previewUrl ? existingNorm.previewUrl : '')))
    : '';
  const hasDetectedAsset = Boolean(fileBase64 || watchedSize > 0 || editing || watchedName.includes('.'));

  const handlePickFile = (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      message.warning('Tệp tải trực tiếp tối đa 15 MB. Với tệp lớn hơn, hãy dán liên kết Google Drive bên dưới.');
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      const detectedMime = (file.type && file.type !== 'application/octet-stream') ? file.type : guessClientMimeByExt(file.name);
      const curName = String(form.getFieldValue('file_name') || '').trim();
      const nextPatch: Record<string, unknown> = { file_base64: dataUrl, file_name: (!editing || !curName) ? file.name : curName, mime_type: detectedMime, size_bytes: file.size };
      if (!editing && form.getFieldValue('category') === 'BANNER') nextPatch.category = inferCategoryForMime(detectedMime, file.name);
      setProbedPreviewUrl(''); setProbeStatusText('');
      form.setFieldsValue(nextPatch);
      void form.validateFields(['external_url']).catch(() => undefined);
    };
    reader.readAsDataURL(file);
    return false;
  };

  const formatDisplayValue = probing ? 'Đang nhận diện định dạng...' : hasDetectedAsset ? resolveMediaMimeLabel(effectiveMime, watchedName || externalUrl) : 'Tự động nhận diện theo tệp';
  const sizeDisplayValue = probing ? 'Đang tự động kiểm tra dung lượng...' : watchedSize > 0 ? `${formatMediaBytes(watchedSize)} (${watchedSize.toLocaleString('vi-VN')} Bytes)` : 'Tự động tính khi tải tệp hoặc điền liên kết';

  return (
    <Modal
      open={open} forceRender width={720} style={{ top: 20 }}
      title={editing ? `Cập nhật Tệp Media — ${editing.file_name}` : 'Tải Tệp / Tài liệu lên Kho Media Hệ thống'}
      okText={editing ? 'Lưu cập nhật' : 'Tải lên & Lưu Kho Media'} cancelText="Hủy bỏ"
      okButtonProps={{ icon: editing ? <SaveOutlined /> : <PlusOutlined />, loading: loading || probing }}
      cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={onClose} onOk={() => form.submit()}
    >
      <Form
        form={form} layout="vertical"
        initialValues={{ category: 'BANNER', mime_type: '', size_bytes: 0, is_internal_only: true, file_base64: '', external_url: '' }}
        onFinish={(vals) => { const { external_url, ...rest } = vals; onSubmit({ ...rest, mime_type: effectiveMime, drive_url: String(external_url || '').trim() }); }}
      >
        <Form.Item name="file_base64" hidden><Input /></Form.Item>
        <Form.Item name="mime_type" hidden><Input /></Form.Item>
        <Form.Item name="size_bytes" hidden><InputNumber /></Form.Item>
        <Form.Item label="Tải tệp trực tiếp từ thiết bị">
          <Upload.Dragger accept={ACCEPTED_EXTENSIONS} multiple={false} showUploadList={false} beforeUpload={handlePickFile} style={{ padding: '10px 12px', borderRadius: 4 }}>
            <Space direction="vertical" size={2}>
              <CloudUploadOutlined style={{ fontSize: 24, color: '#2563EB' }} />
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Bấm chọn hoặc kéo thả Hình ảnh, PDF, Tệp nén (ZIP/RAR), Word, Excel, PowerPoint, Video...</div>
            </Space>
          </Upload.Dragger>
          {fileBase64 && (
            <Flex justify="space-between" align="center" wrap gap={8} style={{ marginTop: 8, padding: '6px 10px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4 }}>
              <Space size={6} wrap>{renderMediaIcon(effectiveMime, watchedName, 16)}<Tag color="blue" style={{ margin: 0 }}>Tệp đã chọn</Tag><strong style={{ fontSize: 13 }}>{watchedName || 'Tệp mới'}</strong><span className="num" style={{ fontSize: 12, color: '#475569' }}>({formatMediaBytes(watchedSize)})</span></Space>
              <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => form.setFieldsValue({ file_base64: '', mime_type: editing ? String(editing.mime_type || '') : '', size_bytes: editing ? Number(editing.size_bytes || 0) : 0 })}>Bỏ tệp vừa chọn</Button>
            </Flex>
          )}
        </Form.Item>
        {previewImgSrc ? (
          <div style={{ marginBottom: 14, borderRadius: 4, overflow: 'hidden', border: '1px solid #E5E7EB' }}><FancyboxImage src={previewImgSrc} alt={watchedName || 'Xem trước hình ảnh'} height={175} objectFit="contain" /></div>
        ) : (!isImageAsset && hasDetectedAsset && !probing) ? (
          <Flex align="center" justify="space-between" wrap gap={10} style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 4, border: '1px solid #E5E7EB', background: '#F8FAFC' }}>
            <Space size={10}>
              <div style={{ width: 38, height: 38, borderRadius: 4, border: '1px solid #E2E8F0', background: '#FFFFFF', display: 'grid', placeItems: 'center' }}>{renderMediaIcon(effectiveMime, watchedName || externalUrl, 20)}</div>
              <div>
                <div style={{ fontWeight: 600, color: '#0F172A' }}>{watchedName || 'Tệp đính kèm đã nhận diện'}</div>
                <Space size={6} style={{ marginTop: 2 }}><Tag color="cyan" style={{ margin: 0 }}>{resolveMediaMimeLabel(effectiveMime, watchedName || externalUrl)}</Tag>{watchedSize > 0 && <span className="num" style={{ fontSize: 12, color: '#64748B' }}>{formatMediaBytes(watchedSize)}</span>}</Space>
              </div>
            </Space>
            <Tag color="green" style={{ margin: 0 }}>Sẵn sàng tải xuống qua Hệ thống</Tag>
          </Flex>
        ) : null}
        <Row gutter={12}>
          <Col xs={24} md={10}><Form.Item name="file_name" label="Tên tệp / Tài liệu truyền thông" rules={[{ required: true, message: 'Vui lòng nhập tên tệp' }]}><Input placeholder="VD: tai-lieu-sop-thang-11.zip" /></Form.Item></Col>
          <Col xs={12} md={7}><Form.Item name="category" label="Phân loại nội dung"><Select options={MEDIA_CATEGORY_OPTIONS} /></Form.Item></Col>
          <Col xs={12} md={7}><Form.Item label="Định dạng tệp"><Input disabled value={formatDisplayValue} /></Form.Item></Col>
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
