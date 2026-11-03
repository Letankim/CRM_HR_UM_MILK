'use client';

import { Button, Col, Descriptions, Form, Input, InputNumber, Modal, Row, Select, Space, Switch, Table, Tabs, Tag, Typography, type FormInstance } from 'antd';
import { CloseOutlined, EditOutlined, HistoryOutlined, PlusOutlined, SaveOutlined, SettingOutlined, UnorderedListOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { StatusTag } from '../StatusTag';
import { useEmployeeSearchSelect } from '../hooks/useEmployeeSearchSelect';
import { BaseDetailDrawer } from './BaseDetailDrawer';
import { buildClickableRowProps } from './BulkActionBar';
import { DateStringPicker, TimeSelect } from './DateTimePickers';
import { AttemptHistoryTable } from './ExamTestCenter';
import { useQuickDetail } from './RecordQuickDetailModal';

export interface QuestionRow {
  id: string;
  q: string;
  options: string[];
  answer?: number;
}

export const DEFAULT_QUESTIONS: QuestionRow[] = [
  { id: 'q1', q: 'Nhiệt độ bảo quản sữa tươi thanh trùng chuẩn tại quầy là bao nhiêu?', options: ['Từ 2°C đến 6°C', 'Từ 10°C đến 15°C', 'Nhiệt độ phòng 25°C', 'Dưới -5°C'], answer: 0 },
  { id: 'q2', q: 'Quy định bắt buộc khi điểm danh vào ca trên Cổng Nhân Viên là gì?', options: ['Đứng trong bán kính GPS cửa hàng và chụp Camera trực tiếp', 'Tải ảnh từ thư viện điện thoại', 'Nhờ đồng nghiệp bấm hộ', 'Chỉ cần mở Wi-Fi ở nhà'], answer: 0 },
];

export function parseQuestions(raw: unknown): QuestionRow[] {
  try {
    const arr = JSON.parse(String(raw || '[]'));
    return Array.isArray(arr) && arr.length > 0 ? arr : DEFAULT_QUESTIONS;
  } catch {
    return DEFAULT_QUESTIONS;
  }
}

export function TestAssignmentFormModal({
  open, editing, form, loading, tests, employees, onClose, onSubmit,
}: {
  open: boolean; editing: Record<string, unknown> | null; form: FormInstance; loading?: boolean;
  tests: Record<string, unknown>[]; employees: { value: string; label: string }[];
  onClose: () => void; onSubmit: (values: Record<string, unknown>) => void;
}) {
  const empSelect = useEmployeeSearchSelect({ initialOptions: employees, enabled: open });
  const watchedTestId = Form.useWatch('test_id', form);
  const selectedTest = tests.find((t) => String(t.id) === String(watchedTestId)) ?? tests[0];
  const totalBankQuestions = Math.max(1, Number(selectedTest?.questionsCount ?? selectedTest?.total_questions ?? 25));
  const empOptions = editing?.employee_id && !empSelect.options.some((e) => e.value === String(editing.employee_id))
    ? [{ value: String(editing.employee_id), label: String(editing.employeeName || editing.employee_id) }, ...empSelect.options]
    : empSelect.options;

  return (
    <Modal
      width={820}
      style={{ maxWidth: 'calc(100vw - 24px)' }}
      open={open} forceRender
      title={editing ? `Chỉnh sửa Đợt giao bài — ${editing.assignment_code}` : 'Giao bài kiểm tra nghiệp vụ cho Nhân sự'}
      okText={editing ? 'Lưu cập nhật' : 'Giao bài kiểm tra'} cancelText="Hủy bỏ"
      okButtonProps={{ icon: editing ? <SaveOutlined /> : <PlusOutlined />, loading }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose} onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" initialValues={{ due_date: '2026-10-30', due_time: '17:00', max_attempts: 3, exam_sample_size: 25, reset_attempts: false }} onFinish={onSubmit}>
        <Form.Item name="test_id" label="Bộ đề kiểm tra" rules={[{ required: true, message: 'Vui lòng chọn bộ đề kiểm tra' }]}>
          <Select
            showSearch optionFilterProp="label" placeholder="Chọn bộ đề kiểm tra"
            onChange={(val) => {
              const found = tests.find((t) => String(t.id) === String(val));
              if (found) {
                if (!editing) form.setFieldValue('max_attempts', Number(found.max_attempts ?? 3));
                form.setFieldValue('exam_sample_size', Number(found.exam_sample_size ?? found.examSampleSize ?? found.questionsCount ?? 25));
              }
            }}
            options={tests.map((t) => ({ value: String(t.id), disabled: Boolean(t.status && t.status !== 'APPROVED'), label: `${t.code} — ${t.title} (Kho ${t.questionsCount ?? t.total_questions ?? 25} câu · Random ${t.exam_sample_size ?? t.examSampleSize ?? 25} câu · ${t.duration_minutes}p · Đạt ≥${t.pass_percent ?? 80}%)${t.status && t.status !== 'APPROVED' ? ' — Chưa phê duyệt' : ''}` }))}
          />
        </Form.Item>
        {editing ? (
          <Form.Item name="employee_id" label="Nhân sự nhận đề" rules={[{ required: true, message: 'Vui lòng chọn nhân sự' }]}>
            <Select showSearch placeholder="Tìm theo mã NV, họ tên, chi nhánh..." options={empOptions} loading={empSelect.loading} onSearch={empSelect.onSearch} filterOption={empSelect.filterOption} onDropdownVisibleChange={empSelect.onDropdownVisibleChange} />
          </Form.Item>
        ) : (
          <Form.Item name="employee_ids" label="Nhân sự nhận đề" rules={[{ required: true, message: 'Chọn ít nhất 1 nhân sự' }]}>
            <Select mode="multiple" allowClear showSearch placeholder="Tìm và chọn một hoặc nhiều nhân sự..." options={empOptions} loading={empSelect.loading} onSearch={empSelect.onSearch} filterOption={empSelect.filterOption} onDropdownVisibleChange={empSelect.onDropdownVisibleChange} />
          </Form.Item>
        )}
        <Row gutter={12}>
          <Col xs={12} sm={6}><Form.Item name="exam_sample_size" label={<span style={{ whiteSpace: 'nowrap' }}>Số câu Random / đề</span>} rules={[{ required: true, message: 'Nhập số câu' }]}><InputNumber min={1} max={totalBankQuestions} style={{ width: '100%' }} suffix={`/${totalBankQuestions} câu`} /></Form.Item></Col>
          <Col xs={12} sm={6}><Form.Item name="max_attempts" label={<span style={{ whiteSpace: 'nowrap' }}>Số lần thi tối đa</span>} rules={[{ required: true, message: 'Nhập số lần thi' }]}><InputNumber min={1} max={20} style={{ width: '100%' }} suffix="lần" /></Form.Item></Col>
          <Col xs={12} sm={6}><Form.Item name="due_date" label={<span style={{ whiteSpace: 'nowrap' }}>Ngày hạn nộp</span>} rules={[{ required: true, message: 'Chọn ngày hạn nộp' }]}><DateStringPicker /></Form.Item></Col>
          <Col xs={12} sm={6}><Form.Item name="due_time" label={<span style={{ whiteSpace: 'nowrap' }}>Giờ hạn nộp</span>} rules={[{ required: true, message: 'Chọn giờ hạn nộp' }]}><TimeSelect /></Form.Item></Col>
        </Row>
        {editing && (
          <Form.Item name="reset_attempts" label="Đặt lại số lượt đã thi về 0" valuePropName="checked">
            <Switch checkedChildren="Đặt lại về 0" unCheckedChildren="Giữ nguyên" />
          </Form.Item>
        )}
        <Form.Item name="note" label="Ghi chú hướng dẫn đợt thi">
          <Input.TextArea rows={2} placeholder="Ví dụ: Hoàn thành bài kiểm tra SOP trước khi vào ca chính thức..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function TestDetailDrawer({
  viewingTest, viewingAssignment, attempts = [], canManage,
  onCloseTest, onCloseAssignment, onEditTest, onEditAssignment, onViewAttempt, onDeleteAttempt,
}: {
  viewingTest: Record<string, unknown> | null;
  viewingAssignment: Record<string, unknown> | null;
  attempts?: Record<string, unknown>[];
  canManage?: boolean;
  onCloseTest: () => void;
  onCloseAssignment: () => void;
  onEditTest: (record: Record<string, unknown>) => void;
  onEditAssignment: (record: Record<string, unknown>) => void;
  onViewAttempt?: (attempt: Record<string, unknown>) => void;
  onDeleteAttempt?: (attempt: Record<string, unknown>) => void;
}) {
  const showDetail = useQuickDetail();
  const assignmentAttempts = viewingAssignment
    ? attempts.filter((att) => String(att.assignment_id) === String(viewingAssignment.id))
    : [];

  return (
    <>
      <BaseDetailDrawer
        open={Boolean(viewingTest)}
        title={viewingTest ? `Chi tiết Bộ đề: ${viewingTest.code} — ${viewingTest.title}` : 'Chi tiết bộ đề'}
        onClose={onCloseTest}
        extra={
          canManage && viewingTest ? (
            <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => { const t = viewingTest; onCloseTest(); onEditTest(t); }}>
              Chỉnh sửa bộ đề &amp; câu hỏi
            </Button>
          ) : null
        }
      >
        {viewingTest && (
          <Tabs
            items={[
              { key: 'info', label: <span><SettingOutlined /> Cấu hình Kỳ thi</span>, children: <Descriptions size="small" bordered column={2}><Descriptions.Item label="Mã bộ đề"><Tag color="geekblue">{String(viewingTest.code)}</Tag></Descriptions.Item><Descriptions.Item label="Tên bộ đề">{String(viewingTest.title)}</Descriptions.Item><Descriptions.Item label="Nhóm vị trí">{String(viewingTest.staffGroupLabel ?? viewingTest.staff_group)}</Descriptions.Item><Descriptions.Item label="Kho & Ra đề (Random)"><Space size={6}><Tag color="blue" style={{ margin: 0 }}>Tổng kho: {String(viewingTest.questionsCount ?? viewingTest.total_questions ?? 25)} câu</Tag><Tag color="purple" style={{ margin: 0 }}>Random mỗi đề: {String(viewingTest.examSampleSize ?? viewingTest.exam_sample_size ?? 25)} câu</Tag></Space></Descriptions.Item><Descriptions.Item label="Thời gian làm bài">{String(viewingTest.duration_minutes)} phút</Descriptions.Item><Descriptions.Item label="Điểm chuẩn đạt">{String(viewingTest.pass_percent)}%</Descriptions.Item><Descriptions.Item label="Số lần làm tối đa">{String(viewingTest.max_attempts ?? 3)} lần</Descriptions.Item></Descriptions> },
              {
                key: 'qlist',
                label: <span><UnorderedListOutlined /> Danh sách Câu hỏi ({parseQuestions(viewingTest.questions_json).length} câu)</span>,
                children: (
                  <Table<QuestionRow>
                    size="small" rowKey="id" pagination={false} scroll={{ x: 'max-content' }} dataSource={parseQuestions(viewingTest.questions_json)}
                    onRow={(r) => buildClickableRowProps(r, (item) => showDetail('testQuestion', item))}
                    columns={[
                      { title: 'STT', width: 70, render: (_, __, i) => `Câu ${i + 1}` },
                      { title: 'Nội dung câu hỏi', dataIndex: 'q' },
                      { title: 'Các phương án trắc nghiệm', render: (_, q: QuestionRow) => <Space wrap>{q.options.map((o, idx) => <Tag key={idx}>{String.fromCharCode(65 + idx)}. {o}</Tag>)}</Space> },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </BaseDetailDrawer>

      <BaseDetailDrawer
        open={Boolean(viewingAssignment)}
        title={viewingAssignment ? `Chi tiết Đợt giao bài & Lịch sử làm bài — ${viewingAssignment.assignment_code}` : 'Chi tiết đợt giao bài'}
        onClose={onCloseAssignment}
        extra={
          canManage && viewingAssignment ? (
            <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => { const a = viewingAssignment; onCloseAssignment(); onEditAssignment(a); }}>
              Chỉnh sửa hạn nộp &amp; số lần thi
            </Button>
          ) : null
        }
      >
        {viewingAssignment && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="Mã đợt giao bài"><Tag color="geekblue">{String(viewingAssignment.assignment_code)}</Tag></Descriptions.Item>
              <Descriptions.Item label="Trạng thái"><StatusTag value={String(viewingAssignment.status)} /></Descriptions.Item>
              <Descriptions.Item label="Nhân sự nhận đề"><strong>{String(viewingAssignment.employeeName)}</strong></Descriptions.Item>
              <Descriptions.Item label="Số lượt đã thi / Tối đa"><Tag color="blue">{String(viewingAssignment.attempts_used ?? 0)} / {String(viewingAssignment.max_attempts ?? 3)} lần</Tag></Descriptions.Item>
              <Descriptions.Item label="Bộ đề kiểm tra">{String(viewingAssignment.testTitle)}</Descriptions.Item>
              <Descriptions.Item label="Số câu hỏi ra đề (Random)"><Tag color="purple" style={{ margin: 0 }}>Random {String(viewingAssignment.examSampleSize ?? viewingAssignment.exam_sample_size ?? 25)} / {String(viewingAssignment.bankQuestionsCount ?? 120)} câu</Tag></Descriptions.Item>
              <Descriptions.Item label="Thời hạn nộp bài">{viewingAssignment.close_at ? dayjs(String(viewingAssignment.close_at)).format('HH:mm DD/MM/YYYY') : '—'}</Descriptions.Item>
              <Descriptions.Item label="Điểm cao nhất đạt được"><Tag color={Number(viewingAssignment.best_score_percent ?? 0) >= 80 ? 'green' : 'default'}>{String(viewingAssignment.best_score_percent ?? 0)}%</Tag></Descriptions.Item>
              <Descriptions.Item label="Ghi chú hướng dẫn" span={2}>{String(viewingAssignment.note || '—')}</Descriptions.Item>
            </Descriptions>

            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                <HistoryOutlined /> Lịch sử các lượt làm bài của đợt giao này ({assignmentAttempts.length} lượt):
              </Typography.Text>
              <AttemptHistoryTable
                attempts={assignmentAttempts}
                canDelete={canManage}
                onViewAttempt={(att) => onViewAttempt?.(att)}
                onDeleteAttempt={onDeleteAttempt}
              />
            </div>
          </Space>
        )}
      </BaseDetailDrawer>
    </>
  );
}
