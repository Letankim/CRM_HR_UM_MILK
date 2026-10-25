import type { FastifyRequest } from 'fastify';
import type { ZodError, ZodIssue } from 'zod';
import type {
  ApiErrorEnvelope,
  ApiSuccessEnvelope,
  ListMeta,
  ValidationErrorCode,
  ValidationErrorDetail,
} from '@umbm/shared';
import type { PaginatedResult } from './list-query.js';

/**
 * Trả về JSON thành công theo đúng chuẩn doanh nghiệp.
 */
export function sendSuccess<TData, TMeta = Record<string, unknown> | null>(
  request: FastifyRequest,
  message: string,
  data: TData,
  meta: TMeta = null as TMeta,
): ApiSuccessEnvelope<TData, TMeta> {
  return {
    success: true,
    message,
    data,
    meta,
    errors: null,
    request_id: String(request.id),
  };
}

/**
 * Trả về JSON danh sách kèm phân trang, sắp xếp, bộ lọc theo đúng chuẩn.
 */
export function sendPaginated<TItem>(
  request: FastifyRequest,
  message: string,
  result: PaginatedResult<TItem>,
): ApiSuccessEnvelope<TItem[], ListMeta> {
  return {
    success: true,
    message,
    data: result.items,
    meta: result.meta,
    errors: null,
    request_id: String(request.id),
  };
}

/**
 * Trả về JSON lỗi theo đúng chuẩn.
 */
export function buildErrorEnvelope(
  request: FastifyRequest,
  code: string,
  message: string,
  details: ValidationErrorDetail[] = [],
): ApiErrorEnvelope {
  return {
    success: false,
    message,
    data: null,
    meta: null,
    errors: {
      code,
      details,
    },
    request_id: String(request.id),
  };
}

function getValueAtPath(source: unknown, path: (string | number)[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[key];
  }
  return current ?? null;
}

function inferValidationCode(field: string, issue: ZodIssue): ValidationErrorCode {
  const lower = field.toLowerCase();
  if (issue.code === 'invalid_type' && (issue.received === 'undefined' || issue.received === 'null')) {
    return 'REQUIRED_FIELD';
  }
  if (lower.includes('phone')) return 'INVALID_PHONE';
  if (lower.includes('email')) return 'INVALID_EMAIL';
  if (lower.includes('date') || lower.endsWith('_at')) return 'INVALID_DATE';
  if (issue.code === 'invalid_enum_value') return 'INVALID_ENUM';
  if (issue.code === 'too_small') {
    return issue.type === 'string' ? 'TOO_SHORT' : 'OUT_OF_RANGE';
  }
  if (issue.code === 'too_big') {
    return issue.type === 'string' ? 'TOO_LONG' : 'OUT_OF_RANGE';
  }
  if (issue.code === 'invalid_type') return 'INVALID_TYPE';
  return 'INVALID_FORMAT';
}

function translateZodMessage(field: string, issue: ZodIssue, code: ValidationErrorCode): string {
  // Nếu thông báo gốc đã là tiếng Việt (không phải thông báo mặc định tiếng Anh của Zod), giữ nguyên
  const msg = issue.message;
  const isDefaultEnglish =
    /^(Required|Expected|Invalid|String must|Number must|Array must)/i.test(msg);
  if (!isDefaultEnglish && msg.trim().length > 0) {
    return msg;
  }
  switch (code) {
    case 'REQUIRED_FIELD':
      return `Trường ${field} là bắt buộc`;
    case 'INVALID_PHONE':
      return 'Định dạng số điện thoại không hợp lệ';
    case 'INVALID_EMAIL':
      return 'Định dạng địa chỉ email không hợp lệ';
    case 'INVALID_DATE':
      return `Định dạng ngày/thời gian của trường ${field} không hợp lệ`;
    case 'INVALID_ENUM':
      return `Giá trị của trường ${field} không nằm trong danh sách cho phép`;
    case 'TOO_SHORT':
      return `Trường ${field} quá ngắn so với quy định`;
    case 'TOO_LONG':
      return `Trường ${field} vượt quá độ dài tối đa cho phép`;
    case 'OUT_OF_RANGE':
      return `Giá trị của trường ${field} nằm ngoài phạm vi cho phép`;
    case 'INVALID_TYPE':
      return `Kiểu dữ liệu của trường ${field} không hợp lệ`;
    default:
      return `Giá trị của trường ${field} không hợp lệ`;
  }
}

/**
 * Chuyển đổi ZodError sang mảng chi tiết lỗi chuẩn { field, code, message, rejected_value }.
 */
export function formatZodError(error: ZodError, request: FastifyRequest): ValidationErrorDetail[] {
  const source =
    request.method === 'GET' || request.method === 'DELETE'
      ? request.query
      : request.body ?? request.query;

  return error.issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join('.') : 'payload';
    const code = inferValidationCode(field, issue);
    const rejectedValue = issue.path.length > 0 ? getValueAtPath(source, issue.path) : (source ?? null);
    return {
      field,
      code,
      message: translateZodMessage(field, issue, code),
      rejected_value: rejectedValue === undefined ? null : rejectedValue,
    };
  });
}
