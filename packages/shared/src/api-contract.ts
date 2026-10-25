import { z } from 'zod';
import { API_ERROR_CODES, VALIDATION_ERROR_CODES, type ApiErrorCode, type ValidationErrorCode } from './enums.js';

/**
 * Hợp đồng chuẩn cho toàn bộ API Response của hệ thống Ụm Bò Milk HR V5.1.
 *
 * Mẫu thành công (List / Single):
 * {
 *   "success": true,
 *   "message": "Lấy danh sách tài khoản thành công",
 *   "data": [...],
 *   "meta": {
 *     "pagination": {
 *       "page": 1,
 *       "per_page": 12,
 *       "total": 2,
 *       "last_page": 1,
 *       "has_next_page": false,
 *       "has_previous_page": false
 *     },
 *     "sort": { "sort_by": "created_at", "sort_order": "desc" },
 *     "filters": { "status": "ACTIVE" }
 *   },
 *   "errors": null,
 *   "request_id": "req_6ab3918cae0ee00a"
 * }
 *
 * Mẫu lỗi (Validation / Business Error):
 * {
 *   "success": false,
 *   "message": "Dữ liệu gửi lên không hợp lệ",
 *   "data": null,
 *   "meta": null,
 *   "errors": {
 *     "code": "VALIDATION_ERROR",
 *     "details": [
 *       {
 *         "field": "phone_number",
 *         "code": "INVALID_PHONE",
 *         "message": "Định dạng số điện thoại không hợp lệ",
 *         "rejected_value": "1865341745"
 *       }
 *     ]
 *   },
 *   "request_id": "req_c6c37e0e29c8847e"
 * }
 */

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  last_page: number;
  has_next_page: boolean;
  has_previous_page: boolean;
}

export interface SortMeta {
  sort_by: string;
  sort_order: SortOrder;
}

export interface ListMeta {
  pagination: PaginationMeta;
  sort: SortMeta;
  filters: Record<string, string>;
}

export interface ValidationErrorDetail {
  field: string;
  code: ValidationErrorCode | string;
  message: string;
  rejected_value: unknown;
}

export interface ApiErrorPayload {
  code: ApiErrorCode | string;
  details: ValidationErrorDetail[];
}

export interface ApiSuccessEnvelope<TData, TMeta = ListMeta | Record<string, unknown> | null> {
  success: true;
  message: string;
  data: TData;
  meta: TMeta;
  errors: null;
  request_id: string;
}

export interface ApiErrorEnvelope {
  success: false;
  message: string;
  data: null;
  meta: null;
  errors: ApiErrorPayload;
  request_id: string;
}

export type ApiEnvelope<TData, TMeta = ListMeta | Record<string, unknown> | null> =
  | ApiSuccessEnvelope<TData, TMeta>
  | ApiErrorEnvelope;

/** Schema kiểm tra query phân trang, tìm kiếm, sắp xếp dùng chung cho các API danh sách */
export const zListQueryBase = z.object({
  page: z.coerce.number().int().min(1, 'Trang phải lớn hơn hoặc bằng 1').default(1),
  per_page: z.coerce.number().int().min(1, 'Số dòng mỗi trang tối thiểu là 1').max(100, 'Số dòng mỗi trang tối đa là 100').default(12),
  sort_by: z.string().trim().max(64, 'Trường sắp xếp không hợp lệ').optional(),
  sort_order: z.enum(SORT_ORDERS, { errorMap: () => ({ message: 'Thứ tự sắp xếp chỉ nhận asc hoặc desc' }) }).default('desc'),
  q: z.string().trim().max(120, 'Từ khóa tìm kiếm tối đa 120 ký tự').optional(),
});
export type ListQueryBase = z.infer<typeof zListQueryBase>;

export const zValidationErrorDetail = z.object({
  field: z.string(),
  code: z.enum(VALIDATION_ERROR_CODES).or(z.string()),
  message: z.string(),
  rejected_value: z.unknown(),
});

export const zApiErrorPayload = z.object({
  code: z.enum(API_ERROR_CODES).or(z.string()),
  details: z.array(zValidationErrorDetail),
});
