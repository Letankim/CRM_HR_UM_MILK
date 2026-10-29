'use client';

import dayjs from 'dayjs';
import type { TicketCategory, TicketDepartment, TicketMessage, TicketPriority, TicketStatus } from '@umbm/shared';
import { exportToExcel } from '@/lib/export-excel';

export interface TicketAssigneeOption {
  id: string;
  username: string;
  displayName: string;
  role: TicketDepartment;
  roleLabel: string;
  department: TicketDepartment;
  departmentLabel: string;
  branchId: string;
  branchName: string;
}

export interface LinkedPayslipTicketSummary {
  id: string;
  ticketCode: string;
  status: TicketStatus;
  statusLabel: string;
  department: TicketDepartment;
  departmentLabel: string;
  assigneeName: string;
  messageCount: number;
}

export interface SupportTicketItem {
  id: string;
  version: number;
  created_at: string;
  updated_at: string;
  ticket_code: string;
  requester_user_id: string;
  requester_employee_id: string;
  requesterName: string;
  requesterCode: string;
  requesterRole: string;
  requesterRoleLabel: string;
  branch_id: string;
  branchName: string;
  category: TicketCategory;
  categoryLabel: string;
  priority: TicketPriority;
  priorityLabel: string;
  target_department: TicketDepartment;
  departmentLabel: string;
  assignee_user_id: string;
  assigneeName: string;
  assigneeRoleLabel: string;
  subject: string;
  description: string;
  related_entity_type: string;
  related_entity_id: string;
  related_label: string;
  status: TicketStatus;
  statusLabel: string;
  resolution_note: string;
  resolved_by: string;
  resolvedByName: string;
  resolved_at: string;
  closed_at: string;
  isRequester?: boolean;
  isAssignedToMe?: boolean;
  canForward?: boolean;
  messages: TicketMessage[];
  messageCount: number;
}

export const DEFAULT_DEPT_BY_CATEGORY: Record<TicketCategory, TicketDepartment> = {
  PAYSLIP_INQUIRY: 'FINANCE',
  ATTENDANCE_SCHEDULE: 'HR',
  HR_POLICY: 'HR',
  STORE_OPERATION: 'STORE',
  ACCOUNT_SYSTEM: 'ADMIN',
  OTHER: 'HR',
};

export function exportTicketsExcel(rows: SupportTicketItem[]) {
  exportToExcel({
    fileName: `Danh_Sach_Phieu_Ho_Tro_${dayjs().format('YYYYMMDD_HHmm')}.xls`,
    sheetTitle: 'DANH SÁCH PHIẾU HỖ TRỢ & GIẢI ĐÁP THẮC MẮC NỘI BỘ',
    subtitle: `Tổng số phiếu: ${rows.length} | Ngày xuất: ${dayjs().format('DD/MM/YYYY HH:mm')}`,
    columns: [
      { header: 'Mã phiếu', key: 'ticket_code' },
      { header: 'Tiêu đề', key: 'subject' },
      { header: 'Phân loại', key: 'categoryLabel' },
      { header: 'Mức ưu tiên', key: 'priorityLabel' },
      { header: 'Người gửi', render: (r) => `${r.requesterName}${r.requesterCode ? ` (${r.requesterCode})` : ''}` },
      { header: 'Chi nhánh', key: 'branchName' },
      { header: 'Bộ phận tiếp nhận', key: 'departmentLabel' },
      { header: 'Người phụ trách', key: 'assigneeName' },
      { header: 'Trạng thái', key: 'statusLabel' },
      { header: 'Số phản hồi', key: 'messageCount', align: 'right' },
      { header: 'Ngày tạo', render: (r) => dayjs(r.created_at).format('DD/MM/YYYY HH:mm') },
      { header: 'Kết quả / Ghi chú xử lý', key: 'resolution_note' },
    ],
    rows,
  });
}
