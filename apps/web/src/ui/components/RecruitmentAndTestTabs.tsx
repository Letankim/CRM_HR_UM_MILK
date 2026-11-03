'use client';

import { App, Button, Card, Form, Tabs } from 'antd';
import { BookOutlined, CalendarOutlined, MessageOutlined, SolutionOutlined, TeamOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ROLE_LABELS } from '@umbm/shared';
import { api } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { applyApiFormErrors } from '@/lib/form-error';
import { useEmployeeSearchSelect } from '../hooks/useEmployeeSearchSelect';
import { InterviewCreateModal } from './InterviewScheduleModals';
import { RecruitmentCandidatesPane } from './RecruitmentCandidatesPane';
import { RecruitmentInterviewsPane } from './RecruitmentInterviewsPane';
import { TestBankManagerPane } from './TestBankManagerPane';
import { ZaloCandidateNotifyModal, type ZaloNotifyTarget } from './ZaloCandidateNotifyModal';
import { ZaloHrAccountsModal, type ZaloHrAccountItem } from './ZaloHrAccountsModal';

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
  const nextSlotMin = Math.ceil(((now.hour() * 60 + now.minute()) + 5) / 30) * 30;
  if (nextSlotMin > 21 * 60 + 30) return { date: now.add(1, 'day').format('YYYY-MM-DD'), slot: '09:30' };
  const clampedMin = Math.max(9 * 60, nextSlotMin);
  return { date: now.format('YYYY-MM-DD'), slot: `${String(Math.floor(clampedMin / 60)).padStart(2, '0')}:${String(clampedMin % 60).padStart(2, '0')}` };
}

