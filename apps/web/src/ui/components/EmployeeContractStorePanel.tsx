'use client';

import { useRef, useState } from 'react';
import { Alert, App, Button, Card, Empty, Flex, Input, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloudUploadOutlined, DeleteOutlined, FileProtectOutlined, PlusCircleOutlined, SafetyCertificateOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { CONTRACT_MAX_SIZE_BYTES, CONTRACT_TYPE_LABELS, verifyContractMagicBytes, type ContractType, type EmployeeContractItem } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import type { EmployeeRowItem } from './employee-table-columns';

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

export function EmployeeContractStorePanel({ employee, canManage = false }: { employee: EmployeeRowItem; canManage?: boolean }) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [contractType, setContractType] = useState<ContractType>(employee.stage === 'OFFICIAL' ? 'OFFICIAL_CONTRACT' : 'PROBATION_CONTRACT');
  const [note, setNote] = useState('');
  const [meetNote, setMeetNote] = useState('');

  const contractsQ = useQuery({
    queryKey: ['employee-contracts', employee.id],
    queryFn: async () => {
      const res = await api.get<{ contracts?: EmployeeContractItem[] } | EmployeeContractItem[]>(`/admin/employees/${employee.id}/contracts`);
      return Array.isArray(res) ? res : (res?.contracts ?? []);
    },
    retry: false,
  });

  const fallbackContracts = ((employee as unknown as { contracts?: EmployeeContractItem[] }).contracts ?? []);
  const contracts = contractsQ.data ?? fallbackContracts;
  const invalidateAll = () => ['employee-contracts', 'employees'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));

  const uploadMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post(`/admin/employees/${employee.id}/contracts`, payload),
    onSuccess: () => {
      message.success('Đã xác thực chữ ký Magic Bytes và lưu trữ kép Hợp đồng lao động (Drive + Local)');
      setNote('');
      invalidateAll();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Tải lên hợp đồng thất bại'),
  });

  const deleteMut = useMutation({
    mutationFn: (contractId: string) => api.delete(`/admin/employees/${employee.id}/contracts/${contractId}`),
    onSuccess: () => {
      message.success('Đã xóa tệp hợp đồng khỏi hồ sơ nhân sự');
      invalidateAll();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể xóa hợp đồng'),
  });

  const grantLeaveMut = useMutation({
    mutationFn: () => api.post(`/admin/employees/${employee.id}/grant-emergency-leave`, { note: 'HR cấp thêm 1 lượt nghỉ đột xuất trong chu kỳ thử việc' }),
    onSuccess: () => {
      message.success(`Đã cấp thêm 1 lượt nghỉ đột xuất cho nhân sự ${employee.fullName}`);
      invalidateAll();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Cấp lượt nghỉ đột xuất thất bại'),
  });

  const meetEvalMut = useMutation({
    mutationFn: () => api.post(`/admin/employees/${employee.id}/meet-evaluation`, { passed: true, probation_meet_done: true, note: meetNote.trim() || 'Hoàn tất buổi vấn đáp đánh giá thử việc qua Google Meet' }),
    onSuccess: () => {
      message.success(`Đã xác nhận hoàn tất Vấn đáp Google Meet cho ${employee.fullName}`);
      setMeetNote('');
      invalidateAll();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xác nhận vấn đáp Meet thất bại'),
  });

  const handleSelectFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > CONTRACT_MAX_SIZE_BYTES) {
      message.error('Dung lượng tệp hợp đồng vượt quá giới hạn tối đa 6MB');
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const check = verifyContractMagicBytes(new Uint8Array(buf), file.name);
      if (!check.valid) {
        message.error(check.message);
        return;
      }
      const dataUrl = await readFileAsDataUrl(file);
      uploadMut.mutate({ contract_type: contractType, file_name: file.name, mime_type: check.detectedMime || file.type, size_bytes: file.size, file_base64: dataUrl, note: note.trim() });
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Không thể xử lý tệp hợp đồng');
    }
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {employee.stage === 'PROBATION' && canManage && (
        <Card size="small" title={<span><VideoCameraOutlined /> Đặc quyền HR cho Nhân viên Thử việc (Nghỉ đột xuất &amp; Vấn đáp Meet)</span>}>
          <Flex justify="space-between" align="center" wrap gap={10}>
            <Space size={8} wrap>
              <Button icon={<PlusCircleOutlined />} loading={grantLeaveMut.isPending} onClick={() => grantLeaveMut.mutate()}>Cấp 1 lượt nghỉ đột xuất</Button>
              <Input placeholder="Ghi chú kết quả vấn đáp Google Meet..." value={meetNote} onChange={(e) => setMeetNote(e.target.value)} style={{ width: 260 }} />
              <Button type="primary" icon={<CheckCircleOutlined />} loading={meetEvalMut.isPending} onClick={() => meetEvalMut.mutate()}>Xác nhận hoàn tất Vấn đáp Meet</Button>
            </Space>
          </Flex>
        </Card>
      )}

      <Card
        size="small"
        title={<span><FileProtectOutlined /> Kho Hợp đồng Lao động Điện tử ({contracts.length})</span>}
        extra={<Tag color="blue" icon={<SafetyCertificateOutlined />} style={{ margin: 0 }}>Magic Bytes &amp; Lưu trữ kép Drive + Local (Tối đa 6MB)</Tag>}
      >
        {canManage && (
          <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: 10, marginBottom: 12 }}>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" style={{ display: 'none' }} onChange={(e) => void handleSelectFile(e)} />
            <Flex gap={8} wrap align="center">
              <Select value={contractType} onChange={setContractType} style={{ width: 230 }} options={Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
              <Input placeholder="Ghi chú số hợp đồng / thời hạn..." value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <Button type="primary" icon={<CloudUploadOutlined />} loading={uploadMut.isPending} onClick={() => fileRef.current?.click()}>Tải lên Hợp đồng (PDF/Ảnh/Word &lt;= 6MB)</Button>
            </Flex>
          </div>
        )}

        {contracts.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có Hợp đồng Thử việc hoặc Hợp đồng Lao động Chính thức nào được lưu trữ." />
        ) : (
          <Table<EmployeeContractItem>
            size="small" rowKey="id" pagination={false} dataSource={contracts}
            columns={[
              { title: 'Loại hợp đồng', dataIndex: 'contractType', width: 210, render: (v: ContractType) => <Tag color={v === 'OFFICIAL_CONTRACT' ? 'green' : 'gold'}>{CONTRACT_TYPE_LABELS[v] || v}</Tag> },
              { title: 'Tên tệp & Định dạng', key: 'file', render: (_, r) => <div><Typography.Text strong>{r.fileName}</Typography.Text><div style={{ fontSize: 11, color: '#64748B' }}>{r.mimeType} · {fmtSizeKb(r.sizeBytes)}</div></div> },
              { title: 'Lưu trữ kép', key: 'storage', width: 170, render: (_, r) => <Space size={4} wrap><Tag color="blue" style={{ margin: 0 }}>Drive: {r.driveFileId ? 'Đã đồng bộ' : 'Local'}</Tag><Tag color="cyan" style={{ margin: 0 }}>Backup</Tag></Space> },
              { title: 'Ngày tải lên', dataIndex: 'uploadedAt', width: 135, render: (v: string) => <span className="num" style={{ fontSize: 12 }}>{v ? dayjs(v).format('HH:mm DD/MM/YYYY') : '—'}</span> },
              ...(canManage ? [{
                title: 'Xóa', key: 'del', width: 70, align: 'right' as const,
                render: (_: unknown, r: EmployeeContractItem) => (
                  <Popconfirm title="Xóa hợp đồng này khỏi hồ sơ?" okText="Xóa" cancelText="Hủy" onConfirm={() => deleteMut.mutate(r.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} loading={deleteMut.isPending} />
                  </Popconfirm>
                ),
              }] : []),
            ]}
          />
        )}
        <Alert type="info" showIcon style={{ marginTop: 10 }} message="Hệ thống kiểm tra chữ ký số đầu tệp (Magic Bytes) cho PDF, JPG, PNG, WEBP, DOC, DOCX và tự động sao lưu song song trên Google Drive & đĩa cục bộ." />
      </Card>
    </Space>
  );
}
