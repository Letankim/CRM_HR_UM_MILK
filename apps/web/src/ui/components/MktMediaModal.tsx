'use client';

import { App, Button, Col, Flex, Form, Input, InputNumber, Modal, Row, Select, Space, Switch, Tag, Upload } from 'antd';
import type { FormInstance } from 'antd';
import { CloseOutlined, CloudUploadOutlined, DeleteOutlined, FilePdfOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { FancyboxImage } from './FancyboxPreview';
import { MEDIA_CATEGORY_OPTIONS, formatMediaBytes, normalizeClientMediaItem } from './MediaAttachmentCards';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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
  const fileBase64 = String(Form.useWatch('file_base64', form) || '');
  const watchedName = String(Form.useWatch('file_name', form) || '');
  const watchedSize = Number(Form.useWatch('size_bytes', form) || 0);
  const watchedMime = String(Form.useWatch('mime_type', form) || 'image/png');
  const existingNorm = editing ? normalizeClientMediaItem(editing) : null;

  const previewImgSrc = fileBase64.startsWith('data:image/')
    ? fileBase64
    : (!fileBase64 && existingNorm?.isImage && existingNorm.previewUrl ? existingNorm.previewUrl : '');

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
      if (detectedMime === 'application/pdf' && form.getFieldValue('category') === 'BANNER') {
        nextPatch.category = 'SOP_DOC';
      }
      form.setFieldsValue(nextPatch);
      void form.validateFields(['external_url']).catch(() => undefined);
    };
    reader.readAsDataURL(file);
    return false;
  };

  return (
    <Modal
      open={open}
      forceRender
      width={720}
      style={{ top: 20 }}
      title={editing ? `Cập nhật Tệp Media — ${editing.file_name}` : 'Tải Ảnh / Tài liệu lên Kho Media Hệ thống'}
      okText={editing ? 'Lưu cập nhật' : 'Tải lên & Lưu Kho Media'}
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: editing ? <SaveOutlined /> : <PlusOutlined />, loading }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ category: 'BANNER', mime_type: 'image/png', size_bytes: 0, is_internal_only: true, file_base64: '', external_url: '' }}
        onFinish={(vals) => {
          const { external_url, ...rest } = vals;
          onSubmit({ ...rest, drive_url: String(external_url || '').trim() });
        }}
      >
        <Form.Item name="file_base64" hidden><Input /></Form.Item>
        <Form.Item label="Chọn hoặc kéo thả tệp trực tiếp từ thiết bị (Đồng bộ Google Drive Hệ thống 05_MKT_MEDIA)">
          <Upload.Dragger
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
            multiple={false}
            showUploadList={false}
            beforeUpload={handlePickFile}
            style={{ padding: '10px 12px', borderRadius: 4 }}
          >
            <Space direction="vertical" size={2}>
              <CloudUploadOutlined style={{ fontSize: 26, color: '#2563EB' }} />
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Bấm chọn hoặc kéo thả Hình ảnh (PNG, JPG, WebP, GIF) hoặc Tài liệu PDF</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>Tệp được lưu trực tiếp lên Google Drive hệ thống, xem được từ mọi tài khoản không lo lỗi quyền 403</div>
            </Space>
          </Upload.Dragger>
          {fileBase64 && (
            <Flex justify="space-between" align="center" wrap gap={8} style={{ marginTop: 8, padding: '6px 10px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4 }}>
              <Space size={6} wrap>
                {watchedMime === 'application/pdf' && <FilePdfOutlined style={{ color: '#DC2626' }} />}
                <Tag color="blue" style={{ margin: 0 }}>Tệp đã chọn tải lên</Tag>
                <strong style={{ fontSize: 13 }}>{watchedName || 'Tệp mới'}</strong>
                <span className="num" style={{ fontSize: 12, color: '#475569' }}>({formatMediaBytes(watchedSize)})</span>
              </Space>
              <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => form.setFieldValue('file_base64', '')}>Bỏ tệp vừa chọn</Button>
            </Flex>
          )}
        </Form.Item>

        {previewImgSrc && (
          <div style={{ marginBottom: 14, borderRadius: 4, overflow: 'hidden', border: '1px solid #E5E7EB' }}>
            <FancyboxImage src={previewImgSrc} alt={watchedName || 'Xem trước hình ảnh'} height={175} objectFit="contain" />
          </div>
        )}

        <Row gutter={12}>
          <Col xs={24} md={10}>
            <Form.Item name="file_name" label="Tên tệp / Tài liệu truyền thông" rules={[{ required: true, message: 'Vui lòng nhập tên tệp' }]}>
              <Input placeholder="VD: banner-sop-pha-che-v5.png" />
            </Form.Item>
          </Col>
          <Col xs={12} md={7}>
            <Form.Item name="category" label="Phân loại nội dung"><Select options={MEDIA_CATEGORY_OPTIONS} /></Form.Item>
          </Col>
          <Col xs={12} md={7}>
            <Form.Item name="mime_type" label="Định dạng tệp">
              <Select options={[
                { value: 'image/png', label: 'Hình ảnh PNG' },
                { value: 'image/jpeg', label: 'Hình ảnh JPEG' },
                { value: 'image/webp', label: 'Hình ảnh WebP' },
                { value: 'image/gif', label: 'Hình ảnh GIF' },
                { value: 'application/pdf', label: 'Tài liệu PDF' },
              ]} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="external_url"
          label="Hoặc liên kết Google Drive nội bộ / URL tệp (không bắt buộc nếu đã chọn tệp tải lên)"
          rules={[{
            validator: async (_, val) => {
              const hasUpload = Boolean(form.getFieldValue('file_base64'));
              const hasUrl = Boolean(String(val || '').trim());
              if (editing || hasUpload || hasUrl) return;
              throw new Error('Vui lòng chọn tệp tải lên từ thiết bị hoặc nhập đường dẫn tệp');
            },
          }]}
        >
          <Input placeholder="Để trống nếu đã chọn tệp tải lên ở trên, hoặc dán liên kết https://..." />
        </Form.Item>

        <Row gutter={12}>
          <Col xs={24} md={10}>
            <Form.Item name="size_bytes" label="Dung lượng tệp"><InputNumber style={{ width: '100%' }} min={0} step={10240} suffix="Bytes" /></Form.Item>
          </Col>
          <Col xs={24} md={14}>
            <Form.Item name="is_internal_only" label="Phạm vi bảo mật tài liệu" valuePropName="checked">
              <Switch checkedChildren="Chỉ lưu hành nội bộ" unCheckedChildren="Công khai có kiểm soát" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
