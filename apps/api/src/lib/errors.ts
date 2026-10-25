import type { ApiErrorCode, ValidationErrorCode, ValidationErrorDetail } from '@umbm/shared';

/**
 * Lỗi nghiệp vụ & kiểm tra dữ liệu chuẩn hóa.
 * Error handler toàn cục chuyển thành cấu trúc:
 * {
 *   success: false,
 *   message: string,
 *   data: null,
 *   meta: null,
 *   errors: { code: string, details: ValidationErrorDetail[] },
 *   request_id: string
 * }
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorCode | string,
    message: string,
    public readonly details: ValidationErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: (msg = 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn') =>
    new AppError(401, 'UNAUTHORIZED', msg),

  forbidden: (msg = 'Bạn không có quyền thực hiện thao tác này') =>
    new AppError(403, 'FORBIDDEN', msg),

  notFound: (entity = 'Dữ liệu', rejectedValue: unknown = null) =>
    new AppError(
      404,
      'NOT_FOUND',
      `${entity} không tồn tại`,
      rejectedValue !== null
        ? [{ field: 'id', code: 'INVALID_VALUE', message: `${entity} không tồn tại`, rejected_value: rejectedValue }]
        : [],
    ),

  conflict: (msg = 'Dữ liệu đã bị người khác thay đổi, vui lòng tải lại', rejectedVersion?: unknown) =>
    new AppError(
      409,
      'VERSION_CONFLICT',
      msg,
      rejectedVersion !== undefined
        ? [{ field: 'version', code: 'INVALID_VALUE', message: msg, rejected_value: rejectedVersion }]
        : [],
    ),

  badRequest: (msg: string, details: ValidationErrorDetail[] = []) =>
    new AppError(400, details.length > 0 ? 'VALIDATION_ERROR' : 'BAD_REQUEST', msg, details),

  validation: (details: ValidationErrorDetail[], msg = 'Dữ liệu gửi lên không hợp lệ') =>
    new AppError(400, 'VALIDATION_ERROR', msg, details),

  fieldValidation: (
    field: string,
    code: ValidationErrorCode,
    message: string,
    rejectedValue: unknown,
    topMessage = 'Dữ liệu gửi lên không hợp lệ',
  ) =>
    new AppError(400, 'VALIDATION_ERROR', topMessage, [
      { field, code, message, rejected_value: rejectedValue ?? null },
    ]),

  locked: (msg: string) => new AppError(423, 'ACCOUNT_LOCKED', msg),

  syncPending: (msg = 'Dữ liệu chưa được ghi xác nhận lên Google Sheets, hệ thống đang thử lại') =>
    new AppError(503, 'SYNC_PENDING', msg),
};
