import { Tag } from 'antd';
import { STATUS_VISUAL_MAP } from '@umbm/shared';

const COLOR_MAP: Record<string, string> = {
  success: 'green',
  processing: 'blue',
  warning: 'gold',
  error: 'red',
  default: 'default',
};

/** Màu bổ sung cho trạng thái hồ sơ lương / phiếu lương */
const EXTRA_COLORS: Record<string, string> = { SCHEDULED: 'processing', MISSING: 'warning', REVISED: 'default' };

/**
 * Component hiển thị trạng thái đồng nhất toàn hệ thống, lấy trực tiếp từ STATUS_VISUAL_MAP (@umbm/shared).
 * Giữ viền mảnh sắc nét (bordered={true}, borderRadius: 2px) theo chuẩn 3DO ADMIN.
 * `label` (tùy chọn) cho phép ghi đè nhãn tiếng Việt theo ngữ cảnh (ví dụ: "Đang áp dụng" cho hồ sơ lương).
 */
export function StatusTag({ value, label }: { value: string; label?: string }) {
  const visual = STATUS_VISUAL_MAP[value] ?? { color: EXTRA_COLORS[value] ?? 'default', label: value };
  return (
    <Tag
      color={COLOR_MAP[visual.color] ?? 'default'}
      style={{
        marginInlineEnd: 0,
        borderRadius: 2,
        fontWeight: 500,
        fontSize: 12,
        paddingInline: 8,
      }}
    >
      {label ?? visual.label}
    </Tag>
  );
}
