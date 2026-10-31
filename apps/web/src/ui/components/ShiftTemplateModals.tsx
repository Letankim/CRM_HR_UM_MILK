'use client';

import { Button, Col, Descriptions, Form, Input, InputNumber, Modal, Row, Select, Space, Tag, type FormInstance } from 'antd';
import { CloseOutlined, EditOutlined, PlusOutlined, SaveOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { generateShiftCode } from '@/lib/auto-generate';
import { StatusTag } from '@/ui/StatusTag';
import { DateStringPicker, TimeSelect } from './DateTimePickers';
import type { ShiftTemplateItem, StaffingRuleItem } from './ShiftTemplatesCard';

interface BranchOption {
  id: string;
  code: string;
  name: string;
}

interface ShiftTemplateModalsProps {
  canConfig: boolean;
  branches: BranchOption[];
  shifts: ShiftTemplateItem[];
  viewingShift: ShiftTemplateItem | null;
  onCloseViewShift: () => void;
  onEditFromView: (item: ShiftTemplateItem) => void;
  shiftModalOpen: boolean;
  editingShift: ShiftTemplateItem | null;
  shiftForm: FormInstance;
  savingShift: boolean;
  onCloseShiftModal: () => void;
  onSaveShift: (values: Record<string, unknown>) => void;
  ruleModalOpen: boolean;
  editingRule: StaffingRuleItem | null;
  ruleForm: FormInstance;
  savingRule: boolean;
  onCloseRuleModal: () => void;
  onSaveRule: (values: Record<string, unknown>) => void;
}

export function ShiftTemplateModals({
  canConfig, branches, shifts,
  viewingShift, onCloseViewShift, onEditFromView,
  shiftModalOpen, editingShift, shiftForm, savingShift, onCloseShiftModal, onSaveShift,
  ruleModalOpen, editingRule, ruleForm, savingRule, onCloseRuleModal, onSaveRule,
}: ShiftTemplateModalsProps) {
  return (
    <>
      <Modal
        title={viewingShift ? `Chi tiết Mẫu Ca — ${viewingShift.name}` : 'Chi tiết mẫu ca'}
        open={!!viewingShift} onCancel={onCloseViewShift} width={600} destroyOnHidden
        footer={
          <Space>
            {viewingShift && canConfig && (
              <Button type="primary" icon={<EditOutlined />} onClick={() => { const cur = viewingShift; onCloseViewShift(); onEditFromView(cur); }}>
                Chỉnh sửa mẫu ca
              </Button>
            )}
            <Button icon={<CloseOutlined />} onClick={onCloseViewShift}>Đóng</Button>
          </Space>
        }
      >
        {viewingShift && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Tên ca làm việc"><strong>{viewingShift.name}</strong></Descriptions.Item>
            <Descriptions.Item label="Chi nhánh áp dụng"><Tag color={!viewingShift.branchId || viewingShift.branchId === 'ALL' ? 'default' : 'blue'}>{viewingShift.branchName || 'Tất cả chi nhánh'}</Tag></Descriptions.Item>
            <Descriptions.Item label="Khung giờ làm việc"><span className="num">{viewingShift.startTime} – {viewingShift.endTime}</span></Descriptions.Item>
            <Descriptions.Item label="Số giờ công chuẩn"><span className="num" style={{ fontWeight: 700 }}>{viewingShift.standardHours} giờ (Nghỉ giữa ca: {viewingShift.breakMinutes ?? 0} phút)</span></Descriptions.Item>
            <Descriptions.Item label="Ngày bắt đầu hiệu lực"><span className="num">{viewingShift.effectiveFrom}</span></Descriptions.Item>
            <Descriptions.Item label="Trạng thái"><StatusTag value={viewingShift.status} /></Descriptions.Item>
            <Descriptions.Item label="Ghi chú">{viewingShift.note || '—'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Modal
        width={720} title={editingShift ? `Sửa Mẫu Ca — ${editingShift.name}` : 'Thêm Mẫu Ca Làm Việc Mới'}
        open={shiftModalOpen} onOk={async () => onSaveShift(await shiftForm.validateFields())} onCancel={onCloseShiftModal}
        okText={editingShift ? 'Lưu cập nhật' : 'Thêm mẫu ca'} cancelText="Hủy bỏ"
        okButtonProps={{ icon: editingShift ? <SaveOutlined /> : <PlusOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
        confirmLoading={savingShift} forceRender
      >
        <Form form={shiftForm} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={12}>
            <Col xs={24} md={8}><Form.Item name="branch_id" label="Chi nhánh áp dụng" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={[{ value: 'ALL', label: 'Tất cả chi nhánh (Dùng chung)' }, ...branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))]} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name="name" label="Tên ca hiển thị" rules={[{ required: true }]}><Input placeholder="Ví dụ: Ca sáng" /></Form.Item></Col>
            <Col xs={24} md={8}>
              <Form.Item name="code" label="Mã định danh ca" rules={[{ required: true, message: 'Nhập mã định danh ca' }]}>
                <Input
                  disabled={!!editingShift} placeholder="Ví dụ: CA_LINH_HOAT"
                  suffix={!editingShift ? <span style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#2563EB' }} onClick={() => shiftForm.setFieldsValue({ code: generateShiftCode(shiftForm.getFieldValue('name'), shiftForm.getFieldValue('code')) })}><ThunderboltOutlined /> Tự sinh</span> : undefined}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col xs={12} md={6}><Form.Item name="start_time" label="Giờ bắt đầu" rules={[{ required: true }]}><TimeSelect /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name="end_time" label="Giờ kết thúc" rules={[{ required: true }]}><TimeSelect /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name="standard_hours" label="Giờ công chuẩn" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={0.5} max={24} step={0.5} suffix="giờ" /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name="break_minutes" label="Nghỉ giữa ca (phút)"><InputNumber style={{ width: '100%' }} min={0} max={180} suffix="phút" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} md={8}><Form.Item name="effective_from" label="Ngày hiệu lực"><DateStringPicker /></Form.Item></Col>
            <Col xs={24} md={16}><Form.Item name="note" label="Ghi chú ca làm việc"><Input placeholder="Ghi chú đặc thù ca làm việc..." /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        width={720} title={editingRule ? 'Chỉnh sửa Định biên Nhân sự Theo Ca' : 'Thiết lập Định biên Nhân sự Theo Ca'}
        open={ruleModalOpen} onOk={async () => onSaveRule(await ruleForm.validateFields())} onCancel={onCloseRuleModal}
        okText={editingRule ? 'Lưu cập nhật' : 'Lưu định biên'} cancelText="Hủy bỏ"
        okButtonProps={{ icon: <SaveOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
        confirmLoading={savingRule} forceRender
      >
        <Form form={ruleForm} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={12}>
            <Col xs={24} md={12}><Form.Item name="branch_id" label="Chi nhánh áp dụng" rules={[{ required: true, message: 'Vui lòng chọn chi nhánh áp dụng' }]}><Select showSearch optionFilterProp="label" options={[{ value: 'ALL', label: 'Tất cả chi nhánh (Định biên mặc định chung)' }, ...branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))]} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="shift_template_id" label="Khung ca áp dụng" rules={[{ required: true, message: 'Vui lòng chọn khung ca áp dụng' }]}><Select showSearch optionFilterProp="label" options={[{ value: 'ALL', label: 'Mọi khung ca làm việc' }, ...shifts.map((s) => ({ value: s.id, label: `${s.name} (${s.startTime} – ${s.endTime})${s.branchId && s.branchId !== 'ALL' ? ` · ${s.branchName}` : ''}` }))]} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col xs={12} md={7}><Form.Item name="min_staff" label="Số NS tối thiểu / ca" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={1} max={30} suffix="người" /></Form.Item></Col>
            <Col xs={12} md={7}><Form.Item name="max_staff" label="Số NS tối đa / ca" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={1} max={50} suffix="người" /></Form.Item></Col>
            <Col xs={24} md={10}><Form.Item name="enforcement" label="Chế độ kiểm soát định biên"><Select options={[{ value: 'HARD_BLOCK', label: 'Chặn cứng (đúng định biên)' }, { value: 'SOFT_WARN', label: 'Cảnh báo mềm khi thiếu người' }]} /></Form.Item></Col>
          </Row>
          <Form.Item name="note" label="Ghi chú vận hành"><Input placeholder="VD: Định biên chuẩn 1 nhân sự / ca (không nhiều hơn, không ít hơn)" /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
