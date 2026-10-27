'use client';

import { Button, Col, Descriptions, Drawer, Form, Input, Modal, Row, Select, Space, Switch, Table, Tag } from 'antd';
import type { FormInstance } from 'antd';
import { CheckCircleOutlined, CloseOutlined, EditOutlined, ExpandAltOutlined, SaveOutlined, SendOutlined, ShrinkOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useState } from 'react';
import { TABLE_DISPLAY_LABELS } from '@umbm/shared';
import { StatusTag } from '../StatusTag';
import { useClientPagination } from '../hooks/useClientPagination';
import { DateStringPicker } from './DateTimePickers';
import { RichHtmlEditor } from './RichHtmlEditor';

export const POLICY_CATEGORY_OPTIONS = [
  { value: 'ATTENDANCE', label: 'Chấm công & Điểm danh GPS' },
  { value: 'HR_CULTURE', label: 'Nhân sự, Nội quy & Văn hóa Công ty' },
  { value: 'PROBATION_LEAVE', label: 'Chu kỳ Thử việc & Nghỉ phép (OFF)' },
  { value: 'PAYROLL_SWAP', label: 'Lương, Thưởng, Phụ cấp & Đổi ca' },
  { value: 'STORE_OPS', label: 'Quy chuẩn Vận hành & Pha chế (SOP)' },
  { value: 'GENERAL_NOTICE', label: 'Thông báo Vận hành & Quy định Chung' },
];

export const POLICY_CATEGORY_LABELS: Record<string, string> = {
  ATTENDANCE: 'Chấm công & Điểm danh GPS',
  HR_CULTURE: 'Nhân sự & Nội quy Công ty',
  PROBATION_LEAVE: 'Thử việc & Nghỉ phép (OFF)',
  PAYROLL_SWAP: 'Lương, Thưởng & Đổi ca',
  STORE_OPS: 'Vận hành & Pha chế (SOP)',
  GENERAL_NOTICE: 'Quy định & Thông báo Chung',
};

const PRESET_POLICY_TEMPLATES = [
  { value: 'LATE_GRACE_MINUTES', label: 'Số phút ân hạn đi trễ đầu ca (Chấm công)', category: 'ATTENDANCE', description: 'Quy định số phút ân hạn đi trễ đầu ca & điều kiện điểm danh GPS tại cửa hàng', value_json: '5 phút / Bán kính GPS chuẩn', content_html: '<p><strong>1. Quy định chấm công đầu ca:</strong> Nhân sự thực hiện điểm danh bằng Camera trực tiếp và định vị GPS tại chi nhánh làm việc.</p><p><strong>2. Ân hạn đầu ca:</strong> Tối đa 05 phút so với giờ bắt đầu ca quy định.</p>' },
  { value: 'HR_DRESS_CODE_SOP', label: 'Nội quy đồng phục, tác phong & giao tiếp (Nhân sự HR)', category: 'HR_CULTURE', description: 'Quy định đồng phục, bảng tên và tác phong phục vụ khách hàng tại toàn bộ chi nhánh', value_json: 'Áp dụng 100% ca làm việc', content_html: '<p><strong>1. Đồng phục & Bảng tên:</strong> Nhân sự mặc đầy đủ áo đồng phục, tạp dề sạch sẽ và đeo bảng tên suốt thời gian trong ca.</p><p><strong>2. Tác phong phục vụ:</strong> Luôn chào khách hàng theo chuẩn Ụm Bò Milk ngay khi khách bước vào quầy.</p>' },
  { value: 'PROBATION_CYCLE_DAYS', label: 'Chu kỳ thử việc 12 ngày & đánh giá chuyển chính thức (HR)', category: 'PROBATION_LEAVE', description: 'Quy định chu kỳ thử việc 12 ngày (10 ngày làm, tối đa 2 ngày OFF) & bài thi SOP', value_json: '12 ngày (10 công + tối đa 2 OFF)', content_html: '<p><strong>1. Thời gian thử việc:</strong> Chu kỳ chuẩn 12 ngày gồm 10 ngày làm việc thực tế và tối đa 02 ngày đăng ký nghỉ OFF.</p><p><strong>2. Điều kiện lên Chính thức:</strong> Hoàn thành bài kiểm tra TEST Nghiệp vụ đạt từ 80% trở lên.</p>' },
  { value: 'SHIFT_SWAP_ALLOWANCE_VND', label: 'Phụ cấp nhận ca thay & hỗ trợ tăng ca (Lương & Ca)', category: 'PAYROLL_SWAP', description: 'Chính sách phụ cấp hỗ trợ nhân sự nhận ca thay đã duyệt trên hệ thống', value_json: '30.000đ / ca nhận thay hợp lệ', content_html: '<p><strong>1. Phụ cấp đổi ca / nhận ca thay:</strong> Nhân sự nhận ca thay hợp lệ được cộng phụ cấp 30.000đ/ca vào kỳ lương tương ứng.</p>' },
  { value: 'STORE_HYGIENE_CLOSING', label: 'Quy chuẩn vệ sinh quầy & bàn giao cuối ca (Vận hành CH)', category: 'STORE_OPS', description: 'Quy định kiểm tra vệ sinh máy móc, nguyên vật liệu và khóa sổ bàn giao cuối ca', value_json: 'Bắt buộc trước khi Ra ca', content_html: '<p><strong>1. Vệ sinh thiết bị:</strong> Vệ sinh máy pha, bình ủ và khu vực pha chế sạch sẽ trước khi chấm công Ra ca.</p><p><strong>2. Kiểm kê & Bàn giao:</strong> Ghi nhận đầy đủ tồn kho nguyên liệu cuối ca.</p>' },
];

