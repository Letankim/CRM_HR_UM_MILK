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
  meetLink?: string;
  rsvpUrl?: string;
  candidateConfirmed?: boolean;
  defaultTemplateType?: 'GREETING' | 'INVITE' | 'REMINDER' | 'PASS';
}

/** Dựng nội dung tin nhắn xem trước từ mẫu của tài khoản Zalo và thông tin ứng viên / lịch phỏng vấn. */
export function renderLocalPreview(tpl: string, target: ZaloNotifyTarget, acc?: ZaloHrAccountItem, isGreeting = false): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const rendered = tpl
    .replace(/\{candidate_name\}/g, target.candidateName || 'Bạn')
    .replace(/\{candidate_code\}/g, target.candidateCode || 'UV')
    .replace(/\{position\}/g, target.positionLabel || 'Nhân viên Cửa hàng')
    .replace(/\{branch_name\}/g, target.branchName || SYSTEM_CONFIG.brandName)
    .replace(/\{brand_name\}/g, SYSTEM_CONFIG.brandName)
    .replace(/\{interview_time\}/g, target.interviewTime || 'theo lịch hẹn')
    .replace(/\{meet_link\}/g, target.meetLink || 'https://meet.google.com/umb-milk-hr')
    .replace(/\{rsvp_url\}/g, target.rsvpUrl || `${origin}/rsvp/xac-nhan`)
    .replace(/\{hr_zalo_name\}/g, acc?.zalo_name || `HR ${SYSTEM_CONFIG.brandName}`)
    .replace(/\{hr_zalo_phone\}/g, acc?.zalo_phone || '0901000002')
    .replace(/\{minutes_left\}/g, '10')
    .trim();
  return isGreeting && rendered.length > 150 ? rendered.slice(0, 150).trim() : rendered;
}
