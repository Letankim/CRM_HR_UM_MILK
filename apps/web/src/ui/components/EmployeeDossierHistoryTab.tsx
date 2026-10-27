'use client';

import { Alert, Button, Card, Col, Descriptions, Empty, Form, Input, Modal, Row, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { CheckCircleOutlined, CloseOutlined, EyeOutlined, RiseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useClientPagination } from '../hooks/useClientPagination';
import { StatusTag } from '../StatusTag';
import { DateStringPicker } from './DateTimePickers';
import type { EmployeeRowItem } from './employee-table-columns';

type StageHistoryItem = NonNullable<EmployeeRowItem['stageHistory']>[number];
type RecentShiftItem = NonNullable<EmployeeRowItem['recentShifts']>[number];

export function EmployeeDossierHistoryTab({ employee }: { employee: EmployeeRowItem }) {
  const historyRows = employee.stageHistory ?? [];
  const shiftRows = employee.recentShifts ?? [];
  const histPag = useClientPagination(10, 'lần chuyển');
  const shiftPag = useClientPagination(10, 'ca');
  const [viewingStage, setViewingStage] = useState<StageHistoryItem | null>(null);
  const [viewingShift, setViewingShift] = useState<RecentShiftItem | null>(null);

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Descriptions title="Tổng hợp Công thử việc, Kết quả TEST & Đơn từ liên quan" column={{ xs: 1, sm: 2 }} bordered size="small">
        <Descriptions.Item label="Tổng ca làm việc đã xếp">
          <span className="num" style={{ fontWeight: 600 }}>{employee.totalShiftsCount ?? 0} ca ({employee.probationHoursCompleted ?? 0} giờ)</span>
        </Descriptions.Item>
        <Descriptions.Item label="Kết quả bài thi TEST nghiệp vụ">
          <Space size={6}>
            <Tag color={employee.testPassed ? 'success' : (employee.testAssignedCount ?? 0) > 0 ? 'processing' : 'default'}>
              {employee.testPassed ? 'ĐẠT TEST NGHIỆP VỤ' : (employee.testAssignedCount ?? 0) > 0 ? 'ĐANG THI / CHỜ KẾT QUẢ' : 'Chưa giao bài thi'}
            </Tag>
            <span className="num" style={{ fontWeight: 600 }}>{employee.testBestScorePercent ?? 0}%</span>
            <span style={{ fontSize: 12, color: '#64748B' }}>({employee.testAttemptsCount ?? 0} lượt nộp)</span>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="Thời gian thử việc gốc (giữ nguyên lịch sử)">
          <span className="num">{employee.probationStart || '—'} đến {employee.probationEnd || '—'} ({employee.probationCycleDays} ngày)</span>
        </Descriptions.Item>
        <Descriptions.Item label="Đơn từ liên quan (Nghỉ OFF / Đổi ca)">
          <span className="num">{employee.leaveRequestsCount ?? 0} đơn nghỉ OFF · {employee.swapRequestsCount ?? 0} yêu cầu đổi ca</span>
        </Descriptions.Item>
      </Descriptions>

      <Card size="small" title={`Lịch sử chuyển giai đoạn & Thay đổi hiệu lực (${historyRows.length})`}>
        {historyRows.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa phát sinh lịch sử chuyển giai đoạn (nhân sự đang ở giai đoạn khởi tạo ban đầu)" />
        ) : (
          <Table<StageHistoryItem>
            size="small"
            rowKey="id"
            scroll={{ x: 920 }}
            pagination={histPag}
            dataSource={historyRows}
            columns={[
              { title: 'Chuyển đổi giai đoạn', key: 'transition', width: 225, render: (_, r) => <Space size={6} wrap><StatusTag value={r.fromStage} /><span style={{ color: '#94A3B8', fontWeight: 600 }}>→</span><StatusTag value={r.toStage} /></Space> },
              { title: 'Ngày hiệu lực', dataIndex: 'effectiveFrom', width: 115, render: (v: string) => <span className="num" style={{ fontWeight: 600 }}>{v}</span> },
              { title: 'Giờ thử việc / Điểm TEST', key: 'metrics', width: 165, render: (_, r) => <Space size={4} wrap><Tag color="blue" className="num" style={{ margin: 0, borderRadius: 2 }}>{r.probationHoursCompleted}h</Tag><Tag color={r.testScorePercent >= 80 ? 'green' : 'gold'} className="num" style={{ margin: 0, borderRadius: 2 }}>TEST {r.testScorePercent}%</Tag></Space> },
              {
                title: 'Đánh giá & Lý do quyết định',
                dataIndex: 'evaluationSummary',
                ellipsis: { showTitle: false },
                render: (v: string) => (
                  <Tooltip title={v || '—'}>
                    <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0, fontSize: 13, minWidth: 200 }}>{v || '—'}</Typography.Paragraph>
                  </Tooltip>
                ),
              },
              {
                title: 'Người duyệt',
                key: 'decidedBy',
                width: 175,
                render: (_, r) => (
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#0F172A' }}>{r.decidedBy || 'Phòng Nhân sự'}</div>
                    {(r.decidedByRoleLabel || r.decidedBySub) && <div style={{ fontSize: 11, color: '#64748B' }}>{[r.decidedByRoleLabel, r.decidedBySub].filter(Boolean).join(' · ')}</div>}
                  </div>
                ),
              },
              { title: 'Thao tác', key: 'action', width: 95, align: 'right', render: (_, r) => <Button size="small" icon={<EyeOutlined />} onClick={() => setViewingStage(r)}>Chi tiết</Button> },
            ]}
          />
        )}
      </Card>

      <Card size="small" title={`Lịch phân ca gần nhất của nhân sự (${shiftRows.length})`}>
        {shiftRows.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có ca làm việc nào được phân công" />
        ) : (
          <Table<RecentShiftItem>
            size="small"
            rowKey="id"
            scroll={{ x: 760 }}
            pagination={shiftPag}
            dataSource={shiftRows}
            columns={[
              { title: 'Ngày làm việc', dataIndex: 'work_date', width: 115, render: (v: string) => <span className="num" style={{ fontWeight: 600 }}>{v}</span> },
              { title: 'Khung ca & Chi nhánh', key: 'shift', render: (_, r) => <div><div style={{ fontWeight: 600, fontSize: 13 }}>{r.shiftLabel}</div>{r.branchName && <div style={{ fontSize: 11, color: '#64748B' }}>{r.branchName}</div>}</div> },
              { title: 'Giờ ca', key: 'time', width: 145, render: (_, r) => <span className="num">{r.start_at} - {r.end_at} ({r.scheduled_hours}h)</span> },
              { title: 'Trạng thái ca', dataIndex: 'status', width: 140, render: (v: string) => <StatusTag value={v} /> },
              { title: 'Người xếp ca', dataIndex: 'assignedByName', width: 145, render: (v?: string) => <span style={{ fontSize: 12, color: '#475569' }}>{v || 'Quản lý ca'}</span> },
              { title: 'Thao tác', key: 'action', width: 95, align: 'right', render: (_, r) => <Button size="small" icon={<EyeOutlined />} onClick={() => setViewingShift(r)}>Chi tiết</Button> },
            ]}
          />
        )}
      </Card>

      <Modal open={Boolean(viewingStage)} title="Chi tiết Quyết định Chuyển đổi Giai đoạn Nhân sự" onCancel={() => setViewingStage(null)} footer={<Button icon={<CloseOutlined />} onClick={() => setViewingStage(null)}>Đóng</Button>} width={640} destroyOnHidden>
        {viewingStage && (
          <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Nhân sự" span={2}><strong>{employee.fullName}</strong> ({employee.employeeCode})</Descriptions.Item>
            <Descriptions.Item label="Giai đoạn trước"><StatusTag value={viewingStage.fromStage} /></Descriptions.Item>
            <Descriptions.Item label="Giai đoạn chuyển sang"><StatusTag value={viewingStage.toStage} /></Descriptions.Item>
            <Descriptions.Item label="Ngày hiệu lực áp dụng"><span className="num" style={{ fontWeight: 600 }}>{viewingStage.effectiveFrom}</span></Descriptions.Item>
            <Descriptions.Item label="Thời điểm ghi nhận"><span className="num">{viewingStage.createdAt ? dayjs(viewingStage.createdAt).format('HH:mm DD/MM/YYYY') : viewingStage.effectiveFrom}</span></Descriptions.Item>
            <Descriptions.Item label="Công thử việc tích lũy"><span className="num" style={{ fontWeight: 600 }}>{viewingStage.probationHoursCompleted} giờ</span></Descriptions.Item>
            <Descriptions.Item label="Điểm bài thi TEST"><Tag color={viewingStage.testScorePercent >= 80 ? 'success' : 'processing'} className="num">{viewingStage.testScorePercent}%</Tag></Descriptions.Item>
            <Descriptions.Item label="Chi nhánh & Khung ca" span={2}>{(viewingStage.toBranchName || employee.branchName)} · {(viewingStage.toShiftLabel || employee.defaultShiftLabel)}</Descriptions.Item>
            <Descriptions.Item label="Người phê duyệt quyết định" span={2}>
              <strong>{viewingStage.decidedBy || 'Phòng Nhân sự'}</strong>{viewingStage.decidedByRoleLabel ? ` (${viewingStage.decidedByRoleLabel})` : ''}{viewingStage.decidedBySub ? ` · ${viewingStage.decidedBySub}` : ''}
            </Descriptions.Item>
            <Descriptions.Item label="Đánh giá & Lý do quyết định" span={2}>{viewingStage.evaluationSummary || '—'}</Descriptions.Item>
            {viewingStage.note && viewingStage.note !== viewingStage.evaluationSummary && <Descriptions.Item label="Ghi chú bổ sung" span={2}>{viewingStage.note}</Descriptions.Item>}
          </Descriptions>
        )}
      </Modal>

      <Modal open={Boolean(viewingShift)} title="Chi tiết Ca làm việc của Nhân sự" onCancel={() => setViewingShift(null)} footer={<Button icon={<CloseOutlined />} onClick={() => setViewingShift(null)}>Đóng</Button>} width={560} destroyOnHidden>
        {viewingShift && (
          <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Nhân sự" span={2}><strong>{employee.fullName}</strong> ({employee.employeeCode})</Descriptions.Item>
            <Descriptions.Item label="Ngày làm việc"><span className="num" style={{ fontWeight: 600 }}>{viewingShift.work_date}</span></Descriptions.Item>
            <Descriptions.Item label="Trạng thái ca"><StatusTag value={viewingShift.status} /></Descriptions.Item>
            <Descriptions.Item label="Chi nhánh làm việc" span={2}>{viewingShift.branchName || employee.branchName}</Descriptions.Item>
            <Descriptions.Item label="Khung ca phân công">{viewingShift.shiftLabel}</Descriptions.Item>
            <Descriptions.Item label="Thời lượng ca"><span className="num">{viewingShift.start_at} - {viewingShift.end_at} ({viewingShift.scheduled_hours} giờ)</span></Descriptions.Item>
            <Descriptions.Item label="Người xếp ca" span={2}>{viewingShift.assignedByName || 'Quản lý ca'}{viewingShift.assignedByRoleLabel ? ` (${viewingShift.assignedByRoleLabel})` : ''}</Descriptions.Item>
            <Descriptions.Item label="Ghi chú ca làm việc" span={2}>{viewingShift.note || 'Không có ghi chú bổ sung'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </Space>
  );
}

export function PromoteOfficialModal({
  employee, loading, onClose, onConfirm,
}: {
  employee: EmployeeRowItem | null; loading: boolean; onClose: () => void;
  onConfirm: (payload: { official_from: string; evaluation_summary: string }) => void;
}) {
  const [form] = Form.useForm();
  useEffect(() => {
    if (employee) {
      form.setFieldsValue({
        official_from: dayjs().format('YYYY-MM-DD'),
        evaluation_summary: `Hoàn thành chu kỳ thử việc (${employee.probationHoursCompleted ?? 0}h công, điểm TEST ${employee.testBestScorePercent ?? 0}%), đạt yêu cầu chuyển sang Nhân viên chính thức.`,
      });
    }
  }, [employee, form]);

  return (
    <Modal width={620} open={Boolean(employee)} destroyOnHidden title={employee ? `Xét duyệt Chuyển Chính thức: ${employee.fullName} (${employee.employeeCode})` : 'Chuyển Chính thức'} okText="Xác nhận Chuyển Chính thức" cancelText="Hủy bỏ" okButtonProps={{ icon: <RiseOutlined />, loading }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={onClose} onOk={() => form.submit()}>
      {employee && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert type="info" showIcon icon={<CheckCircleOutlined />} message="Quy tắc bảo toàn lịch sử khi chuyển chính thức" description={`Giữ nguyên Mã nhân sự (${employee.employeeCode}) và không xóa mốc thử việc gốc (${employee.probationStart || '—'} đến ${employee.probationEnd || '—'}). Hệ thống sẽ ghi nhận ngày hiệu lực chính thức và lưu vào lịch sử chuyển giai đoạn của nhân sự.`} />
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="Công thử việc tích lũy"><span className="num" style={{ fontWeight: 600 }}>{employee.totalShiftsCount ?? 0} ca ({employee.probationHoursCompleted ?? 0} giờ)</span></Descriptions.Item>
            <Descriptions.Item label="Điểm bài TEST nghiệp vụ"><Tag color={employee.testPassed ? 'success' : 'processing'} className="num">{employee.testBestScorePercent ?? 0}% ({employee.testPassed ? 'Đạt' : 'Chưa đạt / Đang thi'})</Tag></Descriptions.Item>
            <Descriptions.Item label="Chi nhánh & Vị trí" span={2}>{employee.branchName} · {employee.staffGroupLabel}</Descriptions.Item>
          </Descriptions>
          <Form form={form} layout="vertical" onFinish={(v) => onConfirm(v)}>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="official_from" label="Ngày hiệu lực Chính thức" rules={[{ required: true, message: 'Vui lòng chọn ngày hiệu lực chính thức' }]}><DateStringPicker /></Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item name="evaluation_summary" label="Đánh giá của HR & Điều kiện phê duyệt" rules={[{ required: true, message: 'Vui lòng nhập nhận xét đánh giá chuyển chính thức' }]}>
                  <Input.TextArea rows={3} placeholder="Nhập đánh giá kết quả thử việc, tác phong, điểm TEST và quyết định của HR..." />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Space>
      )}
    </Modal>
  );
}
