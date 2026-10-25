'use client';

import { Col, Form, Input, InputNumber, Modal, Row, Select, Switch } from 'antd';
import type { FormInstance } from 'antd';
import { CloseOutlined, PlusOutlined, SaveOutlined, SendOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { DateStringPicker } from './DateTimePickers';
import { RichHtmlEditor } from './RichHtmlEditor';

export function MktAnnouncementModal({
  open, editing, form, campaigns, audienceGroups, mediaAssets, loading, onClose, onSubmit,
}: {
  open: boolean; editing: Record<string, unknown> | null; form: FormInstance;
  campaigns: Record<string, unknown>[]; audienceGroups: Record<string, unknown>[]; mediaAssets: Record<string, unknown>[];
  loading?: boolean; onClose: () => void; onSubmit: (values: Record<string, unknown>) => void;
}) {
  const statusVal = Form.useWatch('status', form);
  const audienceOptions = audienceGroups.length > 0
    ? audienceGroups.map((g) => ({ value: `${g.scope}|${g.target}`, label: `${g.label} (${g.recipientCount ?? 0} người nhận)` }))
    : [{ value: 'ALL|ALL', label: 'Toàn công ty Ụm Bò Milk' }, { value: 'STAGE|THU_VIEC', label: 'Nhân viên Thử việc' }, { value: 'STAGE|CHINH_THUC', label: 'Nhân viên Chính thức' }];

  return (
    <Modal
      open={open} forceRender width="76vw" style={{ top: 18, maxWidth: 1120 }}
      title={editing ? `Chỉnh sửa Thông báo Nội bộ — ${editing.announcement_code ?? editing.code}` : 'Tạo Thông báo Nội bộ & Đặt Lịch Phát'}
      okText={editing ? 'Lưu cập nhật thông báo' : statusVal === 'SENT' ? 'Phát thông báo ngay' : statusVal === 'SCHEDULED' ? 'Lưu & Đặt lịch phát' : 'Lưu bản nháp'}
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: editing ? <SaveOutlined /> : statusVal === 'SENT' ? <SendOutlined /> : <PlusOutlined />, loading }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose} onOk={() => form.submit()}
    >
      <Form
        form={form} layout="vertical"
        initialValues={{ priority: 'HIGH', status: 'SENT', audience_key: 'ALL|ALL', requires_ack: true, media_list: [] }}
        onFinish={(vals) => {
          const [audience_scope = 'ALL', audience_target = 'ALL'] = String(vals.audience_key || 'ALL|ALL').split('|');
          const media_ids = Array.isArray(vals.media_list) ? vals.media_list.join(',') : String(vals.media_ids || '');
          onSubmit({ ...vals, audience_scope, audience_target, media_ids, publish_now: vals.status === 'SENT' });
        }}
      >
        <Row gutter={12}>
          <Col xs={24} md={10}><Form.Item name="title" label="Tiêu đề thông báo" rules={[{ required: true, message: 'Vui lòng nhập tiêu đề thông báo' }]}><Input placeholder="Nhập tiêu đề bản tin truyền thông nội bộ..." /></Form.Item></Col>
          <Col xs={12} md={4}><Form.Item name="priority" label="Mức độ thông báo"><Select options={[{ value: 'NORMAL', label: 'Thông thường' }, { value: 'HIGH', label: 'Quan trọng' }, { value: 'URGENT', label: 'Khẩn cấp' }]} /></Form.Item></Col>
          <Col xs={12} md={5}><Form.Item name="status" label="Chế độ phát hành"><Select options={[{ value: 'DRAFT', label: 'Lưu bản nháp trước khi phát' }, { value: 'SCHEDULED', label: 'Đặt lịch phát theo ngày' }, { value: 'SENT', label: 'Phát thông báo ngay' }]} /></Form.Item></Col>
          <Col xs={24} md={5}><Form.Item name="scheduled_at" label="Ngày phát dự kiến"><DateStringPicker placeholder="Chọn ngày phát" /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={9}><Form.Item name="audience_key" label="Nhóm người nhận thông báo" rules={[{ required: true }]}><Select options={audienceOptions} showSearch optionFilterProp="label" /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="campaign_id" label="Chiến dịch truyền thông nội bộ"><Select allowClear placeholder="Chọn chiến dịch truyền thông..." options={campaigns.map((c) => ({ value: String(c.id), label: `${c.campaign_code} — ${c.name}` }))} /></Form.Item></Col>
          <Col xs={24} md={7}><Form.Item name="media_list" label="Tệp / Ảnh đính kèm từ Kho Media"><Select mode="multiple" allowClear placeholder="Chọn ảnh/tài liệu đính kèm..." options={mediaAssets.map((m) => ({ value: String(m.id), label: String(m.file_name) }))} /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={9}><Form.Item name="summary" label="Tóm tắt ngắn" rules={[{ required: true, message: 'Vui lòng nhập tóm tắt thông báo' }]}><Input placeholder="Tóm tắt hiển thị trên danh sách thông báo..." /></Form.Item></Col>
          <Col xs={12} md={5}><Form.Item name="cta_label" label="Nhãn nút hành động (CTA)"><Input placeholder="VD: Xem quy trình SOP" /></Form.Item></Col>
          <Col xs={12} md={5}><Form.Item name="cta_link" label="Đường dẫn điều hướng"><Input placeholder="VD: /nv/ban-tin" /></Form.Item></Col>
          <Col xs={24} md={5}><Form.Item name="requires_ack" label="Yêu cầu xác nhận đã đọc" valuePropName="checked"><Switch checkedChildren="Có xác nhận đọc" unCheckedChildren="Không bắt buộc" /></Form.Item></Col>
        </Row>
        <Form.Item name="body_md" label="Nội dung chi tiết thông báo" rules={[{ required: true, message: 'Vui lòng nhập nội dung thông báo' }]}><RichHtmlEditor placeholder="Nhập nội dung thông báo truyền thông nội bộ..." /></Form.Item>
      </Form>
    </Modal>
  );
}

