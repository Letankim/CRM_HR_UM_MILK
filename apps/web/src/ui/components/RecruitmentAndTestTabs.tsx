'use client';

import { App, Card, Form, Tabs } from 'antd';
import { BookOutlined, CalendarOutlined, SolutionOutlined, TeamOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ROLE_LABELS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { useEmployeeSearchSelect } from '../hooks/useEmployeeSearchSelect';
import { InterviewCreateModal } from './InterviewScheduleModals';
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
  const { data: me } = useMe();
  const searchParams = useSearchParams();
  const { message } = App.useApp();
  const subParam = searchParams.get('sub');
  const [recSubTab, setRecSubTab] = useState<'candidates' | 'interviews'>(subParam === 'interviews' ? 'interviews' : 'candidates');
  const [ivModal, setIvModal] = useState(false);
  const [externalEditIv, setExternalEditIv] = useState<Record<string, unknown> | null>(null);
  const [ivForm] = Form.useForm();

  useEffect(() => {
    if (subParam === 'interviews' || subParam === 'candidates') {
      setRecSubTab(subParam);
    }
  }, [subParam]);

  const canViewRec = can('candidate.manage', 'interview.manage');
  const canViewTests = can('test.manage', 'employee.read', 'system.config');
  const isRecActive = !activeTab || activeTab === 'recruitment';
  const isTestsActive = !activeTab || activeTab === 'tests';
  const empSelect = useEmployeeSearchSelect({ initialOptions: employees, enabled: (canViewRec && ivModal) || (canViewTests && isTestsActive) });
  const candQ = useQuery({ queryKey: ['candidates'], queryFn: () => api.list<Record<string, unknown>>('/admin/candidates?per_page=100'), enabled: canViewRec && isRecActive });
  const ivQ = useQuery({ queryKey: ['interviews', 'all'], queryFn: () => api.get<Record<string, unknown>[]>('/admin/interviews?per_page=100'), enabled: canViewRec && isRecActive });
  const testsQ = useQuery({ queryKey: ['tests-bank'], queryFn: () => api.get<{ tests: Record<string, unknown>[]; assignments: Record<string, unknown>[]; attempts: Record<string, unknown>[] }>('/admin/tests/bank'), enabled: canViewTests && isTestsActive });
  const recipientsQ = useQuery({ queryKey: ['notifications', 'recipients'], queryFn: () => api.get<{ id: string; username: string; displayName: string; roleLabel: string }[]>('/notifications/recipients'), enabled: canViewRec && isRecActive });

  const interviewerOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (me?.user) {
      map.set(me.user.id, `${me.user.displayName} (@${me.user.username}) — ${ROLE_LABELS[me.user.role]} (Bạn)`);
    }
    for (const u of recipientsQ.data ?? []) {
      if (!map.has(u.id)) map.set(u.id, `${u.displayName} (@${u.username}) — ${u.roleLabel}`);
    }
    if (map.size === 0) {
      for (const d of DEFAULT_INTERVIEWERS) map.set(d.value, d.label);
    }
    for (const e of empSelect.options) if (!map.has(e.value)) map.set(e.value, e.label);
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [me?.user, recipientsQ.data, empSelect.options]);

  const allInterviews = ivQ.data ?? [];
  const scheduledCandidateIds = useMemo(() => {
    const s = new Set<string>();
    for (const iv of allInterviews) {
      if (iv.status !== 'CANCELLED') {
        s.add(String(iv.candidate_id));
        if (iv.candidateCode) s.add(String(iv.candidateCode));
      }
    }
    return s;
  }, [allInterviews]);

  const refreshAll = () => ['candidates', 'interviews', 'tests-bank', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const postMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.post(url, body),
    onSuccess: () => {
      message.success('Đã đặt lịch phỏng vấn thành công');
      setIvModal(false);
      setRecSubTab('interviews');
      refreshAll();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Đặt lịch phỏng vấn thất bại'),
  });

  const openScheduleForCandidate = (candidateId?: string) => {
    if (candidateId) {
      const existingIv = allInterviews.find((iv) => (String(iv.candidate_id) === candidateId || String(iv.candidateCode) === candidateId) && iv.status !== 'CANCELLED');
      if (existingIv) {
        setRecSubTab('interviews');
        setExternalEditIv(existingIv);
        return;
      }
    }
    const nextSlot = getNextFutureInterviewSlot();
    const defaultInterviewer = me?.user.id ?? interviewerOptions[0]?.value ?? 'hr';
    const availableCandidates = (candQ.data?.data ?? []).filter((c) => !scheduledCandidateIds.has(String(c.id)) && !scheduledCandidateIds.has(String(c.candidate_code)));
    ivForm.resetFields();
    ivForm.setFieldsValue({
      candidate_id: candidateId || (availableCandidates[0] ? String(availableCandidates[0].id) : undefined),
      interviewer_ids: [defaultInterviewer],
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
          children: <RecruitmentCandidatesPane branches={branches} scheduledCandidateIds={scheduledCandidateIds} onScheduleInterview={(id) => openScheduleForCandidate(id)} />,
        },
        {
          key: 'interviews',
          label: <span><CalendarOutlined /> Lịch Phỏng vấn &amp; Google Meet ({allInterviews.length})</span>,
          children: (
            <RecruitmentInterviewsPane
              branches={branches}
              interviewerOptions={interviewerOptions}
              allInterviews={allInterviews}
              externalEditTarget={externalEditIv}
              onClearExternalEdit={() => setExternalEditIv(null)}
              onOpenScheduleModal={() => openScheduleForCandidate()}
            />
          ),
        },
      ]}
    />
  );

  const testsPane = <TestBankManagerPane tests={testsQ.data?.tests ?? []} assignments={testsQ.data?.assignments ?? []} attempts={testsQ.data?.attempts ?? []} employees={empSelect.options} canManage={can('test.manage')} />;

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

      <InterviewCreateModal
        open={ivModal}
        form={ivForm}
        candidates={candQ.data?.data ?? []}
        scheduledCandidateIds={scheduledCandidateIds}
        interviewerOptions={interviewerOptions}
        existingInterviews={allInterviews}
        loading={postMut.isPending}
        onCancel={() => setIvModal(false)}
        onSubmit={(payload) => postMut.mutate({ url: '/admin/interviews', body: payload })}
      />
    </Card>
  );
}
