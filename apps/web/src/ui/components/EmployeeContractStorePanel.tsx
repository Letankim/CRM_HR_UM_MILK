'use client';

import { useEffect, useRef, useState } from 'react';
import { App, Button, Card, Col, Descriptions, Empty, Form, Input, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined, CloseOutlined, CloudUploadOutlined, DeleteOutlined, EditOutlined, EyeOutlined,
  FilePdfOutlined, FileProtectOutlined, FileTextOutlined, PlusCircleOutlined, PlusOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { CONTRACT_MAX_SIZE_BYTES, CONTRACT_TYPE_LABELS, verifyContractMagicBytes, type ContractType, type EmployeeContractItem } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { StatusTag } from '../StatusTag';
import { ContractPreviewModal } from './ContractPreviewModal';
import type { EmployeeRowItem } from './employee-table-columns';
import { useWorkflowDecisionModal } from './WorkflowDecisionModal';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Không thể đọc tệp hợp đồng'));
    reader.readAsDataURL(file);
  });
}

function fmtSizeKb(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ContractUploadModal({
  open, presetEmployee, employeeOptions = [], onClose, onSuccess,
}: {
  open: boolean; presetEmployee?: EmployeeRowItem | null;
  employeeOptions?: { value: string; label: string; stage?: string }[];
  onClose: () => void; onSuccess?: () => void;
}) {
  const qc = useQueryClient(), { message } = App.useApp(), [form] = Form.useForm();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ file: File; dataUrl: string; mime: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedFile(null); form.resetFields();
    form.setFieldsValue({
      employee_id: presetEmployee?.id ?? employeeOptions[0]?.value,
      contract_type: presetEmployee?.stage === 'OFFICIAL' ? 'OFFICIAL_CONTRACT' : 'PROBATION_CONTRACT', note: '',
    });
  }, [open, presetEmployee, employeeOptions, form]);

  const uploadMut = useMutation({
    mutationFn: (v: { employee_id: string; contract_type: ContractType; note?: string }) => {
      if (!selectedFile) throw new Error('Vui lòng chọn tệp hợp đồng đính kèm');
      return api.post(`/admin/employees/${v.employee_id}/contracts`, {
        contract_type: v.contract_type, file_name: selectedFile.file.name,
        mime_type: selectedFile.mime, size_bytes: selectedFile.file.size,
        file_base64: selectedFile.dataUrl, note: (v.note || '').trim(),
      });
    },
    onSuccess: () => {
      message.success('Đã tải lên và lưu hợp đồng lao động thành công');
      ['employee-contracts', 'employee-contract-detail', 'employees'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
      onSuccess?.(); onClose();
    },
    onError: (e) => message.error(e instanceof ApiClientError || e instanceof Error ? e.message : 'Tải lên hợp đồng thất bại'),
  });

  const handleChooseFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (file.size > CONTRACT_MAX_SIZE_BYTES) { message.error('Dung lượng tệp hợp đồng không được vượt quá 6MB'); return; }
    const buf = await file.arrayBuffer(), check = verifyContractMagicBytes(new Uint8Array(buf), file.name);
    if (!check.valid) { message.error(check.message); return; }
    setSelectedFile({ file, dataUrl: await readFileAsDataUrl(file), mime: check.detectedMime || file.type });
  };

  return (
    <Modal
      width={620} open={open} destroyOnHidden onCancel={onClose} onOk={() => form.submit()}
      title={presetEmployee ? `Tải lên Hợp đồng Lao động: ${presetEmployee.fullName} (${presetEmployee.employeeCode})` : 'Tải lên Hợp đồng Lao động mới'}
      okText="Lưu hợp đồng" cancelText="Hủy bỏ"
      okButtonProps={{ icon: <CloudUploadOutlined />, loading: uploadMut.isPending }} cancelButtonProps={{ icon: <CloseOutlined /> }}
    >
      <Form form={form} layout="vertical" onFinish={(v) => uploadMut.mutate(v)}>
        <Row gutter={12}>
          <Col span={presetEmployee ? 24 : 14}>
            <Form.Item name="employee_id" label="Nhân sự" rules={[{ required: true, message: 'Vui lòng chọn nhân sự' }]} hidden={Boolean(presetEmployee)}>
              <Select showSearch optionFilterProp="label" options={employeeOptions} placeholder="Tìm theo mã NV hoặc họ tên..." />
            </Form.Item>
          </Col>
          <Col span={presetEmployee ? 24 : 10}>
            <Form.Item name="contract_type" label="Loại hợp đồng lao động" rules={[{ required: true }]}>
              <Select options={Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="Tệp văn bản hợp đồng (Hỗ trợ PDF, Word, Ảnh JPG/PNG tối đa 6MB)" required>
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" style={{ display: 'none' }} onChange={(e) => void handleChooseFile(e)} />
          <div onClick={() => fileRef.current?.click()} style={{ border: '1px dashed #94A3B8', borderRadius: 4, background: '#F8FAFC', padding: '12px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <Space size={10}>
              <FilePdfOutlined style={{ fontSize: 22, color: '#2563EB' }} />
              <div>
                <div style={{ fontWeight: 600, color: '#0F172A' }}>{selectedFile ? selectedFile.file.name : 'Nhấn vào đây để chọn tệp hợp đồng từ máy tính'}</div>
                <div style={{ fontSize: 12, color: '#64748B' }}>{selectedFile ? `Dung lượng: ${fmtSizeKb(selectedFile.file.size)} · Đã kiểm tra định dạng hợp lệ` : 'Định dạng chuẩn: .pdf, .docx, .doc, .jpg, .png'}</div>
              </div>
            </Space>
            <Button size="small" icon={<CloudUploadOutlined />}>{selectedFile ? 'Đổi tệp khác' : 'Chọn tệp'}</Button>
          </div>
        </Form.Item>
        <Form.Item name="note" label="Số hợp đồng / Ghi chú hiệu lực" style={{ marginBottom: 0 }}>
          <Input.TextArea rows={2} placeholder="Ví dụ: HĐLĐ số 12/2026/HĐ-UBM, thời hạn 12 tháng..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function EmployeeContractStorePanel({ employee, canManage = false }: { employee: EmployeeRowItem; canManage?: boolean }) {
  const qc = useQueryClient(), { message } = App.useApp(), { promptDecision, decisionModalElement } = useWorkflowDecisionModal();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewState, setPreviewState] = useState<{ open: boolean; item: EmployeeContractItem | null }>({ open: false, item: null });

  const contractsQ = useQuery({
    queryKey: ['employee-contracts', employee.id], retry: false,
    queryFn: async () => {
      const res = await api.get<{ contracts?: EmployeeContractItem[] } | EmployeeContractItem[]>(`/admin/employees/${employee.id}/contracts`);
      return Array.isArray(res) ? res : (res?.contracts ?? []);
    },
  });

  const contracts = contractsQ.data ?? ((employee as unknown as { contracts?: EmployeeContractItem[] }).contracts ?? []);
  const invalidateAll = () => ['employee-contracts', 'employee-contract-detail', 'employees'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));

  const deleteMut = useMutation({
    mutationFn: (contractId: string) => api.delete(`/admin/employees/${employee.id}/contracts/${contractId}`),
    onSuccess: () => { message.success('Đã xóa hợp đồng khỏi hồ sơ nhân sự'); invalidateAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể xóa hợp đồng'),
  });

  const creditPts = employee.attendanceCreditPoints ?? 100;
  const openMeetPrompt = () => promptDecision({
    title: `${employee.probationMeetDone ? 'Chỉnh sửa' : 'Ghi nhận'} kết quả Vấn đáp Google Meet: ${employee.fullName}`,
    subtitle: 'Ghi nhận hoặc cập nhật kết quả buổi vấn đáp cuối kỳ thử việc trước khi chuyển nhân sự lên Chính thức.',
    required: true, noteLabel: 'Nhận xét đánh giá buổi vấn đáp', okText: 'Lưu kết quả vấn đáp', initialNote: employee.probationMeetNote || '',
    suggestions: ['Hoàn thành tốt buổi vấn đáp Google Meet, nắm vững quy trình SOP và nội quy cửa hàng'],
    onConfirm: async (note) => { await api.post(`/admin/employees/${employee.id}/meet-evaluation`, { probation_meet_done: true, note }); message.success(`Đã lưu kết quả vấn đáp Google Meet cho ${employee.fullName}`); invalidateAll(); },
  });

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 3 }}>
        <Descriptions.Item label="Giai đoạn nhân sự"><StatusTag value={employee.stage || 'PROBATION'} /></Descriptions.Item>
        <Descriptions.Item label="Điểm tín nhiệm chuyên cần"><Tag color={creditPts >= 95 ? 'success' : creditPts >= 80 ? 'warning' : 'error'} style={{ margin: 0, fontWeight: 600 }}>{creditPts}/100 điểm</Tag></Descriptions.Item>
        <Descriptions.Item label="Giờ công & Điểm TEST"><Space size={4}><Tag color="blue" style={{ margin: 0 }}>Công: {employee.probationHoursCompleted ?? 0}h</Tag><Tag color={employee.testPassed ? 'success' : 'default'} style={{ margin: 0 }}>TEST: {employee.testBestScorePercent ?? 0}%</Tag></Space></Descriptions.Item>
        <Descriptions.Item label="Đánh giá vấn đáp Google Meet"><Space size={4} wrap>{employee.probationMeetDone ? <Tag color="success" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>Đã hoàn tất vấn đáp</Tag> : <Tag color="default" style={{ margin: 0 }}>Chưa vấn đáp</Tag>}{employee.probationMeetNote && <span style={{ fontSize: 12, color: '#475569' }}>({employee.probationMeetNote})</span>}</Space></Descriptions.Item>
        <Descriptions.Item label="Quyền nghỉ đột xuất (Thử việc)"><Tag color="cyan" style={{ margin: 0 }}>Đã cấp: {employee.emergencyLeaveGrantCount ?? 0} lượt</Tag></Descriptions.Item>
        <Descriptions.Item label="Tổng số hợp đồng lưu trữ">
          <Space size={6} wrap>
            <Tag color={contracts.length > 0 ? 'geekblue' : 'default'} style={{ margin: 0, fontWeight: 600 }}>{contracts.length} văn bản</Tag>
            {contracts.length > 0 && <Button size="small" type="link" icon={<EyeOutlined />} style={{ padding: 0, height: 'auto' }} onClick={() => setPreviewState({ open: true, item: contracts[0]! })}>Xem hợp đồng</Button>}
          </Space>
        </Descriptions.Item>
      </Descriptions>

      {employee.stage === 'PROBATION' && canManage && (
        <Card size="small" title="Thao tác Đánh giá Thử việc & Cấp quyền Nghỉ đột xuất">
          <Space wrap>
            <Button size="small" type={employee.probationMeetDone ? 'default' : 'primary'} icon={employee.probationMeetDone ? <EditOutlined /> : <VideoCameraOutlined />} onClick={openMeetPrompt}>
              {employee.probationMeetDone ? 'Chỉnh sửa kết quả Vấn đáp Meet' : 'Ghi nhận kết quả Vấn đáp Meet'}
            </Button>
            <Button size="small" icon={<PlusCircleOutlined />} onClick={() => promptDecision({ title: `Cấp quyền nghỉ đột xuất: ${employee.fullName}`, subtitle: 'Cho phép nhân sự thử việc gửi 1 đơn xin nghỉ đột xuất hợp lệ trong chu kỳ thử việc.', required: false, noteLabel: 'Lý do cấp quyền nghỉ đột xuất', okText: 'Xác nhận cấp quyền', suggestions: ['Nhân sự có việc cá nhân/lịch học đột xuất đã báo trước với Quản lý'], onConfirm: async (note) => { await api.post(`/admin/employees/${employee.id}/grant-emergency-leave`, { grant_count: 1, note: note || 'HR cấp 1 lượt nghỉ đột xuất' }); message.success(`Đã cấp 1 lượt nghỉ đột xuất cho ${employee.fullName}`); invalidateAll(); } })}>
              Cấp 1 lượt nghỉ đột xuất
            </Button>
          </Space>
        </Card>
      )}

      <Card
        size="small" title={<span><FileProtectOutlined /> Danh sách Hợp đồng Lao động ({contracts.length})</span>}
        extra={canManage && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setUploadOpen(true)}>{contracts.length > 0 ? 'Tải thêm / Cập nhật tệp HĐ' : 'Tải lên hợp đồng'}</Button>}
      >
        {contracts.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có văn bản hợp đồng lao động nào được tải lên cho nhân sự này." />
        ) : (
          <Table<EmployeeContractItem>
            size="small" rowKey="id" pagination={false} dataSource={contracts}
            onRow={(r) => ({ onClick: () => setPreviewState({ open: true, item: r }), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'Loại hợp đồng', dataIndex: 'contractType', width: 195, render: (v: ContractType) => <Tag color={v === 'OFFICIAL_CONTRACT' ? 'green' : 'gold'} icon={<FileTextOutlined />} style={{ margin: 0 }}>{CONTRACT_TYPE_LABELS[v] || v}</Tag> },
              { title: 'Tên tệp hợp đồng', key: 'file', render: (_, r) => <div><Typography.Text strong>{r.fileName}</Typography.Text><div style={{ fontSize: 11, color: '#64748B' }}>Dung lượng: {fmtSizeKb(r.sizeBytes)}</div></div> },
              { title: 'Ghi chú / Số hợp đồng', dataIndex: 'note', ellipsis: true, render: (v: string) => v || '—' },
              { title: 'Ngày tải lên', dataIndex: 'uploadedAt', width: 140, render: (v: string) => <span className="num" style={{ fontSize: 12 }}>{v ? dayjs(v).format('HH:mm DD/MM/YYYY') : '—'}</span> },
              { title: 'Thao tác', key: 'act', width: canManage ? 130 : 90, align: 'right' as const, render: (_: unknown, r: EmployeeContractItem) => <Space size={4} onClick={(e) => e.stopPropagation()}><Button size="small" type="primary" ghost icon={<EyeOutlined />} onClick={() => setPreviewState({ open: true, item: r })}>Xem</Button>{canManage && <Popconfirm title="Xóa văn bản hợp đồng này?" okText="Xóa" cancelText="Hủy" onConfirm={() => deleteMut.mutate(r.id)}><Button size="small" danger icon={<DeleteOutlined />} loading={deleteMut.isPending} /></Popconfirm>}</Space> },
            ]}
          />
        )}
      </Card>

      <ContractPreviewModal open={previewState.open} employee={employee} contractItem={previewState.item} onClose={() => setPreviewState({ open: false, item: null })} />
      <ContractUploadModal open={uploadOpen} presetEmployee={employee} onClose={() => setUploadOpen(false)} />
      {decisionModalElement}
    </Space>
  );
}