export function RecruitmentAndTestTabs({ branches, employees, activeTab, onTabChange }: Props) {
  const qc = useQueryClient(), can = useCan(), { data: me } = useMe(), searchParams = useSearchParams(), { message } = App.useApp();
  const subParam = searchParams.get('sub');
  const [recSubTab, setRecSubTab] = useState<'candidates' | 'interviews'>(subParam === 'interviews' ? 'interviews' : 'candidates');
  const [ivModal, setIvModal] = useState(false), [externalEditIv, setExternalEditIv] = useState<Record<string, unknown> | null>(null);
  const [zaloConfigOpen, setZaloConfigOpen] = useState(false), [zaloNotifyTarget, setZaloNotifyTarget] = useState<ZaloNotifyTarget | null>(null);
  const [ivForm] = Form.useForm();

  useEffect(() => { if (subParam === 'interviews' || subParam === 'candidates') setRecSubTab(subParam); }, [subParam]);

  const canViewRec = can('candidate.manage', 'interview.manage');
  const canViewTests = can('test.manage', 'employee.read', 'system.config');
  const isRecActive = !activeTab || activeTab === 'recruitment';
  const isTestsActive = !activeTab || activeTab === 'tests';
  const empSelect = useEmployeeSearchSelect({ initialOptions: employees, enabled: (canViewRec && ivModal) || (canViewTests && isTestsActive) });
  const candQ = useQuery({ queryKey: ['candidates'], queryFn: () => api.list<Record<string, unknown>>('/admin/candidates?per_page=100'), enabled: canViewRec && isRecActive });
  const ivQ = useQuery({ queryKey: ['interviews', 'all'], queryFn: () => api.get<Record<string, unknown>[]>('/admin/interviews?per_page=100'), enabled: canViewRec && isRecActive });
  const zaloQ = useQuery({
    queryKey: ['recruitment-zalo-accounts'],
    queryFn: () => api.get<{ items: ZaloHrAccountItem[]; default_templates: { greeting: string; invite: string; reminder: string; pass: string } }>('/admin/recruitment/zalo-accounts'),
    enabled: canViewRec && isRecActive,
  });
  const testsQ = useQuery({ queryKey: ['tests-bank'], queryFn: () => api.get<{ tests: Record<string, unknown>[]; assignments: Record<string, unknown>[]; attempts: Record<string, unknown>[] }>('/admin/tests/bank'), enabled: canViewTests && isTestsActive });
  const recipientsQ = useQuery({ queryKey: ['notifications', 'recipients'], queryFn: () => api.get<{ id: string; username: string; displayName: string; roleLabel: string }[]>('/notifications/recipients'), enabled: canViewRec && isRecActive });

  const interviewerOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (me?.user) map.set(me.user.id, `${me.user.displayName} (@${me.user.username}) — ${ROLE_LABELS[me.user.role]} (Bạn)`);
    for (const u of recipientsQ.data ?? []) if (!map.has(u.id)) map.set(u.id, `${u.displayName} (@${u.username}) — ${u.roleLabel}`);
    if (map.size === 0) for (const d of DEFAULT_INTERVIEWERS) map.set(d.value, d.label);
    for (const e of empSelect.options) if (!map.has(e.value)) map.set(e.value, e.label);
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [me?.user, recipientsQ.data, empSelect.options]);

  const allInterviews = ivQ.data ?? [];
  const zaloAccounts = zaloQ.data?.items ?? [];
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

  const refreshAll = () => ['candidates', 'interviews', 'tests-bank', 'notifications', 'recruitment-zalo-accounts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const postMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.post(url, body),
    onSuccess: () => {
      message.success('Đã đặt lịch phỏng vấn thành công');
      setIvModal(false); setRecSubTab('interviews'); refreshAll();
    },
    onError: (e) => message.error(applyApiFormErrors(ivForm, e, { fallbackMessage: 'Đặt lịch phỏng vấn thất bại' })),
  });

  const openScheduleForCandidate = (candidateId?: string) => {
    if (candidateId) {
      const existingIv = allInterviews.find((iv) => (String(iv.candidate_id) === candidateId || String(iv.candidateCode) === candidateId) && iv.status !== 'CANCELLED');
      if (existingIv) { setRecSubTab('interviews'); setExternalEditIv(existingIv); return; }
    }
    const nextSlot = getNextFutureInterviewSlot();
    const defaultInterviewer = me?.user.id ?? interviewerOptions[0]?.value ?? 'hr';
    const availableCandidates = (candQ.data?.data ?? []).filter((c) => !scheduledCandidateIds.has(String(c.id)) && !scheduledCandidateIds.has(String(c.candidate_code)));
    const firstCand = candidateId ? (candQ.data?.data ?? []).find((c) => String(c.id) === candidateId) : availableCandidates[0];
    ivForm.resetFields();
    ivForm.setFieldsValue({
      candidate_id: candidateId || (firstCand ? String(firstCand.id) : undefined),
      interviewer_ids: [defaultInterviewer],
      interview_date: nextSlot.date,
      interview_slot: nextSlot.slot,
      duration_minutes: 30,
      zalo_account_id: String(firstCand?.zalo_account_id || zaloAccounts[0]?.id || ''),
      candidate_zalo_id: String(firstCand?.candidate_zalo_id || firstCand?.phone || ''),
    });
    setIvModal(true);
  };

  const openZaloForCandidate = (c: Record<string, unknown>) => {
    const linkedIv = allInterviews.find((iv) => (String(iv.candidate_id) === String(c.id) || String(iv.candidateCode) === String(c.candidate_code)) && iv.status !== 'CANCELLED');
    const isConf = Boolean(linkedIv?.candidate_confirmed);
    setZaloNotifyTarget({
      candidateId: String(c.id), interviewId: linkedIv ? String(linkedIv.id) : undefined,
      candidateName: String(c.full_name || 'Ứng viên'), candidateCode: String(c.candidate_code || ''),
      candidatePhone: String(c.phone || ''), candidateZaloId: String(c.candidate_zalo_id || c.phone || ''),
      zaloAccountId: String(c.zalo_account_id || linkedIv?.zalo_account_id || ''),
      positionLabel: String(c.positionLabel || c.position || ''), branchName: String(c.branchName || ''),
      interviewTime: linkedIv ? String(linkedIv.scheduled_at || linkedIv.start_at || '').slice(0, 16).replace('T', ' ') : undefined,
      interviewStartAt: linkedIv ? String(linkedIv.start_at || linkedIv.scheduled_at || '') : undefined,
      meetLink: linkedIv ? String(linkedIv.meet_link || '') : undefined,
      rsvpUrl: linkedIv ? String(linkedIv.rsvpUrl || '') : undefined,
      candidateConfirmed: isConf,
      defaultTemplateType: c.status === 'HIRED' ? 'PASS' : linkedIv ? (isConf ? 'REMINDER' : 'INVITE') : 'GREETING',
    });
  };

  const openZaloForInterview = (iv: Record<string, unknown>) => {
    const isConf = Boolean(iv.candidate_confirmed);
    setZaloNotifyTarget({
      candidateId: String(iv.candidate_id || ''), interviewId: String(iv.id),
      candidateName: String(iv.candidateName || 'Ứng viên'), candidateCode: String(iv.candidateCode || ''),
      candidatePhone: String(iv.candidatePhone || ''), candidateZaloId: String(iv.candidate_zalo_id || iv.candidatePhone || ''),
      zaloAccountId: String(iv.zalo_account_id || ''), positionLabel: String(iv.positionLabel || ''),
      branchName: String(iv.branchName || ''), interviewTime: String(iv.scheduled_at || iv.start_at || '').slice(0, 16).replace('T', ' '),
      interviewStartAt: String(iv.start_at || iv.scheduled_at || ''),
      meetLink: String(iv.meet_link || ''), rsvpUrl: String(iv.rsvpUrl || ''),
      candidateConfirmed: isConf,
      defaultTemplateType: iv.decision === 'PASS' ? 'PASS' : isConf ? 'REMINDER' : 'INVITE',
    });
  };

  const recruitmentPane = (
    <Tabs
      activeKey={recSubTab} onChange={(k) => setRecSubTab(k as 'candidates' | 'interviews')}
      tabBarExtraContent={canViewRec ? <Button size="small" icon={<MessageOutlined style={{ color: '#2563EB' }} />} onClick={() => setZaloConfigOpen(true)}>Tài khoản Zalo HR ({zaloAccounts.length})</Button> : null}
      items={[
        {
          key: 'candidates',
          label: <span><TeamOutlined /> Hồ sơ Ứng viên tuyển dụng ({candQ.data?.data?.length ?? 0})</span>,
          children: <RecruitmentCandidatesPane branches={branches} scheduledCandidateIds={scheduledCandidateIds} onScheduleInterview={(id) => openScheduleForCandidate(id)} onOpenZaloNotify={openZaloForCandidate} />,
        },
        {
          key: 'interviews',
          label: <span><CalendarOutlined /> Lịch Phỏng vấn &amp; Google Meet ({allInterviews.length})</span>,
          children: (
            <RecruitmentInterviewsPane
              branches={branches} interviewerOptions={interviewerOptions} zaloAccounts={zaloAccounts}
              allInterviews={allInterviews} externalEditTarget={externalEditIv}
              onClearExternalEdit={() => setExternalEditIv(null)} onOpenScheduleModal={() => openScheduleForCandidate()}
              onOpenZaloNotify={openZaloForInterview}
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
        open={ivModal} form={ivForm} candidates={candQ.data?.data ?? []} scheduledCandidateIds={scheduledCandidateIds}
        interviewerOptions={interviewerOptions} zaloAccounts={zaloAccounts} existingInterviews={allInterviews}
        loading={postMut.isPending} onCancel={() => setIvModal(false)}
        onSubmit={(payload) => postMut.mutate({ url: '/admin/interviews', body: payload })}
      />
      <ZaloHrAccountsModal
        open={zaloConfigOpen} accounts={zaloAccounts} defaultTemplates={zaloQ.data?.default_templates}
        userOptions={interviewerOptions} currentUserId={me?.user.id} onClose={() => setZaloConfigOpen(false)}
      />
      <ZaloCandidateNotifyModal
        target={zaloNotifyTarget} accounts={zaloAccounts} currentUserId={me?.user.id}
        onClose={() => setZaloNotifyTarget(null)}
        onOpenAccountsConfig={() => { setZaloNotifyTarget(null); setZaloConfigOpen(true); }}
        onRescheduleInterview={(ivId, candId) => {
          setZaloNotifyTarget(null);
          const found = ivId ? allInterviews.find((x) => String(x.id) === ivId) : undefined;
          if (found) { setRecSubTab('interviews'); setExternalEditIv(found); } else openScheduleForCandidate(candId);
        }}
      />
    </Card>
  );
}
