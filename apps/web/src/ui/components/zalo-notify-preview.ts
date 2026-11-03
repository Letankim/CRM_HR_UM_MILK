import dayjs from 'dayjs';
import { SYSTEM_CONFIG } from '@umbm/shared';
import type { ZaloHrAccountItem } from './zalo-accounts-types';

export interface ZaloNotifyTarget {
  candidateId?: string;
  interviewId?: string;
  candidateName: string;
  candidateCode?: string;
  candidatePhone: string;
  candidateZaloId?: string;
  zaloAccountId?: string;
  positionLabel?: string;
  branchName?: string;
  interviewTime?: string;
  interviewStartAt?: string;
  meetLink?: string;
  rsvpUrl?: string;
  candidateConfirmed?: boolean;
  defaultTemplateType?: 'GREETING' | 'INVITE' | 'REMINDER' | 'PASS';
}

export function normalizeClientRsvpUrl(rawUrl?: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  if (!rawUrl) return `${origin}/rsvp/xac-nhan`;
  const idx = rawUrl.indexOf('/rsvp/');
  if (idx >= 0 && typeof window !== 'undefined' && window.location.origin) {
    return `${window.location.origin}${rawUrl.slice(idx)}`;
  }
  return rawUrl;
}

export function computeInterviewTimingNotice(startIsoOrTime?: string): {
  status: 'PAST' | 'SOON' | 'FUTURE' | null;
  label: string;
  shortLabel: string;
  color: 'error' | 'warning' | 'blue';
} {
  if (!startIsoOrTime) return { status: null, label: '', shortLabel: '', color: 'blue' };
  const parsed = dayjs(startIsoOrTime);
  if (!parsed.isValid()) return { status: null, label: '', shortLabel: '', color: 'blue' };
  const diffMin = Math.round(parsed.diff(dayjs(), 'minute', true));
  if (diffMin < 0) {
    return { status: 'PAST', label: 'Đã qua giờ hẹn phỏng vấn', shortLabel: 'Đã qua giờ · Đổi lịch', color: 'error' };
  }
  if (diffMin <= 180) {
    return {
      status: 'SOON',
      label: `Sắp tới giờ hẹn (${diffMin <= 1 ? 'ngay bây giờ' : `còn ${diffMin} phút`})`,
      shortLabel: `Còn ${Math.max(1, diffMin)}p · Đổi lịch`,
      color: 'warning',
    };
  }
  return { status: 'FUTURE', label: '', shortLabel: '', color: 'blue' };
}

/** Dựng nội dung tin nhắn xem trước từ mẫu của tài khoản Zalo và thông tin ứng viên / lịch phỏng vấn. */
export function renderLocalPreview(tpl: string, target: ZaloNotifyTarget, acc?: ZaloHrAccountItem, isGreeting = false): string {
  const rendered = tpl
    .replace(/\{candidate_name\}/g, target.candidateName || 'Bạn')
    .replace(/\{candidate_code\}/g, target.candidateCode || 'UV')
    .replace(/\{position\}/g, target.positionLabel || 'Nhân viên Cửa hàng')
    .replace(/\{branch_name\}/g, target.branchName || SYSTEM_CONFIG.brandName)
    .replace(/\{brand_name\}/g, SYSTEM_CONFIG.brandName)
    .replace(/\{interview_time\}/g, target.interviewTime || 'theo lịch hẹn')
    .replace(/\{meet_link\}/g, target.meetLink || 'https://meet.google.com/umb-milk-hr')
    .replace(/\{rsvp_url\}/g, normalizeClientRsvpUrl(target.rsvpUrl))
    .replace(/\{hr_zalo_name\}/g, acc?.zalo_name || `HR ${SYSTEM_CONFIG.brandName}`)
    .replace(/\{hr_zalo_phone\}/g, acc?.zalo_phone || '0901000002')
    .replace(/\{minutes_left\}/g, '10')
    .trim();
  return isGreeting && rendered.length > 150 ? rendered.slice(0, 150).trim() : rendered;
}
