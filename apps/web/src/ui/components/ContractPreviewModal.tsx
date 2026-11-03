'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Modal, Radio, Space, Spin, Tabs, Tag } from 'antd';
import { CloseOutlined, DownloadOutlined, EyeOutlined, FilePdfOutlined, FileProtectOutlined, PrinterOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { CONTRACT_TYPE_LABELS, type ContractType, type EmployeeContractItem } from '@umbm/shared';
import { api } from '@/lib/api';
import { fmtEmployeeSalary, type EmployeeRowItem } from './employee-table-columns';

interface ContractDetailResponse {
  contract: (EmployeeContractItem & { contractTypeLabel?: string }) | null;
  dataUrl: string | null;
  employee: EmployeeRowItem;
}

export function ContractPreviewModal({
  open,
  employee,
  contractItem = null,
  onClose,
}: {
  open: boolean;
  employee: EmployeeRowItem | null;
  contractItem?: EmployeeContractItem | null;
  onClose: () => void;
}) {
  const printRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<'electronic' | 'file'>('electronic');
  const [docType, setDocType] = useState<ContractType>('PROBATION_CONTRACT');

  const detailQ = useQuery({
    queryKey: ['employee-contract-detail', employee?.id, contractItem?.id || 'electronic'],
    enabled: open && Boolean(employee?.id),
    retry: false,
    queryFn: () => api.get<ContractDetailResponse>(`/admin/employees/${employee!.id}/contracts/${contractItem?.id || 'electronic'}`),
  });

  const fullEmp = detailQ.data?.employee ?? employee;
  const activeContract = contractItem ?? detailQ.data?.contract ?? null;
  const dataUrl = detailQ.data?.dataUrl ?? null;

  useEffect(() => {
    if (!open || !fullEmp) return;
    const defaultType: ContractType = activeContract?.contractType ?? (fullEmp.stage === 'OFFICIAL' ? 'OFFICIAL_CONTRACT' : 'PROBATION_CONTRACT');
    setDocType(defaultType);
    setActiveTab(contractItem ? 'file' : 'electronic');
  }, [open, fullEmp?.id, fullEmp?.stage, contractItem, activeContract?.contractType]);

  const handlePrintContract = () => {
    if (!printRef.current || !fullEmp) return;
    const win = window.open('', '_blank', 'width=920,height=780');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"/><title>${CONTRACT_TYPE_LABELS[docType]} - ${fullEmp.fullName}</title><style>body{font-family:"Times New Roman",serif;color:#0F172A;padding:28px 40px;line-height:1.6}table{width:100%;border-collapse:collapse;margin:10px 0}td,th{border:1px solid #CBD5E1;padding:6px 10px;text-align:left;font-size:13px}@media print{body{padding:12px 18px}}</style></head><body>${printRef.current.innerHTML}</body></html>`);
    win.document.close();
    win.focus();
    window.setTimeout(() => win.print(), 250);
  };

  const handleDownloadFile = () => {
    if (!dataUrl || !activeContract) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = activeContract.fileName || `${fullEmp?.employeeCode || 'NV'}_hop_dong.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const isOfficialDoc = docType === 'OFFICIAL_CONTRACT';
  const contractNo = `${fullEmp?.employeeCode || 'UBM'}/${ dayjs().format('YYYY')}/${isOfficialDoc ? 'HĐLĐ-UBM' : 'HĐTV-UBM'}`;
  const salaryText = fullEmp?.salaryRateType
    ? `${fmtEmployeeSalary(fullEmp, fullEmp.salaryOfficialAmountVnd)} (Thử việc hưởng ${fullEmp.salaryProbationPercent ?? 85}% mức chính thức)`
    : 'Theo quy chế bảng lương cá nhân tại Hệ thống Ụm Bò Milk';

  return (
    <Modal
      width="min(960px, 95vw)"
      style={{ top: 20 }}
      open={open}
      destroyOnHidden
      onCancel={onClose}
      title={
        fullEmp
          ? `Xem Hợp đồng Lao động: ${fullEmp.fullName} (${fullEmp.employeeCode})`
          : 'Xem Hợp đồng Lao động'
      }
      footer={
        <Space wrap>
          {activeContract && dataUrl && (
            <Button icon={<DownloadOutlined />} onClick={handleDownloadFile}>
              Tải xuống tệp gốc ({activeContract.fileName})
            </Button>
          )}
          <Button type="primary" icon={<PrinterOutlined />} onClick={handlePrintContract}>
            In / Xuất PDF Hợp đồng
          </Button>
          <Button icon={<CloseOutlined />} onClick={onClose}>
            Đóng
          </Button>
        </Space>
      }
    >
      <Spin spinning={detailQ.isLoading} tip="Đang tải dữ liệu hợp đồng...">
        {fullEmp && (
          <Tabs
            activeKey={activeTab}
            onChange={(k) => setActiveTab(k as 'electronic' | 'file')}
            items={[
              {
                key: 'electronic',
                label: <span><FileProtectOutlined /> Văn bản Hợp đồng Điện tử</span>,
                children: (
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '8px 12px' }}>
                      <Space size={8} wrap>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Chọn mẫu văn bản:</span>
                        <Radio.Group size="small" buttonStyle="solid" value={docType} onChange={(e) => setDocType(e.target.value as ContractType)}>
                          <Radio.Button value="PROBATION_CONTRACT">Hợp đồng Thử việc (12 ngày)</Radio.Button>
                          <Radio.Button value="OFFICIAL_CONTRACT">Hợp đồng Chính thức</Radio.Button>
                        </Radio.Group>
                      </Space>
                      <Tag color={isOfficialDoc ? 'green' : 'gold'} style={{ margin: 0, fontWeight: 600 }}>Số HĐ: {contractNo}</Tag>
                    </div>

                    <div ref={printRef} style={{ background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: 4, padding: '22px 28px', color: '#0F172A', lineHeight: 1.6, maxHeight: 520, overflowY: 'auto' }}>
                      <div style={{ textAlign: 'center', marginBottom: 16 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, textTransform: 'uppercase' }}>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
                        <div style={{ fontWeight: 600, fontSize: 13, textDecoration: 'underline', marginBottom: 10 }}>Độc lập - Tự do - Hạnh phúc</div>
                        <div style={{ fontWeight: 700, fontSize: 18, color: '#1E3A8A', textTransform: 'uppercase' }}>
                          {isOfficialDoc ? 'HỢP ĐỒNG LAO ĐỘNG CHÍNH THỨC' : 'HỢP ĐỒNG THỬ VIỆC NHÂN SỰ'}
                        </div>
                        <div style={{ fontSize: 12, color: '#475569' }}>Số: <b>{contractNo}</b> · Ngày lập: {dayjs().format('DD/MM/YYYY')}</div>
                      </div>

                      <div style={{ marginBottom: 12, fontSize: 13 }}>
                        <div><b>BÊN A (NGƯỜI SỬ DỤNG LAO ĐỘNG): HỆ THỐNG CỬA HÀNG ỤM BÒ MILK</b></div>
                        <div>Chi nhánh làm việc: <b>{fullEmp.branchName || 'Hệ thống Ụm Bò Milk'}</b> · Đại diện: Phòng Nhân sự &amp; Ban Quản lý Hệ thống</div>
                      </div>

                      <div style={{ marginBottom: 12, fontSize: 13 }}>
                        <div><b>BÊN B (NGƯỜI LAO ĐỘNG): {fullEmp.fullName.toUpperCase()}</b> · Mã nhân viên: <b>{fullEmp.employeeCode}</b></div>
                        <div>Số điện thoại: <b>{fullEmp.phone || '—'}</b> · Số CCCD: <b>{fullEmp.citizenId || 'Theo hồ sơ nhân sự'}</b> · Địa chỉ: {fullEmp.currentAddress || fullEmp.permanentAddress || 'Theo hồ sơ lưu trữ'}</div>
                      </div>

                      <Descriptions size="small" bordered column={2} style={{ marginBottom: 12 }}>
                        <Descriptions.Item label="Điều 1. Vị trí & Chức danh"><b>{fullEmp.staffGroupLabel}</b> ({fullEmp.positionTitle || fullEmp.employmentTypeLabel || 'Nhân viên'})</Descriptions.Item>
                        <Descriptions.Item label="Ca làm việc mặc định">{fullEmp.defaultShiftLabel || 'Theo lịch phân ca hàng tuần'}</Descriptions.Item>
                        <Descriptions.Item label="Điều 2. Thời hạn hợp đồng" span={2}>
                          {isOfficialDoc
                            ? <span>Hợp đồng lao động chính thức có hiệu lực từ ngày <b>{fullEmp.officialFrom || dayjs().format('YYYY-MM-DD')}</b>.</span>
                            : <span>Chu kỳ thử việc tiêu chuẩn <b>{fullEmp.probationCycleDays ?? 12} ngày</b> ({fullEmp.probationWorkDays ?? 7} ngày làm việc + {fullEmp.probationOffDays ?? 5} ngày nghỉ), từ ngày <b>{fullEmp.probationStart || '—'}</b> đến ngày <b>{fullEmp.probationEnd || '—'}</b>.</span>}
                        </Descriptions.Item>
                        <Descriptions.Item label="Điều 3. Tiền lương & Chế độ" span={2}>
                          Mức lương áp dụng: <b>{salaryText}</b>. Thanh toán qua tài khoản ngân hàng: <b>{fullEmp.bankName ? `${fullEmp.bankName} — ${fullEmp.bankAccountNumber || ''}` : 'Cập nhật tại Cổng Nhân viên'}</b>.
                        </Descriptions.Item>
                        <Descriptions.Item label="Điều 4. Nội quy & Chấm công" span={2}>
                          Nhân sự thực hiện điểm danh Vào ca / Ra ca bằng Camera trực tiếp và định vị GPS tại chi nhánh; tuân thủ quy chuẩn SOP pha chế, vệ sinh quầy, hoàn thành bài TEST nghiệp vụ (&gt;= 80%) và duy trì Điểm tín nhiệm chuyên cần.
                        </Descriptions.Item>
                      </Descriptions>

                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, padding: '0 24px', textAlign: 'center', fontSize: 13 }}>
                        <div>
                          <b>ĐẠI DIỆN BÊN A (ỤM BÒ MILK)</b>
                          <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>(Xác thực điện tử trên Hệ thống HR V5.1)</div>
                          <div style={{ marginTop: 36, fontWeight: 700, color: '#2563EB' }}>PHÒNG NHÂN SỰ ỤM BÒ MILK</div>
                        </div>
                        <div>
                          <b>NGƯỜI LAO ĐỘNG (BÊN B)</b>
                          <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>(Đã đọc, hiểu rõ và xác nhận thông tin)</div>
                          <div style={{ marginTop: 36, fontWeight: 700 }}>{fullEmp.fullName}</div>
                        </div>
                      </div>
                    </div>
                  </Space>
                ),
              },
              ...(activeContract ? [{
                key: 'file',
                label: <span><FilePdfOutlined /> Tệp Đính kèm Đã tải lên ({activeContract.fileName})</span>,
                children: (
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Descriptions size="small" bordered column={2}>
                      <Descriptions.Item label="Loại hợp đồng"><Tag color={activeContract.contractType === 'OFFICIAL_CONTRACT' ? 'green' : 'gold'}>{CONTRACT_TYPE_LABELS[activeContract.contractType] || activeContract.contractType}</Tag></Descriptions.Item>
                      <Descriptions.Item label="Tên tệp gốc"><b>{activeContract.fileName}</b></Descriptions.Item>
                      <Descriptions.Item label="Thời gian tải lên">{activeContract.uploadedAt ? dayjs(activeContract.uploadedAt).format('HH:mm DD/MM/YYYY') : '—'}</Descriptions.Item>
                      <Descriptions.Item label="Ghi chú / Số HĐ">{activeContract.note || '—'}</Descriptions.Item>
                    </Descriptions>
                    {dataUrl ? (
                      activeContract.mimeType?.startsWith('image/') ? (
                        <div style={{ textAlign: 'center', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: 12 }}>
                          <img src={dataUrl} alt={activeContract.fileName} style={{ maxWidth: '100%', maxHeight: 500, objectFit: 'contain' }} />
                        </div>
                      ) : (
                        <iframe src={dataUrl} title={activeContract.fileName} style={{ width: '100%', height: 500, border: '1px solid #E5E7EB', borderRadius: 4 }} />
                      )
                    ) : (
                      <Alert
                        type="info"
                        showIcon
                        icon={<EyeOutlined />}
                        message="Tệp đính kèm được lưu trữ trên kho hồ sơ; bạn có thể xem trực tiếp hoặc in văn bản đầy đủ tại tab Văn bản Hợp đồng Điện tử."
                      />
                    )}
                  </Space>
                ),
              }] : []),
            ]}
          />
        )}
      </Spin>
    </Modal>
  );
}
