'use client';

import { App, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Tabs } from 'antd';
import { BookOutlined, CalendarOutlined, CloseOutlined, SolutionOutlined, TeamOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
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
  { value: 'hr', label: 'Nguyễn Thị Nhân Sự (@hr) — Quản lý Nhân sự' },
  { value: 'store1', label: 'Trần Văn Cửa Hàng (@store1) — Quản lý cửa hàng' },
  { value: 'admin', label: 'Quản trị hệ thống (@admin) — Quản trị viên' },
];

function getNextFutureInterviewSlot(): { date: string; slot: string } {
  const now = dayjs();
  const totalMin = now.hour() * 60 + now.minute();
  const nextSlotMin = Math.ceil((totalMin + 5) / 30) * 30;
  if (nextSlotMin > 21 * 60 + 30) {
    return { date: now.add(1, 'day').format('YYYY-MM-DD'), slot: '09:30' };
  }
  const clampedMin = Math.max(9 * 60, nextSlotMin);
  const hh = String(Math.floor(clampedMin / 60)).padStart(2, '0');
  const mm = String(clampedMin % 60).padStart(2, '0');
  return { date: now.format('YYYY-MM-DD'), slot: `${hh}:${mm}` };
}

export function RecruitmentAndTestTabs({ branches, employees, activeTab, onTabChange }: Props) {
  const qc = useQueryClient();
  const can = useCan();
  const searchParams = useSearchParams();
  const { message } = App.useApp();
  const subParam = searchParams.get('sub');
  const [recSubTab, setRecSubTab] = useState<'candidates' | 'interviews'>(subParam === 'interviews' ? 'interviews' : 'candidates');
  const [ivModal, setIvModal] = useState(false);

  useEffect(() => {
    if (subParam === 'interviews' || subParam === 'candidates') {
      setRecSubTab(subParam);
    }
  }, [subParam]);
  const [ivForm] = Form.useForm();
  const selectedDate = Form.useWatch('interview_date', ivForm);
  const todayStr = dayjs().format('YYYY-MM-DD');
  const nowTimeStr = dayjs().format('HH:mm');

  const candQ = useQuery({ queryKey: ['candidates'], queryFn: () => api.list<Record<string, unknown>>('/admin/candidates?per_page=100') });
  const ivQ = useQuery({ queryKey: ['interviews'], queryFn: () => api.get<Record<string, unknown>[]>('/admin/interviews') });
  const testsQ = useQuery({ queryKey: ['tests-bank'], queryFn: () => api.get<{ tests: Record<string, unknown>[]; assignments: Record<string, unknown>[]; attempts: Record<string, unknown>[] }>('/admin/tests/bank') });
  const recipientsQ = useQuery({
    queryKey: ['notification-recipients'],
    queryFn: () => api.get<{ id: string; username: string; displayName: string; roleLabel: string }[]>('/notifications/recipients'),
  });

  const interviewerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of recipientsQ.data ?? []) {
      map.set(u.id, `${u.displayName} (@${u.username}) — ${u.roleLabel}`);
    }
    if (map.size === 0) {
      for (const d of DEFAULT_INTERVIEWERS) map.set(d.value, d.label);
    }
    for (const e of employees) if (!map.has(e.value)) map.set(e.value, e.label);
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [recipientsQ.data, employees]);

  const refreshAll = () => ['candidates', 'interviews', 'tests-bank', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const postMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.post(url, body),
    onSuccess: () => {
      message.success('Đã đặt lịch phỏng vấn và gửi thông báo tới tất cả người tham gia phỏng vấn');
      refreshAll();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Đặt lịch phỏng vấn thất bại'),
  });

  const openScheduleForCandidate = (candidateId?: string) => {
    const nextSlot = getNextFutureInterviewSlot();
    const defaultInterviewer = interviewerOptions[0]?.value ?? 'hr';
    ivForm.setFieldsValue({
      ...(candidateId ? { candidate_id: candidateId } : {}),
      interviewer_ids: ivForm.getFieldValue('interviewer_ids')?.length ? ivForm.getFieldValue('interviewer_ids') : [defaultInterviewer],
      interview_date: nextSlot.date,
      interview_slot: nextSlot.slot,
      duration_minutes: 30,
    });
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

      <Modal width={680} open={ivModal} forceRender destroyOnHidden title="Đặt lịch phỏng vấn & Google Meet" okText="Đặt lịch phỏng vấn" cancelText="Hủy bỏ" okButtonProps={{ icon: <CalendarOutlined />, loading: postMut.isPending }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={() => setIvModal(false)} onOk={() => ivForm.submit()}>
        <Form
          form={ivForm}
          layout="vertical"
          onFinish={(v) => {
            postMut.mutate({ url: '/admin/interviews', body: { candidate_id: v.candidate_id, interviewer_ids: v.interviewer_ids, scheduled_at: `${v.interview_date}T${v.interview_slot}:00+07:00`, duration_minutes: Number(v.duration_minutes || 30), meet_link: v.meet_link } });
            setIvModal(false);
            setRecSubTab('interviews');
          }}
        >
          <Form.Item name="candidate_id" label="Ứng viên" rules={[{ required: true, message: 'Vui lòng chọn ứng viên' }]}><Select showSearch optionFilterProp="label" placeholder="Chọn ứng viên phỏng vấn" options={(candQ.data?.data ?? []).map((c) => ({ value: String(c.id), label: `${c.candidate_code} — ${c.full_name} (${c.phone})` }))} /></Form.Item>
          <Form.Item name="interviewer_ids" label="Người tham gia phỏng vấn (tự động nhận thông báo lịch phỏng vấn)" rules={[{ required: true, message: 'Chọn ít nhất 1 người phỏng vấn' }]}><Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder="Chọn một hoặc nhiều người phỏng vấn" options={interviewerOptions} /></Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                name="interview_date"
                label="Ngày phỏng vấn"
                rules={[
                  { required: true, message: 'Vui lòng chọn ngày phỏng vấn' },
                  {
                    validator: async (_, val) => {
                      if (val && String(val) < dayjs().format('YYYY-MM-DD')) throw new Error('Không được chọn ngày trong quá khứ');
                    },
                  },
                ]}
              >
                <DateStringPicker minDate={todayStr} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="interview_slot"
                label="Giờ bắt đầu"
                dependencies={['interview_date']}
                rules={[
                  { required: true, message: 'Vui lòng chọn giờ bắt đầu' },
                  ({ getFieldValue }) => ({
                    validator: async (_, val) => {
                      const d = getFieldValue('interview_date');
                      if (d && val && `${d} ${val}` < dayjs().format('YYYY-MM-DD HH:mm')) {
                        throw new Error('Không được chọn thời gian trong quá khứ');
                      }
                    },
                  }),
                ]}
              >
                <TimeSelect placeholder="Chọn giờ bắt đầu" minTime={selectedDate === todayStr ? nowTimeStr : undefined} />
              </Form.Item>
            </Col>
            <Col span={8}><Form.Item name="duration_minutes" label="Thời lượng" rules={[{ required: true }]}><InputNumber min={5} max={240} step={5} style={{ width: '100%' }} suffix="phút" /></Form.Item></Col>
          </Row>
          <Form.Item name="meet_link" label="Link Google Meet / Calendar"><Input placeholder="https://meet.google.com/umb-milk-hr" /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
