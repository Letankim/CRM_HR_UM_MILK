// Kiểu dữ liệu & hằng số dùng chung cho cụm quản lý tài khoản Zalo tuyển dụng.
export interface ZaloHrAccountItem {
  id: string; setting_key: string; owner_user_id: string; owner_username: string; owner_display_name: string;
  owner_role_label: string; zalo_name: string; zalo_phone: string; zalo_id: string; has_credentials: boolean;
  masked_credentials: string; encrypted_preview: string; is_default: boolean; status: 'ACTIVE' | 'INACTIVE';
  greeting_template: string; invite_template: string; reminder_template: string; pass_template: string;
  updated_at: string; version: number;
}

export interface QrSessionDto {
  session_id: string; qr_image?: string; qr_url: string; session_token: string;
  status: 'PENDING' | 'SCANNED' | 'CONFIRMED' | 'DECLINED' | 'EXPIRED'; expires_in: number;
  scanned_display_name?: string; scanned_avatar?: string; zalo_name?: string; zalo_phone?: string; saved_account?: ZaloHrAccountItem | null;
}

export const TEMPLATE_VARS = ['{candidate_name}', '{candidate_code}', '{position}', '{branch_name}', '{interview_time}', '{meet_link}', '{rsvp_url}', '{hr_zalo_name}', '{hr_zalo_phone}'];
