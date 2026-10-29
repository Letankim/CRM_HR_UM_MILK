'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { App, Button, Col, Flex, Form, Grid, Input, InputNumber, Modal, Row, Select, Space, Switch, Tag, Upload } from 'antd';
import type { FormInstance } from 'antd';
import { CheckCircleOutlined, CloseOutlined, CloudUploadOutlined, DeleteOutlined, InfoCircleOutlined, LoadingOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
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
  reachable: boolean; driveFileId: string | null; fileName: string; mimeType: string;
  mimeLabel: string; sizeBytes: number; sizeFormatted: string; isImage: boolean; previewUrl: string;
}

export function MktMediaModal({
  open, editing, form, loading, onClose, onSubmit,
}: {
  open: boolean; editing: Record<string, unknown> | null; form: FormInstance;
  loading?: boolean; onClose: () => void; onSubmit: (values: Record<string, unknown>) => void;
}) {
  const { message } = App.useApp();
  const isMobile = Grid.useBreakpoint().md === false;
  const [uploadKey, setUploadKey] = useState(0);
  const [probing, setProbing] = useState(false);
  const [probedReachable, setProbedReachable] = useState(false);
  const [probedPreviewUrl, setProbedPreviewUrl] = useState('');
  const [probeStatusText, setProbeStatusText] = useState('');
  const activeOpRef = useRef(0), lastProbedUrlRef = useRef(''), hasSourceRef = useRef(false), autoNameRef = useRef('');

  const fileBase64 = String(Form.useWatch('file_base64', form) || '');
  const externalUrl = String(Form.useWatch('external_url', form) || '').trim();
  const debouncedExternalUrl = useDebouncedValue(externalUrl, 400);
  const watchedName = String(Form.useWatch('file_name', form) || '');
  const watchedSize = Number(Form.useWatch('size_bytes', form) || 0);
  const watchedMime = String(Form.useWatch('mime_type', form) || '').trim();
  const existingNorm = editing ? normalizeClientMediaItem(editing) : null;

  const resetProbeUi = () => {
    lastProbedUrlRef.current = '';
    setProbing(false); setProbedReachable(false); setProbedPreviewUrl(''); setProbeStatusText('');
  };

  useEffect(() => {
    activeOpRef.current += 1;
    setUploadKey((k) => k + 1);
    resetProbeUi();
    if (!open) return;
    if (editing) {
      hasSourceRef.current = true;
      autoNameRef.current = String(editing.file_name || '');
    } else {
      hasSourceRef.current = false;
      autoNameRef.current = '';
      form.setFieldsValue({ file_name: '', category: 'BANNER', mime_type: '', size_bytes: 0, is_internal_only: true, file_base64: '', external_url: '' });
    }
  }, [open, editing, form]);

  useEffect(() => {
    if (!open || fileBase64) return;
    if (!debouncedExternalUrl || !/^https?:\/\//i.test(debouncedExternalUrl)) { resetProbeUi(); return; }
    if (editing && debouncedExternalUrl === String(editing.externalSourceUrl || '').trim() && Number(editing.size_bytes || 0) > 0 && lastProbedUrlRef.current === '') {
      lastProbedUrlRef.current = debouncedExternalUrl; setProbedReachable(true); return;
    }
    if (lastProbedUrlRef.current === debouncedExternalUrl) return;
    lastProbedUrlRef.current = debouncedExternalUrl;

    let cancelled = false;
    const opId = ++activeOpRef.current;
    setProbing(true); setProbeStatusText('');
    api.post<ProbedMediaInfo>('/mkt/media/probe', { url: debouncedExternalUrl })
      .then((info) => {
        if (cancelled || opId !== activeOpRef.current) return;
        if (info.reachable) {
          const curNameNow = String(form.getFieldValue('file_name') || '').trim();
          const nextName = (!curNameNow || curNameNow === autoNameRef.current) ? (info.fileName || '') : curNameNow;
          autoNameRef.current = info.fileName || nextName;
          hasSourceRef.current = true;
          setProbedReachable(true);
          form.setFieldsValue({ ...(nextName ? { file_name: nextName } : {}), size_bytes: info.sizeBytes, mime_type: info.mimeType, category: inferCategoryForMime(info.mimeType, info.fileName || nextName) });
          setProbedPreviewUrl(info.isImage ? (info.previewUrl || '') : '');
          setProbeStatusText(`Đã nhận diện: ${info.mimeLabel}${info.fileName ? ` · ${info.fileName}` : ''} (${info.sizeFormatted})`);
        } else {
          setProbedReachable(false); setProbedPreviewUrl('');
          form.setFieldsValue({ size_bytes: 0, mime_type: guessClientMimeByExt(debouncedExternalUrl) });
          setProbeStatusText('Chưa đọc được thông tin tệp từ liên kết này — vui lòng kiểm tra quyền chia sẻ liên kết');
        }
      })
      .catch(() => { if (!cancelled && opId === activeOpRef.current) { setProbedReachable(false); setProbedPreviewUrl(''); setProbeStatusText('Chưa đọc được thông tin tệp từ liên kết'); } })
      .finally(() => { if (!cancelled && opId === activeOpRef.current) setProbing(false); });
    return () => { cancelled = true; };
  }, [open, fileBase64, debouncedExternalUrl, editing, form]);

  const effectiveMime = (watchedMime && watchedMime !== 'application/octet-stream') ? watchedMime : guessClientMimeByExt(watchedName || externalUrl);
  const isImageAsset = effectiveMime.toLowerCase().startsWith('image/');
  const previewImgSrc = isImageAsset
    ? (fileBase64.startsWith('data:image/') ? fileBase64 : (probedPreviewUrl || (!fileBase64 && existingNorm?.isImage && (!externalUrl || externalUrl === String(editing?.externalSourceUrl || '').trim()) ? existingNorm.previewUrl : '')))
    : '';
  const hasDetectedAsset = Boolean(fileBase64 || probedReachable || watchedSize > 0 || (editing && hasSourceRef.current));

  const handlePickFile = (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      message.warning('Tệp tải trực tiếp tối đa 15 MB. Với tệp lớn hơn, hãy dán liên kết Google Drive bên dưới.');
      return false;
    }
    const opId = ++activeOpRef.current;
    setUploadKey((k) => k + 1);
    resetProbeUi();
    const detectedMime = (file.type && file.type !== 'application/octet-stream') ? file.type : guessClientMimeByExt(file.name);
    const basePatch = { external_url: '', file_name: file.name, mime_type: detectedMime, size_bytes: file.size, category: inferCategoryForMime(detectedMime, file.name) };
    autoNameRef.current = file.name;
    hasSourceRef.current = true;
    form.setFieldsValue(basePatch);

    const reader = new FileReader();
    reader.onload = () => {
      if (opId !== activeOpRef.current || typeof reader.result !== 'string' || !reader.result) return;
      form.setFieldsValue({ ...basePatch, file_base64: reader.result });
      void form.validateFields(['external_url', 'file_name']).catch(() => undefined);
    };
    reader.readAsDataURL(file);
    return false;
  };

  const handleClearPickedFile = () => {
    activeOpRef.current += 1;
    setUploadKey((k) => k + 1);
    hasSourceRef.current = Boolean(editing && editing.externalSourceUrl);
    autoNameRef.current = editing ? String(editing.file_name || '') : '';
    form.setFieldsValue({ file_base64: '', file_name: editing ? String(editing.file_name || '') : '', mime_type: editing ? String(editing.mime_type || '') : '', size_bytes: editing ? Number(editing.size_bytes || 0) : 0, category: editing ? String(editing.category || 'BANNER') : 'BANNER' });
  };

  const handleExternalUrlChange = (_e: ChangeEvent<HTMLInputElement>) => {
    activeOpRef.current += 1;
    resetProbeUi();
    const curName = String(form.getFieldValue('file_name') || '').trim();
    const hadPrevFile = Boolean(form.getFieldValue('file_base64'));
    if (hadPrevFile) setUploadKey((k) => k + 1);
    const shouldClearOldName = hasSourceRef.current || hadPrevFile || (Boolean(autoNameRef.current) && curName === autoNameRef.current);
    hasSourceRef.current = false;
    autoNameRef.current = '';
    form.setFieldsValue({ file_base64: '', size_bytes: 0, mime_type: '', ...(shouldClearOldName ? { file_name: '' } : {}) });
  };

  const formatDisplayValue = probing ? 'Đang nhận diện định dạng...' : hasDetectedAsset ? resolveMediaMimeLabel(effectiveMime, watchedName || externalUrl) : 'Tự động nhận diện theo tệp';
  const sizeDisplayValue = probing ? 'Đang tự động kiểm tra dung lượng...' : watchedSize > 0 ? `${formatMediaBytes(watchedSize)} (${watchedSize.toLocaleString('vi-VN')} Bytes)` : 'Tự động tính khi tải tệp hoặc điền liên kết';

  return (
    <Modal
      open={open} forceRender width={isMobile ? '95vw' : '78vw'} style={{ top: 18, maxWidth: 1180 }}
      title={editing ? `Cập nhật Tệp Media — ${editing.file_name}` : 'Tải Tệp / Tài liệu lên Kho Media Hệ thống'}
      okText={editing ? 'Lưu cập nhật' : 'Tải lên & Lưu Kho Media'} cancelText="Hủy bỏ"
      okButtonProps={{ icon: editing ? <SaveOutlined /> : <PlusOutlined />, loading: loading || probing }}
      cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={onClose} onOk={() => form.submit()}
    >
      <Form
        form={form} layout="vertical"
        initialValues={{ file_name: '', category: 'BANNER', mime_type: '', size_bytes: 0, is_internal_only: true, file_base64: '', external_url: '' }}
        onFinish={(vals) => { const { external_url, ...rest } = vals; onSubmit({ ...rest, mime_type: effectiveMime, drive_url: String(external_url || '').trim() }); }}
      >
        <Form.Item name="file_base64" hidden><Input /></Form.Item>
        <Form.Item name="mime_type" hidden><Input /></Form.Item>
        <Form.Item name="size_bytes" hidden><InputNumber /></Form.Item>
        <Form.Item label="Tải tệp trực tiếp từ thiết bị (chọn tệp mới sẽ tự động thay thế tệp trước đó)">
          <Upload.Dragger key={uploadKey} fileList={[]} accept={ACCEPTED_EXTENSIONS} multiple={false} showUploadList={false} beforeUpload={handlePickFile} style={{ padding: '16px 20px', borderRadius: 4 }}>
            <Space direction="vertical" size={4}>
              <CloudUploadOutlined style={{ fontSize: 28, color: '#2563EB' }} />
              <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>Bấm chọn hoặc kéo thả Hình ảnh, PDF, Tệp nén (ZIP/RAR/7z), Word, Excel, PowerPoint, Video...</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>Hỗ trợ tải trực tiếp tối đa 15 MB từ máy tính hoặc dán liên kết Google Drive không giới hạn dung lượng ở bên dưới</div>
            </Space>
          </Upload.Dragger>
          {fileBase64 && (
            <Flex justify="space-between" align="center" wrap gap={8} style={{ marginTop: 10, padding: '8px 12px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4 }}>
              <Space size={8} wrap>{renderMediaIcon(effectiveMime, watchedName, 17)}<Tag color="blue" style={{ margin: 0 }}>Tệp từ thiết bị</Tag><strong style={{ fontSize: 13 }}>{watchedName || 'Tệp mới'}</strong><span className="num" style={{ fontSize: 12, color: '#475569' }}>({formatMediaBytes(watchedSize)})</span></Space>
              <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={handleClearPickedFile}>Bỏ tệp vừa chọn</Button>
            </Flex>
          )}
        </Form.Item>
        {previewImgSrc ? (
          <div style={{ marginBottom: 16, borderRadius: 4, overflow: 'hidden', border: '1px solid #E5E7EB' }}><FancyboxImage src={previewImgSrc} alt={watchedName || 'Xem trước hình ảnh'} height={220} objectFit="contain" /></div>
        ) : (!isImageAsset && hasDetectedAsset && !probing) ? (
          <Flex align="center" justify="space-between" wrap gap={12} style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 4, border: '1px solid #E5E7EB', background: '#F8FAFC' }}>
            <Space size={12}>
              <div style={{ width: 42, height: 42, borderRadius: 4, border: '1px solid #E2E8F0', background: '#FFFFFF', display: 'grid', placeItems: 'center' }}>{renderMediaIcon(effectiveMime, watchedName || externalUrl, 22)}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>{watchedName || 'Tệp đính kèm đã nhận diện'}</div>
                <Space size={8} style={{ marginTop: 3 }}><Tag color="cyan" style={{ margin: 0 }}>{resolveMediaMimeLabel(effectiveMime, watchedName || externalUrl)}</Tag>{watchedSize > 0 && <span className="num" style={{ fontSize: 12, color: '#64748B' }}>{formatMediaBytes(watchedSize)}</span>}</Space>
              </div>
            </Space>
            <Tag color="green" style={{ margin: 0 }}>Sẵn sàng tải xuống qua Hệ thống</Tag>
          </Flex>
        ) : null}
        <Row gutter={16}>
          <Col xs={24} md={11}><Form.Item name="file_name" label="Tên tệp / Tài liệu truyền thông" rules={[{ required: true, message: 'Vui lòng nhập tên tệp' }]}><Input allowClear placeholder="Tự động điền theo tệp mới hoặc nhập tên hiển thị..." /></Form.Item></Col>
          <Col xs={12} md={7}><Form.Item name="category" label="Phân loại nội dung"><Select options={MEDIA_CATEGORY_OPTIONS} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item label="Định dạng tệp"><Input disabled value={formatDisplayValue} /></Form.Item></Col>
        </Row>
        <Form.Item
          name="external_url"
          label={<Flex justify="space-between" align="center" wrap gap={8} style={{ width: '100%' }}><span>Hoặc liên kết Google Drive / URL tệp</span>{probing ? <span style={{ fontSize: 12, color: '#2563EB', fontWeight: 500 }}><LoadingOutlined /> Đang kiểm tra tệp mới từ liên kết...</span> : probeStatusText ? <span style={{ fontSize: 12, color: probedReachable ? '#16A34A' : '#D97706', fontWeight: 500 }}>{probedReachable ? <CheckCircleOutlined /> : <InfoCircleOutlined />} {probeStatusText}</span> : null}</Flex>}
          rules={[{ validator: async (_, val) => { if (editing || Boolean(form.getFieldValue('file_base64')) || Boolean(String(val || '').trim())) return; throw new Error('Vui lòng chọn tệp tải lên từ thiết bị hoặc nhập đường dẫn tệp'); } }]}
        >
          <Input allowClear onChange={handleExternalUrlChange} placeholder="Dán liên kết Google Drive (https://drive.google.com/file/d/...) hoặc đường dẫn trực tiếp của tệp..." suffix={probing ? <LoadingOutlined style={{ color: '#2563EB' }} /> : undefined} />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={11}><Form.Item label="Dung lượng tệp"><Input disabled prefix={probing ? <LoadingOutlined /> : undefined} value={sizeDisplayValue} /></Form.Item></Col>
          <Col xs={24} md={13}><Form.Item name="is_internal_only" label="Phạm vi bảo mật tài liệu" valuePropName="checked"><Switch checkedChildren="Chỉ lưu hành nội bộ" unCheckedChildren="Công khai có kiểm soát" /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}
