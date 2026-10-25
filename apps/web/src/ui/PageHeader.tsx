import { Flex, Typography } from 'antd';
import type { ReactNode } from 'react';

/** Tiêu đề trang: gọn, một dòng mô tả, hành động bên phải. */
export function PageHeader({ title, description, extra }: { title: string; description?: string; extra?: ReactNode }) {
  return (
    <Flex justify="space-between" align="flex-start" gap={16} wrap style={{ marginBottom: 20 }}>
      <div style={{ minWidth: 0 }}>
        <Typography.Title level={4} style={{ margin: 0, fontWeight: 600 }}>
          {title}
        </Typography.Title>
        {description && (
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            {description}
          </Typography.Text>
        )}
      </div>
      {extra && <Flex gap={8} wrap>{extra}</Flex>}
    </Flex>
  );
}