export function MktAudienceModal({
  open, editing, form, branches, jobPositionOptions, loading, onClose, onSubmit,
}: {
  open: boolean; editing: Record<string, unknown> | null; form: FormInstance;
  branches: { value: string; label: string }[]; jobPositionOptions: { value: string; label: string }[];
  loading?: boolean; onClose: () => void; onSubmit: (values: Record<string, unknown>) => void;
}) {
  return (
    <Modal
      open={open} forceRender width={720}
      title={editing ? `Chỉnh sửa Nhóm Người Nhận — ${editing.label}` : 'Cấu hình Nhóm Người Nhận Thông Báo Mới'}
      okText={editing ? 'Lưu cập nhật nhóm' : 'Tạo nhóm người nhận'} cancelText="Hủy bỏ"
      okButtonProps={{ icon: editing ? <SaveOutlined /> : <PlusOutlined />, loading }} cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose} onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" initialValues={{ scope: 'CUSTOM', branch_id: 'ALL', stage: 'ALL', staff_group: 'ALL' }} onFinish={onSubmit} style={{ marginTop: 12 }}>
        <Row gutter={12}>
          <Col xs={24} md={15}>
            <Form.Item name="label" label="Tên nhóm người nhận hiển thị" rules={[{ required: true, message: 'Vui lòng nhập tên nhóm người nhận' }]}>
              <Input placeholder="VD: Nhóm Pha chế Chính thức CN01, Nhóm Nhân sự Mới..." />
            </Form.Item>
          </Col>
          <Col xs={24} md={9}>
            <Form.Item name="scope" label="Kiểu cấu hình phạm vi">
              <Select options={[
                { value: 'CUSTOM', label: 'Kết hợp (Chi nhánh + Giai đoạn + Vị trí)' },
                { value: 'BRANCH', label: 'Theo Chi nhánh' },
                { value: 'STAFF_GROUP', label: 'Theo Vị trí công việc' },
                { value: 'STAGE', label: 'Theo Giai đoạn nhân sự' },
                { value: 'ALL', label: 'Toàn công ty' },
              ]} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item name="branch_id" label="Lọc theo Chi nhánh">
              <Select options={[{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branches]} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="stage" label="Lọc theo Giai đoạn">
              <Select options={[{ value: 'ALL', label: 'Mọi giai đoạn' }, { value: 'PROBATION', label: 'Nhân viên Thử việc' }, { value: 'OFFICIAL', label: 'Nhân viên Chính thức' }]} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="staff_group" label="Lọc theo Vị trí công việc">
              <Select options={[{ value: 'ALL', label: 'Mọi vị trí công việc' }, ...jobPositionOptions]} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="note" label="Mô tả phạm vi & Chính sách bảo mật dữ liệu">
          <Input placeholder="VD: Nhóm nhận thông báo quy trình pha chế mới (Tự động ẩn 100% lương, GPS, CCCD)" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function MktCampaignModal({
  open, editing, form, loading, onClose, onSubmit,
}: {
  open: boolean; editing: Record<string, unknown> | null; form: FormInstance; loading?: boolean; onClose: () => void; onSubmit: (values: Record<string, unknown>) => void;
}) {
  return (
    <Modal
      open={open} forceRender width={720}
      title={editing ? `Chỉnh sửa Chiến dịch — ${editing.campaign_code}` : 'Tạo Chiến dịch Truyền thông Nội bộ Mới'}
      okText={editing ? 'Lưu cập nhật' : 'Tạo chiến dịch'} cancelText="Hủy bỏ"
      okButtonProps={{ icon: editing ? <SaveOutlined /> : <PlusOutlined />, loading }} cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose} onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" initialValues={{ channel: 'IN_APP', audience_scope: 'ALL', status: 'RUNNING' }} onFinish={onSubmit}>
        <Row gutter={12}>
          <Col xs={24} md={9}><Form.Item name="campaign_code" label="Mã chiến dịch" rules={[{ required: true }]}><Input placeholder="CMP-2026-01" suffix={<span style={{ cursor: 'pointer', fontSize: 11, color: '#2563EB', fontWeight: 600 }} onClick={() => form.setFieldValue('campaign_code', `CMP-2026-${Math.floor(10 + Math.random() * 89)}`)}><ThunderboltOutlined /> Tự sinh</span>} /></Form.Item></Col>
          <Col xs={24} md={15}><Form.Item name="name" label="Tên chiến dịch truyền thông" rules={[{ required: true }]}><Input placeholder="VD: Chiến dịch Đào tạo SOP & Vệ sinh ATTP Q4" /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={8}><Form.Item name="channel" label="Kênh phát thông báo"><Select options={[{ value: 'IN_APP', label: 'Cổng Nội bộ' }, { value: 'EMAIL', label: 'Email Doanh nghiệp' }, { value: 'ALL_CHANNELS', label: 'Đa kênh (Cổng + Email)' }]} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="audience_scope" label="Phạm vi đối tượng"><Select options={[{ value: 'ALL', label: 'Toàn công ty' }, { value: 'BRANCH', label: 'Theo chi nhánh' }, { value: 'STAGE', label: 'Theo giai đoạn nhân sự' }, { value: 'STAFF_GROUP', label: 'Nhóm vị trí' }]} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="status" label="Trạng thái chiến dịch"><Select options={[{ value: 'DRAFT', label: 'Bản nháp' }, { value: 'SCHEDULED', label: 'Đã lên lịch' }, { value: 'RUNNING', label: 'Đang triển khai' }, { value: 'COMPLETED', label: 'Đã hoàn tất' }]} /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={8}><Form.Item name="scheduled_at" label="Ngày khởi chạy"><DateStringPicker /></Form.Item></Col>
          <Col xs={24} md={16}><Form.Item name="note" label="Mục tiêu & Ghi chú chiến dịch"><Input placeholder="Gom nhóm các bản tin truyền thông theo đợt..." /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}

export function MktMediaModal({
  open, editing, form, loading, onClose, onSubmit,
}: {
  open: boolean; editing: Record<string, unknown> | null; form: FormInstance; loading?: boolean; onClose: () => void; onSubmit: (values: Record<string, unknown>) => void;
}) {
  return (
    <Modal
      open={open} forceRender width={680}
      title={editing ? `Cập nhật Tệp Media — ${editing.file_name}` : 'Thêm Ảnh / Tài liệu vào Kho Media Phê duyệt'}
      okText={editing ? 'Lưu cập nhật' : 'Lưu vào Kho Media'} cancelText="Hủy bỏ"
      okButtonProps={{ icon: editing ? <SaveOutlined /> : <PlusOutlined />, loading }} cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose} onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" initialValues={{ mime_type: 'image/png', size_bytes: 245000, is_internal_only: true }} onFinish={onSubmit}>
        <Row gutter={12}>
          <Col xs={24} md={14}><Form.Item name="file_name" label="Tên tệp / Tài liệu truyền thông" rules={[{ required: true }]}><Input placeholder="VD: banner-sop-pha-che-v5.png" /></Form.Item></Col>
          <Col xs={24} md={10}><Form.Item name="mime_type" label="Định dạng tệp"><Select options={[{ value: 'image/png', label: 'Hình ảnh PNG' }, { value: 'image/jpeg', label: 'Hình ảnh JPEG' }, { value: 'application/pdf', label: 'Tài liệu PDF' }]} /></Form.Item></Col>
        </Row>
        <Form.Item name="drive_url" label="Đường dẫn lưu trữ Google Drive / Kho Media nội bộ được phê duyệt" rules={[{ required: true }]}><Input placeholder="https://drive.google.com/file/d/..." /></Form.Item>
        <Row gutter={12}>
          <Col xs={24} md={10}><Form.Item name="size_bytes" label="Dung lượng tệp"><InputNumber style={{ width: '100%' }} min={1024} step={10240} suffix="Bytes" /></Form.Item></Col>
          <Col xs={24} md={14}><Form.Item name="is_internal_only" label="Phạm vi bảo mật tài liệu" valuePropName="checked"><Switch checkedChildren="Chỉ lưu hành nội bộ" unCheckedChildren="Công khai có kiểm soát" /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}
