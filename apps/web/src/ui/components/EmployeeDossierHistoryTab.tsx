'use client';

import { Alert, Card, Col, Descriptions, Empty, Form, Input, Modal, Row, Space, Table, Tag } from 'antd';
import { CheckCircleOutlined, CloseOutlined, RiseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { StatusTag } from '../StatusTag';
import { DateStringPicker } from './DateTimePickers';
import type { EmployeeRowItem } from './employee-table-columns';

export function EmployeeDossierHistoryTab({ employee }: { employee: EmployeeRowItem }) {
  const historyRows = employee.stageHistory ?? [];
  const shiftRows = employee.recentShifts ?? [];

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
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={historyRows}
            columns={[
              { title: 'Từ giai đoạn', dataIndex: 'fromStage', width: 130, render: (v: string) => <StatusTag value={v} /> },
              { title: 'Sang giai đoạn', dataIndex: 'toStage', width: 140, render: (v: string) => <StatusTag value={v} /> },
              { title: 'Ngày hiệu lực', dataIndex: 'effectiveFrom', width: 120, render: (v: string) => <span className="num" style={{ fontWeight: 600 }}>{v}</span> },
              { title: 'Giờ thử việc / Điểm TEST', key: 'metrics', width: 170, render: (_, r) => <span className="num">{r.probationHoursCompleted}h · TEST {r.testScorePercent}%</span> },
              { title: 'Đánh giá & Lý do quyết định', dataIndex: 'evaluationSummary' },
              { title: 'Người duyệt', dataIndex: 'decidedBy', width: 110 },
            ]}
          />
        )}
      </Card>

      <Card size="small" title={`Lịch phân ca gần nhất của nhân sự (${shiftRows.length})`}>
        {shiftRows.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có ca làm việc nào được phân công" />
        ) : (
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={shiftRows}
            columns={[
              { title: 'Ngày làm việc', dataIndex: 'work_date', width: 120, render: (v: string) => <span className="num" style={{ fontWeight: 600 }}>{v}</span> },
              { title: 'Khung ca', dataIndex: 'shiftLabel' },
              { title: 'Giờ ca', key: 'time', width: 140, render: (_, r) => <span className="num">{r.start_at} - {r.end_at} ({r.scheduled_hours}h)</span> },
              { title: 'Trạng thái ca', dataIndex: 'status', width: 140, render: (v: string) => <StatusTag value={v} /> },
            ]}
          />
        )}
      </Card>
    </Space>
  );
}

export function PromoteOfficialModal({
  employee,
  loading,
  onClose,
  onConfirm,
}: {
  employee: EmployeeRowItem | null;
  loading: boolean;
  onClose: () => void;
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
    <Modal
      width={620}
      open={Boolean(employee)}
      destroyOnHidden
      title={employee ? `Xét duyệt Chuyển Chính thức: ${employee.fullName} (${employee.employeeCode})` : 'Chuyển Chính thức'}
      okText="Xác nhận Chuyển Chính thức"
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: <RiseOutlined />, loading }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      {employee && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            icon={<CheckCircleOutlined />}
            message="Quy tắc bảo toàn lịch sử khi chuyển chính thức (HR-06)"
            description={`Giữ nguyên Mã nhân sự (${employee.employeeCode}) và không xóa mốc thử việc gốc (${employee.probationStart || '—'} đến ${employee.probationEnd || '—'}). Hệ thống sẽ ghi nhận ngày hiệu lực chính thức (official_from) và lưu vết vào bảng Lịch sử giai đoạn (EMPLOYEE_STAGE_HISTORY).`}
          />
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="Công thử việc tích lũy"><span className="num" style={{ fontWeight: 600 }}>{employee.totalShiftsCount ?? 0} ca ({employee.probationHoursCompleted ?? 0} giờ)</span></Descriptions.Item>
            <Descriptions.Item label="Điểm bài TEST nghiệp vụ"><Tag color={employee.testPassed ? 'success' : 'processing'} className="num">{employee.testBestScorePercent ?? 0}% ({employee.testPassed ? 'Đạt' : 'Chưa đạt / Đang thi'})</Tag></Descriptions.Item>
            <Descriptions.Item label="Chi nhánh & Vị trí" span={2}>{employee.branchName} · {employee.staffGroupLabel}</Descriptions.Item>
          </Descriptions>
          <Form form={form} layout="vertical" onFinish={(v) => onConfirm(v)}>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="official_from" label="Ngày hiệu lực Chính thức (effective_from)" rules={[{ required: true, message: 'Vui lòng chọn ngày hiệu lực chính thức' }]}>
                  <DateStringPicker />
                </Form.Item>
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
