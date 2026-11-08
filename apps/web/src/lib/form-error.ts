import type { FormInstance } from 'antd';
import { ApiClientError } from './api';

export interface ApplyFormErrorsOptions {
  /** Bản đồ ánh xạ tên trường từ Backend sang tên trường trên Form (nếu khác nhau) */
  fieldAliases?: Record<string, string | string[]>;
  /** Tự động chuyển Tab khi trường bị lỗi nằm ở Tab khác */
  onFieldTabSwitch?: (firstRawField: string, firstResolvedField: string) => void;
  /** Thông báo mặc định khi lỗi không phải ApiClientError */
  fallbackMessage?: string;
}

const BUILTIN_FIELD_CANDIDATES: Record<string, string[]> = {
  phone: ['phone', 'phone_number', 'zalo_phone'],
  phone_number: ['phone_number', 'phone', 'zalo_phone'],
  branch_pref: ['applied_branch_id', 'branch_pref', 'branch_id'],
  applied_branch_id: ['applied_branch_id', 'branch_pref', 'branch_id'],
  staff_group: ['applied_position', 'staff_group'],
  applied_position: ['applied_position', 'staff_group'],
  scheduled_at: ['interview_slot', 'interview_date', 'scheduled_at'],
  close_at: ['due_date', 'due_time', 'close_at'],
  interviewer_id: ['interviewer_ids', 'interviewer_id'],
};

function toNamePath(field: string): string | string[] {
  return field.includes('.') ? field.split('.') : field;
}

function resolveTargetFields(
  rawField: string,
  knownValues: Record<string, unknown>,
  customAliases?: Record<string, string | string[]>,
): string[] {
  const custom = customAliases?.[rawField];
  if (custom) return Array.isArray(custom) ? custom : [custom];

  if (rawField.includes('.')) return [rawField];
  if (rawField in knownValues) return [rawField];

  const candidates = BUILTIN_FIELD_CANDIDATES[rawField];
  if (candidates) {
    const matched = candidates.filter((c) => c in knownValues);
    if (matched.length > 0) return matched;
    return [candidates[0]!];
  }
  return [rawField];
}

/**
 * Áp dụng danh sách lỗi từng trường (err.details) từ Backend vào Ant Design Form
 * để tô đỏ trực tiếp ô nhập liệu bị lỗi, tự động chuyển Tab (nếu có) và cuộn tới ô đó.
 * Trả về thông điệp lỗi tiếng Việt cụ thể để truyền vào message.error(...).
 */
export function applyApiFormErrors(
  form: FormInstance | undefined | null,
  err: unknown,
  options?: ApplyFormErrorsOptions,
): string {
  const fallback = options?.fallbackMessage ?? 'Dữ liệu gửi lên không hợp lệ, vui lòng kiểm tra lại';

  if (err instanceof ApiClientError) {
    if (form && err.details.length > 0) {
      const knownValues = (form.getFieldsValue(true) ?? {}) as Record<string, unknown>;
      const fieldErrorMap = new Map<string, { name: string | string[]; errors: string[] }>();
      let firstRaw = '';
      let firstResolved = '';
      let firstNamePath: string | string[] | null = null;

      for (const detail of err.details) {
        const rawField = String(detail.field || '').trim();
        if (!rawField) continue;
        const targets = resolveTargetFields(rawField, knownValues, options?.fieldAliases);
        for (const target of targets) {
          const namePath = toNamePath(target);
          const key = Array.isArray(namePath) ? namePath.join('.') : namePath;
          if (!firstRaw) {
            firstRaw = rawField;
            firstResolved = target;
            firstNamePath = namePath;
          }
          const existing = fieldErrorMap.get(key);
          if (existing) {
            if (!existing.errors.includes(detail.message)) existing.errors.push(detail.message);
          } else {
            fieldErrorMap.set(key, { name: namePath, errors: [detail.message] });
          }
        }
      }

      if (fieldErrorMap.size > 0) {
        if (firstRaw && options?.onFieldTabSwitch) {
          options.onFieldTabSwitch(firstRaw, firstResolved);
        }
        form.setFields(Array.from(fieldErrorMap.values()) as never);
        if (firstNamePath) {
          const targetPath = firstNamePath;
          setTimeout(() => {
            try {
              form.scrollToField(targetPath as never, { behavior: 'smooth', block: 'center' });
            } catch {
              // ignore scroll error if modal is closing
            }
          }, 60);
        }
      }
    }

    if (err.details.length > 0) {
      return err.details.map((d) => d.message).join(' · ');
    }
    return err.message || fallback;
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

/**
 * Xóa trạng thái tô đỏ (lỗi từ Server) ngay khi người dùng chỉnh sửa lại ô nhập liệu đó.
 */
export function clearChangedFieldErrors(form: FormInstance, changedValues: Record<string, unknown>): void {
  const clears: { name: string | string[]; errors: string[] }[] = [];
  for (const [key, val] of Object.entries(changedValues)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      for (const subKey of Object.keys(val as Record<string, unknown>)) {
        const path = [key, subKey];
        if (form.getFieldError(path).length > 0) clears.push({ name: path, errors: undefined as unknown as string[] });
      }
    } else if (form.getFieldError(key).length > 0) {
      clears.push({ name: key, errors: undefined as unknown as string[] });
    }
  }
  if (clears.length > 0) {
    form.setFields(clears as never);
  }
}

/**
 * Đặt giá trị cho 1 hoặc nhiều trường trên Form và chỉ xóa mảng `errors` khi trường đó thực sự đang có lỗi.
 * Tránh lỗi `Warning: There may be circular references` của `rc-util/isEqual` khi so sánh `EMPTY_ERRORS` dùng chung.
 */
export function setFormFieldClean(form: FormInstance, name: string | string[], value: unknown): void {
  form.setFieldValue(name as never, value);
  if (form.getFieldError(name as never).length > 0) {
    form.setFields([{ name: name as never, errors: undefined as unknown as string[] }]);
  }
}

export function setFormFieldsClean(form: FormInstance, entries: { name: string | string[]; value: unknown }[]): void {
  const errorClears: { name: string | string[]; errors: string[] }[] = [];
  for (const entry of entries) {
    form.setFieldValue(entry.name as never, entry.value);
    if (form.getFieldError(entry.name as never).length > 0) {
      errorClears.push({ name: entry.name, errors: undefined as unknown as string[] });
    }
  }
  if (errorClears.length > 0) {
    form.setFields(errorClears as never);
  }
}
