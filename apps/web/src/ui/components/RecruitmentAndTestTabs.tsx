'use client';

import { App, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Tabs } from 'antd';
import { BookOutlined, CalendarOutlined, CloseOutlined, SolutionOutlined, TeamOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { DateStringPicker, TimeSelect } from './DateTimePickers';
import { RecruitmentCandidatesPane } from './RecruitmentCandidatesPane';
import { RecruitmentInterviewsPane } from './RecruitmentInterviewsPane';
import { TestBankManagerPane } from './TestBankManagerPane';

interface Props {
  branches: { value: string; label: string }[];
  employees: { value: string; label: string }[];
  activeTab?: 'recruitment' | 'tests';
  onTabChange?: (tab: 'recruitment' | 'tests') => void;
}

const DEFAULT_INTERVIEWERS = [
  { value: 'u-hr-01', label: 'Nguyễn Thị Mai — Quản lý Nhân sự (HR)' },
  { value: 'u-store-01', label: 'Trần Quốc Bảo — Cửa hàng trưởng (CN Quận 1)' },
  { value: 'u-admin-01', label: 'Ban Giám đốc — Quản trị hệ thống (ADMIN)' },
];

export function RecruitmentAndTestTabs({ branches, employees, activeTab, onTabChange }: Props) {
  const qc = useQueryClient();
  const can = useCan();
  const { message } = App.useApp();
  const [recSubTab, setRecSubTab] = useState<'candidates' | 'interviews'>('candidates');
  const [ivModal, setIvModal] = useState(false);
  const [ivForm] = Form.useForm();

  const candQ = useQuery({ queryKey: ['candidates'], queryFn: () => api.list<Record<string, unknown>>('/admin/candidates?per_page=100') });
  const ivQ = useQuery({ queryKey: ['interviews'], queryFn: () => api.get<Record<string, unknown>[]>('/admin/interviews') });
  const testsQ = useQuery({ queryKey: ['tests-bank'], queryFn: () => api.get<{ tests: Record<string, unknown>[]; assignments: Record<string, unknown>[]; attempts: Record<string, unknown>[] }>('/admin/tests/bank') });

  const interviewerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of DEFAULT_INTERVIEWERS) map.set(d.value, d.label);
    for (const e of employees) if (!map.has(e.value)) map.set(e.value, e.label);
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [employees]);

  const refreshAll = () => ['candidates', 'interviews', 'tests-bank'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const postMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.post(url, body),
    onSuccess: () => { message.success('Đã đặt lịch phỏng vấn thành công'); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Đặt lịch phỏng vấn thất bại'),
  });

  const openScheduleForCandidate = (candidateId?: string) => {
    if (candidateId) ivForm.setFieldsValue({ candidate_id: candidateId });
    setIvModal(true);
  };

  const recruitmentPane = (
    <Tabs
      activeKey={recSubTab}
      onChange={(k) => setRecSubTab(k as 'candidates' | 'interviews')}
      items={[
        {
          key: 'candidates',
          label: <span><TeamOutlined /> Hồ sơ Ứng viên tuyển dụng ({candQ.data?.data?.length ?? 0})</span>,
          children: <RecruitmentCandidatesPane branches={branches} onScheduleInterview={(id) => openScheduleForCandidate(id)} />,
        },
        {
          key: 'interviews',
          label: <span><CalendarOutlined /> Lịch Phỏng vấn &amp; Google Meet ({ivQ.data?.length ?? 0})</span>,
          children: <RecruitmentInterviewsPane branches={branches} onOpenScheduleModal={() => openScheduleForCandidate()} />,
        },
      ]}
    />
  );

  const testsPane = <TestBankManagerPane tests={testsQ.data?.tests ?? []} assignments={testsQ.data?.assignments ?? []} attempts={testsQ.data?.attempts ?? []} employees={employees} canManage={can('test.manage')} />;

  return (
    <Card size="small">
      {activeTab ? (activeTab === 'tests' ? testsPane : recruitmentPane) : (
        <Tabs
          onChange={(k) => onTabChange?.(k as 'recruitment' | 'tests')}
          items={[
            { key: 'recruitment', label: <span><SolutionOutlined /> Tuyển dụng &amp; Phỏng vấn ({candQ.data?.data?.length ?? 0})</span>, children: recruitmentPane },
            { key: 'tests', label: <span><BookOutlined /> Ngân hàng Đề &amp; Thi TEST Nghiệp Vụ ({testsQ.data?.tests?.length ?? 0} đề)</span>, children: testsPane },
          ]}
        />
      )}

      <Modal width={680} open={ivModal} forceRender destroyOnHidden title="Đặt lịch phỏng vấn 30 phút & Google Meet" okText="Đặt lịch phỏng vấn" cancelText="Hủy bỏ" okButtonProps={{ icon: <CalendarOutlined />, loading: postMut.isPending }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={() => setIvModal(false)} onOk={() => ivForm.submit()}>
        <Form
          form={ivForm} layout="vertical" initialValues={{ interviewer_ids: ['u-hr-01'], interview_date: '2026-10-26', interview_slot: '09:30', duration_minutes: 30 }}
          onFinish={(v) => {
            postMut.mutate({ url: '/admin/interviews', body: { candidate_id: v.candidate_id, interviewer_ids: v.interviewer_ids, scheduled_at: `${v.interview_date}T${v.interview_slot}:00.000Z`, duration_minutes: Number(v.duration_minutes || 30), meet_link: v.meet_link } });
            setIvModal(false);
            setRecSubTab('interviews');
          }}
        >
          <Form.Item name="candidate_id" label="Ứng viên" rules={[{ required: true, message: 'Vui lòng chọn ứng viên' }]}><Select showSearch optionFilterProp="label" placeholder="Chọn ứng viên phỏng vấn" options={(candQ.data?.data ?? []).map((c) => ({ value: String(c.id), label: `${c.candidate_code} — ${c.full_name} (${c.phone})` }))} /></Form.Item>
          <Form.Item name="interviewer_ids" label="Người phỏng vấn (kiểm tra chống trùng lịch tự động)" rules={[{ required: true, message: 'Chọn ít nhất 1 người phỏng vấn' }]}><Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder="Chọn một hoặc nhiều người phỏng vấn" options={interviewerOptions} /></Form.Item>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="interview_date" label="Ngày phỏng vấn" rules={[{ required: true }]}><DateStringPicker /></Form.Item></Col>
            <Col span={8}><Form.Item name="interview_slot" label="Giờ bắt đầu" rules={[{ required: true }]}><TimeSelect placeholder="Chọn giờ bắt đầu" /></Form.Item></Col>
            <Col span={8}><Form.Item name="duration_minutes" label="Thời lượng chuẩn" rules={[{ required: true }]}><InputNumber min={5} max={240} step={5} style={{ width: '100%' }} suffix="phút" /></Form.Item></Col>
          </Row>
          <Form.Item name="meet_link" label="Link Google Meet / Calendar"><Input placeholder="https://meet.google.com/umb-milk-hr" /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
