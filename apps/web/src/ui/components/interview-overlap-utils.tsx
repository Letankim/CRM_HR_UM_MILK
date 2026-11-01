'use client';

import { Alert, Tag } from 'antd';
import { ExclamationCircleOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

export interface ClientInterviewOverlapItem {
  id: string;
  candidateName: string;
  candidateCode: string;
  startHm: string;
  endHm: string;
  durationMinutes: number;
  interviewerLabel: string;
  sharesInterviewer: boolean;
}

function parseInterviewLocalWindow(rawStartAt: unknown, rawDuration: unknown): { dateStr: string; startMin: number; endMin: number; startHm: string; endHm: string; durationMinutes: number } | null {
  const s = String(rawStartAt || '').trim();
  if (!s) return null;
  const d = dayjs(s);
  if (!d.isValid()) return null;
  const dateStr = d.format('YYYY-MM-DD');
  const startMin = d.hour() * 60 + d.minute();
  const dur = Math.max(5, Number(rawDuration) || 30);
  const endMin = startMin + dur;
  const eh = String(Math.floor((endMin % 1440) / 60)).padStart(2, '0');
  const em = String(endMin % 60).padStart(2, '0');
  return { dateStr, startMin, endMin, startHm: d.format('HH:mm'), endHm: `${eh}:${em}`, durationMinutes: dur };
}

function extractTokens(ids: string[], interviewerOptions: { value: string; label: string }[]): Set<string> {
  const set = new Set<string>();
  for (const raw of ids) {
    const clean = raw.trim().toLowerCase();
    if (!clean) continue;
    set.add(clean);
    const opt = interviewerOptions.find((o) => o.value.toLowerCase() === clean);
    const usernameMatch = opt?.label.match(/\(@([^)]+)\)/);
    if (usernameMatch?.[1]) set.add(usernameMatch[1].toLowerCase());
  }
  return set;
}

/**
 * Kiểm tra tức thì trên giao diện ngay khi HR chọn ngày / giờ bắt đầu / thời lượng / người phỏng vấn:
 * phát hiện mọi lịch phỏng vấn đang mở có khoảng thời gian giao nhau [startA, endA) ∩ [startB, endB).
 */
export function detectClientInterviewOverlaps(params: {
  existingInterviews: Record<string, unknown>[];
  dateStr?: string;
  slotHm?: string;
  durationMinutes?: number;
  interviewerIds?: string[];
  interviewerOptions?: { value: string; label: string }[];
  excludeInterviewId?: string;
}): { interviewerConflicts: ClientInterviewOverlapItem[]; slotOverlaps: ClientInterviewOverlapItem[]; rangeLabel: string } {
  const { existingInterviews, dateStr, slotHm, durationMinutes = 30, interviewerIds = [], interviewerOptions = [], excludeInterviewId } = params;
  if (!dateStr || !slotHm || !/^\d{2}:\d{2}$/.test(slotHm)) {
    return { interviewerConflicts: [], slotOverlaps: [], rangeLabel: '' };
  }
  const [hh, mm] = slotHm.split(':').map(Number);
  const startMin = (hh ?? 0) * 60 + (mm ?? 0);
  const dur = Math.max(5, Number(durationMinutes) || 30);
  const endMin = startMin + dur;
  const endHm = `${String(Math.floor((endMin % 1440) / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  const rangeLabel = `${slotHm} – ${endHm}`;

  const selectedTokens = extractTokens(interviewerIds, interviewerOptions);
  const interviewerConflicts: ClientInterviewOverlapItem[] = [];
  const slotOverlaps: ClientInterviewOverlapItem[] = [];

  for (const iv of existingInterviews) {
    const id = String(iv.id || '');
    const status = String(iv.status || '');
    if (id === excludeInterviewId || status === 'CANCELLED' || status === 'COMPLETED') continue;
    const exWin = parseInterviewLocalWindow(iv.scheduled_at || iv.start_at, iv.duration_minutes);
    if (!exWin || exWin.dateStr !== dateStr) continue;
    if (!(startMin < exWin.endMin && endMin > exWin.startMin)) continue;

    const rawIvTokens = String(iv.interviewer_id || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const userIdTokens = Array.isArray(iv.interviewerUserIds) ? iv.interviewerUserIds.map((u) => String(u).toLowerCase()) : [];
    const allExTokens = new Set([...rawIvTokens, ...userIdTokens]);
    const sharesInterviewer = Array.from(selectedTokens).some((t) => allExTokens.has(t));

    const item: ClientInterviewOverlapItem = {
      id,
      candidateName: String(iv.candidateName || iv.candidate_id || 'Ứng viên'),
      candidateCode: String(iv.candidateCode || ''),
      startHm: exWin.startHm,
      endHm: exWin.endHm,
      durationMinutes: exWin.durationMinutes,
      interviewerLabel: String(iv.interviewerLabel || iv.interviewer_id || 'Hội đồng phỏng vấn'),
      sharesInterviewer,
    };
    if (sharesInterviewer) interviewerConflicts.push(item);
    else slotOverlaps.push(item);
  }

  return { interviewerConflicts, slotOverlaps, rangeLabel };
}

export function InterviewOverlapAlert({
  interviewerConflicts,
  slotOverlaps,
  rangeLabel,
  dateStr,
}: {
  interviewerConflicts: ClientInterviewOverlapItem[];
  slotOverlaps: ClientInterviewOverlapItem[];
  rangeLabel: string;
  dateStr?: string;
}) {
  const all = [...interviewerConflicts, ...slotOverlaps];
  if (all.length === 0) return null;
  const hasHardConflict = interviewerConflicts.length > 0;
  const dateVi = dateStr ? dayjs(dateStr).format('DD/MM/YYYY') : '';

  return (
    <Alert
      style={{ marginBottom: 12 }}
      type={hasHardConflict ? 'error' : 'warning'}
      showIcon
      icon={hasHardConflict ? <ExclamationCircleOutlined /> : <WarningOutlined />}
      message={
        hasHardConflict
          ? `Trùng lịch người phỏng vấn trong khung giờ ${rangeLabel} ngày ${dateVi}!`
          : `Cảnh báo giao thoa khung giờ phỏng vấn (${rangeLabel} ngày ${dateVi})`
      }
      description={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          {all.map((item) => (
            <div key={item.id} style={{ fontSize: 13 }}>
              <Tag color={item.sharesInterviewer ? 'red' : 'orange'} style={{ marginRight: 6 }}>
                {item.startHm} – {item.endHm} ({item.durationMinutes}p)
              </Tag>
              <strong>{item.candidateName}{item.candidateCode ? ` (${item.candidateCode})` : ''}</strong>
              <span style={{ color: '#475569' }}> — Hội đồng: {item.interviewerLabel}</span>
            </div>
          ))}
          <div style={{ fontSize: 12, color: hasHardConflict ? '#DC2626' : '#B45309', fontWeight: 500, marginTop: 2 }}>
            {hasHardConflict
              ? 'Vui lòng đổi giờ bắt đầu, thời lượng hoặc chọn người phỏng vấn khác để tránh trùng lịch hội đồng.'
              : 'Khung giờ này đang diễn ra song song với cuộc phỏng vấn trên — vui lòng kiểm tra lại phòng họp và nhân sự tham gia.'}
          </div>
        </div>
      }
    />
  );
}