export function PolicyFormModal({
  open, editing, form, isAdmin, loading, onClose, onSubmit,
}: {
  open: boolean; editing: Record<string, unknown> | null; form: FormInstance; isAdmin?: boolean; loading?: boolean; onClose: () => void; onSubmit: (values: Record<string, unknown>) => void;
}) {
  const applyPreset = (presetKey: string) => {
    const found = PRESET_POLICY_TEMPLATES.find((p) => p.value === presetKey);
    if (found) form.setFieldsValue({ key: found.value, category: found.category, description: found.description, value_json: found.value_json, content_html: found.content_html });
  };

  return (
    <Modal
      open={open} forceRender width="72vw" style={{ top: 20, maxWidth: 1080 }}
      title={editing ? `Chỉnh sửa Chính sách & Quy định — ${editing.key}` : 'Ban hành Chính sách / Quy định Mới & Phổ biến Toàn Công ty'}
      okText={editing ? 'Lưu cập nhật chính sách' : 'Ban hành & Phổ biến'} cancelText="Hủy bỏ"
      okButtonProps={{ icon: editing ? <SaveOutlined /> : <SendOutlined />, loading }} cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose} onOk={() => form.submit()}
    >
      <Form
        form={form} layout="vertical"
        initialValues={{ category: 'ATTENDANCE', policy_version: 'v5.1', effective_from: '2026-11-01', is_locked_policy: false, broadcast_company: true, owner_override_approved: true }}
        onFinish={onSubmit}
      >
        {!editing && (
          <Form.Item label="Chọn nhanh mẫu chính sách theo bộ phận (Nhân sự HR / Vận hành Cửa hàng / Chấm công / Lương)">
            <Select allowClear placeholder="Chọn mẫu có sẵn để tự động điền nhanh hoặc tự nhập bên dưới..." options={PRESET_POLICY_TEMPLATES.map((p) => ({ value: p.value, label: p.label }))} onChange={(val) => { if (val) applyPreset(val); }} />
          </Form.Item>
        )}

        <Row gutter={12}>
          <Col xs={24} md={10}>
            <Form.Item name="key" label="Mã chính sách / quy định" rules={[{ required: true, message: 'Vui lòng nhập mã chính sách' }]}>
              <Input placeholder="VD: POL_CHAM_CONG_01" suffix={<span style={{ cursor: 'pointer', userSelect: 'none', fontWeight: 600, fontSize: 12, color: '#2563EB', background: '#EFF6FF', padding: '1px 6px', borderRadius: 2 }} onClick={() => form.setFieldValue('key', `POL_${Math.floor(100 + Math.random() * 900)}`)}><ThunderboltOutlined /> Tự sinh</span>} />
            </Form.Item>
          </Col>
          <Col xs={24} md={9}><Form.Item name="category" label="Nhóm quy định / Bộ phận" rules={[{ required: true }]}><Select options={POLICY_CATEGORY_OPTIONS} /></Form.Item></Col>
          <Col xs={24} md={5}><Form.Item name="policy_version" label="Phiên bản" rules={[{ required: true }]}><Input placeholder="v5.1" /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={14}><Form.Item name="description" label="Tiêu đề chính sách / Quy định phổ biến" rules={[{ required: true, message: 'Vui lòng nhập tiêu đề chính sách' }]}><Input placeholder="Ví dụ: Quy định đồng phục, chấm công GPS & tác phong làm việc tại cửa hàng" /></Form.Item></Col>
          <Col xs={24} md={10}><Form.Item name="value_json" label="Định mức / Giá trị áp dụng tóm tắt" rules={[{ required: true, message: 'Nhập giá trị áp dụng' }]}><Input placeholder="Ví dụ: 5 phút / 100m / Toàn công ty" /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={isAdmin ? 6 : 8}><Form.Item name="effective_from" label="Ngày bắt đầu hiệu lực" rules={[{ required: true }]}><DateStringPicker /></Form.Item></Col>
          <Col xs={24} md={isAdmin ? 6 : 8}><Form.Item name="effective_to" label="Ngày hết hiệu lực"><DateStringPicker placeholder="Không thời hạn" /></Form.Item></Col>
          <Col xs={12} md={isAdmin ? 6 : 8}><Form.Item name="broadcast_company" label="Phổ biến cho toàn công ty" valuePropName="checked"><Switch checkedChildren="Gửi thông báo toàn CTy" unCheckedChildren="Chỉ lưu bảng" /></Form.Item></Col>
          {isAdmin && <Col xs={12} md={6}><Form.Item name="is_locked_policy" label="Khóa bảo vệ cốt lõi" valuePropName="checked"><Switch checkedChildren="Khóa cốt lõi" unCheckedChildren="Linh hoạt" /></Form.Item></Col>}
        </Row>
        <Form.Item name="content_html" label="Nội dung văn bản chính sách & hướng dẫn thực hiện chi tiết">
          <RichHtmlEditor placeholder="Nhập nội dung chính sách, quy định của HR / Cửa hàng / Kế toán / Quản trị để phổ biến cho toàn thể nhân sự..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}

const MODULE_GROUP_LABELS: Record<string, string> = {
  CORE: 'Quản trị & Cấu hình lõi', HR: 'Hồ sơ Nhân sự & Tuyển dụng', SCHEDULE: 'Lịch làm việc & Đơn từ',
  ATTENDANCE: 'Chấm công GPS & Camera', PAYROLL: 'Lương, Thưởng & Phiếu lương', COMMS: 'Truyền thông & Thông báo', SYSTEM: 'Hệ thống & Đối soát',
};

export function BackupDetailDrawer({ record, onClose }: { record: Record<string, unknown> | null; onClose: () => void }) {
  const [wide, setWide] = useState(false);
  const bkpTablesPag = useClientPagination(12, 'bảng dữ liệu được sao lưu');
  const parsed = (() => { try { return JSON.parse(String(record?.rows_json || '{}')) as Record<string, unknown>; } catch { return {}; } })();
  const isVerifyOnly = parsed.status === 'VERIFIED' && typeof parsed.issuesFound === 'number';
  const tableRows = Object.entries(parsed)
    .filter(([, v]) => typeof v === 'number')
    .map(([key, v]) => ({ key, moduleLabel: MODULE_GROUP_LABELS[key.split('.')[0] || 'SYSTEM'] ?? 'Hệ thống', tableLabel: TABLE_DISPLAY_LABELS[key] ?? 'Bảng dữ liệu nghiệp vụ', count: Number(v) }))
    .sort((a, b) => b.count - a.count || a.moduleLabel.localeCompare(b.moduleLabel));
  const totalRecords = tableRows.reduce((s, r) => s + r.count, 0), activeTables = tableRows.filter((r) => r.count > 0).length;
  const durSec = record?.started_at && record?.finished_at ? Math.max(1, dayjs(String(record.finished_at)).diff(dayjs(String(record.started_at)), 'second')) : 1;
  const actorLabel = String(record?.actorName || (!record?.created_by || record?.created_by === 'embedded-cron' ? 'Tự động theo lịch hệ thống' : 'Quản trị hệ thống'));

  return (
    <Drawer
      open={Boolean(record)} width={wide ? '95vw' : '72vw'} onClose={onClose} destroyOnHidden
      title={record ? `Chi tiết Bản Sao lưu & Khôi phục: ${String(record.backup_code)}` : 'Chi tiết bản sao lưu'}
      extra={<Space wrap><Button size="small" icon={wide ? <ShrinkOutlined /> : <ExpandAltOutlined />} onClick={() => setWide((v) => !v)}>{wide ? 'Thu gọn' : 'Mở rộng'}</Button><Button size="small" icon={<CloseOutlined />} onClick={onClose}>Đóng</Button></Space>}
    >
      {record && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Mã bản sao lưu"><Tag color="geekblue">{String(record.backup_code)}</Tag></Descriptions.Item>
            <Descriptions.Item label="Trạng thái thực thi"><Space size={6}><StatusTag value={String(record.status)} />{Boolean(record.verified_restore) ? <Tag color="green" icon={<CheckCircleOutlined />}>Đã diễn tập khôi phục</Tag> : <Tag color="blue">Bản sao lưu hệ thống</Tag>}</Space></Descriptions.Item>
            <Descriptions.Item label="Loại sao lưu"><strong>{String(record.kindLabel || 'Sao lưu định kỳ')}</strong></Descriptions.Item>
            <Descriptions.Item label="Tiến trình / Người thực hiện"><Tag color="cyan">{actorLabel}</Tag></Descriptions.Item>
            <Descriptions.Item label="Thời điểm bắt đầu"><span className="num">{record.started_at ? dayjs(String(record.started_at)).format('HH:mm:ss DD/MM/YYYY') : '—'}</span></Descriptions.Item>
            <Descriptions.Item label="Thời điểm hoàn tất"><span className="num">{record.finished_at ? `${dayjs(String(record.finished_at)).format('HH:mm:ss DD/MM/YYYY')} (${durSec} giây)` : '—'}</span></Descriptions.Item>
            <Descriptions.Item label="Số tệp bảng tính sao lưu"><Tag color="geekblue">{Number(record.files_count ?? 0)} tệp dữ liệu</Tag></Descriptions.Item>
            <Descriptions.Item label="Tổng khối lượng bản ghi">{isVerifyOnly ? <Tag color="green">Kiểm chứng toàn vẹn hệ thống</Tag> : <Space size={6}><Tag color="blue">{totalRecords} bản ghi</Tag><Tag>{activeTables}/{tableRows.length} bảng có dữ liệu</Tag></Space>}</Descriptions.Item>
            <Descriptions.Item label="Kiểm tra toàn vẹn dữ liệu" span={2}>{record.error ? <Tag color="red">{String(record.error)}</Tag> : <Tag color="green">Nguyên vẹn 100% — Không có lỗi phát sinh</Tag>}</Descriptions.Item>
          </Descriptions>
          {isVerifyOnly ? (
            <Descriptions size="small" bordered title="Kết quả diễn tập khôi phục & đối soát toàn vẹn" column={2}>
              <Descriptions.Item label="Số điểm lệch phát hiện"><Tag color={Number(parsed.issuesFound) > 0 ? 'orange' : 'green'}>{Number(parsed.issuesFound ?? 0)} mục</Tag></Descriptions.Item>
              <Descriptions.Item label="Đã tự động đồng bộ & sửa chữa"><Tag color="blue">{Number(parsed.autoRepaired ?? 0)} mục</Tag></Descriptions.Item>
            </Descriptions>
          ) : (
            <Table
              size="small" bordered rowKey="key" dataSource={tableRows}
              pagination={bkpTablesPag}
              columns={[
                { title: 'Phân hệ nghiệp vụ', dataIndex: 'moduleLabel', width: 210, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
                { title: 'Tên bảng dữ liệu đã sao lưu', dataIndex: 'tableLabel', render: (v: string) => <strong>{v}</strong> },
                { title: 'Số bản ghi lưu trữ', dataIndex: 'count', width: 160, align: 'right', render: (v: number) => <Tag color={v > 0 ? 'blue' : 'default'} className="num">{v} bản ghi</Tag> },
              ]}
            />
          )}
        </Space>
      )}
    </Drawer>
  );
}

export function GovernanceDetailDrawer({
  record, kind, onClose, onEdit, onBroadcast,
}: {
  record: Record<string, unknown> | null; kind: 'policy' | 'announcement'; onClose: () => void;
  onEdit?: (r: Record<string, unknown>) => void; onBroadcast?: (r: Record<string, unknown>) => void;
}) {
  const [wide, setWide] = useState(false);
  const html = record ? String(kind === 'policy' ? record.content_html || record.note || `<p>${record.description ?? ''}</p>` : record.body || `<p>${record.summary ?? ''}</p>`) : '';
  const isSent = record && String(record.status) === 'SENT';
  const priorityLabel = record?.priority === 'URGENT' ? 'Khẩn cấp' : record?.priority === 'HIGH' ? 'Quan trọng' : 'Thông thường';
  const priorityColor = record?.priority === 'URGENT' || record?.priority === 'HIGH' ? 'red' : 'blue';

  return (
    <Drawer
      open={Boolean(record)} width={wide ? '95vw' : '70vw'} onClose={onClose} destroyOnHidden
      title={record ? (kind === 'policy' ? `Chi tiết Chính sách & Quy định: ${record.key}` : `Chi tiết Bản tin Nội bộ: ${record.title}`) : 'Chi tiết'}
      extra={
        <Space wrap>
          {record && kind === 'policy' && onBroadcast && <Button size="small" icon={<SendOutlined />} onClick={() => onBroadcast(record)}>Phổ biến toàn công ty</Button>}
          {record && onEdit && <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => { const r = record; onClose(); onEdit(r); }}>Chỉnh sửa</Button>}
          <Button size="small" icon={wide ? <ShrinkOutlined /> : <ExpandAltOutlined />} onClick={() => setWide((v) => !v)}>{wide ? 'Thu gọn' : 'Mở rộng'}</Button>
          <Button size="small" icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
        </Space>
      }
    >
      {record && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Mã định danh"><Tag color="geekblue">{String(record.key ?? record.announcement_code ?? record.code)}</Tag></Descriptions.Item>
            <Descriptions.Item label={kind === 'policy' ? 'Định mức / Giá trị áp dụng' : 'Trạng thái'}>{kind === 'policy' ? <Tag color="blue">{String(record.value_json)}</Tag> : <StatusTag value={isSent ? 'SENT' : 'UNSENT'} label={isSent ? 'Đã gửi' : 'Chưa gửi'} />}</Descriptions.Item>
            {kind === 'policy' && (
              <>
                <Descriptions.Item label="Nhóm quy định">{POLICY_CATEGORY_LABELS[String(record.category)] ?? String(record.category ?? 'Quy định chung')}</Descriptions.Item>
                <Descriptions.Item label="Hiệu lực & Phê duyệt">Từ {String(record.effective_from || '—')} · Ban hành bởi: <strong>{String(record.approved_by || 'Hệ thống')}</strong></Descriptions.Item>
              </>
            )}
            {kind === 'announcement' && (
              <>
                <Descriptions.Item label="Mức độ ưu tiên"><Tag color={priorityColor}>{priorityLabel}</Tag></Descriptions.Item>
                <Descriptions.Item label="Thời điểm phát hành">{isSent && record.sent_at ? dayjs(String(record.sent_at)).format('HH:mm DD/MM/YYYY') : 'Chưa gửi'}</Descriptions.Item>
              </>
            )}
            <Descriptions.Item label="Tiêu đề" span={2}><strong>{String(record.description ?? record.title)}</strong></Descriptions.Item>
            {kind === 'announcement' && record.summary ? (
              <Descriptions.Item label="Tóm tắt nội dung" span={2}>{String(record.summary)}</Descriptions.Item>
            ) : null}
          </Descriptions>
          <div style={{ padding: '14px 18px', border: '1px solid #E5E7EB', borderRadius: 4, background: '#FFFFFF', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: html }} />
        </Space>
      )}
    </Drawer>
  );
}
